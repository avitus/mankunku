# Independent in Theory, Coupled in Practice: Pitch vs Rhythm Complexity

**Status:** closed for the adaptive machinery — the global pitch/rhythm complexity ratchet (`processAttempt`) was retired 2026-08-31, because nothing consumed its output and the coupling analysed here meant it only ratcheted to 100. Coupling source (1) — missed/extra notes zeroing both accuracy dimensions — still applies to the scorer's paired pitch/rhythm accuracies shown in reports and period comparisons; revisit this document when redesigning scoring.

## The observation

Pitch complexity and rhythm complexity were supposed to advance independently, but in real usage they hardly diverged — the two accuracy signals that drove them stay almost in lockstep. This document explains why.

The Progress trend graph (`src/lib/components/progress/TrendChart.svelte`) *used to* make this visible: it plotted two dotted lines (pitch complexity, rhythm complexity) and a solid "Level" midpoint. Those lines were removed — the component now renders only a single "Tonal Mastery" series (see below) — and the ratchet behind them is retired, but the coupling in the scorer's two accuracy signals is unchanged, and that is what this document analyses.

## What the trend graph plots now

The chart renders a single **"Tonal Mastery"** polyline: the average proficiency across 12 scales + 12 keys (0-100), sourced from `DailySummary.tonalMastery` and forward-filled across days that don't refresh it (`dataPoints` and the lone `<polyline>` in `TrendChart.svelte`; the per-scale trend panel beside it comes from `state/scale-trend.ts` over `DailySummary.scaleLevels`).

The old pitch/rhythm complexity lines and the derived "Level" midpoint no longer appear on the graph. The component comment explains the removal: those lines "measure how hard the generated material is, not how well the user plays." `AdaptiveState.currentLevel` — once the `(pitchComplexity + rhythmComplexity) / 2` midpoint — is now frozen at whatever the stored blob holds (1 for a new user); `createInitialAdaptiveState` in `src/lib/difficulty/adaptive.ts` is the only thing that still writes the shape, because `progress.adaptive` round-trips the cloud `adaptive_state` column.

## The three coupling sources

### 1. Missed / extra notes zero both dimensions (biggest effect)

In `scoreAttempt` (`src/lib/scoring/scorer.ts`), any note the DTW aligner marks as `missed` or `extra` produces:

```ts
{ pitchScore: 0, rhythmScore: 0 }
```

Both sums use the same denominator (`scoredCount`), so a single missed attack — which is really a timing/detection failure — punishes pitch accuracy and rhythm accuracy identically. In sessions with any real error rate, this mechanically correlates the two accuracy signals — the ones that used to feed `processAttempt`, and the ones every report, `DailySummary.avgPitch` / `avgRhythm` and period comparison still show.

