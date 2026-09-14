# Contributing

Guidelines for contributing to Mankunku.

## Development Setup

> Looking for the player-facing introduction — what the app does, what gear you
> need, how a first session goes? That's [Getting Started](../getting-started.md).
> This section is the developer setup.

### Prerequisites

- **Node 22.12 or newer.** This is enforced, not advisory: `package.json` declares
  `engines.node: ">=22.12.0"` and `.npmrc` sets `engine-strict=true`, so `npm install`
  fails with `EBADENGINE` on anything older rather than warning. The floor is
  22.12 because Vite 8 requires `^20.19.0 || >=22.12.0`; 22.0–22.11 would install
  a Vite that cannot run. `.nvmrc` pins `26.5.1` to match CI
  (`cimg/node:26.5.1`) — run `nvm use` to switch to it. Any version at or above
  the floor is fine, and newer majors are what most local work happens on.
- **Docker**, only if you want the local Supabase stack. The app runs fine without it.
- **[uv](https://docs.astral.sh/uv/)**, only for the Python OMR subsystem under `omr/` (it pins Python 3.12 itself) — see [docs/omr/README.md](../../docs/omr/README.md).
- A **microphone**, to exercise anything in the audio pipeline by hand.

### First run

```sh
npm install
cp .env.example .env   # placeholder values are enough to build and practice
npm run dev            # http://localhost:5173
```

The `.env` is not optional: the Supabase clients import `PUBLIC_SUPABASE_URL`
and `PUBLIC_SUPABASE_ANON_KEY` from `$env/static/public`, which exports only
variables that exist — without them `npm run build` fails with
`MISSING_EXPORT`, and every dev-server page answers 500 ("Your project's URL
and Key are required to create a Supabase client!"). Their *values* can
stay the placeholders — Mankunku is **local-first**: every write goes to
localStorage/IndexedDB, and practice works fully signed out with no backend
behind those URLs. Sign-in, cloud sync and the community pages need the local
Supabase stack below.

Signed out, `/` is the landing page. The onboarding overlay (instrument,
microphone) mounts only on the mic-driven practice routes — ear training, lick
practice, tricks, record-a-lick, tune practice.

### Environment variables

`.env.example` lists all four; `.env` is gitignored.

| Variable | Read by | Without it |
|---|---|---|
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | Browser + server Supabase clients (`$env/static/public`, inlined at build) | Build fails — set placeholders at minimum |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/lib/supabase/admin.ts` — account deletion (`/api/account`) and the owner-only `/admin` page. Server-only; bypasses RLS | Account deletion answers 500; `/admin` reports its client unavailable |
| `ANTHROPIC_API_KEY` | `src/lib/server/anthropic.ts` — the docs assistant (`/api/chat`) and PDF tune import (`/api/tune-parse`). Server-only, read at runtime | Chat answers 503 "not configured"; PDF import offers manual entry or an OMR-only import |

Build-time only, optional: `SENTRY_AUTH_TOKEN` (or a local
`.env.sentry-build-plugin`) enables source-map upload; without it the build
skips the upload. In production the runtime secrets come from
`shared/runtime.env` on the server, loaded by `ecosystem.config.cjs` — never
from `.env`.

### Optional — the local Supabase stack

Only needed when working on **auth, cloud sync, or anything touching the
database**. Development runs against a *local* Supabase instance so it never
touches production data.

```sh
npm run db:start       # boots Postgres + Auth + Storage in Docker, applying the migrations that exist now
npm run dev            # now talks to the local stack at http://127.0.0.1:54321
```

Then set `.env`'s `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` (and
`SUPABASE_SERVICE_ROLE_KEY`, for account deletion and `/admin`) to the values
printed by `npx supabase status` — the stack's standard local demo keys,
identical on every machine and not secret. Production credentials are
injected by CI at build time and are never read from `.env`.

| Command | What it does |
|---|---|
| `npx supabase migration up --local` | Applies migrations added since the stack was started (e.g. after pulling `main`) |
| `npm run db:reset` | Re-applies every migration from a clean slate — **wipes local data** |
| `npm run db:stop` | Shuts the stack down |
| `npm run db:types:check` | Verifies the hand-maintained `src/lib/supabase/types.ts` still matches the schema |

**The Supabase CLI is linked to the production project.** The commands that take
`--linked` / `--local` — `migration up`, `migration list`, `db push`, `db reset`,
`gen types` — can all reach production, and **`db push` targets the remote
database by default**. Pass `--local` explicitly whenever you mean the local
stack. (`npx supabase migration new`, `db:start`, and `db:stop` accept neither
flag — they are local-only and can't touch production.)

`npm run db:reset` defaults to local, but prefer `migration up --local` when you
only need to apply what's pending — a reset rebuilds from scratch for no reason.

### Database migrations

Create them with `npx supabase migration new <name>`, which produces the
Supabase-standard `<YYYYMMDDHHMMSS>_<name>.sql` UTC-timestamp filename in
`supabase/migrations/`. Do not hand-number new migrations. The legacy
`00001`–`00023` names stay as they are: renaming them would mean rewriting the
`version` keys in production's `supabase_migrations.schema_migrations` in
lockstep, and if files and rows disagree the CLI treats every migration as
pending and CI's `db-migrate` job fails. The mixed schemes sort correctly
(`00023` before any `2026…`). Apply a new one locally with
`npx supabase migration up --local`; CI pushes it to production after the
build on `main` (`supabase db push --linked`).

`src/lib/supabase/types.ts` is **hand-maintained**, not generator output. Edit
it by hand when a migration changes the schema, then run `npm run db:types:check`
(needs the local stack). There is deliberately no regenerate-in-place script —
generator output would drop the file's source-interface header, add the unused
`graphql_public` schema and widen `public_lick_authors.id` to `string | null`.

A new column on a synced table must reach **every** hand-written row mapper:
the cloud reconcile is whole-row last-writer-wins, so a mapper that forgets
the column writes `NULL` and erases the value on the next pull.
`user_licks.mode` rides four (`cloudRowToPhrase`/`phraseToRow` in
`persistence/user-licks.ts`, `rowToPhrase` in `community.ts`, `toRow` in
`sync.ts`), each with a test.

## Code Style

### TypeScript

- Strict mode (`"strict": true` in `tsconfig.json`)
- Bundler module resolution
- Relative imports use bare, extensionless paths (e.g. `import { getScale } from './scales'`); most cross-module imports use the `$lib/...` alias (e.g. `import type { ScaleDefinition } from '$lib/types/music'`). Svelte component imports carry a `.svelte` extension (as do runes state modules, whose `.svelte` suffix resolves to a `.svelte.ts` file); JSON imports keep their `.json` extension.
- Prefer `const` over `let`; avoid `var`
- Use explicit types for function parameters and return values
- Use `type` imports for type-only imports

### Svelte

- Svelte 5 runes only — no Svelte 4 stores or `$:` reactive statements
- `$state()` for reactive state, `$derived()` for computed values, `$props()` for component inputs, `$effect()` for side effects
- Components use `interface Props` pattern for typed props
- Use Tailwind CSS utility classes with CSS custom properties for theming
- Component files: PascalCase (e.g. `MicStatus.svelte`)

### CSS

- Tailwind utility-first approach
- Theme colors via CSS custom properties (`var(--color-accent)`, etc.)
- Defined in `src/app.css` for both dark and light modes
- Listen/play indicators use the semantic aliases `--color-phase-listen` / `--color-phase-play`, never a raw palette token — `tests/unit/ui/design-token-consistency.test.ts` sweeps the phase surfaces ([Design System](../architecture/design-system.md))
- Component-scoped `<style>` blocks for non-utility CSS (e.g. abcjs SVG overrides)

### File Organization

- Module files: kebab-case (e.g. `pitch-detector.ts`)
- State modules: `.svelte.ts` extension (e.g. `session.svelte.ts`)
- Types in `src/lib/types/` grouped by domain
- One module per concern — avoid god files

## Architecture Conventions

### Concert Pitch Canonical

All pitches are stored and processed in **concert pitch** (MIDI note numbers). Transposition to written pitch happens only at display time, in two places:
- `phraseToAbc()` in `notation.ts`
- `concertToWritten()` in `transposition.ts`

### Fractions for Rhythm

Note durations and offsets use `[numerator, denominator]` tuples (type `Fraction`) to avoid floating-point errors. Convert to floats only when computing seconds or ticks.

### Explicit State Saves

State is **not** auto-saved on every change. Call `saveSettings()` or `saveProgress()` explicitly after user-initiated mutations. This avoids excessive writes during real-time operations (e.g. pitch detection updating at 60fps).

### Dynamic Imports

Heavy libraries (Tone.js, smplr, Pitchy, abcjs, pdfjs-dist) are dynamically imported to keep initial bundle size small. abcjs has exactly one loader, `src/lib/notation/abcjs-loader.ts` (memoised `load()` plus a synchronous `loaded()`); a new consumer goes through it rather than issuing its own `import('abcjs')`.

## Workflow

### Branches

`main` is what production runs — every merge to it deploys. Day-to-day work
lands on `dev`, and a release is a pull request from `dev` into `main`.
CodeRabbit reviews every PR (`.coderabbit.yaml`); its walkthrough carries a
docstring-coverage pre-merge check over the changed declarations.

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/), scoped by area:

```text
feat(tunes): carry a pickup through the OMR transcription
fix(lick-practice): keep the reading pause on a no-demo cycle
docs(omr): re-check LEGATO 2 availability
refactor(audio): extract the bleed-evidence resolver
test(e2e): pin the mic-error banner on WebKit
```

### Pull Requests

- Include description of what changed and why
- Reference any related issues
- Ensure all tests pass (`npm test`; plus `npm run test:deploy` if you touched `deploy/`, and `cd omr && uv run pytest` if you touched `omr/`)
- Ensure build succeeds (`npm run build`)
- Ensure types are clean (`npm run check`) — `svelte-check` prints its error count
  *before* the word ERRORS, so gate on the exit code, never on the summary line

### CI

CircleCI, two config files: `.circleci/config.yml` is a setup workflow whose
path filter sets `nginx-changed` / `omr-changed`, and
`.circleci/continue-config.yml` holds the jobs.

| Job | Runs on | What it does |
|---|---|---|
| `test` | every push | `npx vitest run`, then `npm run test:deploy` |
| `e2e` | every push, in parallel with `test` | Playwright on all three engines, sharded 6 ways; the config's `webServer` builds the app itself |
| `build` | `main`, after `test` | `npm run build` |
| `db-migrate` | `main`, after `build` | `supabase db push --linked` against production |
| `deploy` | `main`, after `build` + `db-migrate` + `e2e` | Atomic release on the server, then verifies the public `/api/health` reports this commit |
| `omr-test` | any branch, only when `omr/**` or `.circleci/**` changed | `uv sync --frozen`, `ruff check`, hermetic `pytest` |
| `nginx-deploy` | `main`, only when `nginx/**`, `deploy/nginx/**` or `.circleci/**` changed | Installs and reloads the nginx config (see the root README) |

A failed Firefox/WebKit spec blocks the deploy just like a unit test does.

## Running Tests

```bash
# Unit + integration tests (Vitest, Node)
npm test

# Watch mode
npm run test:watch

# Specific test file
npx vitest run tests/unit/audio/capture.test.ts

# Real-browser flows (Chromium, Firefox, WebKit)
npm run test:e2e

# The server-side release script's invariants (bash, stubbed binaries)
npm run test:deploy

# The Python OMR subsystem (hermetic; no model, no network)
cd omr && uv run pytest
```

`npm test` does **not** cover the last three — CI runs `npm run test:deploy`
inside the same job as vitest, `npx playwright test` in its own job, and the
OMR suite only when `omr/` changed. There is no coverage tooling installed.

Playwright's `webServer` builds and previews the app on port 4173 and, locally,
**reuses whatever already holds that port**. Beside another checkout (a
parallel worktree) that means silently testing the other checkout's build —
set `PLAYWRIGHT_PORT=<free port>` for the run. The deploy-lock cases in
`test:deploy` need `flock` and skip on macOS.

See [Testing Guide](testing-guide.md) for patterns and conventions.

## Building

```bash
# Development server
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```
