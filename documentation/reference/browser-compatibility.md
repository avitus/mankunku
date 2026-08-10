# Browser Compatibility

Mankunku relies on modern Web APIs. This page documents compatibility requirements and known limitations.

## Required APIs

| API | Used For | Chrome | Firefox | Safari | Edge |
|---|---|---|---|---|---|
| Web Audio API | All audio processing | 35+ | 25+ | 14.1+ | 79+ |
| `getUserMedia` | Microphone capture | 53+ | 36+ | 14.1+ | 79+ |
| AudioWorklet | Onset detection | 66+ | 76+ | 14.1+ | 79+ |
| `Permissions.query` | Mic permission check | 43+ | 46+ | 16+ | 79+ |
| `localStorage` | Settings, progress | All | All | All | All |
| `CacheStorage` | Backing-instrument sample cache (optional — falls back to plain `fetch`) | 40+ | 41+ | 11.1+ | 79+ |
| `requestAnimationFrame` | Pitch detection loop | 10+ | 23+ | 6.1+ | 12+ |
| CSS Custom Properties | Theming | 49+ | 31+ | 9.1+ | 15+ |
| ES2022+ | Async/await, modules | 89+ | 89+ | 15+ | 89+ |

## Minimum Browser Versions

| Browser | Minimum Version | Limiting Factor |
|---|---|---|
| Chrome | 66+ | AudioWorklet |
| Firefox | 76+ | AudioWorklet |
| Safari | 14.1+ | AudioWorklet, getUserMedia |
| Edge | 79+ | Chromium-based |

**Not supported:** Internet Explorer, Opera Mini, older mobile browsers without AudioWorklet.

## Mobile Considerations

### iOS Safari

- **AudioContext resume** — iOS Safari suspends the AudioContext until a user gesture. Mankunku handles this via `Tone.start()` called from the first tap.
- **getUserMedia** — Requires HTTPS. Works on iOS 14.3+ for Safari.
- **Screen lock** — Audio may stop when the screen locks. Users should keep the screen active during practice.
- **Low-latency mode** — iOS Safari has higher audio latency than desktop browsers. The latency correction in the scorer absorbs most of this.

### Android Chrome

- **AutoPlay policy** — Same as desktop Chrome: user gesture required to start AudioContext.
- **getUserMedia** — Works reliably on Chrome for Android.
- **Performance** — Lower-end devices may struggle with 60fps pitch detection. The `requestAnimationFrame` loop naturally adapts to device capability.

## Installability

Mankunku is an installable web app via a hand-written manifest (`static/manifest.webmanifest`, linked from `app.html`):

- **Installable** — Can be added to home screen on mobile and desktop (no service worker required)
- **No offline page loads** — the service-worker setup was removed 2026-07-25 (see architecture/tech-stack.md, "Installable web app"); `static/sw.js` is a kill-switch that cleans up legacy registrations and must stay deployed
- **Icons** — App icons in `static/icons/`

Note: Microphone access requires HTTPS in all browsers. Development via `localhost` is exempt.

## Known Limitations

### Permissions API

The `navigator.permissions.query({ name: 'microphone' })` API:
- Not supported in all browsers (gracefully falls back to `'prompt'`)
- On macOS, may report `'denied'` even when the user hasn't been prompted (browser-level permission not yet granted). Mankunku treats `'denied'` as `'prompt'` conservatively.

### AudioWorklet Module Loading

The onset detector loads its worklet via:
```typescript
const workletUrl = new URL('./onset-worklet.js', import.meta.url);
await context.audioWorklet.addModule(workletUrl);
```

The worklet is authored as a plain JavaScript file (`onset-worklet.js`) deliberately so Vite emits it as-is with no TypeScript transpilation on the raw-asset URL. Its algorithm is kept in sync with `onset-core.ts` (used by the replay path). In production builds, Vite handles this correctly. In some development configurations with HMR, the worklet URL may need special handling.

### SoundFont Loading

The default sax instruments (tenor/alto/soprano) load from bundled local `/samples/<instrument>/*.ogg` audio files served as static assets — there is no separate download step. (There is no service worker, so the samples are not SW-cached; the browser HTTP cache still serves them on repeat visits.) Instruments without a bundled sample map fall back to smplr's MusyngKite kit, which smplr fetches as remote JavaScript soundfont files (`{name}-{ogg|mp3}.js`) from `gleitz.github.io` using a plain `fetch` (smplr's `HttpStorage`) — the melody path does not enable smplr's optional `CacheStorage` backing. A loading indicator shows while an instrument loads.

The **backing** instruments (upright bass, pianos) do use it: they load through a wrapped smplr `CacheStorage` under the versioned cache name `mankunku-samples-v1`, so revisits skip the network. Two caveats worth knowing when debugging: the Cache API requires a secure context, and browsers without it silently fall back to `HttpStorage`; and the wrapper exists because the Cache API will happily store a 404 or 500, which would then be served forever — a non-2xx response is retried over the network and the poisoned entry replaced or deleted. Drum samples take a different path entirely: they are fetched and `decodeAudioData`'d directly, each bounded by a 15 s timeout, and a drum that fails simply drops out of the kit.

### Pitch Detection Accuracy

- **Polyphonic signals** — The McLeod Pitch Method is designed for monophonic instruments. Background noise, multiple instruments, or harmonics from certain embouchures may cause detection errors.
- **Low notes** — Notes below ~80Hz require longer analysis windows and may have lower clarity scores.
- **Very high notes** — Above ~1200Hz, harmonics and overtones can cause octave errors.

### Audio Latency

Total system latency (mic → detection → display) is typically 50–150ms, depending on:
- AudioContext buffer size (4096 samples ≈ 85ms at 48kHz)
- `requestAnimationFrame` interval (~16ms)
- Browser audio pipeline latency

The scoring system's latency correction absorbs constant delays, so latency primarily affects real-time visual feedback rather than scoring accuracy.

## HTTPS Requirement

Microphone access (`getUserMedia`) requires a secure context:
- `https://` in production
- `http://localhost` in development (exempt)
- `http://127.0.0.1` in development (exempt)

Deploy behind HTTPS for production use.
