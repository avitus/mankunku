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

```
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

```
matchCost(e, d) = pitchDistance(e, d) + rhythmDistance(e, d)

pitchDistance(e, d) = {
  0.0,                   if e.pitch == d.midi
  min(1.0, |diff| * 0.5) otherwise
}

rhythmDistance(e, d) = min(1.0, |e.onset - d.onset| / beatDuration)
```

### Backtracking

Starting from `dp[N][M]`, trace back to `dp[0][0]` by checking which of the three options (match, skip expected, skip detected) produced each cell's value. This produces an `AlignmentPair[]`.

### Complexity

Time: O(N * M). Space: O(N * M). For typical phrase sizes (4–16 notes), this is negligible.

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

```
midiFloat = 12 * log2(frequency / 440) + 69
midi = round(midiFloat)
cents = round((midiFloat - midi) * 100)
```

## Onset Detection (HFC)

**Source:** `src/lib/audio/onset-worklet.ts`

An energy-based onset detector running on the audio thread via AudioWorklet.

### High-Frequency Content (HFC)

For each 128-sample frame:

```
HFC = sum(|sample[i]| * (i + 1)) / N
```

The weighting by `(i + 1)` emphasizes later samples in each frame, which correspond to higher frequencies. Transients (note attacks) have more high-frequency content than sustained notes.

### Detection Logic

```
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

### Median-Based Pitch Assignment

Within each onset-bounded segment, the pitch is determined by the **median** MIDI note of all pitch readings, not the mean or mode.

**Why median:**
- **Robustness to outliers** — A brief pitch glitch (e.g., octave error) doesn't affect the result
- **No distribution assumption** — Unlike the mean, the median doesn't assume symmetric error
- **Stable for modal data** — For clean segments, the median equals the true pitch

The cents deviation is also the median, but only from readings matching the median MIDI (filtering out octave errors before computing intonation).

## Adaptive Difficulty

**Source:** `src/lib/difficulty/adaptive.ts`

### State Machine

```
                  avg >= 85%
    ┌─────────────────────────────┐
    │                             ▼
  HOLD ◄───── 50% <= avg < 85% ──── ADVANCE
    │                             │
    │         avg < 50%           │
    └────────────────────────────►┘
                RETREAT
```

Transitions require at least 5 attempts since the last change, preventing oscillation.

### Independent Axis Adjustment

Pitch and rhythm complexity are adjusted independently:

- **Advance** increases the *weaker* parameter (bringing it up to match the stronger one)
- **Retreat** decreases the parameter causing more errors (uses the latest attempt's pitch vs rhythm accuracy as proxy)

This allows a player who is strong in rhythm but weak in pitch to get easier pitch material while maintaining their rhythm challenge.

