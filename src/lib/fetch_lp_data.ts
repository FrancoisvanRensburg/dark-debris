/**
 * Ingest a raw supplier catalogue and enrich it with Discogs metadata.
 *
 * Supplier catalogues arrive periodically as raw UPPERCASE lists
 * (FMT/ARTIST/TITLE/PRICE/NOTES), each a full snapshot of what's currently
 * available. Enriched records accumulate in a single canonical file
 * (src/data/catalog.json). On each run we diff the incoming catalogue against
 * what we already have (by artist + title): only LPs we haven't seen before are
 * queried on Discogs and appended, and every catalogue row's `available` flag is
 * refreshed — rows absent from the incoming snapshot are marked unavailable
 * (sold) rather than deleted, so they can still be shown as such.
 *
 * Usage:
 *   DISCOGS_TOKEN=xxxxx node --experimental-strip-types src/lib/fetch_lp_data.ts
 *   DISCOGS_TOKEN=xxxxx node --experimental-strip-types src/lib/fetch_lp_data.ts <input.json> <catalogue.json>
 *
 * Get a personal access token at: https://www.discogs.com/settings/developers
 * (Generate new token). Read-only database access needs nothing more than this
 * token — the OAuth flow is only for acting on behalf of other users.
 *
 * Re-running is safe: newly enriched rows are appended to the catalogue as they
 * complete, so their artist+title keys are already present on the next run and
 * get skipped. An interrupted run resumes where it left off.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const TOKEN = process.env.DISCOGS_TOKEN;
if (!TOKEN) {
  console.error("Missing DISCOGS_TOKEN env var. Get one at https://www.discogs.com/settings/developers");
  process.exit(1);
}

const INPUT_FILE = resolve(process.argv[2] ?? "src/lib/data/2026-07.json");
const CATALOG_FILE = resolve(process.argv[3] ?? "src/data/catalog.json");
const USER_AGENT = "DarkDebrisRatings/1.0 +https://github.com/FrancoisvanRensburg";
const BASE = "https://api.discogs.com";

// Discogs allows 60 authenticated requests/minute. Stay comfortably under it.
const MIN_INTERVAL_MS = 1100;

/** A raw row from a supplier catalogue (keys may be upper- or lowercase). */
interface RawEntry {
  FMT?: string;
  ARTIST?: string;
  TITLE?: string;
  PRICE?: number;
  NOTES?: string;
}

/** The normalised catalogue row this script produces. */
interface Entry {
  artist: string;
  title: string;
  fmt: string;
  price: number;
  notes?: string;
  // True when the LP is on the latest supplier snapshot; false once it drops off
  // (sold / no longer stocked).
  available: boolean;
  // `masterId` is the album-level join key: it's shared by every pressing
  // (German, French, reissue, …), so it's what a user's wantlist should match
  // against. `releaseId` is the specific pressing the rating below came from.
  masterId?: number;
  releaseId?: number;
  discogsRating?: number;
  discogsVotes?: number;
  genres?: string[];
  styles?: string[];
  thumb?: string;
  discogsUrl?: string;
  // Fuzzy similarity (0–1) between our "artist – title" and the matched Discogs
  // release. Low values flag likely mismatches for manual review.
  matchConfidence?: number;
}

// Search is used only to find the right release id + confirm it's vinyl. Its
// master_id / thumb / cover_image fields are unreliable (auth-gated and often
// empty), so we don't read metadata from here.
interface SearchResult {
  id: number;
  title?: string;
  format?: string[];
}

// The release endpoint is the authoritative source for everything we store.
interface ReleaseResponse {
  master_id?: number;
  genres?: string[];
  styles?: string[];
  thumb?: string; // top-level 150px thumbnail
  images?: { type?: string; uri?: string; uri150?: string }[];
  formats?: { name?: string }[];
  community?: { rating?: { average?: number; count?: number } };
}

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/** Fetch JSON from Discogs, respecting rate limits and retrying on 429. */
async function discogs<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Authorization: `Discogs token=${TOKEN}`,
      },
    });

    if (res.status === 429) {
      const backoff = 2000 * (attempt + 1);
      console.warn(`  rate limited, backing off ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Discogs ${res.status} for ${path}: ${await res.text()}`);
    }

    // If we're running low on the per-minute budget, ease off proactively.
    const remaining = Number(res.headers.get("X-Discogs-Ratelimit-Remaining"));
    if (Number.isFinite(remaining) && remaining <= 2) {
      await new Promise((r) => setTimeout(r, 5000));
    }
    return (await res.json()) as T;
  }
}

