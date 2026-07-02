# Feature: Catalogue Data Enrichment Pipeline

## Overview

A supplier sends a raw stock catalogue periodically (e.g.
`src/lib/data/2026-07.json`, UPPERCASE FMT/ARTIST/TITLE/PRICE/NOTES). On each
drop we ingest it into a single **canonical enriched catalogue**
(`src/data/catalog.json`): we diff the incoming list against what we already
have, query Discogs **only for LPs we haven't seen before**, and append them.
Enrichment pulls genre, style, thumbnail, community rating + vote count, and the
Discogs `masterId`/`releaseId` for each new record.

This is the data foundation. The frontend feature
([`2026-07-discogs_wantlist_matching.md`](./2026-07-discogs_wantlist_matching.md))
depends on the `masterId` and `genres`/`styles` fields this pipeline produces.

## Scope

**Included**

- A repeatable, incremental ingest script (`src/lib/fetch_lp_data.ts`): raw
  supplier file in → enriched rows appended to `src/data/catalog.json`.
- Diffing incoming catalogues so only **new** LPs hit the Discogs API.
d- An `available` flag refreshed every ingest: LPs absent from the latest
  snapshot are marked sold, not deleted.
- A vinyl‑only format constraint on the Discogs match.
- A per‑record match‑confidence score to flag likely mismatches.
- A single normalised catalogue **schema** (the data contract, below).

**NOT included**

- Refreshing **prices** on LPs already in the catalogue (availability *is* now
  refreshed; price diffing is not — see Open Questions).
- Spotify (dropped — the catalogue is Discogs‑only).
- Any login, wantlist, or matching logic (see the wantlist‑matching plan).

## Technical Approach

- **Auth:** a Discogs *personal access token* (`DISCOGS_TOKEN`), sent as
  `Authorization: Discogs token=…`. The full OAuth flow is only needed for
  acting on behalf of other users, which enrichment does not do.
- **Two calls per record:** `GET /database/search` (constrained to
  `format=Vinyl` — this is a vinyl catalogue, so CD/digital matches are excluded)
  is used **only to pick the right release `id`**. Its `master_id`/`thumb`/
  `cover_image` fields are auth‑gated and frequently empty, so we don't read
  metadata from it. `GET /releases/{id}` is the authoritative source and returns
  everything in one payload: `master_id`, `thumb` (+ `images[].uri150`),
  `genres`, `styles`, and `community.rating.average`/`count`. Ratings live on the
  *release*, not the master.
- **`masterId` vs `releaseId`:** every pressing (German, French, reissue…) is a
  distinct release with its own id; the `master_id` is shared across all
  pressings. We store both — `masterId` is the album‑level join key the wantlist
  feature matches on; `releaseId` records which specific pressing the rating came
  from.
- **Rate limits:** 60 req/min authenticated. The script throttles to ~1 req/1.1s,
  honours `X-Discogs-Ratelimit-Remaining`, and backs off on HTTP 429.
- **Incremental ingest:** the raw supplier file is treated as read‑only input;
  enriched rows accumulate in `src/data/catalog.json`. New LPs are identified by
  a stable key of `artist + cleaned title`, so only unseen records are queried.
  The catalogue is kept sorted by artist/title for clean diffs.
- **Availability snapshot:** each supplier catalogue is a full "what I have now"
  list, so on every ingest we set `available = true` for catalogue rows on the
  incoming snapshot and `available = false` for those absent (sold). Rows are
  kept either way so the site can show sold items.
- **Idempotent + resumable:** enriched rows are appended as they complete, so
  their keys are already present on the next run and get skipped — an interrupted
  run resumes where it left off. The availability refresh runs every time,
  regardless of whether there are new LPs to fetch.
- **Match confidence:** rather than blindly taking the top hit, the script
  re‑ranks the top 5 vinyl candidates by Sørensen–Dice similarity between our
  "artist – title" and the Discogs release title, keeps the best, and stores the
  score as `matchConfidence` (0–1). Scores below 0.6 are logged for review.

### Normalised schema (the data contract)

```jsonc
{
  "artist": "808 STATE",
  "title": "EX:EL (2LP)",       // original title kept for display
  "fmt": "LP",
  "price": 650,
  "notes": "3 EXTRA TRACKS",    // optional
  "available": true,            // on the latest supplier snapshot
  "masterId": 12345,            // album-level join key (0 if none)
  "releaseId": 55359,           // specific pressing the rating came from
  "discogsRating": 4.15,
  "discogsVotes": 179,
  "genres": ["Electronic"],
  "styles": ["Breakbeat", "House", "Techno", "Downtempo"],
  "thumb": "https://i.discogs.com/…",
  "discogsUrl": "https://www.discogs.com/master/12345",
  "matchConfidence": 0.95       // fuzzy artist+title match, 0–1
}
```

Section‑header rows (e.g. `{ "ARTIST": "VINYL:" }`) are dropped during
normalisation.

## PR Breakdown

### PR 1: Incremental ingest + enrichment script

- **Branch:** `chore/update-data`
- **Status:** [x] In progress
- **Description:** The `fetch_lp_data.ts` script — diffs a raw supplier
  catalogue against `src/data/catalog.json`, enriches only new LPs from Discogs,
  and appends them in the normalised schema above.
- **Files affected:** `src/lib/fetch_lp_data.ts`, `src/data/catalog.json` (new)

### PR 2: Point the site at the enriched catalogue

- **Branch:** `feat/catalog-ingest`
- **Status:** [ ] Not started
- **Depends on:** PR 1
- **Description:** Switch `index.astro` from `src/data/lp_ratings.json` to the
  new `src/data/catalog.json` and **delete `lp_ratings.json` outright** (it lacks
  `masterId`/`releaseId`/`fmt`/`available` and won't be migrated). Remove the
  Spotify button/column while here. Render sold items using `available`, and
  optionally surface low `matchConfidence` for review.
- **Files affected:** `src/pages/index.astro`, `src/data/lp_ratings.json`
  (deleted)

## Open Questions

- **Price refresh:** availability is now refreshed every ingest, but prices are
  not — an existing LP keeps its first‑seen price. Add a price‑diff pass on
  re‑ingest, or leave prices sticky?
- **Confidence threshold:** what `matchConfidence` cutoff (currently logged at
  <0.6) should gate auto‑accept vs. manual review, and should low‑confidence rows
  be hidden from the site until confirmed?

## Notes

- Node 22 runs the script directly:
  `DISCOGS_TOKEN=… node --experimental-strip-types src/lib/fetch_lp_data.ts`.
- `masterId: 0` marks records Discogs hasn't grouped under a master; the wantlist
  feature must fall back to artist+title matching for these.