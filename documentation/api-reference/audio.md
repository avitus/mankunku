# API Reference: Audio

Audio modules handle playback, capture, pitch detection, onset detection, note segmentation, the metronome, and the full backing-track pipeline (piano + bass + drums).

**Source:** `src/lib/audio/`

---

## audio-context.ts

Shared `AudioContext` singleton for Tone.js and smplr, plus a master gain node routed to destination.

### `initAudio(): Promise<AudioContext>`

Initialize the audio engine. Must be called from a user gesture (click/tap). Idempotent — safe to call multiple times. Returns the raw `AudioContext` (not Tone.js's wrapper).

### `getAudioContext(): Promise<AudioContext>`

Returns the raw `AudioContext` Tone.js holds (for passing to smplr). It does **not** check `initAudio()` — Tone creates its context lazily, so before init this is a suspended context with no master gain; `getMasterGain()` is the accessor that throws when audio isn't initialized.

### `getNativeAudioContext(): Promise<AudioContext>`

Variant that unwraps standardized-audio-context's wrapper (`_nativeAudioContext`) — needed by APIs that check `instanceof BaseAudioContext`, e.g. the native `AudioWorkletNode` constructor the onset detector uses.

### `isAudioInitialized(): boolean`

Returns `true` if audio has been initialized.

### `getMasterGain(): GainNode`

Returns the shared master gain node. All instrument chains and backing-track output connect to this node, which in turn connects to `context.destination`. Throws if `initAudio()` hasn't run.

### `setMasterVolume(volume: number): void`

Set the master gain value (0–1). Applied at the graph's final node so it affects melody, metronome, and backing track simultaneously.

---

## playback.ts

Phrase playback using Tone.js Transport plus either custom multi-sampled instruments or smplr SoundFont fallbacks.

### `loadInstrument(instrumentId?, masterVolume?, backingInstrument?): Promise<void>`

Load the user's instrument. Defaults to `'tenor-sax'`. Looks up a `SampleMap` in `sample-maps.ts` and loads custom multi-sampled recordings (soprano, alto, and tenor sax ship with sample maps); when no sample map is available **or** custom samples fail to decode, it falls back to the **MusyngKite** SoundFont via smplr (with `loadLoopData: true` for natural sustain). Cached after first load. Previous instruments are disconnected on switch.

| Parameter | Type | Description |
|---|---|---|
| `instrumentId` | `string` | `'soprano-sax'` / `'tenor-sax'` / `'alto-sax'` / `'trumpet'` (default `'tenor-sax'`) |
| `masterVolume` | `number?` | When provided, applied via `setMasterVolume` during load |
| `backingInstrument` | `BackingInstrument?` | If provided, backing-track samples are loaded in parallel (best-effort — failures are logged and non-blocking) |

On load, sets up jazz expression effects:
- **Warmth filter**: Low-pass `BiquadFilterNode` (4500 Hz sax / 6000 Hz trumpet)
- **Vibrato LFO**: 4.8 Hz oscillator modulating filter detune (12 cents sax / 6 cents trumpet)

### `isInstrumentLoaded(): boolean`

Returns `true` if an instrument (custom sampler or SoundFont) is loaded and ready to play.

### `PhrasePlaybackOpts` interface

```typescript
interface PhrasePlaybackOpts {
  skipMelody?: boolean;          // Don't schedule melody notes (backing-only rescheduling)
  loopBacking?: boolean;         // Loop the backing track at phrase end
  resolveAtMelodyEnd?: boolean;  // Resolve the promise 1 beat after the melody's last note (call-and-response handoffs); ignored when skipMelody is set or the phrase has no melody
  onStarted?: () => void;        // Callback fired after Transport start
  startTick?: number;            // Explicit start tick for bar-aligned scheduling
  onNote?: (event: PlaybackNoteEvent) => void;  // Per sounding melody note, at the audible moment
}

interface PlaybackNoteEvent {
  sourceIndex: number;           // phrase.notes index of the first note of a (possibly tied) chain
  midi: number;
  ticks: number;                 // phrase-relative onset (excludes the count-in / startTick offset)
  durationSec: number;           // sounding duration after the articulation durationScale
}
```

`onNote` fires on the UI thread via `Tone.Draw`, scheduled from the same tick-anchored melody Part the audio uses, so a notation cursor and the sound share one clock; the schedule-generation guard suppresses a stale callback that survives `stopPlayback`, and it never fires under `skipMelody`. Tune practice drives its chart cursor with it.

### `playPhrase(phrase, options, keepMetronome?, opts?): Promise<void>`

Play a phrase through the loaded instrument.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `phrase` | `Phrase` | — | The phrase to play |
| `options` | `PlaybackOptions` | — | `{ tempo, metronomeEnabled, swing?, backingStyle?, ... }` |
| `keepMetronome` | `boolean` | `false` | If `true`, Transport + metronome keep running after phrase ends (for recording phase) |
| `opts` | `PhrasePlaybackOpts` | `{}` | Advanced scheduling hooks (see above) |

Returns a promise that resolves when the phrase finishes. If `keepMetronome` is `true`, call `stopPlayback()` to stop everything.

**Metronome scope:** when the backing track will actually play (`backingTrackEnabled` *and* the instruments are loaded), the synthesized metronome is scheduled for the **count-in bar only** — one real kit plus one synthesized kit is a worse click, not a louder one. Otherwise it runs infinitely under `keepMetronome`, or for the phrase plus its count-in. The count-in bar is also what `tickOffset` shifts the backing track by.

**Note conversion:** Phrase note offsets (fractions of a whole note) are converted to quarter-note beats (`* 4`), then to Tone.js ticks (`* PPQ`), and scheduled as `"${ticks}i"` time strings.

**Expression per note:** Each note gets breath-scoop detune (first note: −15 cents, low notes: −8 cents), humanized velocity (±8), and humanized timing (~±6 ms jitter at the 120 BPM reference, scaling inversely with tempo — e.g. ~±12 ms at 60 BPM).

**Swing:** Applied per-note inside `phraseToEvents` via `applySwingToBeats(rawBeats, swing)` (from `$lib/music/swing`), which shifts only off-beat eighths; triplets are immune by construction. `Tone.Transport.swing` is left at its default `0` (never mapped from `options.swing`) so Tone.js cannot double-shift triplet eighths whose ticks fall in an odd `8n` subdivision slot. There is no `swingSubdivision` mapping.

### `scheduleNextPhrase(phrase, options, opts?): Promise<void>`

Schedule a follow-on phrase onto the already-running Transport without stopping playback. Used by lick-practice to switch phrases at bar boundaries. Pass `opts.skipMelody` to reschedule only the backing track, or `opts.loopBacking: false` when another phrase will be scheduled before the backing would run out.

### `stopPlayback(): Promise<void>`

Stop current playback immediately — transport, metronome, backing track, and all ringing notes.

### `phraseToEvents(phrase, tempo, swing, ppq): PlaybackEvent[]`

The pure note → event conversion behind `playPhrase`: `extractSoundingNotes` (rest-skip + tie-merge), then `computeExpression` at `'moderate'` intensity, then tick placement with the swing pre-shift and humanization described above. The expression pass never touches timing, so the swung onset grid stays identical to the scorer's. Each `PlaybackEvent` carries `{ time, midi, duration, velocity, layerVelocity, release, cutoffHz, detune }` — `velocity` is the humanized loudness, `layerVelocity` the intended, un-humanized value that picks the piano/forte sample layer, so timbre tracks intent and never flickers with gain jitter.

### `getPhraseDuration(phrase, tempo): number`

Calculate total phrase duration in seconds.

### `getPhraseEndTicks(phrase, ppq, resolveAtMelodyEnd?): number`

Ticks from phrase start to the end-of-phrase notification, including a 1-beat margin for the last note's decay; callers add their own start offset. Default is whole-bar semantics — the max of melody and harmony extents, rounded up to a full bar (super phrases whose harmony outlives the demo melody need it). `resolveAtMelodyEnd` (default `false`) ends 1 beat after the last **sounding** note instead, so a call-and-response handoff isn't held back by a harmony vamp that outlasts the call; it falls back to whole-bar semantics when the phrase has no sounding notes.

### `getIsPlaying(): boolean`

Whether playback is currently active.

### `getTransportSeconds(): number`

Get the Transport's current position in seconds. Returns `0` if Tone.js hasn't been loaded.

---

## capture.ts

Microphone capture setup with processing-optimized constraints.

### `MicCapture` interface

```typescript
interface MicCapture {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  context: AudioContext;
}
```

### `checkMicPermission(): Promise<MicPermissionState>`

Check current microphone permission without prompting the user.

Returns `'granted'`, `'prompt'`, or `'unavailable'`. Conservatively returns `'prompt'` when the browser reports `'denied'` — this avoids misreporting on macOS where browser-level permissions may not have been requested yet.

### `startMicCapture(): Promise<MicCapture>`

Request microphone access and set up the audio graph. Idempotent — returns the existing capture if already started.

**Audio constraints:**
- `echoCancellation: false` — don't filter the instrument signal
- `noiseSuppression: false` — preserve harmonics
- `autoGainControl: false` — consistent levels

The `MediaStreamSource` connects to an `AnalyserNode` (fftSize=4096) but is **not** connected to the audio destination (prevents feedback loops).

### `stopMicCapture(): void`

Stop microphone capture. Disconnects the source and stops all media tracks. Safe to call when not capturing.

### `getMicCapture(): MicCapture | null`

Get the current capture, or `null` if not started.

### `getInputLevel(): number`

Read current input level (RMS) from the analyser. Returns `0–1`. Computes RMS from the time-domain buffer and scales by `* 4`, clamped to 1.0.

---

## capture-window.ts

Pure trims for pre-armed captures. Both flows arm the detectors *before* the user's entrance — a capture triggered by its own first note can never hold that note's attack, because the trigger (a confident pitch reading) needs most of an analyser window (~93 ms) of the note first — and then discard the lead-in afterwards. Two counterparts, one per entrance style:

### `trimToPerformance(readings, workletOnsets, duration, preroll?): TrimmedCapture`

For **reacted** entrances (ear training — the user comes in on their own reaction time). Drops the runs of readings that never reach performance level (see `dropSubFloorRuns` below), then everything more than `preroll` ahead of the first surviving reading, and rebases what is left to the new origin. `PERFORMANCE_PREROLL_SECONDS` (0.35) is bounded on both sides: it must exceed the ~190 ms detection lag it undoes, and stay under the ~250 ms where DTW alignment starts to flip (`rhythmDistance` saturates at one beat; 12 of the 21 scored diagnostic fixtures change grade between a 0.25 s and 0.5 s lead-in). Deliberately a **pure function of the capture** — gate, then first surviving reading minus a constant — so the live path, the authoritative replay rescore and /diagnostics all derive the same offset without persisting one. Returns `{ readings, workletOnsets, duration, offset }`; `offset` is the seconds removed from the front (add it to `recordingTransportSeconds` to keep bleed evidence on the beat grid). Captures with no readings, or recorded before pre-arming existed (first reading already at ~0), come back untouched.

### `dropSubFloorRuns(readings, floorDb?, gapSeconds?): PitchReading[]`

The gate `trimToPerformance` applies first. "Confident" is not "performance": McLeod clarity is amplitude-invariant, so a pure tone at the noise floor reads as a confident pitch. The metronome's ringing tail — a single ~271 Hz line at −58 dBFS decaying for ~400 ms after each click on the 2026-09-03 tonic-turn take — produced 1.2 s of clarity-0.9 readings before the player came in, 35–40 dB under the notes that followed; the trim anchored on it, the segmenter cut three phantom notes out of the ring, and DTW matched them against the expected line (a correct take saved as try-again). Splits the readings into runs at holes longer than `READING_RUN_GAP_SECONDS` (0.1 — six frames, so a decaying tail's clarity dropouts don't detach it) and drops every run whose peak never comes within `PERFORMANCE_FLOOR_DB` (−30) of the take's loudest reading, wherever it sits: leading, in a mid-phrase rest, or after the last note. The unit is the **run**, not the reading: a run that reached performance level keeps every reading, decay tail included, so the re-articulation tiers see exactly the evidence they were tuned on (the corpus tracks real decays to −46 dB) and the fixture corpus is byte-identical. Relative, not absolute, because the mic runs with auto-gain off — absolute levels track the user's gain, while a bleed artefact scales with the monitor and the played notes do not (measured margins: phantoms peak at −41 dB, the corpus's softest real note ~15 dB under its take's loudest). Returns the input array itself when nothing is dropped; an all-quiet capture keeps its loudest run and scores as it always did.

### `rebaseToAnchor(readings, workletOnsets, anchorOffset, tolerance?): RebasedCapture`

For **scheduled** entrances (record-a-lick — the entrance is the bar-3 downbeat, known in advance). The detectors run from the top of the count-in; once the take ends, this discards the count-in and re-origins everything on the anchor. No reaction time means no preroll — instead `ANCHOR_EARLY_TOLERANCE_SECONDS` (0.15) keeps events slightly **before** the anchor, because an attack played exactly on the downbeat starts sounding before either detector can report it. The tolerance sits above attack-transient scale (~50–80 ms) and below one beat at 240 BPM (250 ms), so the previous count-in click never survives. Events inside the tolerance come out at slightly negative times on purpose; the quantizer clamps them to beat 0. `anchorOffset` is the entrance in the capture's own timebase — the context time Tone hands the bar-3 `transport.schedule` callback (the audible downbeat, not the ~0.1 s-early callback time) minus the detectors' shared epoch. Returns `{ readings, workletOnsets }`.

---

## record-transcription.ts

The record-a-lick transcription tail, extracted from `/licks/record` so the whole pipeline is one pure, Node-testable function. The page owns audio plumbing and UI state; this owns everything from raw capture to `Phrase`.

### `transcribeTake({ readings, workletOnsets, anchorOffset, tempo }): Phrase | null`

Rebases the raw capture onto the scheduled entrance (`rebaseToAnchor`), computes the take duration (guarded to ≥ 0 — the rebase keeps readings down to −tolerance), then runs the SAME segmentation pipeline as ear training: `resolveOnsets` → `findReArticulations` → `segmentNotes`, with `getMetronomeBleedOnsets` over the take as bleed evidence at a transport offset of `RECORD_COUNT_IN_BEATS` (8 — the two woodblock bars). The kit clicks through the whole take, so dropping that grid restores phantom splits. It then quantizes in 4/4 and normalizes to concert C (`detectKey` → shift, `key: 'C'`) with `calculateDifficulty` stamped. Returns `null` when no readings survive the anchor or nothing survives segmentation — the page returns to idle. The phrase comes back with an empty `name` and `id`; the page assigns the name, and the id is stamped when the lick is saved (`saveUserLick`).

---

## pitch-detector.ts

Pitch detection using [Pitchy](https://github.com/ianprime0509/pitchy) (McLeod Pitch Method).

### `PitchReading` interface

```typescript
interface PitchReading {
  midiFloat: number;     // Fractional MIDI note number
  midi: number;          // Nearest integer MIDI note
  cents: number;         // Deviation from nearest note (-50 to +50)
  clarity: number;       // Detection confidence (0-1)
  time: number;          // Seconds from recording start
  frequency: number;     // Raw Hz
  rms: number;           // RMS amplitude of the whole analysis window
  hfRms?: number;        // RMS of the first-difference high-pass; high-frequency-energy proxy
  rmsMin?: number;       // Minimum short-window RMS (~11.6 ms sub-windows) inside the window
  bandRmsMin?: number;   // rmsMin on a 250-5000 Hz band-passed copy — the INSTRUMENT band
  shapeBreak?: number;   // Lowest short-time period-to-period waveform similarity (0-1)
  shapeBreakAt?: number; // Offset from `time` to the shapeBreak minimum (~3 ms precision)
  warmup?: boolean;      // Captured during the octave-stabilizer warmup window
  octaveUp?: boolean;    // Frame's spectrum looks like a 2nd-harmonic (octave-up) lock
}
```

> The `PitchReading` interface is defined in `pitch-frame.ts` (shared by the live rAF path and the offline replay path) and re-exported from `pitch-detector.ts`.

Every optional field is optional **for replay compatibility**: readings restored from diagnostic JSON written before the field existed simply skip the segmenter pass that consumes it (`hfRms` pre-2026-06-25, `rmsMin` pre-2026-07-25, `shapeBreak`/`shapeBreakAt` pre-2026-07-30, `bandRmsMin` pre-2026-08-01). Never make one required without a migration.

The four envelope/timbre fields exist because the re-articulation tiers each need a *different* kind of evidence — see [note-segmenter.ts](#note-segmenterts) below:

| Field | Measures | Sees |
|---|---|---|
| `rms` | Whole ~93 ms window | Gross envelope motion |
| `rmsMin` | Sliding ~11.6 ms sub-windows | A 20–30 ms tongue stop the window average smooths away |
| `bandRmsMin` | Same, on 250–5000 Hz only | An envelope dip a metronome click would otherwise fill in — the ride is high-passed at 8 kHz, the hi-hat at 6 kHz, and the kick's body sits under 250 Hz, so a bare cymbal measures ~25 dB down against a horn |
| `hfRms` | First-difference high-pass | A brightness burst from a light tongue that never dips the envelope |
| `shapeBreak` | Period-to-period waveform similarity | A legato tongue that produces *no* energy evidence at all — only a reed reset |

`FrameOptions.windowAnchor` (`'start' | 'end'`, default `'start'`) exists for `shapeBreakAt`: replay timestamps a reading at its window start, the live rAF path at its end, and `shapeBreakAt` is emitted such that `time + shapeBreakAt` is the discontinuity in either path's own time base.

### `PitchDetectorHandle` interface

```typescript
interface PitchDetectorHandle {
  start: () => void;
  stop: () => void;
  getReadings: () => PitchReading[];
  clear: () => void;
  resetOctaveStateAt: (time: number) => void;  // Queue an octave-stabilizer reset for the next rAF tick (onset plumbing warms up each note independently)
}
```

### `createPitchDetector(analyser, onPitch): Promise<PitchDetectorHandle>`

Create a pitch detector bound to an `AnalyserNode`.

| Parameter | Type | Description |
|---|---|---|
| `analyser` | `AnalyserNode` | From mic capture |
| `onPitch` | `(reading: PitchReading \| null, rawClarity: number) => void` | Callback on each frame |

**Detection parameters:**
- Runs at ~60fps via `requestAnimationFrame`; the per-frame math is `detectFrame` in `pitch-frame.ts` (below), shared with the offline replay path
- Clarity threshold: `CLARITY_THRESHOLD = 0.80`
- Frequency range: `MIN_FREQUENCY`–`MAX_FREQUENCY`, `80–1200 Hz`
- MIDI conversion: `12 * log2(freq / 440) + 69`

`CLARITY_THRESHOLD`, `MIN_FREQUENCY`, `MAX_FREQUENCY` and `OCTAVE_CONFIRM_FRAMES` are re-exports of the `DEFAULT_*` constants in `pitch-frame.ts`.

### `OCTAVE_CONFIRM_FRAMES: 3`

Exported constant: number of consecutive frames required before the detector commits to an octave change. Prevents flicker when the pitch is midway between octaves.

---

## pitch-frame.ts

The per-frame pitch math, shared by the live rAF loop (`pitch-detector.ts`) and the offline replay harness (`replay.ts`) so both produce identical readings from identical audio. Defines `PitchReading` (above).

### `detectFrame(buffer, time, detector, stabilizer, opts: FrameOptions): FrameResult`

One analyser window → `{ reading: PitchReading | null, rawClarity }` (`rawClarity` is always present, for UI meters; `reading` is null below the clarity threshold or out of range). Runs Pitchy, lifts an octave-down subharmonic pick with `correctSubharmonic` before the frequency enters the MIDI stream, measures the envelope/timbre fields (`rms`, `rmsMin`, `bandRmsMin`, `hfRms`, `shapeBreak`), applies the octave stabilizer (pass `null` to skip it), and flags `octaveUp` only on a frame neither the subharmonic correction nor the stabilizer moved. `FrameOptions` is `{ sampleRate, clarityThreshold?, minFrequency?, maxFrequency?, windowAnchor? }`; the thresholds default to `DEFAULT_CLARITY_THRESHOLD` (0.80), `DEFAULT_MIN_FREQUENCY` (80) and `DEFAULT_MAX_FREQUENCY` (1200).

### `createOctaveStabilizer(confirmFrames?, warmupFrames?): OctaveStabilizer`

Suppresses McLeod subharmonic glitches. **Warmup:** the first `warmupFrames` (`WARMUP_FRAMES`, 5 — ~80 ms) confident readings pass through raw, flagged `warmup`, and the clarity-weighted mode (ties → most recent) seeds the stable MIDI — the old first-frame lock latched onto the inharmonic partials of a reed attack. **Steady state:** an octave-only jump (±12/±24) must persist `confirmFrames` (`OCTAVE_CONFIRM_FRAMES`, 3) frames before it is accepted; any other change is accepted at once. `OctaveStabilizer` is `{ process(rawMidi, clarity): StabilizerResult; reset() }`, with `StabilizerResult = { midi, warmup }`. The confirm inertia means a reported octave change lands a frame or two late — the segmenter's octave-respell rule accounts for it.

### Spectral predicates — `goertzelMagnitude`, `correctSubharmonic`, `isOctaveUpLock`, `measureShapeBreak`

| Function | Purpose |
|---|---|
| `goertzelMagnitude(buffer, frequency, sampleRate)` | Magnitude at one frequency over a Hann-windowed buffer — O(n), allocation-free, far cheaper than an FFT when only a few bins are needed |
| `correctSubharmonic(buffer, frequency, sampleRate)` | Doubles the frequency when it is an octave-down subharmonic: the fundamental bin is empty against the octave above AND the odd harmonics (3f, 5f) are weak — a genuine low note that masks its own fundamental still has full-rank odd harmonics. A correction, applied in place |
| `isOctaveUpLock(buffer, frequency, sampleRate)` | Whether the frame looks like a 2nd-harmonic lock (energy at the odd half-multiples 1.5f / 2.5f, i.e. the 3rd/5th harmonics of f/2), for 160–370 Hz only. A **predicate, not a correction** — an attack transient can fake it for a frame, so the decision is deferred to `mergeWholeNoteOctaveUpLocks`, which acts only on a strong majority of a note's frames |
| `measureShapeBreak(buffer, frequency, sampleRate)` | `{ value, offsetSeconds } \| null` — the lowest period-to-period waveform similarity inside the window ("did the reed restart?"), best lag searched within a tolerance so bends and vibrato can't fake a break. ~0.99 on a steady tone. `null` when the pitch is too low for enough scan positions |

---

## onset-detector.ts

Main-thread coordinator for the AudioWorklet-based onset detector.

### `OnsetDetectorHandle` interface

```typescript
interface OnsetDetectorHandle {
  getOnsets: () => number[];   // Timestamps relative to recording start (seconds)
  clear: () => void;
  reset: (recordingStartTime: number) => void;
  dispose: () => void;
}
```

### `createOnsetDetector(context, source, onOnset?): Promise<OnsetDetectorHandle>`

Create and connect the onset detector worklet. The worklet is registered once per `AudioContext` lifetime.

| Parameter | Type | Description |
|---|---|---|
| `context` | `AudioContext` | Must be running |
| `source` | `MediaStreamAudioSourceNode` | From mic |
| `onOnset` | `(time: number) => void` | Optional callback on each onset |

### `handle.reset(recordingStartTime)`

Clear collected onsets and synchronize the timestamp reference with the pitch detector's recording start time. Must be called before each recording pass.

---

## onset-worklet.js

`AudioWorkletProcessor` running on the audio thread for low-latency onset detection. Deliberately plain JavaScript (not TypeScript): Vite loads it as a raw asset via `new URL('./onset-worklet.js', import.meta.url)` and does not transpile it, so it keeps its algorithm in sync with `onset-core.ts` without a build step.

**Algorithm (energy-based with HFC):**
1. Compute **High-Frequency Content**: `sum(|sample[i]| * (i + 1)) / N`
2. Maintain **EMA** with smoothing factor `0.85`
3. If `HFC / EMA > 3.0` and >= 60ms since last onset, fire event
4. Skip frames with energy below `0.001`
5. Allow EMA to settle for 5 frames

---

## onset-core.ts

The same algorithm as a pure TypeScript module, used by the offline replay harness (and mirrored by hand in the worklet). Constants: `ENERGY_SMOOTHING` (0.85), `ONSET_THRESHOLD` (3.0), `MIN_ONSET_INTERVAL` (0.06 s), `SILENCE_THRESHOLD` (0.001), `SETTLE_FRAMES` (5), `SILENCE_DECAY` (0.95 — the EMA decays through silence so the next loud frame produces a large ratio; that is how silence → signal registers, and settling can complete through silence).

### `createOnsetState(): OnsetState` · `processOnsetFrame(input, state, currentTime): OnsetEvent | null`

`OnsetState` is `{ smoothedEnergy, lastOnsetTime, frameCount }`. `processOnsetFrame` consumes one block (128 samples in the worklet), mutates `state`, and returns `{ onset: true, time }` when the block triggers an onset.

---

## note-segmenter.ts

Combines pitch readings and onset timestamps into `DetectedNote[]`.

### `validateOnsets(onsets, readings, window?): number[]`

Filter raw onset timestamps to only those confirmed by a pitch reading within a short window.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `onsets` | `number[]` | — | Raw onset timestamps (seconds, relative to recording start) |
| `readings` | `PitchReading[]` | — | Pitch readings, sorted by time |
| `window` | `number` | `0.15` | Max time after onset to look for a pitch reading (seconds) |

An onset is dropped if no pitch reading falls within `[onset, onset + window]`. This rejects false positives from metronome bleed and other percussive environmental noise that don't produce pitched content.

**The reading must be the onset's own.** A reading vouches for an onset only if its whole analyser window ends before the NEXT onset — the scan stops at `min(onset + window, nextOnset − ANALYSER_WINDOW_SECONDS)`, where `ANALYSER_WINDOW_SECONDS` (module-internal) is `4096 / 44100` ≈ 0.093 s, the longer of the two sample rates so a reading is never credited to an onset it could not have heard. Reference: the 2026-09-09 blue-note-drop take — a pre-armed capture holds the downbeat click the player enters on, the worklet fired on that click 135 ms ahead of the A3, and the A3's own first reading validated it, cutting a 177 ms phantom head off the note (a correct take saved as 2 of 3). A click produces no pitched window of its own; only borrowing the note's could keep it.

### `segmentNotes(readings, onsets, recordingDuration, minNoteDuration?, onsetGuard?, minReadings?, workletOnsets?, bleedOnsets?, articulationOnsets?): DetectedNote[]`

All parameters are positional (there is no `options` bag).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `readings` | `PitchReading[]` | — | Pitch readings, sorted by time |
| `onsets` | `number[]` | — | Resolved onset timestamps (seconds, sorted). Pass `resolveOnsets(...)` output, not raw worklet onsets. |
| `recordingDuration` | `number` | — | Total recording duration (seconds) |
| `minNoteDuration` | `number` | `0.05` | Minimum note duration to keep |
| `onsetGuard` | `number` | `0.08` | Seconds after a segment start during which FFT-tainted readings from the previous note are skipped |
| `minReadings` | `number` | `3` | Readings needed for the full pitch vote; a segment with fewer (but ≥ 2) falls back to its clearest reading |
| `workletOnsets` | `number[]?` | — | Raw AudioWorklet onset times. Used by the same-pitch consolidation pass to tell artifact splits apart from real re-articulations. |
| `bleedOnsets` | `number[]?` | — | Timestamps of scheduled audible events. The scored surfaces (ear training, lick practice, tune-practice windows) supply `resolveBleedEvidence(...)` (see `bleed-evidence.ts`): backing-track transient onsets when backing is enabled and a schedule exists (the metronome is count-in only under backing), else the metronome click grid via `getMetronomeBleedOnsets(...)` when the metronome is enabled, else `undefined`. Record-a-lick always passes the metronome grid (the kit clicks through the whole take); /diagnostics re-derives it from the stored recording metadata; tune practice's live freestyle scan passes none (pitch-derived onsets only). **No call site passes demo- or melody-playback events**. Worklet onsets landing inside the 50–200 ms speaker→mic bleed window after one of these are not counted as attack evidence during `mergeSamePitchWithoutAttack`, so an artifact split a click or backing hit caused gets collapsed back into one note. These timestamps don't drop any onsets pre-segmentation — segmentation uses `onsets` as given. |
| `articulationOnsets` | `number[]?` | — | Articulation onset times used by the re-articulation detector. |

**Algorithm:**
1. Use the resolved `onsets` as segment boundaries (no pre-segmentation drop; bleed-window suppression happens in the cleanup phase below). If there are no onsets, all readings form one note.
2. For each segment, skip readings inside `onsetGuard` — but only when the boundary IS an amplitude onset (worklet or articulation); a pitch-derived boundary already starts where the readings show the new pitch, and guarding it ate the frames that define the note (2026-07-25 root-frame). Split on durable pitch changes (legato), then pick the pitch by a clarity-weighted pitch-class vote with a nearest-octave tie-break (warmup frames down-weighted), median cents, average clarity. Drop segments shorter than `minNoteDuration` or made only of warmup frames; one with 2 to `minReadings − 1` readings takes its single clearest reading (clarity halved) rather than vanishing.
3. **Cross-segment octave collapse** — delete a sub-150 ms note exactly an octave from the longer note after it (an attack-subharmonic glitch that landed before the boundary).
4. **Octave respell** — a sub-150 ms note exactly an octave from the longer note BEFORE it, whose octave the next note does not continue, takes that neighbour's octave (keeping its onset) when the raw frequencies across the sliver plus one analyser window past its end read the neighbour's fundamental on ≥ 25% of frames. A re-tongued G3 speaks on its 2nd harmonic for ~70 ms (2026-09-09 climb-to-five); a genuinely played G4 contains no 196 Hz, so a real leap stays as played.
5. **Sandwich rule** — a note ±12 from two same-MIDI neighbours merges with both into one note, whatever its duration (a stuck 2nd-harmonic stretch mid-sustain).
6. **`mergeSamePitchWithoutAttack`** — Collapse adjacent same-MIDI segments whose boundary has no `workletOnsets` entry within ±75 ms. A worklet onset that *does* sit inside the bleed window after a `bleedOnsets` event is treated as bleed, not attack, so the split collapses anyway. Catches clarity dropouts and detector wobble that split a single held note.
7. **`mergeOctaveBoundariesWithoutAttack`** — Collapse a stray upper-octave segment back into its neighbour when ≥ 3 of the segment's raw frames match the lower fundamental (McLeod octave-lock artifact).
8. **`mergeWholeNoteOctaveUpLocks`** — Drop a whole note an octave when a strong majority of its frames carry `octaveUp` (a 2nd-harmonic lock). Acted on at the note level, not the frame level, so a stray attack-transient frame on a genuine mid-register note is harmless.

Passes 6 and 7 run only when the caller supplies attack evidence (`workletOnsets` or `articulationOnsets`); without it only pass 8 runs. The two **boundary** merge passes are conservative: they require explicit absence-of-attack evidence at the boundary, so genuine same-pitch re-articulations are preserved. Pass 8 is not a boundary merge — it re-pitches a whole note on a majority of `octaveUp` frames and has no attack-evidence requirement.

### Merge passes — exported individually

| Function | Signature |
|---|---|
| `mergeSamePitchWithoutAttack` | `(notes, workletOnsets, window = 0.075, bleedOnsets?, articulationOnsets?) → DetectedNote[]` — cents and clarity of a merged note are duration-weighted, so a long sustain isn't overridden by a glitch fragment. Articulation onsets count as attack evidence without the bleed filter (they are pitch-derived, not subject to speaker→mic latency) |
| `mergeOctaveBoundariesWithoutAttack` | `(notes, readings, workletOnsets, window = 0.075, bleedOnsets?) → DetectedNote[]` — merges toward the LOWER octave only; sub-octave artifacts are vanishingly rare and handled within segments |
| `mergeWholeNoteOctaveUpLocks` | `(notes, readings) → DetectedNote[]` — ≥ 60% of at least 3 confident frames flagged `octaveUp` |

**The bleed evidence is load-bearing, and the caller supplies it.** `resolveOnsets` takes no bleed argument, so a click can and does survive as a base onset; what removes the resulting split is `bleedOnsets` reaching `findReArticulations` and `mergeSamePitchWithoutAttack` (via `segmentNotes`). Dropping it at a call site silently restores the phantom — `tests/integration/pitch-replay.test.ts` scores the same take both ways.

### `resolveOnsets(workletOnsets, readings): number[]`

The baseline onset list for segmentation — **no bleed argument**. Worklet onsets are validated (`validateOnsets`); if none survive, it falls back to `extractOnsetsFromReadings`. It then prepends stable-pitch-run starts for notes the worklet missed before its first attack (legato entries, a take that starts mid-note), skipping warmup readings so an attack subharmonic can't seed a ghost; when the last such start lands within 150 ms of the first worklet onset and the note after agrees on pitch, the two describe one attack and the earlier stable-run start replaces the worklet onset.

### `extractOnsetsFromReadings(readings): number[]`

Fallback onset extractor for when the worklet produced nothing useful: the first reading, then every reading after a hole > 0.1 s (backdated 50 ms for attack latency) or on a MIDI change, at least 80 ms apart.

### `findReArticulations(readings, baseOnsets, bleedOnsets?): number[]`

The counterpart to the merge passes — it *splits* a same-MIDI run where the player re-attacked but the worklet's amplitude-weighted HFC threshold missed it. Scans contiguous same-MIDI runs of the READINGS (not the baseline segments, because a re-articulation can straddle a boundary the merge pass would collapse), and returns extra onset times the caller merges into the onset list AND passes to `segmentNotes` as `articulationOnsets`, so the merge passes keep the new boundaries. `baseOnsets` (the `resolveOnsets` output) lets the shape tier treat an attack the baseline already found as the start of a settle window; `bleedOnsets` carries the scheduled click times. Five tiers run in this order, each rejecting an impostor the others let through, and each run's onsets are sorted and deduped within 60 ms:

| Tier | Trigger | Key constants |
|---|---|---|
| Reading gap | Pitch tracking drops out inside the run — see the gap rules below | `RE_ARTICULATION_READING_GAP` (0.15 s), `RE_ARTICULATION_GAP_SUSTAIN` (0.85), `RE_ARTICULATION_GAP_ATTACK_RISE` (1.2), `RE_ARTICULATION_GAP_BLOOM_*`, `RE_ARTICULATION_BROKEN_ENTRY_SHAPE` (0.25), `RE_ARTICULATION_GAP_BAND_STOP` / `_HOLD` (0.75 / 0.75) |
| High-frequency spike | `hfRms` spikes ≥ 3× the run median with the fundamental perturbed ≥ 0.1 st against its local neighbours and the envelope sustained | `HF_RE_ARTICULATION_SPIKE_RATIO`, `HF_RE_ARTICULATION_MIN_PITCH_PERTURB`, `HF_RE_ARTICULATION_MIN_RMS_SUSTAIN`, `HF_BLEED_SUPPRESS_BEFORE` / `_AFTER` |
| Envelope dip | `rmsMin` dips and recovers with no dropout | `ENV_DIP_RATIO`, `ENV_RECOVER_RATIO`, `ENV_HF_CORROBORATION` |
| Clarity dip | Clarity drop paired with an RMS dip and recovery | `RE_ARTICULATION_CLARITY_DROP`, `RE_ARTICULATION_RMS_DROP_RATIO`, `RE_ARTICULATION_RMS_RECOVERY_RATIO` |
| Waveform shape | `shapeBreak` dips — the legato-tongue last resort; runs last so its settle gate sees every onset the tiers above emitted | `SHAPE_CLEAN_BASELINE`, `SHAPE_MIN_DROP`, `SHAPE_MIN_PERIODICITY`, `SHAPE_SETTLE_TIME`, `SHAPE_MIN_SUSTAIN` |

Each tier is gated on its field being present, so readings restored from older diagnostic JSON skip the tiers they cannot feed.

**The reading-gap rules.** A hole of 75 ms (the segmenter's split threshold) up to 150 ms is a *short* gap; ≥ 150 ms is a *bare* gap.

- **Bare gap:** fires when the energy after the hole is ≥ `RE_ARTICULATION_GAP_SUSTAIN` × the energy before it — a click on a decaying note wipes tracking just as long, but the note keeps fading (0.67 on the counterexample, 0.94/0.97 on real tongue stops). When a scheduled click lands **inside** the hole the floor rises to a genuine step-up (`RE_ARTICULATION_GAP_ATTACK_RISE`): a click only ever adds energy and masks tracking, it can never make the note louder, and the 2026-08-10 pent run split a held G by landing at 0.85, right on the plain floor.
- **Short gap:** must be a true detector silence — a hole bridged by warmup frames is a stabilizer-reset artifact and never fires. Then any one of four acceptances: **step-up** (energy ≥ 1.2× across the hole); **bloom** (the attack fell inside the hole, so the note resumes below the pre-hole level and climbs past it within 200 ms); **broken entry** (both of the last two tracked frames before the hole carry `shapeBreak` ≤ 0.25 with energy sustained ≥ 0.85 — tongue damping is progressive, so it leaves TWO deep frames at the entry where an impulse abrupt enough to blank tracking leaves at most one; 2026-08-18 crescendo tongue); **stop-and-hold** (the instrument-band floor `bandRmsMin` falls ≤ 0.75× across the hole — click-immune — AND the level 100–400 ms after tracking resumes holds ≥ 0.75× the pre-hole level; a note decaying under a click passes the first test and fails the second; 2026-09-09 blue-note-drop).
- **One hole, one onset:** once the gap tier has marked a hole, the clarity tier defers on it — its recovery-anchored onset lands 50–150 ms later, past the dedupe, and the sliver between the two became a fourth note (2026-05-20 blues-curl-up).

Two non-obvious rules govern the HF and shape tiers, and both are load-bearing:

- **`SHAPE_MIN_PERIODICITY` is a floor, not a ceiling.** The tier fires on a *shallow* similarity dip and rejects deep ones. A genuine legato tongue only reshapes an oscillation that never stops, so similarity barely moves (0.957, 0.961 against ~0.99 baselines); an impulsive contaminant — a metronome click, a key click, a thump — *adds* an uncorrelated signal and drives similarity toward zero (0.33, 0.54, 0.86 in the fixture corpus). Anything that destroys periodicity belongs to another tier or to nothing at all. Inverting this gate reintroduces every click false-positive.
- **The click-schedule veto is conditional, not unconditional.** A click's broadband burst clears every HF gate, so a spike inside a click's window (`HF_BLEED_SUPPRESS_BEFORE` 0.10 s / `_AFTER` 0.28 s) is discarded — but the beat is exactly where notes start, so the veto has three rescues, one per tongue signature a click can't fake: an in-span dip of the 250–5000 Hz instrument-band floor and a pre-spike stop-and-recover (both `bandFloorDips` — a click can only *add* energy), and the **feather tongue** (`feathersTongueShape`, 2026-08-13 repeated-Eb pair): no energy evidence at all, but a multi-frame `shapeBreak` dip in the shallow 0.80–0.92 band on a clean-baseline run, which also stands in for the pitch-perturbation corroborator and accepts the 0.85 re-attack sustain floor. Measured clicks null `shapeBreak` or drive it ≤ 0.60; the corpus's shallow non-events are single-frame or ≥ 0.956. The band-floor rescue is only ever consulted at cymbal clicks — kicks cannot reach the HF tier's 3× requirement in the first place.

`SHAPE_SETTLE_TIME` (and `RE_ARTICULATION_READING_GAP`) are **physical, not beat-relative**. They admit the swung-eighth pair the tier was built for (0.34 s at 105 BPM) but not straight sixteenths at fast tempos — intended conservatism for last-resort tiers, since a re-articulation that fast disturbs the envelope enough for the tiers above to catch it.

### `getMetronomeBleedOnsets(recordingTransportSeconds, tempo, recordingDuration): number[]`

Computes click times rather than reading them from a log: the metronome plays every beat from Transport 0, so click times are integer multiples of `60/tempo`, converted to recording time by subtracting `recordingTransportSeconds`, with a 250 ms pre-recording lookback so a click that fired just before capture but arrived inside it is still represented. Onsets landing inside the 50–200 ms speaker→mic window (`BLEED_LATENCY_MIN` / `BLEED_LATENCY_MAX`) after a computed click aren't counted as attack evidence.

**OPEN (measured 2026-09-08): on every pre-armed ear-training take this grid lands 0.25–0.40 s off the real clicks** (direct-mix click impulses in eight fixtures vs the grid at `transportSeconds + trim`). The one pre-arming fixture measures +0.098 s, which is Tone's 0.1 s `lookAhead` — `Transport.seconds` reads `currentTime + lookAhead`. So `isLikelyBleed`'s window, the HF suppression window and the in-gap click rule do not see the real clicks in production ear training; the corpus passes on the stored stamps. The fix is a re-baseline (stamp, fixture constants and bleed windows together), not a stamp tweak.

---

## metronome.ts

Synthesized jazz metronome using Tone.js synths.

### `warmUpMetronome(): Promise<void>`

Pre-create the metronome synths so the audio graph is stable before the first beat fires. Call during instrument loading, well before the first `playPhrase()`.

### `scheduleMetronome(beatsPerBar, bars, startAt?): Promise<void>`

Schedule a jazz metronome pattern.

| Parameter | Type | Description |
|---|---|---|
| `beatsPerBar` | `number` | Typically 4 |
| `bars` | `number \| null` | Number of bars, or `null` for infinite loop. `playPhrase` passes `1` — the count-in bar only — whenever the backing track will play, so the synthesized kit never doubles the real one |
| `startAt` | `string \| number` | Transport time of the first beat (default `0`). Pass **ticks** (e.g. `` `${8 * transport.PPQ}i` ``), never bar notation like `'2m'`: bar-based times convert through the **sticky global** `Transport.timeSignature`, which a prior playback in another meter may have left at 3 |

**Pattern:**
- **Kick drum** (beat 1): `MembraneSynth` at C1 for a short membrane thump marking the downbeat
- **Ride cymbal** (beats 2–4): White noise through 8kHz highpass filter. The kick *replaces* it on the downbeat rather than layering with it
- **Hi-hat chick** (beats 2 and 4): Pink noise through 6kHz highpass filter

Must be called before `Transport.start()`.

### `scheduleCountInClicks(beatsPerBar, bars): Promise<void>`

Schedule a finite run of count-in clicks from transport 0: high, dead-short woodblock tocks (`MembraneSynth`), downbeats accented. Deliberately nothing like the kit — record-a-lick pairs this with `scheduleMetronome(4, null, startAt)` so the kit enters exactly where the tocks stop, and the **texture change is the audible "your entrance" cue**. The tocks stay on the same quarter grid as the kit, so `getMetronomeBleedOnsets` needs no special-casing. Must be called before `Transport.start()`.

### `setMetronomeVolume(volume): Promise<void>`

Set metronome volume from the settings knob (`0–1`). The knob value is a **mix position, not a raw gain**: `METRONOME_TRIM` (0.6, ≈ −4.4 dB) applies underneath the whole knob range so the synthesized click sits under the music rather than beside it. The knob's shipped default is 0.5.

### `disposeMetronome(): void`

Stop and dispose the metronome sequences (kit and count-in).

---

## recorder.ts

Mixes the microphone input with the master gain (metronome + playback) into a single `MediaRecorder` stream. Used to let the user play back their attempt.

### `RecorderHandle` interface

```typescript
interface RecorderHandle {
  start(): void;
  stop(): Promise<Blob>;
  dispose(): void;
}
```

### `createRecorder(micSource, masterGain, audioCtx): RecorderHandle`

| Parameter | Type | Description |
|---|---|---|
| `micSource` | `MediaStreamAudioSourceNode` | From `startMicCapture()` |
| `masterGain` | `GainNode` | From `getMasterGain()` |
| `audioCtx` | `AudioContext` | Shared audio context |

Fans out both sources into a `MediaStreamDestinationNode` without disturbing existing connections. Mic signal is attenuated (~−8 dB) so it sits alongside the metronome. Chooses `audio/webm;codecs=opus` where supported, falling back to `audio/mp4` (Safari) or browser default.

---

## replay.ts

Offline replay of a captured buffer through the same pitch + onset pipeline as the live path (`detectFrame`, `processOnsetFrame`). Deterministic — no rAF jitter, no worklet scheduling — which is why the **authoritative** score is the post-hoc rescore of the saved recording, not the live readings. Also drives `tests/integration/pitch-replay.test.ts` and the /diagnostics Pitch Replay panel.

### `replayFromAudioBuffer(buffer, opts?: ReplayOptions): Promise<ReplayResult>`

Onsets are computed first, in 128-sample blocks to match the worklet, so the pitch loop can reset the octave stabilizer at each onset and every note warms up independently. `ReplayOptions` is `{ hopSize?, fftSize?, clarityThreshold?, minFrequency?, maxFrequency? }` — `hopSize` defaults to `sampleRate / 60` (the live 60 fps), `fftSize` to 4096 (the `AnalyserNode` size). Returns `ReplayResult = { readings, onsets, duration, sampleRate }`, time base starting at 0 (readings stamped at their window START — the live path stamps the END; see `FrameOptions.windowAnchor`). Accepts any AudioBuffer-like `{ sampleRate, length, numberOfChannels, duration, getChannelData }`, so tests pass a shim.

### `replayFromBlob(blob, audioCtx?, opts?): Promise<ReplayResult>`

Decodes a `MediaRecorder` blob and replays it. Pass the shared `AudioContext` where one exists; otherwise one is constructed at the platform default rate.

---

## quantizer.ts

Rhythmic quantization: converts `DetectedNote[]` into `Note[]` with fraction-based offsets and durations on a 1/48 whole-note grid. Jazz-aware by design: **swung eighths are WRITTEN straight**, so the output vocabulary per quarter-note beat is only {0, 1/3, 1/2, 2/3} — sixteenths and finer degrade to the nearest allowed position, and anything surviving the capture's rebase tolerance ahead of the entrance downbeat clamps to beat 0. The swing-eighth logic assumes a quarter-note beat; the only production caller (record-a-lick) records in 4/4, and the time signature affects only the 8-bar cap.

### `quantizeNotes(detected, tempo, timeSignature): Note[]`

| Parameter | Type | Description |
|---|---|---|
| `detected` | `DetectedNote[]` | Notes from `segmentNotes()` |
| `tempo` | `number` | BPM |
| `timeSignature` | `[number, number]` | e.g. `[4, 4]` |

**Algorithm (per-beat swing classification):**
1. Label each onset by its fraction within its quarter-note beat: *downbeat* (< 1/6), *first-triplet* (1/6–5/12), *offbeat* (5/12 up to `MAX_SWING` + 0.05 jitter). An upbeat heavier than that last boundary is more plausibly a rushed next downbeat than a swing feel the settings knob can't even express, so it counts toward beat k+1.
2. Classify **triplet beats, per beat** — never per take, so one bar can mix swung eighths with a genuine triplet. A beat is a triplet beat iff it contains a first-triplet onset (only triplet figures put anything near 1/3 — no swing feel places an upbeat that early), or its late upbeat (≥ 7/12) continues a quarter-note-triplet from the next beat (which must itself be a triplet beat with no downbeat onset of its own — the walk runs right to left).
3. Snap: downbeats to 0, first-triplet onsets to 1/3; upbeats resolve to the triplet grid (1/3 or 2/3) on triplet beats, and otherwise collapse to the straight eighth — the **swung-pair collapse**: straight 0.5 through `MAX_SWING` (which includes the 2/3 "triplet swing" point) all notate as a straight off-beat eighth.
4. Durations are measured as the distance to the next onset; the last note rounds its detected duration to its beat's own unit (eighth, or triplet eighth on a triplet beat), so a short swung final note reads as a full eighth rather than leaking sub-vocabulary ticks like 1/48.
5. Insert a rest when the gap between the previous note's end and the current onset exceeds 1.5 grid ticks.
6. Cap at `MAX_BARS = 8` bars; notes beyond that are truncated or dropped.

### `detectKey(detected): PitchClass`

Return the pitch class with the highest count in the detected-note pitch-class histogram. Defaults to `'C'` when there are no detected notes.

---

## voicings.ts

Jazz chord voicing utilities used by the backing track engine.

### `pitchClassToNumber(pc: PitchClass): number`

Return the index of a `PitchClass` name within `PITCH_CLASSES` (C=0, Db=1, ..., B=11).

### `shellVoicing(rootPc, quality, registerMidi?): number[]`

Shell voicing: root + 3rd + 7th (guide tones). Falls back to root + 3rd + 5th for triads without a 7th. Default `registerMidi = 54` (around F#3).

### `drop2Voicing(rootPc, quality, registerMidi?): number[]`

Drop-2 voicing: 4-note close-position voicing with the second-from-top note dropped an octave. Default `registerMidi = 60` (C4).

### `rootlessVoicingA(rootPc, quality, registerMidi?): number[]`

Rootless "A-form" voicing: 3-5-7-9 stacked from the 3rd. Altered tensions read from `CHORD_DEFINITIONS` replace the plain tones they colour — b9/#9 in the 9-slot, #11/b13 in the 5-slot — so altered dominants voice their colour tones. Returns `[]` for triads with no 7th-slot tone (`aug`, `dim`). Default `registerMidi = 62`; output is clamped into the mid-piano band (lowest ≥ 48, highest ≤ 84) so the comp never collides with the bass.

### `rootlessVoicingB(rootPc, quality, registerMidi?): number[]`

Rootless "B-form" voicing: 7-9-3-13 stacked from the 7th. Plain dominants take the natural 13 on top (the classic 13 / 13b9 sound); a b13 or #11 in the definition takes the top slot instead; other qualities top with the 5th. Same register clamp and triad behavior as the A-form.

### `guideToneVoicing(rootPc, quality, registerMidi?): number[]`

Just the 3rd and 7th — the two notes that define the harmony (3rd + 5th for triads). The comping planner's occasional guide-tone bars use this for the "leave space" color.

### `quartalVoicing(rootPc, quality, registerMidi?): number[]`

Fourth-stack on 9-5-1 (root on top), the modal McCoy-flavored shape; min7/min6/minMaj7/sus qualities add the 11 as a fourth voice. Returns `[]` for altered/diminished/augmented qualities — fourth-stacks blur exactly the tensions those chords exist to state — so voicing selection falls through to the rootless shapes.

### `voiceLead(chords, voicingFn, registerMidi?): number[][]`

`registerMidi` accepts one center or one per chord — a per-chord center only re-centers that chord's ±12 search window, so closeness to the previous voicing still dominates and an intensity arc drifts the comp gradually.

Apply a voicing function across a sequence of chords and minimize total semitone movement between successive voicings. Searches ±12 semitones around `registerMidi` per chord and picks the candidate closest to the previous voicing. Note-count mismatches are penalized by 12 semitones each. `voicingFn` may also be an **array** of `VoicingFn` (one per chord) so the comping engine can mix shell/rootless/drop-2 shapes while voice-leading still drives the register choice.

---

## sample-maps.ts

Static maps of MIDI numbers to sample URLs and per-note tuning corrections for custom multi-sampled instruments.

### `SampleRegion`, `SampleMap`, `DrumBufferName` interfaces

```typescript
interface SampleRegion {
  url: string;   // Path under /static
  tune: number;  // Cents correction (MTG SFZ mapping)
}

interface SampleMap {
  piano: Record<number, SampleRegion>;   // velocity ≤ split
  forte: Record<number, SampleRegion>;   // velocity > split
  velocitySplit: number;
}

type DrumBufferName =
  | 'kick'
  | 'ride' | 'ride_soft' | 'ride_acc' | 'ride_bell'
  | 'hihat' | 'hihat_pedal'
  | 'snare_ghost' | 'snare_med' | 'snare_acc'
  | 'crossstick'
  | 'crash';
```

### Constants

- **`TENOR_SAX_SAMPLES: SampleMap`** — 33 chromatic samples (MIDI 44–76) × 2 velocity layers, sourced from the MTG Solo Sax library (CC-BY 4.0, Universitat Pompeu Fabra). Tuning corrections compensate for A=442 Hz recording pitch.
- **`ALTO_SAX_SAMPLES: SampleMap`** — Alto sax multi-samples with per-note tuning corrections.
- **`SOPRANO_SAX_SAMPLES: SampleMap`** — Soprano sax multi-samples with per-note tuning corrections.
- **`SAMPLE_MAPS: Record<string, SampleMap>`** — Registry keyed by instrument id. Currently `'tenor-sax'`, `'alto-sax'`, and `'soprano-sax'` (mapping to `TENOR_SAX_SAMPLES`, `ALTO_SAX_SAMPLES`, and `SOPRANO_SAX_SAMPLES` respectively).
- **`DRUM_BUFFERS: Record<DrumBufferName, string>`** — Static drum sample URLs (Virtuosity Drums, CC0), one per velocity layer/articulation (kick, three ride layers + bell, hats + pedal, three snare layers, cross-stick, crash).
- **`DRUM_ARTICULATIONS: Record<DrumVoice, DrumLayer[]>`** — velocity layers per semantic voice, `DrumLayer = { buffer, maxVelocity }` (inclusive upper bound, 0–1): ride `ride_soft` ≤ 0.38 / `ride` ≤ 0.72 / `ride_acc`; snare `snare_ghost` ≤ 0.3 / `snare_med` ≤ 0.62 / `snare_acc`; every other voice one layer. Layers exist only where a soft and a hard stroke differ in timbre, not just level — all buffers are peak-normalized to −3 dBFS, so velocity (times the mix trims) is the only level control. **`drumBufferForVelocity(voice, velocity)`** picks the buffer for a generated, pre-trim velocity (the top layer when nothing matches).
- **`DRUM_FAMILY_BY_VOICE`** / **`DRUM_BUFFER_FAMILY`** — which sampler family (kick / snare / cymbals — see `DrumFamily` in backing-mix.ts) plays each semantic voice; the buffer-level table is derived from `DRUM_ARTICULATIONS` so a future velocity layer lands in its voice's family automatically.

### `layerToBuffers(layer): Record<string, string>`

Convert a `Record<number, SampleRegion>` velocity layer into the `{ noteName: url }` shape that smplr's `Sampler` expects (e.g. `{ "C4": "...", "C#4": "..." }`).

### `getTuneCorrection(map, midi, velocity): number`

Look up the tuning correction (cents) for a given MIDI + velocity in a `SampleMap`. Returns `0` if the region is missing.

---

## generation-rng.ts

Deterministic pseudo-random generation for the backing track engine (mulberry32, matching `util/seeded-shuffle.ts`). Every musical choice the generators make draws from a seeded stream so the same phrase at the same tempo reproduces the exact same backing.

### `SeededRng` interface

```typescript
interface SeededRng {
  float(): number;                    // [0, 1)
  int(min: number, max: number): number;  // inclusive bounds
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(entries: ReadonlyArray<{ value: T; weight: number }>): T;
}
```

### `createRng(seed: number): SeededRng`

### `seedFrom(...parts: Array<string | number>): number`

FNV-1a hash over the joined parts. Callers pass e.g. `(phraseId, tempo, 'bass', barIndex)` so the same bar of the same phrase always seeds the same stream.

---

## backing-intensity.ts

The ensemble intensity arc: one deterministic, **RNG-free** number per bar that every generator reads to shape density, dynamics and color. Intensity consumes no draws itself and only multiplies weights and probabilities at existing draw sites, so it can never reshuffle a *different* seed stream (within a stream, a flipped outcome can change dependent draw counts — as any weight tweak would; cross-stream isolation is the invariant).

### `barIntensity(input): number`

Mapped phrases (a `chorusIndex` present) build by chorus: `0.35 + 0.20·min(chorus, 2) + 0.08·cadence` — the band starts settled, digs in each chorus, leans into cadence bars. Sectionless phrases ramp gently across their length (`0.45 + 0.25·bar/total`) — a loop breathes, it doesn't peak. Reachable range: 0.35–0.83 mapped, 0.45–0.7 flat (the [0.2, 0.9] clamp is defensive, for out-of-contract inputs). Stamped on every `BarInfo` by `buildBarInfos` and carried into `GenerationContext.intensity`.

### `lerp(from, to, t): number`

The hook shape used at every intensity site: `weight × lerp(low, high, intensity)`.

**What the arc moves** — comp: rank-2 busy figures ×lerp(0.7, 1.7), deliberate rest ×lerp(2.2, 0.6), guide-tone bars mostly retire, realization velocity ±(−4…+6), voicing weights (shells early, quartal color later) and the voice-led register center lerp(58, 66); drums: ride modes (breathing bars early, skip-plus later), feathered-kick bar probability lerp(0.55, 0.9), snare silence lerp(6, 2.5), fill/crash probabilities ×lerp(0.9, 1.08); bass: ornament probabilities (ghosts, pickups, octave skips, cadence triplet) ×lerp(0.6, 1.4). Internal only — no settings knob.

---

## backing-styles.ts

Style definitions consumed by the backing generation engine. Patterns are generated one **bar** at a time from a `GenerationContext` — bar-level granularity is what lets a style state figures (Charleston, spang-a-lang, anticipations) that per-beat callbacks cannot express.

### `GenerationContext`, `CompHitSpec`, `DrumHitSpec`, `StyleDefinition` interfaces

```typescript
interface GenerationContext {
  barIndex: number;
  beatsPerBar: number;
  sectionIndex?: number;      // from Phrase.sectionMap (tunes only)
  chorusIndex?: number;       // pass through the form
  isSectionFirstBar: boolean; // section-arrival crash gate
  isSectionFinalBar: boolean;
  isChorusFirstBar?: boolean; // first bar of a chorus pass (downbeat crash stays home)
  isChorusFinalBar?: boolean; // last bar of a chorus when another follows — the long fill's home
  isFinalBar: boolean;
  intensity: number;          // ensemble arc (backing-intensity.ts), [0.2, 0.9]
  swing: number;
  rng: SeededRng;             // per-bar seeded stream
  compOnsets?: number[];      // beat offsets, for drum accent alignment
  plannedComp?: {             // resolved figure for compPlanning styles
    hits: Array<{ b: number; d: number }>;
    tags: string[];
    guideTones: boolean;
  };
  bassOnsets?: number[];      // beat offsets, for kick/bass pickup coupling
  fillRng?: SeededRng;        // dedicated drum-fill stream (form punctuation)
  clavePhase?: '32' | '23';   // phrase-level bossa clave phase (clavePhaseFor)
}

interface CompHitSpec { beatOffset: number; velocity: number; durationBeats: number }
interface DrumHitSpec { drum: DrumVoice; beatOffset: number; velocity: number }
// DrumVoice: 'kick' | 'ride' | 'hihat' | 'hihat-pedal' | 'snare' |
//            'crossstick' | 'ride-bell' | 'crash'

interface StyleDefinition {
  name: string;
  defaultSwing: number;       // the style's own grid; wins outright when swingModel is 'fixed'
  swingModel: 'tempo' | 'fixed';  // 'tempo' → swingForTempo curve
  timing: Record<TimingRole, TimingProfile>;  // ensemble microtiming
  compPlanning?: boolean;     // comp figures planned phrase-wide
  drumPattern: (ctx: GenerationContext) => DrumHitSpec[];  // one bar
  compPattern: (ctx: GenerationContext) => CompHitSpec[];  // one bar
  bass: 'auto' | 'two' | 'pattern';  // walking | permanent two-feel | bossa ostinato
  intensityCap?: number;             // ceiling on the ensemble arc (ballad: 0.6)
  voicingBias?: Partial<Record<     // comp voicing-weight multipliers
    'rootlessA' | 'rootlessB' | 'shell' | 'drop2' | 'quartal', number>>;
  compFigureBias?: Partial<Record<string, number>>; // figure-planner weight multipliers
}
```

`beatOffset` values of `x.5` are eighth off-beats — the generation layer places them late per the swing ratio.

> **Velocity scales:** Drum velocities are `0–1` (converted to MIDI at trigger time). Comp and bass velocities are MIDI `0–127` (smplr's convention). The two scales are intentionally different — don't swap them.

### Constants

- **`BACKING_STYLES: Record<BackingStyle, StyleDefinition>`** — Keys `swing`, `bossa-nova`, `ballad`, `straight`.
  - **Swing** (tempo-curve swing, 0.67 fallback; density/dynamics shaped per bar by `ctx.intensity`): drums are composed vocabulary passes (backing-drum-vocab.ts) — per-bar ride modes (standard spang-a-lang / breathing quarters-only / skip-plus / broken), hi-hat on 2 & 4 (the stick voice, `hihat` — the ballad is the style that uses the pedal), feathered kick under the felt-not-heard ceiling, sparse snare ghosts in dialogue with the comp, kick coupling to comp pushes and bass pickups, fills and setups marking the 4/8-bar form (incl. the hand-to-foot triplet, the Philly Joe kick bomb, the Moanin' side-stick, and a chorus-top long fill rolling over the barline), and section arrivals punctuated by a crash — sometimes anticipated onto the previous bar's final and with the kick, in which case the arrival keeps its downbeat ride — or, when the crash draw fails, a Blakey ride-bell accent that *does* replace the downbeat ride. Added voices are capped at one per beat offset (the anticipated push deliberately bypasses that cap, or its kick would be dropped under its own crash). Comping is phrase-planned (`compPlanning` → backing-comp-figures.ts): the pattern function realizes the planned figure's velocity and articulation.
  - **Bossa Nova** (straight, tight timing): rim-click clave on the cross-stick — 3-side `{1, 2&, 4}` / 2-side `{2, 3&}` (the Brazilian variant), the side per bar set by a **phrase-level phase draw** (`clavePhaseFor`, `clave` stream) shared by comp and drums so rim and guitar-hand never disagree; steady eighth hats with quarter accents over the surdo-derived kick `{1, 2&, 3, 4&}`; João-style comp figures tracking the clave side (the 2-side's and-of-3 push rides the anticipation voicing); `bass: 'pattern'` → `generateBossaBass`.
  - **Ballad** (fixed swing 0.55, loose timing, `intensityCap: 0.6`): the library has no brushes, so the kit speaks in the quietest stick voices — soft ride quarters, the hi-hat FOOT on 2 & 4, whisper kick, cross-stick / ghost-snare color, a cross-stick lean marking section ends. Comp is pads and space (whole-bar sustains, half pads, late pads, deliberate rests — section arrivals always sound) with `voicingBias` leaning drop-2 and quartal. `bass: 'two'` pins the walking planner to permanent two-feel: no chorus latch, no walk escapes, half notes all night.
  - **Straight** (fixed 0.5, halved timing offsets): the swing library played on even eighths — the full drum vocabulary and the phrase-planned comping run unchanged at ratio 0.5, with two leans: the figure planner rests more (`compFigureBias: { rest: 1.3 }` — even eighths clutter faster than swung ones) and a cross-stick colors beat 4. Walking bass (`'auto'`).
- **`BACKING_STYLE_NAMES: Record<BackingStyle, string>`** — Display names for UI menus.
- **`BACKING_STYLE_IDS: BackingStyle[]`** — The ids in display order; every style picker and validator derives from this (tune-practice buttons, settings validation) instead of hand-copying the union.
- **`StyleDefinition.bass`** — which bass engine the style uses: `'auto'` = the walking planner, `'two'` = the planner pinned to permanent two-feel (ballad), `'pattern'` = the bossa ostinato (non-4/4 falls back to walking). Values are added only with their implementation.
- **`StyleDefinition.intensityCap`** — optional ceiling on the per-bar ensemble arc, applied to the whole BarInfo timeline before any generator reads it (ballad: 0.6).
- **`StyleDefinition.voicingBias`** — optional multipliers over the comp voicing-choice weights (rootless A/B, shell, drop-2, quartal); how a style colors its harmony.
- **`StyleDefinition.compFigureBias`** — optional multipliers over the comp figure-planner weights, keyed by figure id; how a `compPlanning` style leans the shared library (straight: `rest: 1.3`).

---

## backing-generation.ts

Pure, Node-testable backing event generation — no Tone.js, no Web Audio. `backing-track.ts` turns these events into scheduled parts. Beat offsets are laid out straight, swung at the beat→tick conversion (`applySwingToBeats` — off-beat eighths land late), then given a few milliseconds of seeded jitter on top.

### `generateBacking(harmony, style, params): GeneratedBacking`

Entry point: generates comp first (drums read its onsets for accents), then bass, then drums. `params` (`BackingGenerationParams`) is `{ phraseId, tempo, ppq, beatsPerBar, swing, sectionMap?, timing? }`; the section map (from `Phrase.sectionMap`) drives section/chorus awareness, and bars are counted flat without it. `timing` overrides the per-role microtiming profiles and defaults to the style's own `timing` table. Returns `GeneratedBacking` = `{ bassEvents, compEvents, drumEvents }` — all carry tick-string `time` values plus a pre-swing `absBeat` for diagnostics and tests.

### `generateBackingCached(harmony, style, params): GeneratedBacking`

`generateBacking` behind a 4-entry LRU — provably safe because generation is deterministic in its inputs. The live scheduler uses this (lick-practice loops and per-key restarts regenerate the identical backing many times per session); cache hits are re-parsed from serialized JSON so every caller gets fresh objects. Keys include the full harmony content; styles key by `name`.

### `clavePhaseFor(phraseId, tempo): '32' | '23'`

The phrase-level bossa clave phase — one draw from the dedicated `clave` stream, deterministic in `(phraseId, tempo)` so the comp and drum generators (which each compute it) always agree. `'32'` = even-indexed bars carry the 3-side.

### `generateBossaBass(harmony, beatsPerBar, params, barInfos): BassLineResult`

Lives in `backing-bass.ts` and is **not** re-exported here — import it from `$lib/audio/backing-bass`. Dispatched via `StyleDefinition.bass === 'pattern'`: the surdo-derived root–fifth ostinato on the BAR grid with a per-beat chord lookup, so split bars (|Dm7 G7|) state the new root at the change point — root of the sounding chord on 1; on 3 the mid-bar chord's root when the harmony moves there (always stated), else the quality-aware fifth (the surdo drop below the root, guaranteed in band by the register policy); eighth pickups on the and-of-2 (chromatic approach when the chord changes at 3) and and-of-4 (approach when the barline brings a new chord); variation drops thin the pickups so the pattern breathes. Register sits flat around E2; events go through the same per-role timing placement as the walking line. 4/4 only — other meters fall back to the walking planner.

### `generateBassLine(harmony, beatsPerBar, params, barInfos, feelOverride?): BassLineResult`

Lives in `backing-bass.ts` (re-exported here, along with `chordToneIntervalsForBass`): the phrase-aware contour planner — register arcs per 4-bar group, coherent approach devices targeting the pitch the next downbeat will actually sound, scale-aware interior walk with anti-stutter guards, two-feel first choruses latching open to four, ornament probabilities (ghosts, pickups, octave skips, cadence triplet) scaled ×lerp(0.6, 1.4, intensity). Upright band E1–G3, leaps ≤ an octave (the octave-drop device's 13-semitone resolve excepted). `BassLineResult` is `{ events, onsetsByBar }`; `onsetsByBar` feeds the drum vocabulary's bass/kick coupling.

`feelOverride: 'two'` pins the planner to permanent two-feel — no chorus latch, no walk escapes. This is the entire ballad bass mechanism: `generateBacking` passes it whenever `style.bass === 'two'`.

### `generateComping(harmony, beatsPerBar, style, params, barInfos): { events, onsetsByBar }`

`events` are `CompEvent`s; `onsetsByBar` (`Map<bar, beatOffsets[]>`) is what `generateDrums` reads for comp/snare dialogue. A voicing type per chord (rootless A/B, shell, drop-2, or quartal where the quality suits it — seeded, quality-aware; the arc thins shells out and brings quartal color in as intensity builds, and the voice-led register center drifts lerp(58, 66, intensity)), voice-led across the sequence, placed by the style's per-bar figures; for `compPlanning` styles in 4/4 the figures come from the phrase-wide planner and guide-tone bars thin the voicing to the 3rd+7th. Off-beat (eighth) hits voice the chord sounding on the **next** beat, so pushes across a chord change anticipate the coming harmony.

### `generateDrums(beatsPerBar, style, params, barInfos, compOnsetsByBar, bassOnsetsByBar?): DrumEvent[]`

Per-bar pattern calls with a context carrying that bar's comp and bass onsets (for dialogue/coupling) and a dedicated `('drum-fill', bar)` stream (`ctx.fillRng`) so form punctuation never reshuffles the timekeeping draws. Two dedupe rules run over the whole timeline, and both must be cross-bar because the anticipated push is emitted at a negative offset and lands inside the previous bar:

1. **Loudest wins** on `(voice, absBeat)` — a later, quieter hit at the same instant is dropped.
2. **One right hand** — wherever a `crash` survives, any `ride` or `hihat` at that same instant is deleted. Kick and snare are deliberately kept (crash-with-shot is idiomatic). `suppressDownbeatRide` already handles this at the pattern level for downbeats; only `generateDrums` can see the *cross-bar* seam where an anticipated crash collides with the previous bar's ride skip.

### `buildBarInfos(totalBars, sectionMap?): BarInfo[]`

Per-bar `{ sectionIndex?, chorusIndex?, isSectionFirstBar, isSectionFinalBar, isChorusFirstBar?, isChorusFinalBar?, isFinalBar, intensity }`. A new chorus starts wherever the emitted `sourceSection` sequence restarts (body, ending 1, body, ending 2); the chorus flags mark its boundary bars (the phrase's final bar is never chorus-final — nothing follows). Bars past the last entry (harmony tail extension) belong to the last section. `intensity` is stamped by `barIntensity` (backing-intensity.ts).

### `chordToneIntervalsForBass(quality)`

`{ third, fifth, seventh | null }` semitone intervals read from `CHORD_DEFINITIONS` — min7b5 → b3/b5/b7, dim7 → b3/b5/bb7, aug7 → 3/#5/b7, sus4 → 4/5/b7. The natural 5th wins when the definition also carries a colour tone (7#11, 7b13); 6th chords walk their 6th in the 7th slot.

### `resolveBackingSwing(userSwing, style, tempo): number`

The backing's swing value. **The style owns the grid:** a `swingModel: 'fixed'` style (straight, bossa-nova, ballad) returns its `defaultSwing` unconditionally, because a bossa is straight regardless of the user's taste. Only `'tempo'` (the swing style) defers to the knob — `userSwing` when above `STRAIGHT_SWING`, otherwise `swingForTempo(bpm)` in `music/swing.ts` (Friberg–Sundström: constant ~100 ms short eighth, ≈3.5:1 cap below ~132 BPM, straight by 300).

This was inverted until 2026-08-09: any `userSwing > 0.5` overrode the style, and since the knob's minimum *is* 0.5 with a 0.05 step, every non-default position silently swung Straight and Bossa Nova. The old rule existed to keep the band on the soloist's grid; that invariant is now upheld from the other side by `resolveMelodySwing` (see backing-styles.ts) rather than by dragging the band onto the melody.

Shared by the live scheduler and the listening-lab bounce. `swingForTempo` remains banned from playback/scoring/tricks modules by a unit test, so the grid the scorer expects never varies with tempo.

### `resolveMelodySwing(userSwing, style): number` · `melodySwingForStyle(userSwing, styleId): number`

In `backing-styles.ts`. The melody's swing — what playback shifts and what the scorer expects. `'fixed'` styles return `defaultSwing` so the soloist shares the band's grid; `'tempo'` returns `userSwing` untouched. Deliberately tempo-independent and free of any `swingForTempo` reference.

Consumed by the three routes where a non-swing style is selectable (lick-practice session, ear-training, tune practice), including the swing value persisted with a recording and the one used to rescore it — otherwise a rescore would grade a take against a different grid than it was played on. Note ballad's `defaultSwing` is 0.55, so on ballad the melody grid differs from the raw knob even at the knob's 0.50 default.

---

## backing-timing.ts

Per-role ensemble microtiming: placement = straight beat → `applySwingToBeats` → role offset → triangular jitter → clamp ≥ 0, in ticks. `SWING_TIMING` profiles (ms): ride/bell 0±4 (the reference clock), hats 0±3, kick +2±6, snare/cross-stick +4±7, crash 0±5, bass −3±5 ("on top"), comp +12±8 (lays back). Offsets are constant milliseconds — compressed to 4% of the beat at fast tempi — and jitter is constant-ms too (the old `humanizeTicks` scaled with `120/tempo`, making slow tempi sloppier and fast tempi robotic). The three derived tables attach per style via `StyleDefinition.timing`, each built by `scaleTiming(SWING_TIMING, offsetScale, jitterScale, overrides?)`: `BALLAD_TIMING` (offsets ×1, jitter ×1.5, comp pinned to +18±12 — looser everywhere), `BOSSA_TIMING` (offsets ×0, jitter ×0.6 — on the grid and tight), `STRAIGHT_TIMING` (offsets ×0.5, **jitter unchanged** — the ensemble tightens toward the grid without becoming machine-even).

`placeEventTicks(absBeat, swing, ppq, tempo, profile, rng)` is the placement entry point; `MAX_OFFSET_BEAT_FRACTION` (0.04) is the fast-tempo clamp.

Jitter draws come from dedicated per-`(role, bar)` streams (`seedFrom(phraseId, tempo, '<role>-time', barIndex)` via `createTimingStreams`), so musical probability checks in a generator can never reshuffle another voice's — or later notes' — timing.

---

## backing-mix.ts

Per-instrument mix levels for the backing track, persisted per device (localStorage key `backing-mix-levels-v2`) so a mix tuned on `/diagnostics/backing-mixer` applies to every session. `bass`/`comp`/`drums`/`room` are linear gain multipliers layered on the overall backing volume; the drum-voice keys are velocity multipliers applied at drum trigger time (voices share their family sampler's output, so within-family balance can only be shaped through velocity). All values clamp to `[0, 3]`; `1` means "as generated".

### `BackingMixLevels` interface, `DEFAULT_BACKING_MIX`

`bass`/`comp`/`drums`/`room` are linear gain multipliers; the drum-voice keys are velocity multipliers applied at trigger time. `room` (increment 9) scales the ambience return; pre-room persisted mixes normalize to its default rather than going dry.

### `BACKING_BASE_TRIMS`

Baseline trims that equalize the raw sample-library loudness: the Smolken bass (`0.05`) and pianos (`0.1`) run far hotter than the drum kit (`1.8` gain plus per-voice velocity trims — kick 2.0, ride 0.71, hi-hat 0.81, etc. — re-expressing the ear-tuned 2026-08-02 balance against the −3 dBFS-normalized samples). The crash trim (`0.47`) sits deliberately below its family estimate: peak normalization is blind to sustain, and the crash's sustained body would otherwise ride far above the ride bed (Milestone B finding, walked down `0.9 → 0.55 → 0.51 → 0.47` in two confirm-listen passes; see `static/samples/drums/ATTRIBUTION.md`, "Crash exception"). User mix levels multiply these bases, so `1.0` on every slider reproduces the tuned balance. Levels saved under the pre-trim storage key are discarded on load — they'd double-apply the correction.

### `normalizeBackingMix(value): BackingMixLevels`

Merge an untrusted value over the defaults: known keys only, finite numbers only, clamped. Never throws.

### `loadBackingMix()` / `saveBackingMix(mix)`

localStorage round-trip; SSR-safe (defaults without storage).

### `voiceVelocity(base, trim): number`

Apply a voice trim to a generated drum velocity, clamped to `[0, 1]`.

### Spatial + bus policy (`DrumFamily`, `BACKING_PANS`, `ROOM_SENDS`, `ROOM_RETURN_GAIN`, `ROOM_IR_URL`, `BACKING_BUS_COMPRESSOR`)

One place for every number the live graph (backing-track.ts) and the offline bounce (backing-bounce.ts) must agree on, so a lab WAV keeps sounding like the app: the kit's three sampler families and their stereo positions (bass/kick centered — low frequencies pull the image; comp −0.2, snare −0.1, cymbals +0.25), per-source room-send levels (low end nearly dry), the −18 dB room return, the IR path, and the backing-bus glue-compressor parameters.

---

## backing-track-schedule.ts

Queryable snapshot of a scheduled backing track. Two consumers: the pitch-based bleed filter asks "what backing-track MIDI was active at transport time T?" (`activeMidiAt`), and the note segmenter asks "when do backing transients land inside this recording window?" (`bleedEventsIn` — the backing replaces the metronome grid as computed bleed evidence once the click is count-in only).

### `BackingScheduleNote`, `BackingTrackSchedule` interfaces

```typescript
interface BackingScheduleNote {
  midi: number;
  startSeconds: number;     // Transport-relative
  durationSeconds: number;
  source: 'bass' | 'comp';
}

interface BackingTrackSchedule {
  notes: BackingScheduleNote[];
  activeMidiAt(transportSeconds: number, tolerance?: number): number[];
  transientOnsets: number[];      // every audible start (bass+comp+drums), deduped 30ms
  loopSeconds: number | null;     // loop period when the parts loop
  bleedEventsIn(recordingTransportSeconds: number, recordingDuration: number): number[];
}
```

`activeMidiAt` defaults `tolerance` to `0.15` seconds; in loop mode it wraps the query onto the first generated pass and probes symmetrically — one period later *and* one period earlier — for notes ringing across the seam. `bleedEventsIn` returns recording-relative onsets with the same 250 ms pre-recording lookback as `getMetronomeBleedOnsets`, repeated across loop passes — previously coverage silently ended after the first pass of a looped recording. Because each pass was deduped independently at build time, the concatenated multi-pass output gets a **second** sequential 30 ms dedupe: an onset just before a loop's end and one just after the next pass's start otherwise land inside the same mic window and both count as evidence. The non-loop branch needs no second pass.

Drum hits contribute to `transientOnsets` only — never to the pitched `notes` list, which the bleed filter matches against.

### `buildSchedule(bassEvents, compEvents, drumEvents, tickOffset, ppq, tempo, loopTicks?): BackingTrackSchedule`

Collapse the generated event arrays (tick-string `time` values) into the schedule. Comp chords are expanded so each voice becomes an individual schedule note; drum events feed the transient-onset lists only (unpitched — never the pitch list). `tickOffset` adds the count-in bar; `loopTicks` (default null) enables loop-aware queries.

---

## bleed-evidence.ts

### `resolveBleedEvidence(ctx): number[] | undefined`

The one rule for what bleed evidence the segmenter receives, shared by the scored recording surfaces (ear training — live and the authoritative replay rescore — lick practice, tune practice). /diagnostics does not call it: it replays the evidence stored with the recording (`backingBleedOnsets`, else the metronome grid from the saved transport stamp). `ctx` is `{ schedule, backingTrackEnabled, metronomeEnabled, recordingTransportSeconds, tempo, recordingDuration }`. Backing enabled + schedule present → the schedule's `bleedEventsIn(...)` (the synth metronome is count-in only under backing, so the quarter-note click grid would be false evidence — and it never covered off-beat backing content); else metronome enabled → `getMetronomeBleedOnsets(...)`; else `undefined`. This also closes the old hole where metronome-off + backing-on produced no suppression at all.

---

## backing-track.ts

Backing-track scheduler: loads the instruments, calls `backing-generation.ts` for the events, and schedules them against the Tone.js Transport. Bass, comp **and drums** are all tick-placed `Tone.Part`s (drums moved off `Tone.Sequence` so their swung eighths share the swing grid). The effective swing comes from `resolveBackingSwing(options.swing, style, options.tempo)` — the style's own grid for `swingModel: 'fixed'`, the user's knob (or the tempo curve when it sits straight) for `'tempo'`. So the swing style's ride pattern swings even while the melody setting sits straight, and it swings by the *tempo curve*, not by `defaultSwing`.

**Instruments:**
- **Upright bass** — Smolken "Pizzicato" double-bass sample library
- **Comp** — `SplendidGrandPiano` (Salamander) for piano, or `Soundfont('drawbar_organ', kit: 'MusyngKite')` for organ
- **Drums** — three `smplr.Sampler`s (kick / snare-family / cymbals, partitioned by `DRUM_BUFFER_FAMILY`) driving the `DRUM_BUFFERS` (Virtuosity Drums, CC0)

The CDN libraries (bass, piano, organ) load through smplr's `CacheStorage` (versioned cache `mankunku-samples-v1`) when the Cache API is available, so revisits skip the network and the instruments work offline after a first load.

**The backing bus** (increment 9): everything backing flows through `backingGain` (the volume fader) into a gentle glue `DynamicsCompressor` (`BACKING_BUS_COMPRESSOR`) and only then into `getMasterGain()` — master itself is untouched and carries the melody dry. Comp is panned (`BACKING_PANS.comp`), the three drum-family samplers sit behind their own `StereoPanner`s on a shared `drumBus` (gain = kit trim; the volume lives upstream on `backingGain`), and a small-room `ConvolverNode` (IR fetched best-effort from `ROOM_IR_URL` — failure leaves the backing dry) takes post-pan sends per `ROOM_SENDS` and returns at `ROOM_RETURN_GAIN × mix.room` into the bus. The decoded IR is cached module-wide and survives `disposeBackingTrack`; the graph around it rebuilds on the next load. Per-instrument trims come from `backing-mix.ts` and are adjustable live via `setBackingMix`.

### `getBackingMix()` / `setBackingMix(partial)`

Read / update per-instrument mix levels. Updates apply to live gain nodes immediately (kick/ride/hihat velocity trims take effect from the next drum trigger) and persist via `saveBackingMix`. The `/diagnostics/backing-mixer` page is the UI over these.

### Diagnostics types

```typescript
interface BackingTrackBeat {
  beat: number;
  bassMidi: number;
  compMidi: number[] | null;
  compVelocity: number | null;
  drumParts: string[];
  melodyMidi: number | null;
}

interface BackingTrackSegmentLog {
  chord: string;
  startBeat: number;
  durationBeats: number;
  beats: BackingTrackBeat[];
}

interface BackingTrackLog {
  timestamp: number;
  phraseId: string;
  phraseName: string;
  key: string;
  tempo: number;
  timeSignature: [number, number];
  segments: BackingTrackSegmentLog[];
}
```

### `getBackingTrackLog(count?): BackingTrackLog[]`

Return the most recent backing-track schedules (newest first). Default and internal cap are both `MAX_LOG_ENTRIES` (10). Backed by `sessionStorage` so `/diagnostics` can render schedules from prior phrase playbacks.

### `loadBackingInstruments(instrumentType?): Promise<void>`

Load the shared bass + comp instruments. `instrumentType` is `'piano'` (default) or `'organ'`. Bass is loaded once and reused; comp is re-loaded only when the type changes. Safe to call concurrently — an internal load-id guards against stale loads overwriting newer ones.

### `isBackingLoaded(): boolean`

Returns `true` when both bass and comp are loaded.

### `scheduleBackingTrack(phrase, options, tickOffset, loop?, isStillCurrent?): Promise<void>`

Generate and schedule walking bass + comping + drums for a phrase.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `phrase` | `Phrase` | — | Source of harmony + time signature |
| `options` | `PlaybackOptions` | — | `{ tempo, backingStyle?, backingTrackVolume?, backingInstrument? }` |
| `tickOffset` | `number` | — | Ticks to shift events (usually one count-in bar) |
| `loop` | `boolean` | `false` | Loop bass/comp/drum parts at the end of the harmony |
| `isStillCurrent` | `() => boolean` | `() => true` | Guard for concurrent reschedules — the function bails out without touching module-level state once this returns false |

Also captures diagnostics into the log and builds a `BackingTrackSchedule` available via `getActiveSchedule()`.

### `startBackingTrack(phrase, options, keepLooping): Promise<void>`

Convenience: `loadBackingInstruments()` → `scheduleBackingTrack()` with a one-bar count-in offset. Call before `Transport.start()`.

### `getActiveSchedule(): BackingTrackSchedule | null`

Return the schedule produced by the most recent `scheduleBackingTrack()` invocation, or `null` if no backing track is active. Consumed by the bleed filter.

### `disposeBackingParts(): void`

Stop and release the current `Tone.Part`s (bass, comp, drums). Keeps the loaded instruments. Called between reschedules.

### `disposeBackingTrack(): void`

Full teardown: dispose parts, disconnect bass/comp/drum samplers and the shared gain node.

### `setBackingTrackVolume(volume: number): void`

Clamp to `0–1` and set the shared backing gain node's value. Affects bass + comp + drums together.

### `playTransitionChords(stabs, velocity?): void`

Trigger one-off chord stabs directly on the module-level comp instrument, outside any `Tone.Part`. No-op if the comp instrument isn't loaded. Drives the inter-lick **ii-V transition cue** in lick-practice sessions (built via `getTransitionCadenceChords` in `data/progressions.ts`).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `stabs` | `Array<{ notes: number[]; time: number; duration: number }>` | — | Chord stabs to trigger; `time` is absolute AudioContext seconds |
| `velocity` | `number` | `65` | MIDI velocity (0–127) |

Stab times **must** be near-now (within smplr's ~200 ms lookahead) so a later `compInstrument.stop()` (`disposeBackingParts` / teardown) can cut them. Schedule far-future stabs as Transport events that call this at fire time instead.

### `playBackingHitsNow(hits: BackingHit[], time): void`

The full-rhythm-section version of the same near-now contract: triggers bass, comp and drum `BackingHit`s (from `buildTurnaroundBarEvents`, below) directly on the loaded instruments, outside any `Tone.Part`. Callers schedule each batch as a transport event and pass the callback's `time` through. It lives here because the drum velocity-layer and trim mapping (`drumBufferForVelocity`, `BACKING_BASE_TRIMS`, the live mix levels) is module-private, so this mirrors the backing Parts' trigger callbacks.

---

## turnaround-bar.ts

One bar of rhythm-section ii-V into a target key as plain, schedulable data — the glue between continuous deep-practice cycles. It cannot be phrase harmony: the next cycle's `scheduleNextPhrase` runs a deferred `disposeBackingParts()` that destroys not-yet-fired Part events exactly when the turnaround should sound. Nor can it be built into the super phrase: its target is the NEXT cycle's head key, decided by scores earned during the current cycle.

### `buildTurnaroundBarEvents({ progressionType, targetKey, backingStyle, tempo, swing, ppq, beatsPerBar }): TurnaroundEvent[]`

Realizes `turnaroundHarmony(progressionType, targetKey, beatsPerBar)` through `generateBacking` (seeded on `turnaround:<type>:<key>`, so each key gets its own figures and replays are identical) and returns `{ tickOffset, hit }` events relative to the bar start, sorted. Events are clamped into the bar: negative jitter plays at 0, anything pushed past the barline is dropped so it can't collide with the next cycle's downbeat. `BackingHit` is a tagged union — `{ kind: 'bass', midi, velocity, duration } | { kind: 'comp', notes, velocity, duration } | { kind: 'drum', drum, velocity }`.

`turnaroundHarmony` itself lives in `data/progressions.ts` (re-exported here) so the lead-sheet reading pause can vamp the same bar inside a super phrase without the state layer importing audio code.

---

## backing-comp-figures.ts

Swing comping vocabulary: `COMP_FIGURES` (13 one- and two-bar figures — Charleston family, off-beat pairs, pushes, pads, 2-bar Red Garland / call-answer shapes, deliberate rest — all hits on the x.0/x.5 eighth grid the anticipation convention requires) and `planCompFigures(barInfos, beatsPerBar, phraseId, tempo, figureBias?): PlannedBar[]`, a sequential planner (the optional `figureBias` — `StyleDefinition.compFigureBias` — multiplies figure weights per id) whose anti-repetition memory reshapes WEIGHTS only — each bar keeps its own `('comp-figure', bar)` seed stream, so plans are reproducible per bar and the stream-isolation guarantee holds. Plan rules: no figure three choices running; bar 0 must open with an `early` figure; cadence (section-final, non-final) bars strongly favor `push` figures with the rest damped, and a non-push 2-bar figure may not land its tail on a cadence bar; rank-2 (busiest) figures lean in (×lerp(0.7, 1.7, intensity)) and deliberate rest thins out (×lerp(2.2, 0.6)) as the arc builds; the phrase's final bar may not rest; occasional guide-tone bars (p 0.06 × lerp(1.6, 0.4) — a low-intensity color that mostly retires as the band digs in). `hitsForPlannedBar` resolves a bar's concrete hits (handling 2-bar `'cont'` tails — via `headFigureFor`, which recovers the figure that owns a continuation bar — and final-bar suppression with a resolution-pad fallback); `compFigureById` is the lookup. Consumed by `generateComping` for styles with `StyleDefinition.compPlanning`, which hand the resolved hits to the pattern function via `ctx.plannedComp` for velocity/articulation realization: pads sustain untouched, **off-beat** non-push stabs clamp to ≤ 0.7 beats, and the **final-and** hit of a push figure holds ≥ 1.1 beats so it ties across the barline. The planner runs only for `compPlanning` styles in 4/4.

---

## backing-drum-vocab.ts

Swing drum vocabulary: composable per-bar passes the swing `drumPattern` assembles, splitting the kit into a timekeeping **ostinato** (ride + hats + feathered kick) and sparse **additions** (snare dialogue, coupling kicks, fills) capped at one added voice per beat offset. All randomness flows through the caller's per-bar `drums` stream except form punctuation, which draws from the dedicated `drum-fill` stream (`ctx.fillRng`).

- **`chooseRideMode(rng, intensity)` / `rideBar(mode, barIndex, beatsPerBar, rng)`** — per-bar ride flavor (`standard` w5 / `quarters-only` w2·lerp(1.6, 0.5, I) / `skip-plus` w1.5·lerp(0.5, 1.8, I) / `broken` w1 — breathing bars early, busier sentences later): quarters on every beat (velocity 0.36–0.48, backbeats favored, a +0.05 shade on every 4th bar's downbeat), skip eighths per mode — standard after 2 and 4, skip-plus adds one after 1 or 3, broken drops one backbeat skip and speaks after 1 instead.
- **`hihatBar(beatsPerBar, rng)`** — the hi-hat on 2 & 4, the one non-negotiable. It emits the `hihat` stick voice; the source comment calls it "foot", but the pedal sample (`hihat-pedal`) is the ballad's voice, not this one.
- **`featherBar(beatsPerBar, rng, intensity)`** — feathered kick quarters at velocity 0.07–0.13 (felt, never heard); bar probability lerp(0.55, 0.9, I) — more bars sit out early in the form.
- **`snareBar(ctx, rng)`** — conversational comping: nothing (weight lerp(6, 2.5, I) — the snare talks more as the band digs in) / single ghost / ghost pair / and-of-4 accent (the accent only before a 4-bar group boundary — a setup, not a habit), plus a p 0.25 echo ghost one beat after an off-beat comp onset.
- **`couplingBar(ctx, rng)`** — kick catches off-beat comp pushes (p 0.35) and doubles swung-eighth (x.5) bass pickups from `ctx.bassOnsets` (p 0.25); the bass's triplet ornaments are deliberately not doubled.
- **`fillBar(ctx, fillRng)`** — form punctuation: light markers at 4-bar boundaries (p 0.18, one of four — two snare shapes, the Philly Joe kick bomb on the and of 3, the Moanin' side-stick on 4), one of five setup figures on every section-final bar (incl. a snare triplet and the hand-to-foot triplet, whose 1/3-beat offsets the swing conversion never touches), a chorus-top long fill on chorus-final bars (p 0.6, replacing the setup draw: a ghost–accent–ghost build over the barline whose velocities alternate the snare sample layers, foot landing the final triplet partial), and section-first punctuation (crash p 0.6 from chorus 1, else 0.25; marker and crash probabilities ×lerp(0.9, 1.08, I)) that **replaces** the downbeat ride via the returned `suppressDownbeatRide` flag: the crash — 30% of successful mid-chorus crash draws anticipating it onto the previous bar's final and, paired with the kick, on the returned `anticipated` channel (negative offsets, ostinato-bound so the one-per-offset ledger can't drop the pair; the ride then keeps the downbeat, and the cross-bar sweep in `generateDrums` clears the previous bar's tick-coincident ride/hat) — or, when the crash draw fails (p 0.35), a Blakey ride-bell accent on 1.
- **`capAdditionsPerOffset(ostinato, additions)`** — the anti-clutter ledger: first addition wins each beat offset (the caller passes fills first, then coupling kicks, then snare chatter, so form-marking hits take contested slots); ostinato hits don't count against it. The anticipated push rides the ostinato side for exactly this reason — its crash and kick share one offset.

---

## backing-lab-presets.ts / backing-bounce.ts / backing-report.ts / backing-listening-checklist.ts

The backing **listening lab** (see `documentation/contributing/backing-listening.md` for the protocol). All four modules are pure/Node-testable except the render call itself.

- **backing-lab-presets.ts** — `BACKING_LAB_PRESETS` (ii-V-I-VI loop, 12-bar F blues, rhythm-changes A, 3-chorus AABA with a `sectionMap`), `LAB_TEMPO_PRESETS` (90/160/240), `labPhraseWithSeed(preset, seed)` (suffixes the phrase id — all generation streams derive from it, so a suffix re-rolls every stream), and `buildChorusedForm(sections, choruses)` which emits the flattened harmony plus a sectionMap whose `sourceSection` restart marks each chorus boundary.
- **backing-bounce.ts** — `generateForBounce(params)` (the exact generation call the live scheduler makes, at `BOUNCE_PPQ = 192`), `bounceBacking(params, drumBuffers, roomIr?)` (renders to a WAV blob via smplr `renderOffline` at `BOUNCE_SAMPLE_RATE = 44100`, mirroring the live bus: volume → glue compressor, panned comp, three panned drum-family samplers, optional room-convolver sends, per-voice velocity trims), `renderEventsToWav`, `renderGoldenJsonToWav` (plays a past engine's committed events through today's instruments), `eventTicksToSeconds`, `harmonyDurationBeats`, `eventsDurationSeconds`, `bounceFilename`. Output is peak-normalized to −1 dBFS, with the gain capped at 50× so a genuinely silent render can't be amplified into its own noise floor.

  Two non-obvious mechanics: every instrument in a bounce shares **one smplr `Scheduler` whose lookahead spans the entire render**, because an offline context finishes in milliseconds and a normal `setInterval`-pumped queue would fire almost none of the events (the original "one beat of music" bug). And the IR is decoded on a throwaway `OfflineAudioContext` pinned to the bounce sample rate, *not* reused from the live graph's cache: `decodeAudioData` resamples to its own context's rate and `ConvolverNode.buffer` throws on a rate mismatch, so a 48 kHz output device would otherwise have killed the whole 44.1 kHz render. A mismatch that slips through renders dry rather than throwing.

  Drum buffers come from `getDecodedDrumBuffersForBounce()` and the IR from `getDecodedRoomIrForBounce(sampleRate)` in backing-track.ts, so a bounce with no IR renders dry exactly like the app would. Note the bounce calls plain `generateBacking`, not the memoized variant.
- **backing-report.ts** — `buildBackingReport()`: deterministic ASCII statistics over lab presets × tempi × seeds (bass intervals/stepwise/downbeat-root, comp density/placement, drum voice activity). Snapshot at `documentation/reference/backing-report.txt`, regenerated by `npm run backing:report` and pinned by `tests/unit/audio/backing-report.test.ts`; golden event fixtures live under `tests/fixtures/backing/` via `npm run backing:golden`.
- **backing-listening-checklist.ts** — `LISTENING_CHECKLIST` (the single source of truth for human listening items: `ListeningChecklistItem = { id, section, prompt, detail }`, grouped by `ChecklistSection` — swing-feel / bass / comp / drums / ensemble / mix, labelled by `CHECKLIST_SECTION_LABELS`), `buildListeningReport(meta: ListeningReportMeta, verdicts)` → markdown for PRs and the listening log (`ChecklistVerdict` is `'pass' | 'fail' | 'skip'`; `meta` is `{ presetLabel, style, tempo, seed, notes? }`).

---

## bleed-filter.ts

Reference-aware filter that rejects detected notes likely produced by backing-track audio bleeding into the microphone.

### `BleedFilterResult` interface

```typescript
interface BleedFilterResult {
  kept: DetectedNote[];
  filtered: DetectedNote[];
}
```

### `filterBleed(detected, schedule, recordingTransportSeconds, clarityFloor?): BleedFilterResult`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `detected` | `DetectedNote[]` | — | Notes from the segmenter (post onset-validation) |
| `schedule` | `BackingTrackSchedule` | — | Usually from `getActiveSchedule()` |
| `recordingTransportSeconds` | `number` | — | Transport time when recording began |
| `clarityFloor` | `number` | `0.88` | Clarity below which a pitch-matched note is rejected |

**Decision tree (per note):**
1. Compute `transportTime = recordingTransportSeconds + note.onsetTime`, then ask the schedule for active backing MIDI at that time.
2. If the detected pitch does **not** match any active backing MIDI (allowing 0 / 12 / 24 semitone aliasing), keep.
3. If clarity ≥ `0.92` (ceiling), keep — the user is clearly playing along.
4. If clarity < `clarityFloor`, reject as bleed.
5. Borderline clarity: reject only if the detected onset lands within 50 ms of a backing note start.
6. Otherwise, keep (benefit of the doubt).
