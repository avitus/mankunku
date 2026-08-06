# API Reference: Audio

Audio modules handle playback, capture, pitch detection, onset detection, note segmentation, the metronome, and the full backing-track pipeline (piano + bass + drums).

**Source:** `src/lib/audio/`

---

## audio-context.ts

Shared `AudioContext` singleton for Tone.js and smplr, plus a master gain node routed to destination.

### `initAudio(): Promise<AudioContext>`

Initialize the audio engine. Must be called from a user gesture (click/tap). Idempotent — safe to call multiple times. Returns the raw `AudioContext` (not Tone.js's wrapper).

### `getAudioContext(): Promise<AudioContext>`

Returns the raw `AudioContext`. Throws if `initAudio()` hasn't been called.

### `getNativeAudioContext(): Promise<AudioContext>`

Variant that returns the native `AudioContext` — used when a module needs to hand the underlying context to browser APIs that don't accept Tone's wrapper.

### `isAudioInitialized(): boolean`

Returns `true` if audio has been initialized.

### `getMasterGain(): GainNode`

Returns the shared master gain node. All instrument chains and backing-track output connect to this node, which in turn connects to `context.destination`.

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
}
```

### `playPhrase(phrase, options, keepMetronome?, opts?): Promise<void>`

Play a phrase through the loaded instrument.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `phrase` | `Phrase` | — | The phrase to play |
| `options` | `PlaybackOptions` | — | `{ tempo, metronomeEnabled, swing?, backingStyle?, ... }` |
| `keepMetronome` | `boolean` | `false` | If `true`, Transport + metronome keep running after phrase ends (for recording phase) |
| `opts` | `PhrasePlaybackOpts` | `{}` | Advanced scheduling hooks (see above) |

Returns a promise that resolves when the phrase finishes. If `keepMetronome` is `true`, call `stopPlayback()` to stop everything.

**Note conversion:** Phrase note offsets (fractions of a whole note) are converted to quarter-note beats (`* 4`), then to Tone.js ticks (`* PPQ`), and scheduled as `"${ticks}i"` time strings.

**Expression per note:** Each note gets breath-scoop detune (first note: −15 cents, low notes: −8 cents), humanized velocity (±8), and humanized timing (~±6 ms jitter at the 120 BPM reference, scaling inversely with tempo — e.g. ~±12 ms at 60 BPM).

**Swing:** Applied per-note inside `phraseToEvents` via `applySwingToBeats(rawBeats, swing)` (from `$lib/music/swing`), which shifts only off-beat eighths; triplets are immune by construction. `Tone.Transport.swing` is left at its default `0` (never mapped from `options.swing`) so Tone.js cannot double-shift triplet eighths whose ticks fall in an odd `8n` subdivision slot. There is no `swingSubdivision` mapping.

### `scheduleNextPhrase(phrase, options, opts?): Promise<void>`

Schedule a follow-on phrase onto the already-running Transport without stopping playback. Used by lick-practice to switch phrases at bar boundaries. Pass `opts.skipMelody` to reschedule only the backing track, or `opts.loopBacking: false` when another phrase will be scheduled before the backing would run out.

### `stopPlayback(): Promise<void>`

Stop current playback immediately — transport, metronome, backing track, and all ringing notes.

### `getPhraseDuration(phrase, tempo): number`

Calculate total phrase duration in seconds.

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
- Runs at ~60fps via `requestAnimationFrame`
- Clarity threshold: `CLARITY_THRESHOLD = 0.80`
- Frequency range: `80–1200 Hz`
- MIDI conversion: `12 * log2(freq / 440) + 69`

### `OCTAVE_CONFIRM_FRAMES: 3`

Exported constant: number of consecutive frames required before the detector commits to an octave change. Prevents flicker when the pitch is midway between octaves.

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

### `segmentNotes(readings, onsets, recordingDuration, minNoteDuration?, onsetGuard?, minReadings?, workletOnsets?, bleedOnsets?, articulationOnsets?): DetectedNote[]`

All parameters are positional (there is no `options` bag).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `readings` | `PitchReading[]` | — | Pitch readings, sorted by time |
| `onsets` | `number[]` | — | Resolved onset timestamps (seconds, sorted). Pass `resolveOnsets(...)` output, not raw worklet onsets. |
| `recordingDuration` | `number` | — | Total recording duration (seconds) |
| `minNoteDuration` | `number` | `0.05` | Minimum note duration to keep |
| `onsetGuard` | `number` | `0.08` | Seconds after a segment start during which FFT-tainted readings from the previous note are skipped |
| `minReadings` | `number` | `3` | Minimum pitch readings required to keep a segment |
| `workletOnsets` | `number[]?` | — | Raw AudioWorklet onset times. Used by the same-pitch consolidation pass to tell artifact splits apart from real re-articulations. |
| `bleedOnsets` | `number[]?` | — | Timestamps of scheduled audible events. Every caller supplies `resolveBleedEvidence(...)` (see `bleed-evidence.ts`): backing-track transient onsets when backing is enabled and a schedule exists (the metronome is count-in only under backing), else the metronome click grid via `getMetronomeBleedOnsets(...)` when the metronome is enabled, else `undefined` — **no call site passes demo- or melody-playback events**. Worklet onsets landing inside the 50–200 ms speaker→mic bleed window after one of these are not counted as attack evidence during `mergeSamePitchWithoutAttack`, so an artifact split a click or backing hit caused gets collapsed back into one note. These timestamps don't drop any onsets pre-segmentation — segmentation uses `onsets` as given. |
| `articulationOnsets` | `number[]?` | — | Articulation onset times used by the re-articulation detector. |

**Algorithm:**
1. Use the resolved `onsets` as segment boundaries (no pre-segmentation drop; bleed-window suppression happens in the cleanup phase below).
2. For each segment, compute median MIDI note, median cents on matching readings, and average clarity.
3. Filter segments shorter than `minNoteDuration`.
4. If no onsets detected, treat all readings as one note.
5. **`mergeSamePitchWithoutAttack`** — Collapse adjacent same-MIDI segments whose boundary has no `workletOnsets` entry within ±75 ms. A worklet onset that *does* sit inside the bleed window after a `bleedOnsets` event is treated as bleed, not attack, so the split collapses anyway. Catches clarity dropouts and detector wobble that split a single held note.
6. **`mergeOctaveBoundariesWithoutAttack`** — Collapse a stray upper-octave segment back into its neighbour when ≥ 3 of the segment's raw frames match the lower fundamental (McLeod octave-lock artifact).
7. **`mergeWholeNoteOctaveUpLocks`** — Drop a whole note an octave when a strong majority of its frames carry `octaveUp` (a 2nd-harmonic lock). Acted on at the note level, not the frame level, so a stray attack-transient frame on a genuine mid-register note is harmless.

The two **boundary** merge passes (5 and 6) are conservative: they require explicit absence-of-attack evidence at the boundary, so genuine same-pitch re-articulations are preserved. Pass 7 is not a boundary merge — it re-pitches a whole note on a majority of `octaveUp` frames and has no attack-evidence requirement.

### `findReArticulations(...)`

The counterpart to the merge passes — it *splits* a same-MIDI run where the player re-attacked but the worklet's amplitude-weighted HFC threshold missed it. Five tiers run in order of evidence strength, each rejecting an impostor the others let through:

| Tier | Trigger | Key constants |
|---|---|---|
| Reading gap | Pitch track drops out, energy steps back up on resumption | `RE_ARTICULATION_READING_GAP`, `RE_ARTICULATION_GAP_ATTACK_RISE`, plus a **bloom** acceptance path — a reed attack blooms over 100–200 ms and can read *below* the pre-gap mean on resumption |
| Clarity dip | Clarity drop paired with an RMS dip and recovery | `RE_ARTICULATION_CLARITY_DROP`, `RE_ARTICULATION_RMS_DROP_RATIO`, `RE_ARTICULATION_RMS_RECOVERY_RATIO` |
| Envelope dip | `rmsMin` dips and recovers with no dropout | `ENV_DIP_RATIO`, `ENV_RECOVER_RATIO`, `ENV_HF_CORROBORATION` |
| High-frequency spike | `hfRms` spikes ≥ 3× the run baseline with the envelope sustained | `HF_RE_ARTICULATION_SPIKE_RATIO`, `HF_RE_ARTICULATION_MIN_RMS_SUSTAIN` |
| Waveform shape | `shapeBreak` dips — the legato-tongue last resort | `SHAPE_CLEAN_BASELINE`, `SHAPE_MIN_DROP`, `SHAPE_MIN_PERIODICITY`, `SHAPE_SETTLE_TIME`, `SHAPE_MIN_SUSTAIN` |

Two non-obvious rules govern the last two tiers, and both are load-bearing:

- **`SHAPE_MIN_PERIODICITY` is a floor, not a ceiling.** The tier fires on a *shallow* similarity dip and rejects deep ones. A genuine legato tongue only reshapes an oscillation that never stops, so similarity barely moves (0.957, 0.961 against ~0.99 baselines); an impulsive contaminant — a metronome click, a key click, a thump — *adds* an uncorrelated signal and drives similarity toward zero (0.33, 0.54, 0.86 in the fixture corpus). Anything that destroys periodicity belongs to another tier or to nothing at all. Inverting this gate reintroduces every click false-positive.
- **The click-schedule veto is conditional, not unconditional.** The beat is exactly where notes start, so vetoing all HF evidence at a scheduled click discards real articulations. `bandRmsMin` resolves it: a click can only *add* energy, so a dip measured in the 250–5000 Hz instrument band is evidence no click can manufacture. The band-floor override is only ever consulted at cymbal clicks — kicks cannot reach the HF tier's 3× requirement in the first place.

`SHAPE_SETTLE_TIME` (and `RE_ARTICULATION_READING_GAP`) are **physical, not beat-relative**. They admit the swung-eighth pair the tier was built for (0.34 s at 105 BPM) but not straight sixteenths at fast tempos — intended conservatism for last-resort tiers, since a re-articulation that fast disturbs the envelope enough for the tiers above to catch it.

### `getMetronomeBleedOnsets(...)`

Computes click times rather than reading them from a log: the metronome plays every beat, so click times are integer multiples of `60/tempo`. Onsets landing inside the 50–200 ms speaker→mic window (`BLEED_LATENCY_MIN` / `BLEED_LATENCY_MAX`) after a computed click aren't counted as attack evidence.

---

## metronome.ts

Synthesized jazz metronome using Tone.js synths.

### `warmUpMetronome(): Promise<void>`

Pre-create the metronome synths so the audio graph is stable before the first beat fires. Call during instrument loading, well before the first `playPhrase()`.

### `scheduleMetronome(beatsPerBar, bars): Promise<void>`

Schedule a jazz metronome pattern.

| Parameter | Type | Description |
|---|---|---|
| `beatsPerBar` | `number` | Typically 4 |
| `bars` | `number \| null` | Number of bars, or `null` for infinite loop |

**Pattern:**
- **Kick drum** (beat 1): `MembraneSynth` at C1 for a short membrane thump marking the downbeat
- **Ride cymbal** (all beats): White noise through 8kHz highpass filter
- **Hi-hat chick** (beats 2 and 4): Pink noise through 6kHz highpass filter

Must be called before `Transport.start()`.

### `setMetronomeVolume(volume): Promise<void>`

Set metronome volume (`0–1`).

### `disposeMetronome(): void`

Stop and dispose the metronome sequence.

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

## quantizer.ts

Rhythmic quantization: converts `DetectedNote[]` into `Note[]` with fraction-based offsets and durations on a 1/48 whole-note grid.

### `quantizeNotes(detected, tempo, timeSignature): Note[]`

| Parameter | Type | Description |
|---|---|---|
| `detected` | `DetectedNote[]` | Notes from `segmentNotes()` |
| `tempo` | `number` | BPM |
| `timeSignature` | `[number, number]` | e.g. `[4, 4]` |

**Algorithm:**
1. Try multiple sub-grids (straight-16 = 12/whole, triplet-12 = 16/whole, combined = 48/whole) and pick the one with lowest total snap error — disambiguates straight vs. triplet feels.
2. Snap each onset to the winning grid, then rescale into 1/48 space.
3. Durations are measured as the distance to the next onset (last note uses its detected duration snapped to grid).
4. Insert a rest when the gap between the previous note's end and the current onset exceeds 1.5 grid ticks.
5. Cap at `MAX_BARS = 8` bars; notes beyond that are truncated or dropped.

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

type DrumBufferName = 'kick' | 'ride' | 'hihat';
```