A note on where swing enters the rhythm dimension, since it is the one place the expected grid moves under the player: `scoreRhythm` shifts an expected off-beat eighth by `(swing − 0.5)` of a beat whenever `swing > 0.5` (the same rule as `applySwingToBeats` in `music/swing.ts`, which playback, the DTW aligner and the fluency scorer's expected onsets share — `scoreRhythm` carries its own inline copy), so a perfectly swung performance scores perfectly, and the penalty is tempo-scaled: `min(1, 0.5 + tempo/300)` per beat of error. Record-a-lick's quantizer takes the mirror-image stance: its per-beat vocabulary is `{0, 1/3, 1/2, 2/3}`, a beat is a triplet beat only if something lands near 1/3 (or continues a quarter-note triplet from the right), and every upbeat from straight 0.5 through `MAX_SWING` (0.8, `music/swing.ts` — the settings knob's ceiling) **notates** as the straight off-beat eighth. Both sides agree that swing is a performance parameter, not notation — which is why the session `swing` (default 0.62; the fixed-grid backing styles pin it through `melodySwingForStyle` in `audio/backing-styles.ts`) reaches the scorer at all.

A missed note is not pitch information: no pitch was heard, so there is nothing to judge. An extra note is not rhythm information in the same way. Averaging zeros into the "wrong" bucket is the single biggest reason the two dimensions track.

### 2. Phrase content never selectively stresses one dimension

A single difficulty number drives selection on the one surviving path:

- Ear-training lick selection (`routes/ear-training/+page.svelte`) keeps every lick whose `effectiveDifficultyLevel` (the stored `level`, raised to the note-count floor — `difficulty/calculate.ts`) is at or below the active scale's proficiency level, then narrows to scale-compatible licks. Both sides of that comparison are single scalars; neither separates the two dimensions.

(The algorithmic phrase generator used to be the second path here, and it *did* diverge slightly above difficulty 80 by capping `rhythmComplexity`. It was removed along with the ear-training settings page that was its only caller, so the coupling is now total rather than near-total.)

So nothing the user ever plays is deliberately pitch-easy / rhythm-hard or vice versa. Without differentiated challenge, the two accuracy signals lack the opportunity to diverge.

### 3. Identical advancement rules and starting point

The retired ratchet gave both dimensions the same thresholds (≥ 85% advance, < 50% retreat), the same 25-sample window, the same 10-attempt cooldown, and the same starting level of 1. Given sources (1) and (2) already correlate the inputs, identical rules then advanced both dimensions on effectively the same attempts. Those constants survive in `adaptive.ts` (`WINDOW_SIZE`, `ADVANCE_THRESHOLD`, `RETREAT_THRESHOLD`, `MIN_ATTEMPTS_BETWEEN_CHANGES`) because the live per-scale / per-key proficiency (`processScaleAttempt` / `processKeyAttempt`, one shared `advanceSingleDimension`) runs the same single-dimension rule over the `overall` score — which sidesteps the coupling by never splitting pitch from rhythm in the first place.

## What *was* genuinely independent

The state update itself. `AdaptiveState` kept separate windows (`recentPitchScores` vs `recentRhythmScores`) and separate cooldown counters (`pitchAttemptsSinceChange` vs `rhythmAttemptsSinceChange`), and the advancement decisions were made independently. The wiring was correct — the inputs just didn't diverge. The fields are still on the frozen type ([Data Model](./data-model.md#adaptivestate)).

## Extreme-case simulation: perfect rhythm, single note

To confirm the machinery works when signals are genuinely uncorrelated, consider a user who plays an 8-note C major fragment (`C D E F G A B C`) as `C C C C C C C C` with perfect timing and in-tune attack.

Assumption: DTW pairs onsets 1:1 because timing is perfect. Pitch *is* part of the alignment cost, but the assumption holds — see **The DTW cost function** below.

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

`scorePitch` (`pitch-scoring.ts`) is effectively binary: 0 on any pitch miss, 1.0 plus up to a 0.1 intonation bonus on a match (octave-insensitive in continuous lick practice).

- `pitchAccuracy = 2/8 = 0.25`
- `rhythmAccuracy ≈ 1.0`
- `overall = 0.6 × 0.25 + 0.4 × 1.0 = 0.55`

### Over many repetitions

Starting from `pitchComplexity = 1, rhythmComplexity = 1`, under the retired ratchet's rules:

| attempts | pitch | rhythm | displayed Level |
|---|---|---|---|
| 10   | 1 (floor) | 2   | 2  |
| 100  | 1         | 11  | 6  |
| 500  | 1         | 51  | 26 |
| 1000 | 1         | 100 (cap) | 51 |

The dimensions separated maximally: `pitchComplexity` stayed pinned at 1, `rhythmComplexity` climbed to the 100 cap, and the derived `currentLevel` midpoint rose to 51.

### Conclusion

The adaptive state update *could* produce full divergence. The lockstep behavior in real usage was an input-correlation problem, not a logic bug.

## The DTW cost function

The simulation above assumes the DTW aligner in `src/lib/scoring/alignment.ts` pairs onsets 1:1 when timing is perfect, regardless of pitch. Pitch is in the match cost, but it cannot break that pairing. A match costs `pitchDistance + rhythmDistance`: the pitch term is 0.5 per semitone and saturates at 1.0 from two semitones up (cyclic pitch-class distance when octave-insensitive), and the rhythm term is the onset error in beats, capped at 1.0. So a pair never costs more than 2.0, while dropping it to one `missed` plus one `extra` costs two skips (`SKIP_COST` 2.0 each, 4.0). With perfect timing every wrong-note pair costs at most 1.0, and a shifted alignment would add end skips while making no pitch cheaper, because the detected notes are all C. The single-note take therefore aligns 1:1, and the pitch/rhythm split in the table stands. The aligner only leaves pairs unmatched when the two sequences differ in length, or when a shifted alignment saves more than its skips cost.

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
