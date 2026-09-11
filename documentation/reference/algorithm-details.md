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

`E` is the phrase's *sounding* notes, not its raw note list: `scoreAttempt` runs `extractSoundingNotes` first, dropping rests and merging tied same-pitch chains, so the scorer expects exactly what playback sounded (a held note written as an eighth tied into a half is one expected note, not two). Expected onsets are swung with `applySwingToBeats` from `music/swing.ts` — the same off-beat-eighth shift playback applies — so a perfect performance of a swung phrase scores perfectly.

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

1. Align with DTW on the raw recording-relative onsets (recording start ≡ phrase offset 0)
2. For each matched pair (expectedIndex, detectedIndex), compute: `offset = detected.onset - expected.onset`
3. Take the **median** of all offsets (robust to outliers from misaligned pairs)
4. Subtract this median from all detected onsets, then score per-note rhythm against the corrected onsets

The median typically absorbs 100–300ms of constant delay without affecting relative timing accuracy between notes.

### Why Median?

The mean is sensitive to outliers — a single badly aligned pair could skew the correction. The median ignores up to 50% outliers, making it robust when some pairs are poorly matched by DTW.

## McLeod Pitch Method

**Source:** `src/lib/audio/pitch-detector.ts` (the live loop, via [Pitchy](https://github.com/ianprime0509/pitchy)); the per-frame math and its constants live in `src/lib/audio/pitch-frame.ts`, shared with the offline replay path.

The McLeod Pitch Method is an autocorrelation-based algorithm optimized for monophonic pitch detection.

### Key Properties

- **Autocorrelation-based** — Measures the similarity of a signal with time-shifted copies of itself. Peaks in the autocorrelation correspond to the fundamental period.
- **Normalized Square Difference Function (NSDF)** — Instead of raw autocorrelation, McLeod uses NSDF which normalizes by the signal energy, making peaks comparable across different amplitudes.
- **Peak picking** — The algorithm finds peaks in the NSDF and selects the one that best balances clarity (peak height) and frequency (peak position).
- **Parabolic interpolation** — Refines the peak position for sub-sample accuracy, yielding fractional MIDI values.

### Parameters in Mankunku

| Parameter | Value | Rationale |
|---|---|---|
| Buffer size | 4096 samples | The `AnalyserNode`'s `fftSize`: ~93 ms at 44.1 kHz (the figure the segmenter's `ANALYSER_WINDOW_SECONDS` assumes), ~85 ms at 48 kHz. Sufficient for frequencies down to ~80 Hz. |
| Clarity threshold | 0.80 | `DEFAULT_CLARITY_THRESHOLD` — only accept readings where the signal is clearly periodic. Clarity is amplitude-invariant, so a quiet periodic sound (a metronome's ringing tail) reads as confident too; level gating happens later, in `capture-window.ts`. |
| Min frequency | 80 Hz | Below the lowest note of supported instruments. |
| Max frequency | 1200 Hz | Above the highest fundamental of supported instruments. |
| Update rate | ~60fps | `requestAnimationFrame` loop. |
| Octave confirm | 3 frames (~50 ms) | `OCTAVE_CONFIRM_FRAMES` — an octave-only jump (±12/±24) must persist this long before it is accepted, filtering subharmonic glitches. |
| Warmup | 5 frames (~80 ms) | `WARMUP_FRAMES` — confident frames observed before committing to an initial stable MIDI; warmup readings are flagged and down-weighted downstream. |
| Octave-lock checks | ≤ 350 Hz / 160–370 Hz | Single-bin Goertzel tests on low readings: a *subharmonic* lock (doubled period, reported an octave low — often with higher clarity than the truth; tested at ≤ 350 Hz via the fundamental's energy and the odd-harmonic rank) and a *2nd-harmonic* lock (halved period, reported an octave high; tested for readings in 160–370 Hz). Notes from ~G3 up detect their own fundamental and never mislock. |

The analyser window ENDS at the live loop's timestamp (`windowAnchor: 'end'`), while the replay harness timestamps a window by its start — `detectFrame` takes the anchor explicitly so both paths agree on when a reading happened.

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
energy = sum(sample[i]²) / N
if energy < silenceFloor:
  EMA = EMA * silenceDecay       // the EMA sinks through silence, so the
  return                         // next attack produces a large ratio

ratio = HFC / EMA                 // against the EMA *before* this frame
if ratio > threshold AND time - lastOnset > cooldown:
  fire onset event
  lastOnset = currentTime
EMA = alpha * EMA + (1 - alpha) * HFC
```

The first `settleFrames` frames only seed the EMA.

| Parameter | Constant | Value |
|---|---|---|
| Alpha (smoothing) | `ENERGY_SMOOTHING` | 0.85 |
| Threshold | `ONSET_THRESHOLD` | 3.0 |
| Cooldown | `MIN_ONSET_INTERVAL` | 60 ms |
| Silence floor | `SILENCE_THRESHOLD` | 0.001 (mean squared amplitude) |
| Silence decay | `SILENCE_DECAY` | 0.95 per frame |
| Settle frames | `SETTLE_FRAMES` | 5 |

### Without the worklet

Every mic route wraps `createOnsetDetector` in a try/catch; if the worklet cannot load (no `AudioWorklet`, a failed `addModule`) the take is segmented without worklet onsets. `resolveOnsets` in `note-segmenter.ts` falls back to `extractOnsetsFromReadings` — an onset at every reading gap over 100 ms (backdated 50 ms for attack latency) or pitch change, at least 80 ms apart — and the same fallback covers a take whose worklet onsets all fail validation. A repeated note tongued without a reading gap then has no onset of its own until the segmenter's re-articulation tiers find one ([Audio Pipeline](../architecture/audio-pipeline.md)).

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

## Rhythmic Quantization

**Source:** `src/lib/audio/quantizer.ts` (used by record-a-lick to turn a take into notation)

`quantizeNotes` snaps detected onsets to a 48-ticks-per-whole-note grid whose per-beat vocabulary is **{0, 1/3, 1/2, 2/3}** of a quarter-note beat — no sixteenths (a played sixteenth degrades to the nearest allowed position), and nothing before the entrance downbeat (clamped to beat 0). Swung eighths are *written straight*, so the swing ratio never decides the notation; the onset pattern of each beat does.

Each onset is labelled by its fraction `f` of the beat:

| Fraction | Label |
|---|---|
| `f < 1/6` | downbeat |
| `1/6 ≤ f < 5/12` | triplet middle (the 1/3 point) |
| `5/12 ≤ f < MAX_SWING + 0.05` (`MAX_SWING` = 0.8, `music/swing.ts`) | off-beat |
| `f ≥ MAX_SWING + 0.05` | the *next* beat's downbeat — a rushed downbeat, not a swing the knob can express |

A beat is a **triplet beat** iff it holds a triplet-middle onset (no swing feel puts an upbeat that early), or its off-beat sits at `f ≥ 7/12` and the next beat is a triplet beat with no downbeat of its own — the quarter-note-triplet continuation, which is why the classification walks the beats right to left. On a triplet beat an off-beat snaps to 1/3 or 2/3; on any other beat everything from straight 0.5 through `MAX_SWING` collapses to the straight off-beat eighth. Classification is per beat, not per take, so one bar can mix swung eighths with a genuine triplet. Durations run to the next note's grid position (the last note rounds to its beat's own unit); a gap over 1.5 ticks becomes a rest; takes are capped at 8 bars.

## Proficiency Advancement

**Source:** `src/lib/difficulty/adaptive.ts`

### Rule

Each attempt's overall score is pushed into a 25-score window, then:

| Condition (checked only when ≥ 10 attempts since the last change) | Result |
|---|---|
| window average ≥ 85% | level + 1 (max 100) |
| window average < 50% | level − 1 (min 1) |
| otherwise | hold |

A change resets the since-change counter, so the level moves at most one step per ten attempts, preventing oscillation.

### Per-Scale / Per-Key Tracking

The same single-dimension rule runs independently for each scale type (`processScaleAttempt`) and each key (`processKeyAttempt`). These proficiencies gate ear-training content selection and drive key/scale unlocks.

The old global two-dimension variant (`processAttempt`, averaging a pitch and a rhythm complexity into a displayed level) was retired 2026-08-31 — nothing consumed its output, so it only ratcheted to 100.