### Constants

- **`TENOR_SAX_SAMPLES: SampleMap`** — 33 chromatic samples (MIDI 44–76) × 2 velocity layers, sourced from the MTG Solo Sax library (CC-BY 4.0, Universitat Pompeu Fabra). Tuning corrections compensate for A=442 Hz recording pitch.
- **`ALTO_SAX_SAMPLES: SampleMap`** — Alto sax multi-samples with per-note tuning corrections.
- **`SOPRANO_SAX_SAMPLES: SampleMap`** — Soprano sax multi-samples with per-note tuning corrections.
- **`SAMPLE_MAPS: Record<string, SampleMap>`** — Registry keyed by instrument id. Currently `'tenor-sax'`, `'alto-sax'`, and `'soprano-sax'` (mapping to `TENOR_SAX_SAMPLES`, `ALTO_SAX_SAMPLES`, and `SOPRANO_SAX_SAMPLES` respectively).
- **`DRUM_BUFFERS: Record<DrumBufferName, string>`** — Static drum sample URLs (Virtuosity Drums, CC0). Keys: `kick`, `ride`, `hihat`.

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

The ensemble intensity arc: one deterministic, **RNG-free** number per bar in [0.2, 0.9] that every generator reads to shape density, dynamics and color. Because intensity only multiplies weights and probabilities at existing draw sites (never adding or removing draws), it can never reshuffle a seed stream.

