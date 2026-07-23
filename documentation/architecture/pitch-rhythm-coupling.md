# Independent in Theory, Coupled in Practice: Pitch vs Rhythm Complexity

**Status:** open investigation — revisit when redesigning scoring or adaptive difficulty.

## The observation

Pitch complexity and rhythm complexity are supposed to advance independently, but in real usage they hardly diverge — the two accuracy signals that drive them stay almost in lockstep. This document explains why.

The Progress trend graph (`src/lib/components/progress/TrendChart.svelte`) *used to* make this visible: it plotted two dotted lines (pitch complexity, rhythm complexity) and a solid "Level" midpoint. Those lines were removed — the component now renders only a single "Tonal Mastery" series (see below) — but the underlying coupling in the scoring and adaptive machinery is unchanged, and that is what this document analyses.

## What the trend graph plots now

The chart renders a single **"Tonal Mastery"** polyline: the average proficiency across 12 scales + 12 keys (0-100), sourced from `DailySummary.tonalMastery` and forward-filled across days that don't refresh it. See `TrendChart.svelte:33-99` (`dataPoints`) and `:179-185` (the lone `<polyline>`).

The old pitch/rhythm complexity lines and the derived "Level" midpoint no longer appear on the graph. The component comment (`TrendChart.svelte:33-36`) explains the removal: those lines "measure how hard the generated material is, not how well the user plays." The `(pitchComplexity + rhythmComplexity) / 2` average still exists, but as `currentLevel` inside the adaptive state, not on the chart — see `src/lib/difficulty/adaptive.ts:103`.

## The three coupling sources

### 1. Missed / extra notes zero both dimensions (biggest effect)

In `src/lib/scoring/scorer.ts:172-190`, any note the DTW aligner marks as `missed` or `extra` produces:

```ts
{ pitchScore: 0, rhythmScore: 0 }
```

Both sums use the same denominator (`scoredCount`), so a single missed attack — which is really a timing/detection failure — punishes pitch accuracy and rhythm accuracy identically. In sessions with any real error rate, this mechanically correlates the two accuracy windows that feed `processAttempt`.

A missed note is not pitch information: no pitch was heard, so there is nothing to judge. An extra note is not rhythm information in the same way. Averaging zeros into the "wrong" bucket is the single biggest reason the two dimensions track.

### 2. Phrase content never selectively stresses one dimension

The practice settings page feeds a single `selectedDifficulty` into both paths:

- Curated lick selection filters on the combined `level` field: `library-loader.ts:124` (inside `queryLicks`) — `l.difficulty.level <= query.maxDifficulty`.
- The generator copies that number into `pitchComplexity` directly but caps `rhythmComplexity` at 80: `generator.ts:63-64` (`pitchComplexity: options.difficulty`, `rhythmComplexity: Math.min(options.difficulty, 80)`). Below difficulty 80 the two are identical; above 80 they diverge — a minor exception to "content never selectively stresses one dimension," but only at the very top of the range.

So nothing the user ever plays is deliberately pitch-easy / rhythm-hard or vice versa. Without differentiated challenge, the two accuracy signals lack the opportunity to diverge.

### 3. Identical advancement rules and starting point

`adaptive.ts:73-99`: both dimensions use the same thresholds (≥85% advance, <50% retreat), the same 25-sample window, the same 10-attempt cooldown, and both initialize to 1. Given sources (1) and (2) already correlate the inputs, identical rules then advance both dimensions on effectively the same attempts.

## What *is* genuinely independent

The state update itself. `AdaptiveState` keeps separate windows (`recentPitchScores` vs `recentRhythmScores`) and separate cooldown counters (`pitchAttemptsSinceChange` vs `rhythmAttemptsSinceChange`), and the advancement decisions are made independently. The wiring is correct — the inputs just don't diverge.

## Extreme-case simulation: perfect rhythm, single note

To confirm the machinery works when signals are genuinely uncorrelated, consider a user who plays an 8-note C major fragment (`C D E F G A B C`) as `C C C C C C C C` with perfect timing and in-tune attack.

Assumption: DTW pairs onsets 1:1 because timing is perfect. This may not hold if pitch is part of the alignment cost — see **Open question** below.

### One attempt

| # | expected | detected | pitch | rhythm |
|---|---|---|---|---|
| 1 | C | C | 1.0 | ~1.0 |
| 2 | D | C | 0   | ~1.0 |
| 3 | E | C | 0   | ~1.0 |
| 4 | F | C | 0   | ~1.0 |
| 5 | G | C | 0   | ~1.0 |
| 6 | A | C | 0   | ~1.0 |
| 7 | B | C | 0   | ~1.0 |
| 8 | C | C | 1.0 | ~1.0 |

`scorePitch` (`pitch-scoring.ts:32`) is effectively binary: 0 on any pitch miss, ~1.0 on match.

- `pitchAccuracy = 2/8 = 0.25`
- `rhythmAccuracy ≈ 1.0`
- `overall = 0.6 × 0.25 + 0.4 × 1.0 = 0.55`

### Over many repetitions

Starting from `pitchComplexity = 1, rhythmComplexity = 1`:

| attempts | pitch | rhythm | displayed Level |
|---|---|---|---|
| 10   | 1 (floor) | 2   | 2  |
| 100  | 1         | 11  | 6  |
| 500  | 1         | 51  | 26 |
| 1000 | 1         | 100 (cap) | 51 |

The dimensions separate maximally: `pitchComplexity` stays pinned at 1, `rhythmComplexity` climbs to the 100 cap, and the derived `currentLevel` midpoint rises to 51.

### Conclusion

The adaptive state update *can* produce full divergence. The lockstep behavior in real usage is an input-correlation problem, not a logic bug.

## Open question — DTW cost function

The simulation above assumes the DTW aligner in `src/lib/scoring/alignment.ts` pairs onsets 1:1 when timing is perfect, regardless of pitch. If pitch is part of the alignment cost, the single-note case could instead be marked as 6 `missed` + 6 `extra` notes, which would collapse *both* dimensions to ~0 and re-couple them. This should be verified before using the simulation as design guidance.

## Proposed direction (not yet implemented)

The most direct fix is the scoring coupling. Score `missed` and `extra` notes asymmetrically:

- **Missed note**: contributes to rhythm accuracy only (as a 0). Pitch accuracy should not see it — no pitch was heard.
- **Extra note**: contributes to pitch accuracy only (as a 0). Rhythm is undefined for an attack the phrase didn't expect.

Implementation would change `pitchSum / scoredCount` and `rhythmSum / scoredCount` to use per-dimension denominators, or keep per-dimension counters.

Content differentiation (source #2) is a larger redesign: phrase selection would need to consult `pitchComplexity` and `rhythmComplexity` separately, and the library would need licks that stress the dimensions asymmetrically. The curated data already carries per-dimension complexity ratings (e.g. `pitchComplexity: 32, rhythmComplexity: 72` in `blues.ts`), which is infrastructure that could be leveraged.

## When to revisit

- Before any redesign of the scoring pipeline or adaptive state.
- If the trend graph's purpose shifts from "progress over time" toward diagnostic use (showing players *which* dimension needs work).
- If curated licks start being added with deliberately asymmetric pitch/rhythm ratings and the adaptive system doesn't surface that asymmetry to the player.
