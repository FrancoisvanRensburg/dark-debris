/**
 * Join the catalogue against a user's Discogs library (wantlist + collection).
 *
 * Primary key is `masterId` (album-level, shared across pressings), so a
 * catalogue row and a library entry match even when they're different pressings
 * of the same album. For rows/entries with `masterId === 0` (no master on
 * Discogs) we fall back to a normalised artist+title key.
 *
 * Pure and dependency-free so it runs in the browser bundle as well as on the
 * server — the frontend imports it to tag catalogue rows after fetching
 * `/api/library`.
 */

/** Minimal shape shared by library entries and catalogue rows. */
export interface Matchable {
  artist: string;
  title: string;
  masterId?: number;
}

export interface LibraryLike {
  wanted: Matchable[];
  owned: Matchable[];
}

export interface MatchSets {
  wantedMasters: Set<number>;
  ownedMasters: Set<number>;
  /** Fallback keys for entries whose masterId is 0. */
  wantedKeys: Set<string>;
  ownedKeys: Set<string>;
}

/** `owned` wins over `wanted` so we never recommend buying something you own. */
export type MatchTag = "owned" | "wanted" | null;

/**
 * Strip diacritics and non-alphanumerics so "Café" ≈ "cafe". NFKD splits an
 * accented letter into base + combining mark; the alphanumeric filter then
 * drops the mark (and every other separator) in one pass.
 */
function normStr(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
}

/** Drop pressing/format noise ("(2LP)", "E.P.", trailing 12") before keying. */
function cleanTitle(t: string): string {
  return t
    .replace(
      /\((?:[^)]*\b(?:lp|ep|reissue|re-?issue|remaster(?:ed)?|mono|stereo|deluxe|edition|disc|vinyl)\b[^)]*)\)/gi,
      " ",
    )
    .replace(/\b\d*\s*x?\s*lp\b/gi, " ")
    .replace(/\be\.?p\.?\b/gi, " ")
    .replace(/\d+"\s*$/g, " ")
    .trim();
}

/** Normalised artist+title key used only when masterId is unavailable. */
export function normKey(artist: string, title: string): string {
  return `${normStr(artist)}|${normStr(cleanTitle(title))}`;
}

/** Build the lookup sets once, then tag many catalogue rows against them. */
export function buildMatchSets(library: LibraryLike): MatchSets {
  const sets: MatchSets = {
    wantedMasters: new Set(),
    ownedMasters: new Set(),
    wantedKeys: new Set(),
    ownedKeys: new Set(),
  };

  for (const item of library.owned) {
    if (item.masterId) sets.ownedMasters.add(item.masterId);
    sets.ownedKeys.add(normKey(item.artist, item.title));
  }
  for (const item of library.wanted) {
    if (item.masterId) sets.wantedMasters.add(item.masterId);
    sets.wantedKeys.add(normKey(item.artist, item.title));
  }

  return sets;
}

/** Classify a single catalogue row. Owned takes precedence over wanted. */
export function tagFor(item: Matchable, sets: MatchSets): MatchTag {
  const master = item.masterId ?? 0;
  const key = normKey(item.artist, item.title);

  if ((master && sets.ownedMasters.has(master)) || sets.ownedKeys.has(key)) return "owned";
  if ((master && sets.wantedMasters.has(master)) || sets.wantedKeys.has(key)) return "wanted";
  return null;
}
