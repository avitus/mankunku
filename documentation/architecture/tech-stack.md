# Tech Stack

## Framework & Build

| Technology | Version | Role |
|---|---|---|
| [SvelteKit](https://kit.svelte.dev) | ^2.50 | App framework (routing, SSR, adapters) |
| [Svelte 5](https://svelte.dev) | ^5.51 | UI framework (runes mode for reactivity) |
| [Vite](https://vitejs.dev) | ^8.2 | Build tool and dev server |
| [TypeScript](https://typescriptlang.org) | ^6.0 | Type safety (strict mode) |
| [Tailwind CSS](https://tailwindcss.com) | ^4.2 | Utility-first styling via `@tailwindcss/vite` |

## Audio Libraries

| Library | Version | Role |
|---|---|---|
| [Tone.js](https://tonejs.github.io) | ^15.1 | Transport scheduling, audio graph, synths (metronome) |
| [smplr](https://github.com/danigb/smplr) | ^1.0 | SoundFont instrument playback (GM samples), drum + backing samplers |
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
- **`vite.config.ts`** — Registers Sentry, Tailwind, and SvelteKit plugins. Also carries the **Vitest** config (there is no `vitest.config.ts`): `tests/unit/**` + `tests/integration/**`, `node` environment, `vitest.setup.ts` for the IndexedDB polyfill.
- **`playwright.config.ts`** — E2E: `tests/e2e`, three browser projects, and a `webServer` that builds and previews on port 4173 with `PLAYWRIGHT=1` set (which enables the `e2e-test-user` auth branch in `hooks.server.ts`).

## Architecture Summary

Mankunku is a **local-first installable web app** with optional cloud sync:

- **State persistence** — User progress, settings, and session history are stored in `localStorage` first; large binary blobs (tune PDFs, via `src/lib/persistence/tune-pdf-store.ts`) live in IndexedDB. An optional Supabase backend (`src/lib/supabase/`, `src/routes/api/account/`) provides authenticated cloud sync so the same data follows a user across devices.
- **Audio pipeline** — Built entirely on Web Audio APIs. An `AudioWorklet` handles onset detection, an `AnalyserNode` feeds the pitch detector, and Tone.js manages transport scheduling for metronome and phrase playback.
- **Music theory** — Scales, intervals, transposition, key signatures, and scoring algorithms are implemented in pure TypeScript with no external music theory libraries. The 33-scale catalog and ~452-lick curated catalog are defined as typed data structures (plus additional runtime-generated combinations).
- **Deployment** — `adapter-node` produces a Node.js server bundle, promoted into place by an atomic-release script on a Digital Ocean VM and run under PM2 (see "Deployment" below). Page loads require the network — there is no service worker (see "Installable web app" above); user data stays local-first.

## Deployment

CI (CircleCI) is a dynamic setup pipeline: `.circleci/config.yml` path-filters into
`.circleci/continue-config.yml`. The job graph is `test` → `build` → `db-migrate`,
with `deploy` requiring `build`, `db-migrate` **and** `e2e`; `e2e` itself has no
requirements, so it runs in parallel with `test` rather than after it. Only
`build`, `db-migrate` and `deploy` are branch-filtered to `main` — `test` and
`e2e` run on every push to every branch. A separate `nginx-deploy` workflow fires
only when the path filter sees a change under `nginx/`, `deploy/nginx/` or
`.circleci/` (deliberately *not* `deploy/app/`). `db-migrate` authenticates with
`SUPABASE_ACCESS_TOKEN` and runs `supabase link` + `supabase db push --linked`
(no DB password).

The `deploy` job rsyncs the built bundle into a **new, timestamped release
directory** on the server, scp's `deploy/app/release.sh` alongside it, and runs
that script over SSH. The server-side layout it maintains:

```text
/home/deploy/mankunku/
├── current -> releases/<YYYYMMDD-HHMMSS-sha7>
├── releases/<id>/
│   ├── build/                      # rsynced bundle
│   └── node_modules -> ../../shared/deps/node_modules
└── shared/
    ├── deps/                       # ONE install, shared by every release
    │   ├── node_modules/
    │   ├── .installed-package-lock.json
    │   └── .installed-node-version
    ├── _app/immutable/             # accumulating chunk pool
    └── runtime.env                 # secrets, read by ecosystem.config.cjs
```

`release.sh` is covered by `npm run test:deploy` (`deploy/app/release.test.sh`,
wired into the CI `test` job). Four invariants it exists to protect, each learned
from an incident:

- **Dependencies are shared, not per-release.** `npm ci` installs 378 MB across
  ~22k files and peaks near 500 MB — enough to be OOM-killed on a 961 MB droplet,
  which happened twice on 2026-08-07/08 while the lockfile was byte-identical
  across all three live releases. Deps now install once into `shared/deps` and are
  symlinked into each release, keyed on **both** the lockfile and the Node version.
  Node is part of the key because native bindings compile against an ABI the
  lockfile says nothing about; without it a Node upgrade would silently reuse a
  tree built for the old runtime. Both marker files are written *only after* a
  successful install, so a killed one can never look satisfied. Tradeoff: rolling
  `current` back gives that older release the newer dependency tree.
- **A failed deploy removes its own staged release — unless `current` already
  points at it**, in which case that directory *is* production and deleting it
  would turn a failed deploy into an outage. Cleanup unlinks the `node_modules`
  symlink; it never follows it into `shared/deps`.
- **`pm2 start` returning 0 is not a deploy.** It only means a process spawned. A
  stale process still holding port 3000 answers 200 happily, so `release.sh` polls
  `/api/health` and compares the **release id** — within a wall-clock budget, not
  an accumulated-sleep one. The `deploy` job then re-checks the *public* URL for
  the commit SHA, which is the only step that proves nginx and TLS are also
  serving the new build.
- **Deploys are serialized** with `flock` on `.deploy.lock`, with a periodic
  "still waiting" line so CircleCI doesn't kill a silent step.

The droplet also carries **2 GB of swap** (added 2026-08-08) because the box has
no headroom for burst allocations, and runs **Node 26** installed from the
official tarball into `/usr/local` — Ubuntu's Node 18 remains at `/usr/bin/node`
as a rollback. That skew caused two production incidents before the upgrade
(ESM-only transitive dependencies needing `require(ESM)`, and Supabase realtime
resolving `WebSocket` eagerly), and the Node < 22 WebSocket shim that worked
around the second was deleted once the box was upgraded.

### `/api/health`

An unauthenticated, uncached liveness **and identity** endpoint — the thing both
halves of the deploy check. Logic is in `src/lib/server/health.ts`, the route in
`src/routes/api/health/+server.ts`.

```json
{
  "status": "ok",
  "version": "<commit SHA>",
  "releaseId": "20260808-101500-0d0b73d",
  "node": "v26.5.1",
  "uptimeSeconds": 137,
  "startedAt": "2026-08-08T10:15:02.145Z"
}
```

`version` is `kit.version.name`, pinned to `CIRCLE_SHA1` in `svelte.config.js`.
`releaseId` is derived once at module load from `realpath(process.cwd())` — PM2's
`cwd` is the `current` symlink, so the value cannot drift from what is actually
being served, and no env plumbing is needed. A path that doesn't match the
release-id pattern yields `null` rather than a wrong answer, and a dangling
symlink is swallowed to `null` rather than raising: the endpoint you reach for
when production is sick must not itself 500. The response carries
`cache-control: no-store` so no layer between can answer a cached lie.

## Why These Choices

- **Svelte 5 runes** over stores: Fine-grained reactivity without boilerplate. `$state` and `$derived` replace writable/derived stores with simpler semantics.
- **Tone.js** for transport: Provides sample-accurate scheduling via a centralized Transport, essential for synchronizing metronome clicks with phrase playback.
- **smplr** over Tone.js sampler: Smaller bundle for GM SoundFont playback. Shares the same AudioContext.
- **Pitchy** over Web Audio `AnalyserNode` alone: Implements the McLeod Pitch Method which is more accurate for monophonic instruments than simple FFT peak detection.
- **ABC notation** over MusicXML: Text-based format is trivial to generate from MIDI data. abcjs renders it to SVG with no server required.
- **Local-first with optional Supabase**: All writes hit `localStorage` first so user data survives offline; an authenticated user's Supabase sync is background fire-and-forget, not a request path.
