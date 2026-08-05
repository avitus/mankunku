# Triad-Pair Alternate Playing Styles — Design

**Date:** 2026-08-05
**Status:** Approved (auto-accept + engine-level API + rotating previews chosen by Andy)

## Goal

Triad-pair trick practice should accept three playing styles as fully
conforming, not just the standard cell. The player answers in whichever style
they feel; scoring judges the attempt against all three and keeps the best.

## The three styles

All styles span one 4/4 bar, use both triads of the configured pair, respect
the `order` parameter (which triad starts), and allow any inversion / note
choice within a group — that freedom already exists because each slot's
`exactPcs` is the group's whole triad.

| Style | Structure | Slots | Offsets | Durations | `beatPlacement` |
|---|---|---|---|---|---|
| `cell` | A asc (3) + B asc (3) + first two of A — today's cell, unchanged | 8 | `i/8` (+1/8 when offbeat) | `[1,8]` | respected |
| `triplets` | four eighth-note-triplet groups, one per beat, alternating A-B-A-B | 12 | `i/12` | `[1,12]` | ignored (always on the beat) |
| `four-eighths` | 4 eighths of A then 4 of B | 8 | `i/8` | `[1,8]` | ignored (always on the beat) |

Canonical realizations (for `generatePc`, used by previews):

- `triplets`: each group ascends root → 3rd → 5th of its triad.
- `four-eighths`: root → 3rd → 5th → 3rd per triad (the motivating example
  `C-E-G-E, D-F#-A-F#` over a C/D pair).

`patternPcs` for every slot remains the *other* triad's pcs minus the slot's
own, exactly as today ("right pair, wrong triad ⇒ in-pattern").

Feasibility notes verified up front:

- `applySwingToBeats` only shifts fractional-beat positions ≈ 0.5, so triplet
  offsets (n+1/3, n+2/3) are immune by construction — a swung context cannot
  distort the triplet spec.
- `notation.ts` maps `[1,12]` → eighth-triplet, so rotated previews render.
- `realizeTrickExample` passes slot offsets/durations through verbatim. One
  rail needs loosening: it validates with `maxConsecutiveLeaps: 8`, and a
  12-note triplet arpeggio line has 11 consecutive leaps (leap = > 2
  semitones), which would silently null the triplet preview. Raise the cap
  to 12 — for trick examples it only guards runaway generation, not shapes.

## Decisions and their rationale

1. **Auto-accept, not a parameter.** Style must NOT enter `TrickParameters`:
   parameters feed `normalizeParameterSignature`, which forms the progress
   variant key. One variant key covers all three styles; mastery prerequisites
   and stored progress are untouched.
2. **`beatPlacement` applies to the cell only.** The new styles have no
   natural offbeat form. Offbeat variants therefore accept: the shifted cell,
   on-beat triplets, and on-beat four-eighths. Best-of scoring means a
   well-played offbeat cell still wins for offbeat variants.
3. **Previews rotate styles round by round** (cell → triplets → four-eighths,
   cycling; round 1 = cell) so the styles are taught by demonstration. The
   scorer does not care whether the answer matches the demo.
4. **Best-of lives in the conformance engine** as a general multi-spec API,
   per Andy's pick — available to future devices, not private to triad pairs.

## Changes by module

### `src/lib/types/tricks.ts`

- `ConformanceResult.style?: string` — name of the winning spec variant.
  Absent for single-spec devices (enclosures).
- `TrickContext.exampleStyle?: string` — optional device-interpreted hint for
  `generateExample`; unknown or absent ⇒ device default (`cell`).
- `Trick.exampleStyles?: readonly string[]` — demo styles in rotation order.
  Declared by triad pairs (`['cell', 'triplets', 'four-eighths']`); omitted by
  enclosures.

### `src/lib/tricks/conformance.ts`

New export:

```ts
export interface ConformanceSpecVariant {
  style: string;
  slots: TrickSlotSpec[];
}

export function scoreConformanceAgainstSpecs(
  played: DetectedNote[],
  variants: ConformanceSpecVariant[],
  context: TrickContext
): ConformanceResult;
```

Runs the existing `scoreConformanceAgainstSpec` once per variant, returns the
result with the highest `patternScore`, tagged with the winner's `style`.
Ties (including the all-zero degenerate cases: empty performance, empty
variants list edge) resolve to the earliest variant, so callers list the
canonical style first. `scoreConformanceAgainstSpec` itself is unchanged.
An empty `variants` array falls back to
`scoreConformanceAgainstSpec(played, [], context)` with `style` left
undefined — same graceful shape as the engine's existing empty-slots
handling, never a throw.

### `src/lib/tricks/devices/triad-pairs.ts`