### `barIntensity(input): number`

Mapped phrases (a `chorusIndex` present) build by chorus: `0.35 + 0.20·min(chorus, 2) + 0.08·cadence`, clamped to [0.2, 0.9] — the band starts settled, digs in each chorus, leans into cadence bars. Sectionless phrases ramp gently across their length (`0.45 + 0.25·bar/total`, capped 0.7) — a loop breathes, it doesn't peak. Stamped on every `BarInfo` by `buildBarInfos` and carried into `GenerationContext.intensity`.

### `lerp(from, to, t): number`

The hook shape used at every intensity site: `weight × lerp(low, high, intensity)`.

**What the arc moves** — comp: busy figures ×lerp(0.7, 1.7), deliberate rest ×lerp(2.2, 0.6), guide-tone bars mostly retire, realization velocity ±(−4…+6), voicing weights (shells early, quartal color later) and the voice-led register center lerp(58, 66); drums: ride modes (breathing bars early, skip-plus later), feathered-kick bar probability lerp(0.55, 0.9), snare silence lerp(6, 2.5), fill/crash probabilities ×lerp(0.9, 1.08); bass: ornament probabilities (ghosts, pickups, octave skips, cadence triplet) ×lerp(0.6, 1.4). Internal only — no settings knob.

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
}

