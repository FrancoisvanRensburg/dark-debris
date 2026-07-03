# Feature: Discogs Login + Wantlist/Collection Matching & Suggested Purchases

## Overview

Let a visitor log in with their Discogs account, fetch their **wantlist** and
their **collection** (records they already own), and show them:

1. **Wantlist matches** — catalogue records on their wantlist that are in stock.
2. **Already owned** — catalogue records they already have (badged, and excluded
   from suggestions so we never recommend something they own).
3. **Suggested purchases** — catalogue records they neither own nor have wanted,
   ranked by how well they fit the genres/styles the user actually collects
   (profile built from **both** wantlist and collection), weighted by community
   rating.

Every record they own or want counts once toward the taste profile — neither
list is weighted above the other. The collection additionally filters out records
they already have.

Depends on the enrichment pipeline
([`2026-07-catalog_data_enrichment.md`](./2026-07-catalog_data_enrichment.md))
for the `masterId` join key and per‑record `genres`/`styles`.

## Scope

**Included**

- "Log in with Discogs" (OAuth 1.0a).
- Fetching + caching the user's wantlist **and** collection.
- Match engine: wantlist matches + owned detection (by `masterId`) and
  affinity‑scored suggestions that exclude owned/wanted records.
- UI for the three lists above.

**NOT included**

- Any checkout/payment/reservation flow.
- Writing back to Discogs (marking items bought, editing the wantlist/collection).
- Non‑Discogs identity providers.

## Technical Approach

### This feature requires a backend — the site is currently static

The site today is a **static** Astro build served from Cloudflare assets
(`wrangler.jsonc` → `./dist`). That cannot support this feature, for two
independent reasons:

1. **Discogs OAuth 1.0a needs a consumer secret** that must never ship to the
   browser, and the request signing must happen server‑side.
2. **The Discogs API sends no CORS headers**, so the browser cannot call it
   directly — every call must be proxied through our own origin.

**Decision:** the first PR introduces a server runtime via **Astro SSR with the
`@astrojs/cloudflare` adapter** (output: `"server"`). This is the biggest
architectural change in the plan — the site goes from static assets to an SSR
Worker.

### OAuth 1.0a flow

- Register a Discogs app; store consumer key/secret as Cloudflare **secrets**.
- `/auth/discogs` → get an OAuth request token, redirect to Discogs authorize.
- `/auth/callback` → exchange for an access token + secret.
- Persist the access token in an **encrypted, httpOnly session cookie** — no DB
  required. (Optionally cache in Cloudflare **KV** keyed by session.)

### Wantlist + collection fetch

- Wantlist: `GET /users/{username}/wants?per_page=100`, paginated.
- Collection: `GET /users/{username}/collection/folders/0/releases?per_page=100`,
  paginated (folder `0` = "All").
- Both endpoints return items whose `basic_information` already carries
  `master_id`, `genres`, `styles`, and `thumb` — the same shape — so we can match
  **and** score without any per‑release calls.
- **Either list can run to thousands of items.** At 100/page that's dozens of
  requests each (≈ N/100), so both need the same handling: paginate, cache the
  normalised result per session (KV, with a TTL / manual "refresh" so we don't
  re‑page on every visit), and respect the 60 req/min limit. The rate limit is
  **per token**, i.e. per logged‑in user, so one user's large library only slows
  *their own* first load; it doesn't contend with other users. First load of a
  big library should be async (fetch in the background, show progress) rather
  than blocking the page.

### Match engine

Build three `Set`s of `master_id`s: `wanted`, `owned`, and (derived) everything
in the catalogue.

- **Wantlist matches:** catalogue rows whose `masterId` ∈ `wanted`. For rows with
  `masterId === 0`, fall back to normalised artist+title comparison.
- **Already owned:** catalogue rows whose `masterId` ∈ `owned` — badge them and
  keep them out of suggestions.
