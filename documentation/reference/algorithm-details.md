# Algorithm Details

In-depth mathematical descriptions of Mankunku's core algorithms.

## Dynamic Time Warping (DTW)

**Source:** `src/lib/scoring/alignment.ts`

DTW finds the optimal alignment between a sequence of expected notes and a sequence of detected notes, handling timing variations, missed notes, and extra notes.

### Formulation

Given:
- Expected notes `E = [e_0, e_1, ..., e_{N-1}]`
- Detected notes `D = [d_0, d_1, ..., d_{M-1}]`

Build a cost matrix `dp[i][j]` of size `(N+1) x (M+1)`:

```text
dp[0][0] = 0
dp[i][0] = dp[i-1][0] + SKIP_COST          (skip all detected)
dp[0][j] = dp[0][j-1] + SKIP_COST          (skip all expected)

dp[i][j] = min(
  dp[i-1][j-1] + matchCost(e_{i-1}, d_{j-1}),   // match
  dp[i-1][j]   + SKIP_COST,                       // skip expected (missed)
  dp[i][j-1]   + SKIP_COST                        // skip detected (extra)
)
```

Where `SKIP_COST = 2.0` and:

```text
matchCost(e, d) = pitchDistance(e, d) + rhythmDistance(e, d)

pitchDistance(e, d) = {
  0.0,                   if e.pitch == d.midi
  min(1.0, |diff| * 0.5) otherwise
}

rhythmDistance(e, d) = min(1.0, |e.onset - d.onset| / beatDuration)
```

### Backtracking

Starting from `dp[N][M]`, trace back to `dp[0][0]` by checking which of the three options (match, skip expected, skip detected) produced each cell's value. This produces an `AlignmentPair[]`.

`alignNotes` also takes an `octaveInsensitive` flag (used by lick-practice continuous mode, where the player may legitimately drop a line an octave to keep it on the horn). With it set, `pitchDistance` compares pitch *classes* on the cyclic distance `min(d, 12 − d)` instead of absolute MIDI.

### Complexity

Time: O(N * M). Space: O(N * M). For typical phrase sizes (4–16 notes), this is negligible.

### The conformance variant

`src/lib/tricks/conformance.ts` runs the same DP skeleton — same `SKIP_COST = 2.0`, same three-way recurrence, same diagonal-first backtrack — but replaces `pitchDistance` with a **tiered conformance cost** against a slot's accepted pitch-class sets (exact 0.0 / in-pattern 0.3 / in-scale 0.6 / out-of-scale 1.0). It is a deliberate clone rather than a parameterization: the two cost models have nothing in common beyond the DP, and merging them would put trick semantics in the path of every lick score. See [Trick Scoring](../architecture/trick-scoring.md).

## Latency Correction

**Source:** `src/lib/scoring/scorer.ts`

Human latency (reaction time + audio detection delay) creates a constant offset between expected and detected onsets. Rather than penalizing this as rhythmic inaccuracy, the scorer absorbs it.

### Algorithm

1. For each matched pair (expectedIndex, detectedIndex), compute: `offset = detected.onset - expected.onset`
2. Take the **median** of all offsets (robust to outliers from misaligned pairs)
3. Subtract this median from all detected onsets

The median typically absorbs 100–300ms of constant delay without affecting relative timing accuracy between notes.

### Why Median?

The mean is sensitive to outliers — a single badly aligned pair could skew the correction. The median ignores up to 50% outliers, making it robust when some pairs are poorly matched by DTW.

## McLeod Pitch Method

