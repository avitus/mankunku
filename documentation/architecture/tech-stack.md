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

## PWA

| Tool | Version | Role |
|---|---|---|
| [@vite-pwa/sveltekit](https://vite-pwa-org.netlify.app/frameworks/sveltekit.html) | ^1.1 | PWA integration with auto-update service worker |

The PWA is configured in `vite.config.ts` with:
- `registerType: 'autoUpdate'` — service worker updates automatically
- Workbox pre-caches JS, CSS, HTML, SVG, and WOFF2 files
- SoundFont (`.sf2`) files use `CacheFirst` runtime caching (30-day expiry)
- Standalone display mode with dark theme color (`#0f172a`)

## Styling Approach

Mankunku uses **Tailwind CSS v4** with CSS custom properties for theming:

```css
/* src/app.css */
:root {
  --color-bg: #0f172a;
  --color-bg-secondary: #1e293b;
  --color-accent: #3b82f6;
  /* ... */
}
:root.light {
  --color-bg: #f8fafc;
  /* ... */
}
```

Components reference these variables inline: `bg-[var(--color-bg-secondary)]`. Theme switching toggles the `.light` class on `<html>`.

## Configuration Files

- **`svelte.config.js`** — Enables runes mode for all non-node_modules files via `dynamicCompileOptions`. Uses `adapter-auto` for deployment flexibility.
- **`tsconfig.json`** — Extends SvelteKit's generated config. Strict mode enabled with bundler module resolution.
- **`vite.config.ts`** — Registers Tailwind, SvelteKit, and PWA plugins. Test config points to `tests/unit/**/*.test.ts` with `node` environment.

## Why These Choices

- **Svelte 5 runes** over stores: Fine-grained reactivity without boilerplate. `$state` and `$derived` replace writable/derived stores with simpler semantics.
- **Tone.js** for transport: Provides sample-accurate scheduling via a centralized Transport, essential for synchronizing metronome clicks with phrase playback.
- **smplr** over Tone.js sampler: Smaller bundle for GM SoundFont playback. Shares the same AudioContext.
- **Pitchy** over Web Audio `AnalyserNode` alone: Implements the McLeod Pitch Method which is more accurate for monophonic instruments than simple FFT peak detection.
- **ABC notation** over MusicXML: Text-based format is trivial to generate from MIDI data. abcjs renders it to SVG with no server required.
- **No backend**: Keeps the app simple, free to host on any static hosting (Vercel, Netlify, GitHub Pages), and functional offline.
