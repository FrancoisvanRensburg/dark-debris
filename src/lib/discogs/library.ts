/**
 * Fetch a logged-in user's Discogs wantlist and collection, normalised to a
 * single shape the match/suggest layers can consume.
 *
 * Both endpoints return items whose `basic_information` already carries
 * `master_id`, `genres`, `styles` and `thumb`, so no per-release calls are
 * needed — we page through and normalise in place.
 *
 * Rate limit is 60 req/min *per token*, i.e. per logged-in user, so one large
 * library only slows that user's own load. We still cap total pages so a
 * pathological library can't blow the Worker subrequest limit; callers get
 * `truncated: true` when that happens.
 */

import { discogsGet, type Consumer, type Token } from "./oauth";

/** A wantlist/collection entry, normalised. `source` tags which list it came from. */
export interface LibraryItem {
  releaseId: number;
  masterId: number;
  artist: string;
  title: string;
  thumb: string;
  genres: string[];
  styles: string[];
  source: "wanted" | "owned";
}

export interface Library {
  username: string;
  wanted: LibraryItem[];
  owned: LibraryItem[];
  /** True if either list hit the page cap and was not fully fetched. */
  truncated: boolean;
}

const PER_PAGE = 100;
/** Safety cap: 60 pages ≈ 6000 items per list, well under the subrequest limit. */
const MAX_PAGES = 60;

/** Shape of the `basic_information` block shared by both endpoints. */
interface BasicInformation {
  id?: number;
  master_id?: number;
  title?: string;
  thumb?: string;
  genres?: string[];
  styles?: string[];
  artists?: Array<{ name?: string; anv?: string; join?: string }>;
}

interface Pagination {
  page: number;
  pages: number;
}

/**
 * Join a release's artists into a single display string, stripping Discogs'
 * `(2)` disambiguation suffixes and honouring `join` phrases ("feat.", "&").
 */
function artistName(artists: BasicInformation["artists"]): string {
  if (!artists || artists.length === 0) return "";
  let out = "";
  artists.forEach((a, i) => {
    const name = (a.anv?.trim() || a.name?.trim() || "").replace(/\s*\(\d+\)$/, "");
    if (i > 0) {
      const join = a.join?.trim();
      out += join ? ` ${join} ` : ", ";
    }
    out += name;
  });
  return out.trim();
}

function normalise(basic: BasicInformation | undefined, source: LibraryItem["source"]): LibraryItem {
  const b = basic ?? {};
  return {
    releaseId: b.id ?? 0,
    masterId: b.master_id ?? 0,
    artist: artistName(b.artists),
    title: (b.title ?? "").trim(),
    thumb: b.thumb ?? "",
    genres: b.genres ?? [],
    styles: b.styles ?? [],
    source,
  };
}

/**
 * Page through a Discogs list endpoint, pulling `basic_information` out of each
 * row via `pick`. Returns the normalised items and whether we hit the page cap.
 */
async function fetchAll(
  consumer: Consumer,
  access: Token,
  buildPath: (page: number) => string,
  pick: (json: Record<string, unknown>) => unknown[],
  source: LibraryItem["source"],
): Promise<{ items: LibraryItem[]; truncated: boolean }> {
  const items: LibraryItem[] = [];
  let page = 1;
  let pages = 1;

  do {
    const res = await discogsGet(consumer, access, buildPath(page));
    if (!res.ok) {
      throw new Error(`Discogs ${source} fetch failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const rows = pick(json);
    for (const row of rows) {
      items.push(normalise((row as { basic_information?: BasicInformation }).basic_information, source));
    }
    pages = (json.pagination as Pagination | undefined)?.pages ?? 1;
    page += 1;
  } while (page <= pages && page <= MAX_PAGES);

  return { items, truncated: pages > MAX_PAGES };
}

/** Fetch and normalise the user's wantlist. */
export async function fetchWantlist(
  consumer: Consumer,
  access: Token,
  username: string,
): Promise<{ items: LibraryItem[]; truncated: boolean }> {
  return fetchAll(
    consumer,
    access,
    (page) => `/users/${encodeURIComponent(username)}/wants?per_page=${PER_PAGE}&page=${page}`,
    (json) => (Array.isArray(json.wants) ? (json.wants as unknown[]) : []),
    "wanted",
  );
}

/** Fetch and normalise the user's collection (folder 0 = "All"). */
export async function fetchCollection(
  consumer: Consumer,
  access: Token,
  username: string,
): Promise<{ items: LibraryItem[]; truncated: boolean }> {
  return fetchAll(
    consumer,
    access,
    (page) =>
      `/users/${encodeURIComponent(username)}/collection/folders/0/releases?per_page=${PER_PAGE}&page=${page}`,
    (json) => (Array.isArray(json.releases) ? (json.releases as unknown[]) : []),
    "owned",
  );
}

/** Fetch both lists for a user and return the combined, tagged library. */
export async function fetchLibrary(
  consumer: Consumer,
  access: Token,
  username: string,
): Promise<Library> {
  const [wants, coll] = await Promise.all([
    fetchWantlist(consumer, access, username),
    fetchCollection(consumer, access, username),
  ]);
  return {
    username,
    wanted: wants.items,
    owned: coll.items,
    truncated: wants.truncated || coll.truncated,
  };
}