- **Suggested purchases:**
  1. Build an affinity profile by counting each genre/style once per record
     across wantlist **and** collection — **no per‑source multiplier**, every
     record is an equal vote. (A larger list therefore contributes more total
     votes, which is intended: it means the user simply has more records of that
     taste, not that the list is privileged.)
  2. Normalise against the catalogue base rate to avoid popularity bias: weight
     each genre/style by how **over‑represented** it is in the user's library vs.
     the catalogue average (TF‑IDF‑style lift), so suggestions reflect what's
     *distinctive* about the user rather than "everyone likes Rock".
  3. Score each catalogue row *not owned and not wanted* = Σ (lift‑weighted)
     affinity of its genres/styles, boosted by normalised `discogsRating`.
  4. Sort desc, return top N.

## PR Breakdown

### PR 1: SSR foundation + Discogs OAuth login

- **Branch:** `feat/discogs-oauth`
- **Status:** [x] In progress — implemented & verified in dev (request-token →
  authorize redirect works against real Discogs; callback/logout paths OK).
  Remaining: real end-to-end authorize in a browser, and production deploy wiring.
- **Description:** `@astrojs/cloudflare` SSR adapter (`output: "server"`), the
  `/auth/login` + `/auth/callback` + `/auth/logout` routes, AES-GCM encrypted
  session cookie, and a "Log in with Discogs" button + signed-in state in the
  header.
- **Files:** `astro.config.mjs`, `wrangler.jsonc`, `src/env.d.ts`,
  `src/middleware.ts`, `src/lib/env.ts`, `src/lib/session.ts`,
  `src/lib/discogs/oauth.ts`, `src/lib/discogs/config.ts`, `src/pages/auth/*`,
  `src/pages/index.astro`, `.dev.vars.example`
- **Learnings:**
  - Discogs OAuth 1.0a works with the **PLAINTEXT** signature method over HTTPS
    (`sig = consumerSecret&tokenSecret`) — no HMAC-SHA1 needed.
  - Astro 6+ **removed `Astro.locals.runtime.env`**; read bindings/secrets via
    `import { env } from "cloudflare:workers"` instead.
  - `wrangler.jsonc` `main` must point at the adapter package entrypoint
    `@astrojs/cloudflare/entrypoints/server`, not the (not-yet-built) output.
  - The adapter auto-injects a `SESSION` KV binding (Astro sessions) we don't
    use; leave the KV namespace unprovisioned.
  - OAuth endpoint URLs are overridable via `REQUEST_TOKEN_URL` / `AUTHORISE_URL`
    / `ACCESS_TOKEN_URL`, defaulting to Discogs.

### PR 2: Wantlist + collection fetch + caching

- **Branch:** `feat/discogs-library-fetch`
- **Status:** [x] In progress — implemented & verified in dev (unauthenticated
  → 401; build typechecks). Remaining: authenticated fetch against a real
  logged-in session (browser click-through).
- **Depends on:** PR 1
- **Description:** `/api/library` endpoint that fetches (paginated) the
  logged‑in user's wantlist and collection, returning normalised items
  (`masterId`, `releaseId`, `genres`, `styles`, `thumb`, artist/title) tagged as
  `wanted`/`owned`.
- **Files affected:** `src/pages/api/library.ts`, `src/lib/discogs/library.ts`
- **Learnings:**
  - Both endpoints share the `basic_information` shape, so one `normalise()`
    handles both; they differ only by the `wanted`/`owned` tag and the array key
    (`wants` vs `releases`).
  - Discogs appends `(2)`-style disambiguation suffixes to artist names and uses
    a per-artist `join` phrase ("feat.", "&") — `artistName()` strips the former
    and honours the latter.
  - Page cap (`MAX_PAGES = 60`, ≈6000 items/list) guards the Worker subrequest
    limit; a larger library returns `truncated: true` rather than failing.
  - No KV caching yet (services unprovisioned) — the endpoint fetches live. If a
    big-library first load proves slow, revisit per-session KV caching here.

