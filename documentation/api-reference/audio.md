# API Reference: Audio

Audio modules handle playback, capture, pitch detection, onset detection, note segmentation, and the metronome.

**Source:** `src/lib/audio/`

---

## audio-context.ts

Shared `AudioContext` singleton for Tone.js and smplr.

### `initAudio(): Promise<AudioContext>`

Initialize the audio engine. Must be called from a user gesture (click/tap). Idempotent — safe to call multiple times.

Returns the raw `AudioContext` (not Tone.js's `standardized-audio-context` wrapper).

### `getAudioContext(): Promise<AudioContext>`

Returns the raw `AudioContext`. Throws if `initAudio()` hasn't been called.

### `isAudioInitialized(): boolean`

Returns `true` if audio has been initialized.

---

## playback.ts

Phrase playback using Tone.js Transport and smplr SoundFont samples.

### `loadInstrument(instrumentId?: string): Promise<void>`

Load a SoundFont instrument. Defaults to `'tenor-sax'`. Uses the **MusyngKite** soundfont for richer wind samples, with `loadLoopData: true` for natural sustain. Cached after first load via smplr's `CacheStorage`. Previous instruments are disconnected on switch.

On load, sets up jazz expression effects:
- **Warmth filter**: Low-pass BiquadFilterNode (4500 Hz sax / 6000 Hz trumpet)
- **Vibrato LFO**: 4.8 Hz oscillator modulating filter detune (12 cents sax / 6 cents trumpet)

**Supported instruments:**

| `instrumentId` | GM Name |
|---|---|
| `'tenor-sax'` | `'tenor_sax'` |
| `'alto-sax'` | `'alto_sax'` |
| `'trumpet'` | `'trumpet'` |

### `isInstrumentLoaded(): boolean`

Returns `true` if an instrument is loaded and ready to play.

### `playPhrase(phrase, options, keepMetronome?): Promise<void>`

Play a phrase through the loaded instrument.

| Parameter | Type | Description |
|---|---|---|
| `phrase` | `Phrase` | The phrase to play |
| `options` | `PlaybackOptions` | `{ tempo: number, metronomeEnabled: boolean }` |
| `keepMetronome` | `boolean` | If `true`, Transport + metronome keep running after phrase ends (for recording phase) |

Returns a promise that resolves when the phrase finishes. If `keepMetronome` is `true`, call `stopPlayback()` to stop everything.

**Note conversion:** Phrase note offsets (fractions of a whole note) are converted to quarter-note beats (`* 4`), then to Tone.js ticks (`* PPQ`), then scheduled as `"${ticks}i"` time strings.

**Expression per note:** Each note gets breath-scoop detune (first note: -15 cents, low notes: -8 cents), humanized velocity (+/-8), and humanized timing (~+/-15ms jitter).

**Swing:** Maps `options.swing` (0.5–0.75) to `transport.swing` (0–0.5) with `swingSubdivision: '8n'`.

### `stopPlayback(): Promise<void>`

Stop current playback immediately — transport, metronome, and all ringing notes.

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
}
```

### `PitchDetectorHandle` interface

```typescript
interface PitchDetectorHandle {
  start: () => void;
  stop: () => void;
  getReadings: () => PitchReading[];
  clear: () => void;
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
- Clarity threshold: `>= 0.80`
- Frequency range: `80–1200 Hz`
- MIDI conversion: `12 * log2(freq / 440) + 69`

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

## onset-worklet.ts

`AudioWorkletProcessor` running on the audio thread for low-latency onset detection.

**Algorithm (energy-based with HFC):**
1. Compute **High-Frequency Content**: `sum(|sample[i]| * (i + 1)) / N`
2. Maintain **EMA** with smoothing factor `0.85`
3. If `HFC / EMA > 3.0` and >= 60ms since last onset, fire event
4. Skip frames with energy below `0.001`
5. Allow EMA to settle for 5 frames

---

## note-segmenter.ts

Combines pitch readings and onset timestamps into `DetectedNote[]`.

### `segmentNotes(readings, onsets, recordingDuration, minNoteDuration?): DetectedNote[]`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `readings` | `PitchReading[]` | — | Pitch readings, sorted by time |
| `onsets` | `number[]` | — | Onset timestamps (seconds, sorted) |
| `recordingDuration` | `number` | — | Total recording duration (seconds) |
| `minNoteDuration` | `number` | `0.05` | Minimum note duration to keep |

**Algorithm:**
1. Use onset timestamps as segment boundaries
2. For each segment, compute:
   - **Median MIDI note** (robust to outliers)
   - **Median cents** of readings matching the median MIDI
   - **Average clarity** of matching readings
3. Filter segments shorter than `minNoteDuration`
4. If no onsets detected, treat all readings as one note

---

## metronome.ts

Synthesized jazz metronome using Tone.js synths.

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
