/**
 * Rank catalogue records the user neither owns nor wants, by how well they fit
 * the genres/styles the user actually collects — boosted by community rating.
 *
 * Taste profile is built from wantlist **and** collection with **no per-source
 * weighting**: every record is one equal vote. A bigger list therefore
 * contributes more total votes, which is intended — it just means the user has
 * more records of that taste, not that the list is privileged.
 *
 * To counter popularity bias ("everyone likes Rock") each tag is weighted
 * TF-IDF style: term frequency in the user's library × inverse frequency in the
 * catalogue. Distinctive tastes (rare styles the user over-indexes on) outweigh
 * broad genres the whole catalogue shares.
 *
 * Pure and dependency-free so it runs in the browser bundle alongside match.ts.
 */

export interface Tagged {
  genres: string[];
  styles: string[];
}

export interface RatedCandidate extends Tagged {
  /** Discogs community rating, 0..5. */
  rating: number;
  /** Vote count — rating is ignored when this is 0 (unreliable). */
  votes: number;
}

/** How much a perfect (5-star) community rating lifts a candidate's score. */
const RATING_BOOST = 0.4;

/**
 * Unique tag tokens for an item. Genres and styles are namespaced so a genre
 * and a style that happen to share a name never collide, and so the two spaces
 * can be weighted separately later if needed.
 */
function tagsOf(item: Tagged): string[] {
  const tags = new Set<string>();
  for (const g of item.genres) if (g) tags.add(`g:${g}`);
  for (const s of item.styles) if (s) tags.add(`s:${s}`);
  return [...tags];
}

/**
 * TF-IDF weight per tag: (share of the user's library carrying the tag) ×
 * (smoothed inverse share of the catalogue carrying it). Only tags the user
 * actually has get a weight; everything else scores 0.
 */
export function buildTagWeights(library: Tagged[], catalogue: Tagged[]): Map<string, number> {
  const nLib = library.length || 1;
  const tf = new Map<string, number>();
  for (const item of library) {
    for (const tag of tagsOf(item)) tf.set(tag, (tf.get(tag) ?? 0) + 1);
  }

  const nCat = catalogue.length || 1;
  const df = new Map<string, number>();
  for (const row of catalogue) {
    for (const tag of tagsOf(row)) df.set(tag, (df.get(tag) ?? 0) + 1);
  }

  const weights = new Map<string, number>();
  for (const [tag, count] of tf) {
    const termFreq = count / nLib;
    const docFreq = df.get(tag) ?? 0;
    // Smoothed idf: always ≥ ~1, larger for tags rare in the catalogue.
    const idf = Math.log((nCat + 1) / (docFreq + 1)) + 1;
    weights.set(tag, termFreq * idf);
  }
  return weights;
}

/**
 * Affinity = Σ weight of the candidate's tags, multiplicatively boosted by its
 * community rating. Zero affinity → zero score (never recommend something the
 * user has no taste overlap with, however highly rated).
 */
export function scoreCandidate(cand: RatedCandidate, weights: Map<string, number>): number {
  let affinity = 0;
  for (const tag of tagsOf(cand)) affinity += weights.get(tag) ?? 0;
  if (affinity <= 0) return 0;

  const ratingNorm = cand.votes > 0 ? Math.max(0, Math.min(5, cand.rating)) / 5 : 0;
  return affinity * (1 + RATING_BOOST * ratingNorm);
}

/**
 * Rank candidates by score, drop zero-overlap ones, return the top N as
 * `{ index, score }` (index into the input array) so callers can map back to
 * their own row objects.
 */
export function rankCandidates(
  candidates: RatedCandidate[],
  weights: Map<string, number>,
  topN: number,
): Array<{ index: number; score: number }> {
  return candidates
    .map((cand, index) => ({ index, score: scoreCandidate(cand, weights) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