/** Coerce a value to a trimmed string (supplier files sometimes type a
 * number-like title/artist, e.g. Robert Wyatt's "68", as a JSON number). */
function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** Coerce a raw supplier row into the normalised schema. */
function normalise(row: RawEntry): Entry {
  const notes = str(row.NOTES);
  return {
    artist: str(row.ARTIST),
    title: str(row.TITLE),
    fmt: str(row.FMT) || "LP",
    price: typeof row.PRICE === "number" ? row.PRICE : Number(row.PRICE) || 0,
    ...(notes ? { notes } : {}),
    available: true, // input rows are, by definition, on the current snapshot
  };
}

/** Strip format suffixes so the title matches Discogs' catalogue. */
function cleanTitle(title: string): string {
  return title
    .replace(/\([^)]*\)/g, "")   // (2LP), (2X12"), (PIC DISC) ...
    .replace(/\bE\.?P\.?\b/gi, "")
    .replace(/\d+"\s*$/, "")       // trailing 12"
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable identity for an album across catalogues: artist + cleaned title. */
function key(artist: string, title: string): string {
  return `${artist.toUpperCase().trim()}||${cleanTitle(title).toUpperCase()}`;
}

/** Human-readable duration, e.g. "14m 03s". */
function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** Normalise to alphanumerics for fuzzy comparison. */
function normStr(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Sørensen–Dice similarity on character bigrams, 0–1. */
function similarity(a: string, b: string): number {
  const na = normStr(a);
  const nb = normStr(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };

  const ma = bigrams(na);
  let overlap = 0;
  for (const [g, c] of bigrams(nb)) overlap += Math.min(c, ma.get(g) ?? 0);
  return (2 * overlap) / (na.length - 1 + (nb.length - 1));
}

async function enrich(entry: Entry): Promise<void> {
  const title = cleanTitle(entry.title);
  const q = new URLSearchParams({
    artist: entry.artist,
    release_title: title,
    type: "release",
    format: "Vinyl", // this is a vinyl catalogue — exclude CD/digital/etc.
    per_page: "5",
  });

  const search = await discogs<{ results: SearchResult[] }>(`/database/search?${q}`);
  const all = search.results ?? [];
  // The format facet should already exclude non-vinyl, but double-check the
  // returned formats and fall back to all results only if none report vinyl.
  const vinyl = all.filter((r) => r.format?.some((f) => /vinyl|\bLP\b/i.test(f)));
  const results = vinyl.length ? vinyl : all;
  if (results.length === 0) {
    console.warn(`  no vinyl Discogs match for "${entry.artist} — ${title}"`);
    entry.genres = [];
    entry.styles = [];
    entry.matchConfidence = 0;
    return;
  }

  // Discogs results are ordered by its own relevance, but the top hit isn't
  // always the right release. Re-rank the candidates by fuzzy similarity to our
  // "artist – title" and keep the best, recording the score as confidence.
  const target = `${entry.artist} - ${title}`;
  let hit = results[0];
  let confidence = similarity(target, hit.title ?? "");
  for (const r of results.slice(1)) {
    const score = similarity(target, r.title ?? "");
    if (score > confidence) {
      confidence = score;
      hit = r;
    }
  }
  entry.matchConfidence = Math.round(confidence * 100) / 100;
  if (confidence < 0.6) {
    console.warn(`  ⚠ low confidence ${entry.matchConfidence} — "${hit.title}" for "${target}"`);
  }

  // Pull the actual metadata from the release itself — the search result omits
  // master_id and reliable images, but the release has master_id, thumb, images,
  // genres, styles and the community rating all in one payload.
  const release = await discogs<ReleaseResponse>(`/releases/${hit.id}`);

  entry.releaseId = hit.id;
  entry.masterId = release.master_id || 0;
  entry.genres = release.genres ?? [];
  entry.styles = release.styles ?? [];
  entry.thumb =
    release.thumb ||
    (release.images?.find((i) => i.type === "primary") ?? release.images?.[0])?.uri150 ||
    "";
  entry.discogsRating = release.community?.rating?.average ?? 0;
  entry.discogsVotes = release.community?.rating?.count ?? 0;
  // Link to the master (album) when there is one, else the specific release.
  entry.discogsUrl = entry.masterId
    ? `https://www.discogs.com/master/${entry.masterId}`
    : `https://www.discogs.com/release/${hit.id}`;

  console.log(
    `  ✓ ${entry.genres.join(", ") || "—"} | ${entry.styles.join(", ") || "—"} | ` +
      `★ ${entry.discogsRating} (${entry.discogsVotes}) | master ${entry.masterId} | ` +
      `conf ${entry.matchConfidence}`,
  );
}

async function readCatalog(): Promise<Entry[]> {
  try {
    return JSON.parse(await readFile(CATALOG_FILE, "utf8")) as Entry[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function main(): Promise<void> {
  const rawInput: RawEntry[] = JSON.parse(await readFile(INPUT_FILE, "utf8"));
  const catalog = await readCatalog();

  // The incoming snapshot: every LP the supplier currently has, keyed by
  // artist + cleaned title (section-header rows like { "ARTIST": "VINYL:" }
  // dropped).
  const normalisedInput = rawInput.map(normalise).filter((e) => e.title);
  const incomingKeys = new Set(normalisedInput.map((e) => key(e.artist, e.title)));

  // Refresh availability on everything we already have: on the snapshot → in
  // stock; absent from it → sold. We keep the row either way.
  let markedSold = 0;
  let backInStock = 0;
  for (const entry of catalog) {
    const avail = incomingKeys.has(key(entry.artist, entry.title));
    if (entry.available && !avail) markedSold++;
    if (!entry.available && avail) backInStock++;
    entry.available = avail;
  }

  // New LPs: not already in the catalogue, deduped within the incoming list.
  const seen = new Set(catalog.map((e) => key(e.artist, e.title)));
  const incomingSeen = new Set<string>();
  const newEntries = normalisedInput.filter((e) => {
    const k = key(e.artist, e.title);
    if (seen.has(k) || incomingSeen.has(k)) return false;
    incomingSeen.add(k);
    return true;
  });

  console.log(
    `${catalog.length} in catalogue, ${normalisedInput.length} on snapshot → ` +
      `${newEntries.length} new to enrich, ${markedSold} marked sold, ` +
      `${backInStock} back in stock.\n`,
  );

  await mkdir(dirname(CATALOG_FILE), { recursive: true });
  const save = () =>
    writeFile(
      CATALOG_FILE,
      JSON.stringify(
        [...catalog].sort((a, b) =>
          a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
        ),
        null,
        4,
      ) + "\n",
    );

  // Persist the availability refresh now, even if there are no new LPs to fetch.
  await save();

  const total = newEntries.length;
  const started = Date.now();
  let done = 0;
  let matched = 0;
  let lowConf = 0;
  let noMatch = 0;
  let errors = 0;

  for (const entry of newEntries) {
    done++;
    const pct = ((done / total) * 100).toFixed(0);
    console.log(`[${done}/${total}] ${pct}% — ${entry.artist} — ${entry.title}`);

    try {
      await enrich(entry);
      if (entry.releaseId) {
        matched++;
        if ((entry.matchConfidence ?? 0) < 0.6) lowConf++;
      } else {
        noMatch++;
      }
    } catch (err) {
      errors++;
      console.error(`  error: ${(err as Error).message}`);
    }

    catalog.push(entry); // append as we go, so an interrupted run is resumable
    await save();

    // Progress heartbeat: tally so far + ETA from the average pace.
    const elapsed = (Date.now() - started) / 1000;
    const eta = Math.round((elapsed / done) * (total - done));
    console.log(
      `  progress: ✓ ${matched} matched (${lowConf} low-conf), ✗ ${noMatch} no-match` +
        `${errors ? `, ${errors} errors` : ""} · ~${fmtDuration(eta)} left`,
    );
  }

  console.log(
    `\nDone in ${fmtDuration((Date.now() - started) / 1000)}. Added ${done} LP(s): ` +
      `${matched} matched (${lowConf} low-conf), ${noMatch} no-match` +
      `${errors ? `, ${errors} errors` : ""} → ${CATALOG_FILE} (${catalog.length} total)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});