- Refactor `buildTriadPairSlots` into three builders sharing the existing
  triad-derivation helpers (`scaleDegreePcs`, `triadOnDegree`, param picks):
  `buildCellSlots` (today's body, verbatim semantics), `buildTripletSlots`,
  `buildFourEighthsSlots`. Slot roles stay `'triad-a'`/`'triad-b'`; exactPcs
  keep the "specific expected pc first" convention.
- One canonical style order everywhere: `['cell', 'triplets',
  'four-eighths']` — used both as the scoring variant order (cell first wins
  degenerate all-zero ties, preserving today's 8-slot shape for empty
  performances) and as the preview rotation order.
- `scoreConformance` calls `scoreConformanceAgainstSpecs` with all three
  variants in that order.
- `generateExample` switches on `context.exampleStyle`; unrecognized/absent ⇒
  `cell`. Phrase name unchanged.
- `exampleStyles: ['cell', 'triplets', 'four-eighths']` on the trick object.
- Description text gains a short clause noting alternate accepted styles.
- `buildTriadPairSlots` stays exported with its current name and cell
  semantics (tests/unit/tricks/devices.test.ts imports it in five places);
  the triplet and four-eighths builders are new exports beside it.

### `src/lib/state/lick-practice.svelte.ts`

At the two `generateExample` call sites (`startTrickSession`, round-boundary
regeneration in the round-advance path):

```ts
const styles = trick.exampleStyles;
const exampleStyle = styles?.length
  ? styles[(roundNumber - 1) % styles.length]
  : undefined;
```

passed via `{ ...context, exampleStyle }`. `startTrickSession` uses round 1.
The round-boundary site regenerates *before* `roundNumber += 1`, so it must
use the incoming round's number (`lickPractice.roundNumber + 1`) — the demo
belongs to the round being entered. Enclosures declare no `exampleStyles`,
so `exampleStyle` stays undefined and nothing changes for them. On a rare
generation failure the existing keep-last-phrase fallback stands.

### `src/lib/scoring/fluency.ts`

`scoreFluency` passes the conformance winner into the example call:

```ts
const example = trick.generateExample(parameters, {
  ...context,
  exampleStyle: conformance.style ?? context.exampleStyle
});
```

so the expected notes shown in reports match the style actually played, even
when it differs from the round's demo. The existing count-mismatch fallback
(degenerate per-slot placeholders with exact rhythm reproduction) remains the
safety net and its behavior is unchanged.

### Docs

`documentation/architecture/trick-scoring.md`: add a short section on the
multi-spec selection layer (what a spec variant is, best-patternScore-wins,
tie to first, `style` on the result) and the three triad-pair styles.

## Explicitly out of scope

- No UI changes: no style picker, no "matched: triplets" badge in reports
  (the `style` field makes that possible later).
- No changes to enclosures, mastery graph, progress storage, or variant keys.
- No new time signatures: like the existing cell, all specs assume the
  session's pinned 4/4.
- No changes to grading thresholds, tier credits, or DTW costs.

## Testing

TDD per project convention — failing tests first, in the existing suites:

- **`tests/unit/tricks/conformance.test.ts`** — `scoreConformanceAgainstSpecs`:
  picks the higher-patternScore variant; tie resolves to the first; result
  carries the winner's `style`; single-spec path unchanged (no `style`).
- **`tests/unit/tricks/devices.test.ts`** —
  - triplet spec structure: 12 slots, offsets `i/12`, durations `[1,12]`,
    groups alternate A-B-A-B, `order` swaps the starter, `beatPlacement:
    'offbeat'` does NOT shift it;
  - four-eighths structure: 8 slots, 0–3 = triad A pcs, 4–7 = triad B;
  - perfect performances in each of the three styles → `patternScore` 1.0
    and the correct `style` label (cell inversions included — e.g. the
    literal `C-E-G-E, D-F#-A-F#` sequence over a 1+2 pair in C);
  - offbeat variant: a shifted-cell performance and an on-beat triplet
    performance both score 1.0 pattern;
  - a non-alternating grouping (e.g. 8 notes all from triad A) is penalized
    (in-pattern credit at best on the B slots);
  - variant-key invariance: `trickVariantKey` output identical before/after
    (style never enters parameters).
- **`tests/unit/tricks/example-generator.test.ts` / devices** —
  `generateExample` honors `exampleStyle` (12 triplet notes; 4+4 with
  root-3rd-5th-3rd contour), defaults to the cell when absent/unknown.
- **`tests/unit/scoring/fluency.test.ts`** — when the played style differs
  from the demo, expected notes come from the winner-style example (real
  notes, not fallback placeholders); triplet-style rhythm scores exactly for
  a perfectly timed swung/straight performance.
- **Rotation** — the round→style mapping exercised directly (pure
  expression); if a state-level test is impractical, cover the mapping helper
  where it lives.
