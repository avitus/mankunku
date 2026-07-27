# Tech Stack

## Framework & Build

| Technology | Version | Role |
|---|---|---|
| [SvelteKit](https://kit.svelte.dev) | ^2.50 | App framework (routing, SSR, adapters) |
| [Svelte 5](https://svelte.dev) | ^5.51 | UI framework (runes mode for reactivity) |
| [Vite](https://vitejs.dev) | ^7.3 | Build tool and dev server |
| [TypeScript](https://typescriptlang.org) | ^5.9 | Type safety (strict mode) |
| [Tailwind CSS](https://tailwindcss.com) | ^4.2 | Utility-first styling via `@tailwindcss/vite` |

## Audio Libraries

| Library | Version | Role |
|---|---|---|
| [Tone.js](https://tonejs.github.io) | ^15.1 | Transport scheduling, audio graph, synths (metronome) |
| [smplr](https://github.com/danigb/smplr) | ^0.19 | SoundFont instrument playback (GM samples) |
| [Pitchy](https://github.com/ianprime0509/pitchy) | ^4.1 | McLeod Pitch Method — real-time pitch detection |

## Music Notation

| Library | Version | Role |
|---|---|---|
| [abcjs](https://www.abcjs.net) | ^6.6 | Renders ABC notation to SVG in the browser |

## Testing

| Tool | Version | Role |
|---|---|---|
| [Vitest](https://vitest.dev) | ^4.1 | Unit testing (node environment) |
| [Playwright](https://playwright.dev) | ^1.58 | End-to-end browser testing |
| [@testing-library/svelte](https://testing-library.com/svelte) | ^5.3 | Component testing utilities |

## Installable web app (no service worker)

The @vite-pwa/sveltekit service-worker setup was **removed 2026-07-25**: its
worker was never registered by SSR pages (the registration `<script>` is only
injected into prerendered HTML, and this app SSRs everything), and the
generated `sw.js` threw mid-evaluation (`createHandlerBoundToURL('/')` with
`'/'` never precached), silently disabling its own runtime caching. What
remains:

- `static/manifest.webmanifest` (linked from `app.html`) keeps the app
  installable — standalone display, dark theme color (`#0f172a`), SVG icons.
- `static/sw.js` is a **kill-switch worker**: devices that registered a worker
  under older builds pick it up on their next update check; it deletes all
  leftover caches, unregisters itself, and reloads its tabs. Keep it deployed.
- Offline behavior: user *data* is local-first (localStorage/IndexedDB), but
  page loads and code chunks need the network. Real offline support would need
  a prerendered shell + an `injectManifest` worker, registered explicitly.

## Styling Approach

Mankunku uses **Tailwind CSS v4** with CSS custom properties for theming:

```css
/* src/app.css */
:root {
  --color-bg: #0f172a;
  --color-bg-secondary: #1e293b;
  --color-bg-tertiary: #334155;
  /* Ear Training (default) — Blue Note peacock teal */
  --color-accent: #2e8b9e;
  --color-accent-hover: #1f6b7a;
  /* Blue Note brass — decorative chrome accent */
  --color-brass: #c8923d;
  --color-paper: #1a1410;
  /* Vintage recording-booth red for the active/stop state */
  --color-onair: #a8463a;
  /* ... */
}
[data-domain='lick-practice'] {
  /* Warm terracotta for lick-practice routes */
  --color-accent: #c96a3e;
  --color-accent-hover: #a64f27;
}
[data-domain='neutral'] {
  --color-accent: #94a3b8;
  --color-accent-hover: #cbd5e1;
}
:root.light { /* light-mode equivalents */ }
```

Components reference these variables inline: `bg-[var(--color-bg-secondary)]`. Theme switching toggles the `.light` class on `<html>`. Route domain (`ear-training` / `lick-practice` / `neutral`) is derived in `+layout.svelte` and applied as `data-domain` on the layout root — flipping `--color-accent` re-colors every interactive surface. See `documentation/architecture/design-system.md`.

The display serif **Fraunces** (variable font, weight 300–800, Latin subset, self-hosted, no external font CDN) is used for the wordmark, page titles, key/grade readouts, and the primary "Ear Training / Lick Practice" nav labels via the `.font-display` utility.

## Configuration Files

- **`svelte.config.js`** — Enables runes mode for all non-node_modules files via `dynamicCompileOptions`. Uses `adapter-node` so the server can run authentication hooks and session middleware.
- **`tsconfig.json`** — Extends SvelteKit's generated config. Strict mode enabled with bundler module resolution.
- **`vite.config.ts`** — Registers Sentry, Tailwind, and SvelteKit plugins. Test config points to `tests/unit/**/*.test.ts` with `node` environment.

## Architecture Summary

Mankunku is a **local-first installable web app** with optional cloud sync:

- **State persistence** — User progress, settings, and session history are stored in `localStorage` first; large binary blobs (tune PDFs, via `src/lib/persistence/tune-pdf-store.ts`) live in IndexedDB. An optional Supabase backend (`src/lib/supabase/`, `src/routes/api/account/`) provides authenticated cloud sync so the same data follows a user across devices.
- **Audio pipeline** — Built entirely on Web Audio APIs. An `AudioWorklet` handles onset detection, an `AnalyserNode` feeds the pitch detector, and Tone.js manages transport scheduling for metronome and phrase playback.
- **Music theory** — Scales, intervals, transposition, key signatures, and scoring algorithms are implemented in pure TypeScript with no external music theory libraries. The 33-scale catalog and ~452-lick curated catalog are defined as typed data structures (plus additional runtime-generated combinations).
- **Deployment** — `adapter-node` produces a Node.js server bundle (deployed via rsync + PM2 to a Digital Ocean VM). Page loads require the network — there is no service worker (see "Installable web app" above); user data stays local-first.

## Why These Choices

- **Svelte 5 runes** over stores: Fine-grained reactivity without boilerplate. `$state` and `$derived` replace writable/derived stores with simpler semantics.
- **Tone.js** for transport: Provides sample-accurate scheduling via a centralized Transport, essential for synchronizing metronome clicks with phrase playback.
- **smplr** over Tone.js sampler: Smaller bundle for GM SoundFont playback. Shares the same AudioContext.
- **Pitchy** over Web Audio `AnalyserNode` alone: Implements the McLeod Pitch Method which is more accurate for monophonic instruments than simple FFT peak detection.
- **ABC notation** over MusicXML: Text-based format is trivial to generate from MIDI data. abcjs renders it to SVG with no server required.
- **Local-first with optional Supabase**: All writes hit `localStorage` first so user data survives offline; an authenticated user's Supabase sync is background fire-and-forget, not a request path.