### PR 3: Match engine + wantlist/owned UI

- **Branch:** `feat/library-matches`
- **Status:** [x] Implemented & verified in dev. `masterId` join with
  artist+title fallback; owned/wanted badges + view filters wired into the
  catalogue as progressive enhancement (client fetches `/api/library`, tags
  rows, never blocks page render).
- **Depends on:** PR 2, plus catalogue `masterId` data (enrichment plan PR 2)
- **Description:** The `masterId` join (artist+title fallback) producing
  "On your wantlist, in stock" and "Already in your collection" (badged) views.
- **Files affected:** `src/lib/matching/match.ts`, `src/pages/index.astro`
- **Learnings:**
  - Owned takes precedence over wanted (same master in both lists → badged as
    owned, kept out of suggestions).
  - Match runs client-side after `/api/library` resolves, so a slow library
    fetch never blocks first paint; rows carry `data-master` for the join.
  - Fallback key normalises artist+title (diacritic strip via NFKD + alnum
    filter, pressing/format suffixes dropped) for the `masterId === 0` rows.

### PR 4: Suggested purchases scoring + UI

- **Branch:** `feat/suggested-purchases`
- **Status:** [x] Implemented & verified in dev. TF-IDF-lift scorer verified
  against the real catalogue (a stoner/psych profile surfaces All Them Witches,
  Kyuss, Fu Manchu, etc.; "Stoner Rock" lift 2.62 > broad "Rock" 1.70). Wired
  into a "◆ For you" view filter.
- **Depends on:** PR 3
- **Description:** Genre/style affinity scoring from the combined
  wantlist+collection profile, excluding owned/wanted, rating‑boosted, rendered
  as a "For you" ranked list (top 30, score-ordered).
- **Files affected:** `src/lib/matching/suggest.ts`, `src/pages/index.astro`
- **Learnings:**
  - Genres/styles are namespaced (`g:` / `s:`) into one tag space; the base-rate
    idf naturally downweights broad genres so distinctive styles dominate — no
    manual genre-vs-style weighting needed.
  - Rating boost is multiplicative and gated on `votes > 0`, so a high rating
    lifts an on-taste record but can't rescue a zero-overlap one (affinity 0 →
    score 0) and unreliable 0-vote ratings are ignored.
  - No per-source weighting: wantlist + collection are pooled as equal votes
    (see the `suggestion-scoring-no-source-weighting` decision).
  - Reuses PR 3's `data-match` tags for the owned/wanted exclusion; candidates
    are in-stock rows with no match tag.

## Open Questions

- **Session storage:** encrypted cookie only, or cookie + KV cache for the
  wantlist/collection?
- **Base‑rate normalisation:** confirm the TF‑IDF‑style lift (genre/style
  weighted by over‑representation vs. catalogue average) is the right way to
  counter popularity bias, and tune how strongly it's applied. (Per‑source
  weighting is settled: none — each record is one equal vote.)
- **`masterId === 0` fallback:** how aggressive should artist+title fuzzy
  matching be before we risk false positives?
- **Scoring:** exact weights for genre vs style vs rating; should price factor in
  (e.g. surface affordable strong matches)?
- **Edge cases:** private wantlists/collections, very large wantlists *or*
  collections (pagination cost — both can be thousands of items), users with an
  empty wantlist or collection.

## Notes

- Discogs is **OAuth 1.0a**, not OAuth 2 — request signing is mandatory; pick a
  small signing helper rather than a generic OAuth2 client.
- The whole matching layer runs on data already in the catalogue JSON + the
  `basic_information` returned by the wantlist and collection endpoints, so no
  extra Discogs calls per record are needed at match time — keeps us well under
  the rate limit.
- Wantlist and collection items share the same `basic_information` shape, so one
  normaliser handles both; they differ only by the `wanted`/`owned` tag.