interface CompHitSpec { beatOffset: number; velocity: number; durationBeats: number }
interface DrumHitSpec { drum: DrumVoice; beatOffset: number; velocity: number }
// DrumVoice: 'kick' | 'ride' | 'hihat' | 'hihat-pedal' | 'snare' |
//            'crossstick' | 'ride-bell' | 'crash'

interface StyleDefinition {
  name: string;
  defaultSwing: number;       // used when the session swing sits straight
  swingModel: 'tempo' | 'fixed';  // 'tempo' → swingForTempo curve
  timing: Record<TimingRole, TimingProfile>;  // ensemble microtiming
  compPlanning?: boolean;     // comp figures planned phrase-wide
  drumPattern: (ctx: GenerationContext) => DrumHitSpec[];  // one bar
  compPattern: (ctx: GenerationContext) => CompHitSpec[];  // one bar
  bassStyle: 'walking' | 'pedal' | 'pattern';
}
```

`beatOffset` values of `x.5` are eighth off-beats — the generation layer places them late per the swing ratio.

> **Velocity scales:** Drum velocities are `0–1` (converted to MIDI at trigger time). Comp and bass velocities are MIDI `0–127` (smplr's convention). The two scales are intentionally different — don't swap them.

### Constants

- **`BACKING_STYLES: Record<BackingStyle, StyleDefinition>`** — Keys `swing`, `bossa-nova`, `ballad`, `straight`.
  - **Swing** (tempo-curve swing, 0.67 fallback; density/dynamics shaped per bar by `ctx.intensity`): drums are composed vocabulary passes (backing-drum-vocab.ts) — per-bar ride modes (standard spang-a-lang / breathing quarters-only / skip-plus / broken), hi-hat foot on 2 & 4, feathered kick under the felt-not-heard ceiling, sparse snare ghosts in dialogue with the comp, kick coupling to comp pushes and bass pickups, fills and setups marking the 4/8-bar form, and a crash replacing the downbeat ride on section arrivals — with added voices capped at one per beat offset. Comping is phrase-planned (`compPlanning` → backing-comp-figures.ts): the pattern function realizes the planned figure's velocity and articulation.
  - **Bossa Nova** (straight): cross-stick feel on 2/4, hi-hat every beat, on-beat clave comping (1, 3, 4), `pattern` bass.
  - **Ballad** (swing 0.55): sparse ride, minimal kick, whole-note / half-note comping, walking bass.
  - **Straight** (straight): even 8ths drum feel, even quarter-note comping, walking bass.
- **`BACKING_STYLE_NAMES: Record<BackingStyle, string>`** — Display names for UI menus.

---

## backing-generation.ts

Pure, Node-testable backing event generation — no Tone.js, no Web Audio. `backing-track.ts` turns these events into scheduled parts. Beat offsets are laid out straight, swung at the beat→tick conversion (`applySwingToBeats` — off-beat eighths land late), then given a few milliseconds of seeded jitter on top.

### `generateBacking(harmony, style, params): GeneratedBacking`

Entry point: generates comp first (drums read its onsets for accents), then bass, then drums. `params` is `{ phraseId, tempo, ppq, beatsPerBar, swing, sectionMap? }`; the section map (from `Phrase.sectionMap`) drives section/chorus awareness, and bars are counted flat without it. Returns `{ bassEvents, compEvents, drumEvents }` — all carry tick-string `time` values plus a pre-swing `absBeat` for diagnostics and tests.

### `generateBassLine(harmony, beatsPerBar, params, barInfos): { events, onsetsByBar }`

Lives in `backing-bass.ts` (re-exported here): the phrase-aware contour planner — register arcs per 4-bar group, coherent approach devices targeting the pitch the next downbeat will actually sound, scale-aware interior walk with anti-stutter guards, two-feel first choruses latching open to four, ornament probabilities (ghosts, pickups, octave skips, cadence triplet) scaled ×lerp(0.6, 1.4, intensity). Upright band E1–G3, leaps ≤ an octave (the octave-drop device's 13-semitone resolve excepted). `onsetsByBar` feeds the drum vocabulary's bass/kick coupling.

### `generateComping(harmony, beatsPerBar, style, params, barInfos)`

A voicing type per chord (rootless A/B, shell, drop-2, or quartal where the quality suits it — seeded, quality-aware; the arc thins shells out and brings quartal color in as intensity builds, and the voice-led register center drifts lerp(58, 66, intensity)), voice-led across the sequence, placed by the style's per-bar figures; for `compPlanning` styles in 4/4 the figures come from the phrase-wide planner and guide-tone bars thin the voicing to the 3rd+7th. Off-beat (eighth) hits voice the chord sounding on the **next** beat, so pushes across a chord change anticipate the coming harmony.

### `generateDrums(beatsPerBar, style, params, barInfos, compOnsetsByBar, bassOnsetsByBar?): DrumEvent[]`

Per-bar pattern calls with a context carrying that bar's comp and bass onsets (for dialogue/coupling) and a dedicated `('drum-fill', bar)` stream (`ctx.fillRng`) so form punctuation never reshuffles the timekeeping draws. Duplicate same-voice hits at one offset resolve loudest-wins.

### `buildBarInfos(totalBars, sectionMap?): BarInfo[]`

Per-bar `{ sectionIndex?, chorusIndex?, isSectionFirstBar, isSectionFinalBar, isFinalBar, intensity }`. A new chorus starts wherever the emitted `sourceSection` sequence restarts (body, ending 1, body, ending 2). Bars past the last entry (harmony tail extension) belong to the last section. `intensity` is stamped by `barIntensity` (backing-intensity.ts).

### `chordToneIntervalsForBass(quality)`

`{ third, fifth, seventh | null }` semitone intervals read from `CHORD_DEFINITIONS` — min7b5 → b3/b5/b7, dim7 → b3/b5/bb7, aug7 → 3/#5/b7, sus4 → 4/5/b7. The natural 5th wins when the definition also carries a colour tone (7#11, 7b13); 6th chords walk their 6th in the 7th slot.

### `resolveBackingSwing(userSwing, style, tempo): number`

The backing's swing value: the session swing when the user swings the melody (`> 0.5` — the band must share the soloist's grid), else the style's `swingModel` — `'tempo'` follows `swingForTempo(bpm)` in `music/swing.ts` (Friberg–Sundström: constant ~100 ms short eighth, ≈3.5:1 cap below ~132 BPM, straight by 300), `'fixed'` uses `defaultSwing`. Shared by the live scheduler and the listening-lab bounce; scoring never sees this value (it uses only the melody's `options.swing`, and `swingForTempo` is banned from playback/scoring/tricks modules by a unit test).

---

## backing-timing.ts

Per-role ensemble microtiming: placement = straight beat → `applySwingToBeats` → role offset → triangular jitter → clamp ≥ 0, in ticks. `SWING_TIMING` profiles (ms): ride/bell 0±4 (the reference clock), hats 0±3, kick +2±6, snare/cross-stick +4±7, crash 0±5, bass −3±5 ("on top"), comp +12±8 (lays back). Offsets are constant milliseconds — compressed to 4% of the beat at fast tempi — and jitter is constant-ms too (the old `humanizeTicks` scaled with `120/tempo`, making slow tempi sloppier and fast tempi robotic). `BALLAD_TIMING` (looser, comp +18), `BOSSA_TIMING` (on-grid, tight), `STRAIGHT_TIMING` (halved) attach per style via `StyleDefinition.timing`.

Jitter draws come from dedicated per-`(role, bar)` streams (`seedFrom(phraseId, tempo, '<role>-time', barIndex)` via `createTimingStreams`), so musical probability checks in a generator can never reshuffle another voice's — or later notes' — timing.

---

## backing-mix.ts

Per-instrument mix levels for the backing track, persisted per device (localStorage key `backing-mix-levels`) so a mix tuned on `/diagnostics/backing-mixer` applies to every session. `bass`/`comp`/`drums` are linear gain multipliers layered on the overall backing volume; `kick`/`ride`/`hihat` are velocity multipliers applied at drum trigger time (the kit is one sampler, so voice balance can only be shaped through velocity). All values clamp to `[0, 3]`; `1` means "as generated".

### `BackingMixLevels` interface, `DEFAULT_BACKING_MIX`

### `BACKING_BASE_TRIMS`

Baseline trims that equalize the raw sample-library loudness: the Smolken bass (`0.05`) and pianos (`0.1`) run far hotter than the drum kit (`1.8` gain plus per-voice velocity trims — kick 2.0, ride 0.71, hi-hat 0.81, etc. — re-expressing the ear-tuned 2026-08-02 balance against the −3 dBFS-normalized samples). User mix levels multiply these bases, so `1.0` on every slider reproduces the tuned balance. Levels saved under the pre-trim storage key are discarded on load — they'd double-apply the correction.

### `normalizeBackingMix(value): BackingMixLevels`

Merge an untrusted value over the defaults: known keys only, finite numbers only, clamped. Never throws.

### `loadBackingMix()` / `saveBackingMix(mix)`

localStorage round-trip; SSR-safe (defaults without storage).

### `voiceVelocity(base, trim): number`

Apply a voice trim to a generated drum velocity, clamped to `[0, 1]`.

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

`activeMidiAt` defaults `tolerance` to `0.15` seconds; in loop mode it wraps the query onto the first generated pass (and probes one period later for notes ringing across the seam). `bleedEventsIn` returns recording-relative onsets with the same 250 ms pre-recording lookback as `getMetronomeBleedOnsets`, repeated across loop passes — previously coverage silently ended after the first pass of a looped recording.

### `buildSchedule(bassEvents, compEvents, drumEvents, tickOffset, ppq, tempo, loopTicks?): BackingTrackSchedule`

Collapse the generated event arrays (tick-string `time` values) into the schedule. Comp chords are expanded so each voice becomes an individual schedule note; drum events feed the transient-onset lists only (unpitched — never the pitch list). `tickOffset` adds the count-in bar; `loopTicks` (default null) enables loop-aware queries.

---

## bleed-evidence.ts

### `resolveBleedEvidence(ctx): number[] | undefined`

The one rule for what bleed evidence the segmenter receives, shared by all recording surfaces (ear training, lick practice, tune practice, diagnostics replay). `ctx` is `{ schedule, backingTrackEnabled, metronomeEnabled, recordingTransportSeconds, tempo, recordingDuration }`. Backing enabled + schedule present → the schedule's `bleedEventsIn(...)` (the synth metronome is count-in only under backing, so the quarter-note click grid would be false evidence — and it never covered off-beat backing content); else metronome enabled → `getMetronomeBleedOnsets(...)`; else `undefined`. This also closes the old hole where metronome-off + backing-on produced no suppression at all.

---

## backing-track.ts

Backing-track scheduler: loads the instruments, calls `backing-generation.ts` for the events, and schedules them against the Tone.js Transport. Bass, comp **and drums** are all tick-placed `Tone.Part`s (drums moved off `Tone.Sequence` so their swung eighths share the swing grid). The effective swing is the session value when the user swings it, else the style's `defaultSwing` — so the swing style's ride pattern swings even while the melody setting sits straight.

**Instruments:**
- **Upright bass** — Smolken "Pizzicato" double-bass sample library
- **Comp** — `SplendidGrandPiano` (Salamander) for piano, or `Soundfont('drawbar_organ', kit: 'MusyngKite')` for organ
- **Drums** — `smplr.Sampler` driving the `DRUM_BUFFERS` (Virtuosity Drums, CC0)

**Gain graph:** bass and comp each have their own trim node (`bassGain`, `compGain`) feeding the shared `backingGain` (overall backing volume) into `getMasterGain()`; drums have their own node into master scaled by volume × drum trim. Per-instrument trims come from `backing-mix.ts` and are adjustable live via `setBackingMix`.

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

Return the most recent backing-track schedules (newest first). Defaults to 20 entries; internal cap is 30. Backed by `sessionStorage` so `/diagnostics` can render schedules from prior phrase playbacks.

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

---

## backing-comp-figures.ts

Swing comping vocabulary: `COMP_FIGURES` (13 one- and two-bar figures — Charleston family, off-beat pairs, pushes, pads, 2-bar Red Garland / call-answer shapes, deliberate rest — all hits on the x.0/x.5 eighth grid the anticipation convention requires) and `planCompFigures(barInfos, beatsPerBar, phraseId, tempo): PlannedBar[]`, a sequential planner whose anti-repetition memory reshapes WEIGHTS only — each bar keeps its own `('comp-figure', bar)` seed stream, so plans are reproducible per bar and the stream-isolation guarantee holds. Plan rules: no figure three choices running; bar 0 must open with an `early` figure; cadence (section-final, non-final) bars strongly favor `push` figures with the rest damped, and a non-push 2-bar figure may not land its tail on a cadence bar; busy figures lean in (×lerp(0.7, 1.7, intensity)) and deliberate rest thins out (×lerp(2.2, 0.6)) as the arc builds; the phrase's final bar may not rest; occasional guide-tone bars (p 0.06 × lerp(1.6, 0.4) — a low-intensity color that mostly retires as the band digs in). `hitsForPlannedBar` resolves a bar's concrete hits (handling 2-bar `'cont'` tails and final-bar suppression with a resolution-pad fallback). Consumed by `generateComping` for styles with `StyleDefinition.compPlanning`, which hand the resolved hits to the pattern function via `ctx.plannedComp` for velocity/articulation realization (pads sustain, stabs clamp ≤ 0.7 beats, pushes hold ≥ 1.1 beats to tie across the barline).

---

## backing-drum-vocab.ts

Swing drum vocabulary: composable per-bar passes the swing `drumPattern` assembles, splitting the kit into a timekeeping **ostinato** (ride + hats + feathered kick) and sparse **additions** (snare dialogue, coupling kicks, fills) capped at one added voice per beat offset. All randomness flows through the caller's per-bar `drums` stream except form punctuation, which draws from the dedicated `drum-fill` stream (`ctx.fillRng`).

- **`chooseRideMode(rng, intensity)` / `rideBar(mode, barIndex, beatsPerBar, rng)`** — per-bar ride flavor (`standard` w5 / `quarters-only` w2·lerp(1.6, 0.5, I) / `skip-plus` w1.5·lerp(0.5, 1.8, I) / `broken` w1 — breathing bars early, busier sentences later): quarters on every beat (velocity 0.36–0.48, backbeats favored, a +0.05 shade on every 4th bar's downbeat), skip eighths per mode — standard after 2 and 4, skip-plus adds one after 1 or 3, broken drops one backbeat skip and speaks after 1 instead.
- **`hihatBar(beatsPerBar, rng)`** — foot on 2 & 4, the one non-negotiable.
- **`featherBar(beatsPerBar, rng, intensity)`** — feathered kick quarters at velocity 0.07–0.13 (felt, never heard); bar probability lerp(0.55, 0.9, I) — more bars sit out early in the form.
- **`snareBar(ctx, rng)`** — conversational comping: nothing (weight lerp(6, 2.5, I) — the snare talks more as the band digs in) / single ghost / ghost pair / and-of-4 accent (the accent only before a 4-bar group boundary — a setup, not a habit), plus a p 0.25 echo ghost one beat after an off-beat comp onset.
- **`couplingBar(ctx, rng)`** — kick catches off-beat comp pushes (p 0.35) and doubles swung-eighth (x.5) bass pickups from `ctx.bassOnsets` (p 0.25); the bass's triplet ornaments are deliberately not doubled.
- **`fillBar(ctx, fillRng)`** — form punctuation: light snare markers at 4-bar boundaries (p 0.18), one of four setup figures on every section-final bar (incl. a snare triplet whose 1/3-beat offsets the swing conversion never touches), and a crash on section-first downbeats (p 0.6 from chorus 1, else 0.25; marker and crash probabilities ×lerp(0.9, 1.08, I)) that **replaces** the downbeat ride via the returned `crashOnOne` flag.
- **`capAdditionsPerOffset(ostinato, additions)`** — the anti-clutter ledger: first addition wins each beat offset (the caller passes fills first, then coupling kicks, then snare chatter, so form-marking hits take contested slots); ostinato hits don't count against it.

---

## backing-lab-presets.ts / backing-bounce.ts / backing-report.ts / backing-listening-checklist.ts

The backing **listening lab** (see `documentation/contributing/backing-listening.md` for the protocol). All four modules are pure/Node-testable except the render call itself.

- **backing-lab-presets.ts** — `BACKING_LAB_PRESETS` (ii-V-I-VI loop, 12-bar F blues, rhythm-changes A, 3-chorus AABA with a `sectionMap`), `LAB_TEMPO_PRESETS` (90/160/240), `labPhraseWithSeed(preset, seed)` (suffixes the phrase id — all generation streams derive from it, so a suffix re-rolls every stream), and `buildChorusedForm(sections, choruses)` which emits the flattened harmony plus a sectionMap whose `sourceSection` restart marks each chorus boundary.
- **backing-bounce.ts** — `generateForBounce(params)` (the exact generation call the live scheduler makes, at `BOUNCE_PPQ = 192`), `bounceBacking(params, drumBuffers)` (renders to a WAV blob via smplr `renderOffline`, mirroring the live gain graph and per-voice velocity trims), `eventTicksToSeconds`, `harmonyDurationBeats`. Drum buffers come from `getDecodedDrumBuffersForBounce()` in backing-track.ts — the same decode path as the live kit.
- **backing-report.ts** — `buildBackingReport()`: deterministic ASCII statistics over lab presets × tempi × seeds (bass intervals/stepwise/downbeat-root, comp density/placement, drum voice activity). Snapshot at `documentation/reference/backing-report.txt`, regenerated by `npm run backing:report` and pinned by `tests/unit/audio/backing-report.test.ts`; golden event fixtures live under `tests/fixtures/backing/` via `npm run backing:golden`.
- **backing-listening-checklist.ts** — `LISTENING_CHECKLIST` (the single source of truth for human listening items), `buildListeningReport(meta, verdicts)` → markdown for PRs and the listening log.

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