**Source:** `src/lib/audio/pitch-detector.ts` (via [Pitchy](https://github.com/ianprime0509/pitchy))

The McLeod Pitch Method is an autocorrelation-based algorithm optimized for monophonic pitch detection.

### Key Properties

- **Autocorrelation-based** — Measures the similarity of a signal with time-shifted copies of itself. Peaks in the autocorrelation correspond to the fundamental period.
- **Normalized Square Difference Function (NSDF)** — Instead of raw autocorrelation, McLeod uses NSDF which normalizes by the signal energy, making peaks comparable across different amplitudes.
- **Peak picking** — The algorithm finds peaks in the NSDF and selects the one that best balances clarity (peak height) and frequency (peak position).
- **Parabolic interpolation** — Refines the peak position for sub-sample accuracy, yielding fractional MIDI values.

### Parameters in Mankunku

| Parameter | Value | Rationale |
|---|---|---|
| Buffer size | 4096 samples | At 48kHz, gives ~85ms windows. Sufficient for frequencies down to ~80Hz. |
| Clarity threshold | 0.80 | Only accept readings where the signal is clearly periodic. |
| Min frequency | 80 Hz | Below the lowest note of supported instruments. |
| Max frequency | 1200 Hz | Above the highest fundamental of supported instruments. |
| Update rate | ~60fps | `requestAnimationFrame` loop. |

### MIDI Conversion

```text
midiFloat = 12 * log2(frequency / 440) + 69
midi = round(midiFloat)
cents = round((midiFloat - midi) * 100)
```

## Onset Detection (HFC)

**Source:** `src/lib/audio/onset-core.ts` (pure algorithm + constants, shared with the offline replay path), run on the audio thread by the `src/lib/audio/onset-worklet.js` AudioWorklet shim (plain JS by necessity — it executes in `AudioWorkletGlobalScope` and Vite loads its URL as a raw asset, so it can't be TypeScript and its constants are kept in sync with `onset-core.ts`).

An energy-based onset detector running on the audio thread via AudioWorklet.

### High-Frequency Content (HFC)

For each 128-sample frame:

```text
HFC = sum(|sample[i]| * (i + 1)) / N
```

The weighting by `(i + 1)` emphasizes later samples in each frame, which correspond to higher frequencies. Transients (note attacks) have more high-frequency content than sustained notes.

### Detection Logic

```text
EMA_new = alpha * EMA_old + (1 - alpha) * HFC     // alpha = 0.85
ratio = HFC / EMA

if ratio > threshold AND time - lastOnset > cooldown:
  fire onset event
  lastOnset = currentTime
```

| Parameter | Value |
|---|---|
| Alpha (smoothing) | 0.85 |
| Threshold | 3.0 |
| Cooldown | 60ms |
| Silence floor | 0.001 energy |
| Settle frames | 5 |

### Why HFC over Spectral Flux?

HFC is computationally simpler (no FFT required) and works well for percussive onsets typical of wind instruments. Spectral flux requires computing the magnitude spectrum of each frame and comparing to the previous frame — more accurate for subtle onsets but more expensive.

## Note Segmentation

**Source:** `src/lib/audio/note-segmenter.ts`

### Clarity-Weighted Pitch Assignment

Within each onset-bounded segment, the pitch is chosen by `pickMidi()`, a two-stage clarity-weighted vote (effectively a weighted mode):

1. **Pitch class** — Sum each reading's weight per pitch class (`midi % 12`) and pick the heaviest pitch class.
2. **Octave** — Within that pitch class, sum weights per octave (per absolute MIDI) and pick the heaviest octave. Near-ties (within 5%) are broken by proximity to the previous note's MIDI so cross-note octave flips don't occur.

Each reading's weight is `clarity²`, further scaled by `0.25` for warmup frames (emitted during the octave stabilizer's warmup window, where raw MIDI often reflects attack-transient partials).

**Why weighted mode:**
- **Sustained frames dominate** — High-clarity, held frames outweigh brief transients, so the true pitch wins the vote
- **Outlier suppression** — Attack transients and subharmonic/octave glitches get outvoted rather than averaged in
- **Octave continuity** — The proximity tie-break keeps octave choices stable across adjacent notes

The cents deviation *is* a median, but only over the readings that already match the chosen MIDI (filtering out octave errors before computing intonation).

## Adaptive Difficulty

**Source:** `src/lib/difficulty/adaptive.ts`

### State Machine

```text
                  avg >= 85%
    ┌─────────────────────────────┐
    │                             ▼
  HOLD ◄───── 50% <= avg < 85% ──── ADVANCE
    │                             │
    │         avg < 50%           │
    └────────────────────────────►┘
                RETREAT
```

Transitions require at least 10 attempts since the last change per dimension, preventing oscillation.

### Independent Axis Adjustment

Pitch and rhythm complexity are adjusted independently — each has its own 25-score accuracy window and its own 10-attempt cooldown counter:

- **Pitch**: advances when pitch accuracy window average ≥ 85%, retreats when < 50%
- **Rhythm**: advances when rhythm accuracy window average ≥ 85%, retreats when < 50%
- `currentLevel = Math.round((pitchComplexity + rhythmComplexity) / 2)`

This allows a player who is strong in rhythm but weak in pitch to progress their rhythm complexity while pitch stays at a comfortable level.

