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
- A **microphone**, to exercise anything in the audio pipeline by hand.

### First run

```sh
npm install
npm run dev            # http://localhost:5173
```

That is genuinely all you need. Mankunku is **local-first**: every write goes to
localStorage/IndexedDB, and the app is fully usable signed out, offline, with no
backend configured. Cloud sync is an optional layer on top.

### Optional — the local Supabase stack

Only needed when working on **auth, cloud sync, or anything touching the
database**. Development runs against a *local* Supabase instance so it never
touches production data.

```sh
npm run db:start       # boots Postgres + Auth + Storage in Docker, applying the migrations that exist now
npm run dev            # now talks to the local stack at http://127.0.0.1:54321
```

Then copy `.env.example` to `.env` and set `PUBLIC_SUPABASE_URL` and
`PUBLIC_SUPABASE_ANON_KEY` to the values printed by `npx supabase status`.
`.env` is gitignored; production credentials are injected by CI at build time
and are never read from it.

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
Supabase-standard `<YYYYMMDDHHMMSS>_<name>.sql` UTC-timestamp filename. Do not
hand-number new migrations — see the "Database migrations" section of
`CLAUDE.md` for why the legacy `00001`–`00023` names are left alone.

`src/lib/supabase/types.ts` is **hand-maintained**, not generator output. Edit
it by hand when a migration changes the schema, then run `npm run db:types:check`.

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

Heavy libraries (Tone.js, smplr, Pitchy, abcjs) are dynamically imported to keep initial bundle size small.

## Workflow

### Branch Naming

- `feature/description` — New features
- `fix/description` — Bug fixes
- `docs/description` — Documentation
- `refactor/description` — Code restructuring

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat: add retrograde mutation for lick variations
fix: correct latency correction in scorer
docs: add API reference for scoring module
refactor: extract chord tone logic to chords.ts
test: add capture module unit tests
```

### Pull Requests

- One feature/fix per PR
- Include description of what changed and why
- Reference any related issues
- Ensure all tests pass (`npm test`; plus `npm run test:deploy` if you touched `deploy/`)
- Ensure build succeeds (`npm run build`)
- Ensure types are clean (`npm run check`) — `svelte-check` prints its error count
  *before* the word ERRORS, so gate on the exit code, never on the summary line

## Running Tests

```bash
# Unit + integration tests (Vitest, Node)
npm test

# Watch mode
npm run test:watch

# Specific test file
npx vitest tests/unit/audio/capture.test.ts

# Real-browser flows (Chromium, Firefox, WebKit)
npm run test:e2e

# The server-side release script's invariants (bash, stubbed binaries)
npm run test:deploy
```

`npm test` does **not** cover the last two — CI runs `npm run test:deploy` inside
the same job as vitest, and `npx playwright test` in its own job. There is no
coverage tooling installed.

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
