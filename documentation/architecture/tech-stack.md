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
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) | ^6.2 | IndexedDB polyfill for the node test environment (`vitest.setup.ts`) |

## Platform & services

| Library | Version | Role |
|---|---|---|
| [@supabase/supabase-js](https://supabase.com/docs/reference/javascript) + [@supabase/ssr](https://supabase.com/docs/guides/auth/server-side) | ^2.99 / ^0.12 | Auth + Postgres cloud sync; browser and per-request server clients (`src/lib/supabase/`) |
| [@sentry/sveltekit](https://docs.sentry.io/platforms/javascript/guides/sveltekit/) | ^10.49 | Error monitoring, client replay tunnelled through `/api/monitoring`; source maps uploaded at build when a token is present |
| [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) | ^0.115 | The docs assistant (`/api/chat`) and lead-sheet PDF transcription (`/api/tune-parse`) |
| [pdfjs-dist](https://mozilla.github.io/pdf.js/) | ^6.1 | Client-side PDF geometry + text-layer extraction for the PDF importer |
| [driver.js](https://driverjs.com) | ^1.4 | Guided tours (`src/lib/tour/`) |
| [marked](https://marked.js.org) + [sanitize-html](https://github.com/apostrophecms/sanitize-html) | ^18 / ^2.17 | In-app docs rendering (`src/lib/docs/`) |

**Node.** `.nvmrc` pins **26.5.1** (what the production server runs); `package.json` `engines` allows `>=22.12.0`. The `omr/` subsystem is a separate uv-managed **Python 3.12** project (its own `pyproject.toml` / `uv.lock` / `.venv`) that nothing in the app calls yet — see the OMR section of [CLAUDE.md](../../CLAUDE.md) and `docs/omr/README.md`.

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
  /* Practice-phase semantics: the player PLAYS in brass, LISTENS in red */
  --color-phase-play: var(--color-brass);
  --color-phase-listen: var(--color-onair);
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

The display serif **Fraunces** (variable font, weight 300–800, Latin subset, self-hosted, no external font CDN) is used for the wordmark, page titles, key/grade readouts, and the primary "Ear Training / Lick Practice" nav labels via the `.font-display` utility, which reads the `--font-display` token (component CSS such as the `Knob` readout reads the token directly). Two more self-hosted faces serve notation: **Edwin** (MuseScore's engraved text face, Roman + Bold) supplies the Δ ♭ ♯ glyphs Fraunces lacks, and the two together are `--chord-font` — the ONE chord-symbol face everywhere a chord is drawn (lead-sheet SVG tspans, the practice chart, `ChordSymbolText`); **MuseJazzText** is abcjs's `infofont` for section marks. All are SIL OFL 1.1, under `static/fonts/`.

**abcjs is loaded once.** At ~500 KB raw / ~125 KB brotli it is the second-largest chunk, so it stays a dynamic import behind ONE memoised loader (`src/lib/notation/abcjs-loader.ts`: `load()` shared by every consumer, a synchronous `loaded()`, a failed fetch retried rather than cached). `NotationDisplay` reads from it and the lick-practice session route calls `load()` at mount alongside the mic/sample/detector setup, so the first lead sheet never pays the download at the moment it must be read.

## Configuration Files

- **`svelte.config.js`** — Enables runes mode for all non-node_modules files via `dynamicCompileOptions`. Uses `adapter-node` so the server can run authentication hooks and session middleware. Pins `kit.version.name` to `CIRCLE_SHA1` when CI sets it (what `/api/health` reports as `version`), and turns on `experimental.instrumentation.server` + `tracing.server`, which is what makes SvelteKit load `src/instrumentation.server.ts`.
- **`tsconfig.json`** — Extends SvelteKit's generated config. Strict mode enabled with bundler module resolution.
- **`vite.config.ts`** — Registers Sentry, Tailwind, and SvelteKit plugins (source-map upload only when `SENTRY_AUTH_TOKEN` or `.env.sentry-build-plugin` is present and `PLAYWRIGHT` is not `1`). Also carries the **Vitest** config (there is no `vitest.config.ts`): `tests/unit/**` + `tests/integration/**`, `node` environment, `vitest.setup.ts` for the IndexedDB polyfill. `server.watch.ignored` excludes `.claude/worktrees/**`, **anchored at the config file's own path**: Claude Code worktrees are full checkouts nested under the root, and a `tsconfig.json` created or checked out in any of them fired `reloadOnTsconfigChange` in the parent's dev server (module graph invalidated, tab force-reloaded, Sentry re-initialised — 2026-09-10). The unanchored `**/.claude/worktrees/**` form would also blank the watcher of a dev server started *inside* a worktree, because chokidar (v3, bundled by Vite — the hoisted 4.x is a decoy) matches ignore globs against absolute paths, root included.
- **`src/instrumentation.server.ts`** — Server-side Sentry init. Production loads it once, via Node's `--import`; `npm run dev` loads it through `vite.ssrLoadModule` on every request, so any wipe of Vite's SSR module graph (a config/`.env` restart, an edit to the file or its import, any `tsconfig.json` add/change/unlink under the project root — worktrees under `.claude/worktrees/` included) evaluates it again in the same process. Sentry's `init` is not idempotent — each call stacks another `child_process` diagnostics-channel subscriber, another `uncaughtException`/`unhandledRejection`/`beforeExit` handler and, on macOS, a `sw_vers` spawn whose child carries every subscriber's `error` listener; that is where `MaxListenersExceededWarning: 11 error listeners added to [ChildProcess]` came from (2026-09-10) — so the call is guarded by `Sentry.isInitialized()`: one client per process, and an edit to the options in dev needs a dev-server restart. Pinned by `tests/unit/server/instrumentation-server.test.ts`.
- **`playwright.config.ts`** — E2E: `tests/e2e`, three browser projects, and a `webServer` that builds and previews with `PLAYWRIGHT=1` set (which enables the `e2e-test-user` auth branch in `hooks.server.ts`). The port is `PLAYWRIGHT_PORT`, default 4173. Outside CI `reuseExistingServer` is on, so a run attaches to whatever already answers on that port — from a worktree beside another checkout's preview, that is the other checkout's build, tested silently. Set `PLAYWRIGHT_PORT` to a free port there.
- **`src/hooks.server.ts`** — `handle` = Sentry's request handle → Supabase per-request client → security headers; `handleError` = `Sentry.handleErrorWithSentry(createServerErrorHandler())` (`src/lib/server/error-handler.ts`, unit-tested): silent on 4xx, one entry with the status, method + path (never the query string — the auth callback carries its exchange code there) and the stack for anything else. Sentry's wrapper skips capturing 4xx but still calls the handler for them, and its own fallback printed a full stack per route-less 404 — scanner probes filled PM2's error log to 320 MB by 2026-09-09 (`pm2-logrotate` on the droplet now caps the logs regardless — see "Deployment").

## Architecture Summary

Mankunku is a **local-first installable web app** with optional cloud sync:

- **State persistence** — User progress, settings, and session history are stored in `localStorage` first; large binary blobs (tune PDFs, via `src/lib/persistence/tune-pdf-store.ts`) live in IndexedDB. An optional Supabase backend (`src/lib/supabase/`, `src/routes/api/account/`) provides authenticated cloud sync so the same data follows a user across devices.
- **Audio pipeline** — Built entirely on Web Audio APIs. An `AudioWorklet` handles onset detection, an `AnalyserNode` feeds the pitch detector, and Tone.js manages transport scheduling for metronome and phrase playback.
- **Music theory** — Scales, intervals, transposition, key signatures, and scoring algorithms are implemented in pure TypeScript with no external music theory libraries. The 33-scale catalog and ~452-lick curated catalog are defined as typed data structures (plus additional runtime-generated combinations).
- **Deployment** — `adapter-node` produces a Node.js server bundle, promoted into place by a symlink-swap release script on a Digital Ocean VM and run under PM2 (see "Deployment" below). Page loads require the network — there is no service worker (see "Installable web app" above); user data stays local-first.

## Deployment

CI (CircleCI) is a dynamic setup pipeline: `.circleci/config.yml` path-filters into
`.circleci/continue-config.yml`. The job graph is `test` → `build` → `db-migrate`,
with `deploy` requiring `build`, `db-migrate` **and** `e2e`; `e2e` itself has no
requirements, so it runs in parallel with `test` rather than after it. Only
`build`, `db-migrate` and `deploy` are branch-filtered to `main` — `test` and
`e2e` run on every push to every branch (`test` also runs `npm run test:deploy`,
the release-script suite). Two path-filtered workflows sit beside it: `nginx-deploy`
fires only on `main` and only when a change lands under `nginx/`, `deploy/nginx/` or
`.circleci/` (deliberately *not* `deploy/app/`), and `omr` runs the hermetic Python suite
(`omr-test`: `uv sync --frozen`, ruff, pytest — no model downloads) when `omr/` or
`.circleci/` changed, on any branch, and never deploys anything. `db-migrate`
authenticates with `SUPABASE_ACCESS_TOKEN` and runs `supabase link` +
`supabase db push --linked` (no DB password) against the production project.

The `deploy` job rsyncs the built bundle (plus `package.json` and the lockfile) into
a **new, timestamped release directory** on the server, scp's `ecosystem.config.cjs`
into it from the job's own checkout — comparing sha256 on both ends and aborting on a
mismatch, after a server once ended up with stale content — then scp's
`deploy/app/release.sh` to `/tmp` and runs it over SSH. The target host is the CircleCI project environment variable
**`DEPLOY_HOST`** (with `DEPLOY_USER`), managed in the project settings and nowhere
in this repo — a server move is finished only once it is updated there. Production
moved to a new **4 GB droplet on 2026-09-08** (64.23.176.115 at the time of
writing); PR #247's merge deploy landed on the retired box until the job's public
verify step caught it. The server-side layout the script maintains:

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
  ~22k files and peaks near 500 MB — enough to be OOM-killed on the 961 MB droplet of the time (4 GB since 2026-09-08),
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
  symlink; it never follows it into `shared/deps`. Best-effort, not guaranteed:
  the handler cannot run if the script is `SIGKILL`ed or OOM-killed — the exact
  failure that motivated shared deps — so an orphaned staged release can survive
  until a later prune.
- **`pm2 start` returning 0 is not a deploy.** It only means a process spawned. A
  stale process still holding port 3000 answers 200 happily, so `release.sh` polls
  `/api/health` and compares the **release id** — within a wall-clock budget, not
  an accumulated-sleep one. The `deploy` job then re-checks the *public* URL for
  the commit SHA, which is the only step that proves nginx and TLS are also
  serving the new build.
- **Deploys are serialized** with `flock` on `.deploy.lock` (the kernel releases a
  flock when the holder dies — SIGKILL, dropped SSH, OOM — which a mkdir mutex
  would not), with a periodic "still waiting" line so CircleCI doesn't kill a
  silent step. The prune pass keeps the newest `KEEP_RELEASES` (5) release dirs
  and always spares the one `current` points at.

The droplet also carries **2 GB of swap** (added 2026-08-08; the 2026-09-08 clone
kept it) because the box has no headroom for burst allocations, and runs
**Node 26.5.1** installed from the official tarball into `/usr/local` — *not* apt.
Ubuntu's apt Node 18 and its 152-package dependency cascade were purged on
2026-08-06 (restore manifest at `/root/node18-purge-manifest.txt`), so Node
security updates on the box are **manual**. The 18-vs-26 skew had caused two
production incidents before the upgrade (ESM-only transitive dependencies needing
`require(ESM)`, and Supabase realtime resolving `WebSocket` eagerly), and the
Node < 22 WebSocket shim that worked around the second was deleted once the box
was upgraded.

Runtime secrets are not baked into the bundle: `ecosystem.config.cjs` reads
`shared/runtime.env` (git-ignored, `chmod 600`, one `KEY=VALUE` per line) into
PM2's `env_production`, spread *before* the operational config so a stray `PORT`
or `ORIGIN` in the file can't override deploy settings. It also raises adapter-node's
`BODY_SIZE_LIMIT` to `16M` — each route's own byte constant is the real gate
(`/api/tune-parse` 15 MB, `/api/monitoring` 1 MB). PM2 needs `delete` + `start`,
not `restart`, to pick either up, which is what `release.sh` does.

**nginx** (`nginx/mankunku.conf`, deployed by `deploy/nginx/deploy.sh`) 301s
`www.mankunkujazz.com` and plain HTTP to the apex; serves `/_app/immutable/`
straight from the accumulating `shared/_app/immutable/` chunk pool (so a tab
holding an older build's hashes keeps loading after a deploy), falling through
to the app otherwise; and gives `/api/tune-parse` its own `client_max_body_size
16m` and `proxy_read_timeout 420s` — the timeout measures the gap *between*
upstream reads, which is why the route answers on an NDJSON heartbeat
([Tune System](./tune-system.md#pdf-import-timing-and-partial-results)).
`/api/monitoring` (the Sentry replay tunnel) gets 2m; the default
`client_max_body_size` is 1m everywhere else. `pm2-logrotate`, installed under the
deploy user on the box, caps the PM2 logs at 20 MB × 14 files, compressed.

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
`startedAt` is module-load time — an "old" process reporting a *newer*
`startedAt` than the one you deployed is another machine, which is how the
2026-09-09 wrong-droplet deploy was diagnosed.

## Database

Supabase Postgres, one **shared** project for dev and prod historically — the root
of every dev/prod data contamination incident until 2026-06-21, when dev moved
to the local Supabase stack (`npm run db:start`). The CLI is linked to the
**production** project ref, so local commands need an explicit `--local`
(`npx supabase migration up --local`); the `--linked` variants target production.
`npm run db:reset` defaults to local but rebuilds from scratch, so prefer
`migration up --local` to apply pending migrations in place.

**Migrations** live in `supabase/migrations/`. Create new ones with
`npx supabase migration new <name>`, which produces the Supabase-standard
`<YYYYMMDDHHMMSS>_<name>.sql` UTC-timestamp filename — **do not hand-number
them**. Migrations `00001`–`00023` use a legacy sequential scheme; the dashboard
parses the version string as a timestamp, so those render "Unknown" forever, and
renaming them retroactively would mean rewriting the `version` primary keys in
production's `supabase_migrations.schema_migrations` in lockstep (files and rows
disagreeing makes the CLI treat *every* migration as pending and fails
`db-migrate`). Mixed schemes order correctly since `00023` sorts before any
`2026…` string.

**`src/lib/supabase/types.ts` is hand-maintained**, in the generator's format
but not generator output. Edit it by hand when a migration changes the schema,
then run `npm run db:types:check` (`scripts/check-db-types.mjs`, needs the local
stack) to diff it against the database. There is deliberately no
regenerate-in-place script: generating over it would drop the source-interface
mapping in its header, add the unused `graphql_public` schema, and widen
`public_lick_authors.id` to `string | null` — a NOT NULL primary key that
Postgres cannot prove non-null through a view — which would widen the Map key
type at three call sites in `persistence/community.ts`.

## Why These Choices

- **Svelte 5 runes** over stores: Fine-grained reactivity without boilerplate. `$state` and `$derived` replace writable/derived stores with simpler semantics.
- **Tone.js** for transport: Provides sample-accurate scheduling via a centralized Transport, essential for synchronizing metronome clicks with phrase playback.
- **smplr** over Tone.js sampler: Smaller bundle for GM SoundFont playback. Shares the same AudioContext.
- **Pitchy** over Web Audio `AnalyserNode` alone: Implements the McLeod Pitch Method which is more accurate for monophonic instruments than simple FFT peak detection.
- **ABC notation** over MusicXML: Text-based format is trivial to generate from MIDI data. abcjs renders it to SVG with no server required.
- **Local-first with optional Supabase**: All writes hit `localStorage` first so user data survives offline; an authenticated user's Supabase sync is background fire-and-forget, not a request path.
