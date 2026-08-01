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
| `bleedOnsets` | `number[]?` | — | Timestamps of scheduled metronome (and demo-playback) events. Worklet onsets that land inside the 50–200 ms speaker→mic bleed window after one of these are not counted as attack evidence during `mergeSamePitchWithoutAttack`, so an artifact split a metronome click caused gets collapsed back into one note. These timestamps don't drop any onsets pre-segmentation — segmentation uses `onsets` as given. |
| `articulationOnsets` | `number[]?` | — | Articulation onset times used by the re-articulation detector. |

**Algorithm:**
1. Use the resolved `onsets` as segment boundaries (no pre-segmentation drop; bleed-window suppression happens in the cleanup phase below).
2. For each segment, compute median MIDI note, median cents on matching readings, and average clarity.
3. Filter segments shorter than `minNoteDuration`.
4. If no onsets detected, treat all readings as one note.
5. **`mergeSamePitchWithoutAttack`** — Collapse adjacent same-MIDI segments whose boundary has no `workletOnsets` entry within ±75 ms. A worklet onset that *does* sit inside the bleed window after a `bleedOnsets` event is treated as bleed, not attack, so the split collapses anyway. Catches clarity dropouts and detector wobble that split a single held note.
6. **`mergeOctaveBoundariesWithoutAttack`** — Collapse a stray upper-octave segment back into its neighbour when ≥ 3 of the segment's raw frames match the lower fundamental (McLeod octave-lock artifact).
7. **`mergeWholeNoteOctaveUpLocks`** — Drop a whole note an octave when a strong majority of its frames carry `octaveUp` (a 2nd-harmonic lock). Acted on at the note level, not the frame level, so a stray attack-transient frame on a genuine mid-register note is harmless.

The merge passes are conservative: they require explicit absence-of-attack evidence, so genuine same-pitch re-articulations are preserved.

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

### `voiceLead(chords, voicingFn, registerMidi?): number[][]`

Apply a voicing function across a sequence of chords and minimize total semitone movement between successive voicings. Searches ±12 semitones around `registerMidi` per chord and picks the candidate closest to the previous voicing. Note-count mismatches are penalized by 12 semitones each.

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

## backing-styles.ts

Style definitions consumed by the backing track scheduler.

### `DrumHit` and `StyleDefinition` interfaces

```typescript
interface DrumHit {
  kick?: boolean;
  ride?: boolean;
  hihat?: boolean;
  kickVelocity?: number;   // 0–1 (Tone synth gain)
  rideVelocity?: number;
  hihatVelocity?: number;
}

interface StyleDefinition {
  name: string;
  defaultSwing: number;
  drumPattern: (beat: number, beatsPerBar: number) => DrumHit;
  compPattern: (beat: number, beatsPerBar: number) =>
    { hit: boolean; velocity: number; duration: [number, number] };
  bassStyle: 'walking' | 'pedal' | 'pattern';
}
```

> **Velocity scales:** Drum velocities are `0–1` (Tone.js `triggerAttackRelease` gain). Comp and bass velocities are MIDI `0–127` (smplr's convention). The two scales are intentionally different — don't swap them.

### Constants

- **`BACKING_STYLES: Record<BackingStyle, StyleDefinition>`** — Keys `swing`, `bossa-nova`, `ballad`, `straight`.
  - **Swing** (default swing 0.67): ride on every beat, kick on 1, hi-hat on 2 & 4, walking bass, comping on off-beats 2/4 with occasional fills.
  - **Bossa Nova** (straight): cross-stick on 2/4, hi-hat every beat, syncopated comping, `pattern` bass.
  - **Ballad** (swing 0.55): sparse ride, minimal kick, whole-note / half-note comping, walking bass.
  - **Straight** (straight): even 8ths drum feel, even quarter-note comping, walking bass.
- **`BACKING_STYLE_NAMES: Record<BackingStyle, string>`** — Display names for UI menus.

---

## backing-track-schedule.ts

Queryable snapshot of a scheduled backing track. Used by the bleed filter to ask "what backing-track MIDI was active at transport time T?"

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
}
```

`activeMidiAt` defaults `tolerance` to `0.15` seconds. Notes are sorted by `startSeconds`, so the lookup short-circuits once past the query window.

### `buildSchedule(bassEvents, compEvents, tickOffset, ppq, tempo): BackingTrackSchedule`

Collapse the internal bass and comp event arrays (tick-string `time` values, already generated by the backing track engine) into a flat, sorted `BackingScheduleNote[]`. Comp chords are expanded so each voice becomes an individual schedule note. `tickOffset` adds the count-in bar.

---

## backing-track.ts

Full backing-track engine: walking bass + piano/organ comping + drum pattern, scheduled against the Tone.js Transport.

**Instruments:**
- **Upright bass** — Smolken "Pizzicato" double-bass sample library
- **Comp** — `SplendidGrandPiano` (Salamander) for piano, or `Soundfont('drawbar_organ', kit: 'MusyngKite')` for organ
- **Drums** — `smplr.Sampler` driving the `DRUM_BUFFERS` (Virtuosity Drums, CC0)

All three route through a shared internal gain node into `getMasterGain()`.

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

Stop and release the current `Tone.Part`s and drum sequence. Keeps the loaded instruments. Called between reschedules.

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
