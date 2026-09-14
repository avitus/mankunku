# Browser Compatibility

Mankunku relies on modern Web APIs. This page documents compatibility requirements and known limitations.

## Browser APIs

| API | Used For | Chrome | Firefox | Safari | Edge |
|---|---|---|---|---|---|
| Web Audio API | All audio processing | 35+ | 25+ | 14.1+ | 79+ |
| `getUserMedia` | Microphone capture | 53+ | 36+ | 14.1+ | 79+ |
| AudioWorklet | Live onset detection (if it can't load, onsets are derived from the pitch readings — see [Algorithm Details](./algorithm-details.md#without-the-worklet)) | 66+ | 76+ | 14.1+ | 79+ |
| `MediaRecorder` | Recording each take (mic + click mix) for replay, rescoring and diagnostics | 49+ | 25+ | 14.1+ | 79+ |
| `Permissions.query` | Mic permission check (optional — falls back to `'prompt'`) | 43+ | 46+ | 16+ | 79+ |
| `localStorage` + IndexedDB | Settings, progress and licks (localStorage); take recordings and stored tune PDFs (IndexedDB) | All | All | All | All |
| `CacheStorage` | Backing-instrument sample cache (optional — falls back to plain `fetch`) | 40+ | 41+ | 11.1+ | 79+ |
| Screen Wake Lock | Keeping the screen on during a session (optional) | 84+ | 126+ | 16.4+ | 84+ |
| `requestAnimationFrame` | Pitch detection loop | 10+ | 23+ | 6.1+ | 12+ |
| Modern CSS + JS baseline | Tailwind CSS 4; Vite 8's default build target | 111+ | 128+ | 16.4+ | 111+ |

## Minimum Browser Versions

| Browser | Minimum Version | Limiting Factor |
|---|---|---|
| Chrome | 111+ | Tailwind CSS 4, Vite build target |
| Firefox | 128+ | Tailwind CSS 4 |
| Safari (macOS and iOS) | 16.4+ | Tailwind CSS 4, Vite build target |
| Edge | 111+ | Chromium-based |

The floor is set by the toolchain, not the audio APIs. Tailwind CSS 4 states Chrome 111, Safari 16.4 and Firefox 128 as the versions its core depends on, and `vite.config.ts` sets no `build.target`, so Vite 8's default `baseline-widely-available` target (Chrome/Edge 111, Firefox 114, Safari/iOS 16.4) decides which syntax gets down-levelled. Every audio API above is supported well below that.

**Not supported:** Internet Explorer, Opera Mini, browsers older than the floor.

## Mobile Considerations

### iOS Safari

- **AudioContext resume** — iOS Safari suspends the AudioContext until a user gesture. Mankunku handles this via `Tone.start()`, called by `initAudio()` (`audio-context.ts`) from the first tap.
- **getUserMedia** — Requires HTTPS.
- **Screen lock** — Audio may stop when the screen locks. The practice routes (ear training, lick practice, tune practice, record-a-lick) hold a Screen Wake Lock while a session runs (`util/wake-lock.ts`) and re-request it when the tab becomes visible again; where the API is missing or refused (battery saver), keep the screen on yourself.
- **Low-latency mode** — iOS Safari has higher audio latency than desktop browsers. The latency correction in the scorer absorbs most of this.

### Android Chrome

- **AutoPlay policy** — Same as desktop Chrome: user gesture required to start AudioContext.
- **getUserMedia** — Works reliably on Chrome for Android.
- **Performance** — Lower-end devices may struggle with 60fps pitch detection. The `requestAnimationFrame` loop naturally adapts to device capability.

## Installability

Mankunku is an installable web app via a hand-written manifest (`static/manifest.webmanifest`, linked from `app.html`). It is not a PWA in the offline sense:

- **Installable** — Can be added to home screen on mobile and desktop (no service worker required)
- **No service worker, so no offline page loads** — the service-worker setup was removed 2026-07-25 (see [Tech Stack](../architecture/tech-stack.md), "Installable web app"). Data written while offline survives (local-first storage); loading a page does not. `static/sw.js` is a kill-switch that clears the caches of workers registered by older builds, unregisters itself and reloads its tabs — it must stay deployed indefinitely
- **Icons** — App icons in `static/icons/`

Note: Microphone access requires HTTPS in all browsers. Development via `localhost` is exempt.

## Microphone Processing

`startMicCapture()` (`capture.ts`) requests the mic with **`echoCancellation`, `noiseSuppression` and `autoGainControl` all off**, so the pipeline sees the raw signal. Level-based rules depend on that: the capture trim's performance floor (−30 dB) is relative to the take's loudest reading, on the premise that played notes keep a stable level while click bleed scales with the monitor, and the re-articulation tiers read energy dips and step-ups inside a note. With echo cancellation off, speaker playback reaches the mic — metronome bleed is handled inside the scoring pipeline ([Audio Pipeline](../architecture/audio-pipeline.md)), and headphones avoid it altogether.

## Known Limitations

### Permissions API

The `navigator.permissions.query({ name: 'microphone' })` API:
- Not supported in all browsers (gracefully falls back to `'prompt'`)
- On macOS, may report `'denied'` even when the user hasn't been prompted (browser-level permission not yet granted). Mankunku treats `'denied'` as `'prompt'` conservatively.

### AudioWorklet Module Loading

The onset detector (`onset-detector.ts`) loads its worklet via:
```typescript
const nativeCtx = await getNativeAudioContext();
const workletUrl = new URL('./onset-worklet.js', import.meta.url);
await nativeCtx.audioWorklet.addModule(workletUrl);
```

Two details matter. Tone.js wraps the AudioContext in `standardized-audio-context`, and the native `AudioWorkletNode` constructor rejects that wrapper, so the module is registered on the unwrapped native context (`getNativeAudioContext()` in `audio-context.ts`) — once per context lifetime. And the worklet is authored as a plain JavaScript file (`onset-worklet.js`) deliberately, so Vite emits it as-is with no TypeScript transpilation on the raw-asset URL; its algorithm is kept in sync with `onset-core.ts` (used by the replay path). A failed registration is caught by the calling route, which logs a warning and continues without worklet onsets.

### SoundFont Loading

The default sax instruments (tenor/alto/soprano) load from bundled local `/samples/<instrument>/*.ogg` audio files served as static assets — there is no separate download step. (There is no service worker, so the samples are not SW-cached; the browser HTTP cache still serves them on repeat visits.) Instruments without a bundled sample map fall back to smplr's MusyngKite kit, which smplr fetches as remote JavaScript soundfont files (`{name}-{ogg|mp3}.js`) from `gleitz.github.io` using a plain `fetch` (smplr's `HttpStorage`) — the melody path does not enable smplr's optional `CacheStorage` backing. A loading indicator shows while an instrument loads.

