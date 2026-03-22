# Dark Debris — Theme Plan

## Direction

**Jazz kissa / brutalist library catalog**

The site started as a stranger's spreadsheet of LPs for sale — artists unknown, no context. That origin matters. This isn't a shop front trying to sell you something. It's a curated record, serious about its taste, indifferent to whether you get it. The design should feel the same: a dim room, worn wooden shelves, a card catalog you have to earn.

References:
- Japanese jazz kissa (kissaten) — amber light, quiet authority, decades of accumulated taste
- ECM Records sleeve design — muted, deliberate, no wasted gesture
- Library card catalog — monospaced metadata, ruled lines, rubber-stamped labels
- Brutalist print — heavy type, structural grids, nothing decorative that isn't also functional

---

## Color Palette

| Token           | Value       | Role                                         |
|-----------------|-------------|----------------------------------------------|
| `--bg`          | `#0b0d09`   | Near-black with an olive undertone           |
| `--surface`     | `#131509`   | Raised surfaces — cards, inputs              |
| `--surface-2`   | `#1c1f13`   | Subtle dividers, alternating rows            |
| `--border`      | `#2d3120`   | Structural lines                             |
| `--text`        | `#e2d9c0`   | Warm ivory — aged paper, not pure white      |
| `--text-muted`  | `#7a7a5e`   | Secondary labels, metadata                  |
| `--text-dim`    | `#545447`   | Tertiary — row numbers, placeholders         |
| `--accent`      | `#c4952a`   | Deep mustard — brass, aged ink, not yellow   |
| `--accent-glow` | `rgba(196, 149, 42, 0.12)` | Subtle accent wash          |
| `--accent-2`    | `#6b7a4a`   | Muted olive — genre tags, secondary elements |

Reasoning: The current orange (`#e87c2a`) reads as a generic "dark UI" accent. Shifting to deep mustard (`#c4952a`) keeps warmth but reads as brass, aged paper, vintage print — much more kissa. The olive secondary gives the genre taxonomy its own visual language without competing with the primary accent.

---

## Typography

Keep the existing typefaces — **Barlow Condensed** + **Space Mono** — they already have character. The change is in how they're used.

**Current problems:**
- Logo feels big but flat
- Metadata (mono) and display (condensed) aren't differentiated enough by weight and case
- Genre pills and tags all feel the same weight of "small label"

**Changes:**
- Header: push the logotype harder — add a catalog issue marker (e.g. `CAT. NO. 001`) as an eyebrow in monospace, stamp-like
- Row artist names: tighten letter-spacing further, increase contrast with title weight
- Metadata: all monospace data (price, votes, number) should feel like typed catalog entries — precise, not styled
- Genre tags: shift to feel like rubber stamps — slight border, muted olive tones, squared

---

## Layout & Structural Changes

### Header
- Remove the gradient underline — replace with a **double rule**: one full-width solid border + a 3px accent-colored top border on the header itself (like a kissa menu header bar)
- Add a catalog stamp element in the top-right corner alongside the record count: small monospaced text like `ZAR · EST. 2024` or similar
- The logotype split — `DARK` plain, `DEBRIS` in accent — keep, it works

### Controls bar (sticky)
- Add a very subtle top border line in `--accent-2` (olive) to give it a tabbed feel
- Genre pills: make them feel more like **file folder tabs** — slightly more padding, squared corners (already no border-radius), border in olive rather than the current neutral

### Catalogue rows
- **Hover state**: drop the generic background fill. Instead: left border flash `3px solid var(--accent)` + very subtle background. More like a bookmark than a highlight.
- **Row number**: make it feel more deliberate — right-align, monospace, styled like a catalog index marker
- **Thumbnail**: already added — keep 36×36, bordered. No border-radius (keep it square/archival)
- **Price**: already styled in accent — keep, it's one of the few things that should draw the eye
- **Rating bar**: replace the thin 2px bar with a **tick-mark / notch system** — 5 segments, filled to the rating level. More mechanical, less "progress bar"

### Genre tags (in rows)
- Two-tier visual language:
  - **Genre tags** (`genre-tag`): muted olive border + olive text — feels like a subject heading stamp
  - **Style tags** (`style-tag`): dimmer still, just `--text-dim` — subordinate, reference-only

### Empty state
- Currently just hidden text. Make it feel intentional — a monospaced "no records matching query" with catalog-style formatting

---

## What to Remove

- The gradient line under the header (too decorative, too common)
- Any `border-radius` that crept in (keep everything square — archival feel)
- The generic orange — it reads SaaS, not kissa

---

## What to Keep

- Grain overlay — subtle, effective, adds texture
- Barlow Condensed 800 for display — it's doing the right job
- Space Mono for all data/metadata — essential to the catalog feel
- The overall grid structure — it works, just needs visual character layered on top
- Sticky controls — functional and correct

---

## Implementation Order

1. Update CSS custom properties (color tokens)
2. Header treatment — double rule, stamp eyebrow, catalog marker
3. Row hover state — left border flash
4. Rating bar → tick-mark system
5. Genre tag color split (olive vs dim)
6. Controls genre pills → olive border treatment
7. Empty state