The **backing** instruments (upright bass, pianos) do use it: they load through a wrapped smplr `CacheStorage` under the versioned cache name `mankunku-samples-v1`, so revisits skip the network. Two caveats worth knowing when debugging: the Cache API requires a secure context, and browsers without it silently fall back to `HttpStorage`; and the wrapper exists because the Cache API will happily store a 404 or 500, which would then be served forever — a non-2xx response is retried over the network and the poisoned entry replaced or deleted. Drum samples take a different path entirely: they are fetched and `decodeAudioData`'d directly, each bounded by a 15 s timeout, and a drum that fails simply drops out of the kit.

### Pitch Detection Accuracy

- **Polyphonic signals** — The McLeod Pitch Method is designed for monophonic instruments. Background noise, multiple instruments, or harmonics from certain embouchures may cause detection errors.
- **Low notes** — Notes below ~80Hz require longer analysis windows and may have lower clarity scores.
- **Very high notes** — Above ~1200Hz, harmonics and overtones can cause octave errors.

### Audio Latency

Total system latency (mic → detection → display) is typically 50–150ms, depending on:
- Analyser window (4096 samples ≈ 93 ms at 44.1 kHz, 85 ms at 48 kHz)
- `requestAnimationFrame` interval (~16ms)
- Browser audio pipeline latency

The scoring system's latency correction absorbs constant delays, so latency primarily affects real-time visual feedback rather than scoring accuracy.

## Testing Across Engines

The Playwright suite runs every spec on Chromium, Firefox and WebKit (`playwright.config.ts`), and each engine needs a different route to a microphone:

- **Chromium** — `permissions: ['microphone']` plus `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream` and `--autoplay-policy=no-user-gesture-required`; `--disable-audio-output` renders Web Audio into a fake sink so the suite is silent while the AudioContext clock still runs in real time.
- **Firefox** — rejects the `'microphone'` permission name at the Playwright API level, so it uses prefs instead: `media.navigator.permission.disabled`, `media.navigator.streams.fake`, and autoplay unblocked.
- **WebKit** — ignores fake-media flags entirely; audio specs rely on the in-page `getUserMedia`/`MediaRecorder` mock in `tests/e2e/fixtures/audio.ts`. That mock is installed on `MediaDevices.prototype`, not on the `navigator.mediaDevices` instance, because WebKit can drop instance properties on that object and fall through to the real `getUserMedia` (`NotAllowedError`).

## HTTPS Requirement

Microphone access (`getUserMedia`) requires a secure context:
- `https://` in production
- `http://localhost` in development (exempt)
- `http://127.0.0.1` in development (exempt)

Deploy behind HTTPS for production use.
