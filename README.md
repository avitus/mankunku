# Mankunku

Jazz ear-training web app with call-and-response practice. The app plays a jazz phrase, you play it back on your instrument via microphone, and it scores your pitch and rhythm accuracy in real time.

Named after Winston "Mankunku" Ngozi's 1968 album [*Yakhal' Inkomo*](https://en.wikipedia.org/wiki/Yakhal%27_Inkomo) — one of the greatest South African jazz recordings. Under the hood: real-time pitch detection at 60fps, Dynamic Time Warping for score alignment, a custom AudioWorklet for onset detection, adaptive difficulty that grows with you, and a local-first architecture that keeps your data on-device (page loads need the network).

## Features

**Practice**

- Call-and-response ear training with automatic scoring
- 12-key lick practice over a generated rhythm section, with per-lick gradual key unlocking and tempo adaptation
- Tune practice: runtime progression detection inside a song form, mastery-aware lick suggestions at each insertion point, and freestyle solo recognition
- Adaptive difficulty: proficiency levels 1-100, 10 content tiers
- Guided tours on every main surface, replayable from Settings

**Listening**

- Real-time pitch detection (McLeod method via Pitchy, 60fps)
- Note onset detection via custom AudioWorklet (HFC algorithm)
- Five-tier re-articulation detection down to legato tonguing that leaves no energy evidence — only a waveform-shape break
- Band-limited (250–5000 Hz) evidence so metronome clicks can neither mask nor fake an articulation
- DTW alignment-based scoring (pitch 60% + rhythm 40%, with latency correction)

**Content**

- 33 scales and 452 curated jazz licks (ii-V-I, blues, bebop, modal, and more)
- Combinatorial phrase generation from scale patterns and rhythm templates
- Full song forms with Real Book–style engraving: jazz chord stacking, section markers, repeats, stacked voltas, multi-system reflow
- Tune importers: iReal Pro links, Band-in-a-Box `.SGU`/`.MGU` + MusicXML, MuseScore `.mscz`/`.mscx`, and AI-assisted PDF extraction with a review pass
- Community sharing for both licks and tunes

**Platform**

- Concert pitch canonical — transposition to written pitch at display time only
- Fraction-based rhythm representation (no floating-point drift with triplets or dotted notes)
- Local-first: writes to localStorage/IndexedDB, optional Supabase cloud sync
- Installable web app (manifest-based; there is no service worker, so page loads need the network)
- Cross-device progress sync via Supabase auth (optional)
- Dark and light themes

## Tech Stack

| Technology | Role |
|---|---|
| SvelteKit 2 + Svelte 5 (runes) | Framework, SSR, file-based routing |
| TypeScript (strict mode) | Type safety throughout |
| Tailwind CSS 4 | Utility-first styling, dark/light theming |
| Tone.js + smplr | Audio scheduling, SoundFont sample playback |
| Pitchy | McLeod pitch detection |
| Custom AudioWorklet | Real-time onset detection |
| abcjs | Sheet music notation rendering |
| Supabase | Auth + PostgreSQL cloud sync (optional) |
| Vitest + Playwright | Unit and E2E testing |

## Quick Start

**Prerequisites:** Node.js >= 22, a modern browser with Web Audio API support

```sh
git clone https://github.com/avitus/mankunku.git
cd mankunku
npm install
npm run dev
```

The app opens at `http://localhost:5173`. The onboarding flow will prompt for instrument selection and microphone access. A microphone is needed for full functionality but not required to explore the codebase.

**Optional — Supabase cloud sync:** Copy `.env.example` to `.env` and add your Supabase project URL and anon key. See [Development Setup](documentation/contributing/contributing.md#development-setup) for full setup including database migrations.

**Local Supabase stack (for auth/sync development):** Development runs against a **local** Supabase instance so it never touches production data. Requires Docker.

```sh
npm run db:start   # boots local Postgres + Auth + Storage via Docker and applies all migrations
npm run dev        # dev server now talks to the local stack at http://127.0.0.1:54321
```

`npx supabase migration up --local` applies any migrations added since the stack was started (e.g. after pulling main); `npm run db:reset` re-applies them from a clean slate; `npm run db:stop` shuts the stack down. `npm run db:types:check` verifies the hand-maintained `src/lib/supabase/types.ts` still matches the schema. Point your local `.env` `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` at the values from `npx supabase status`. Production is unaffected — its credentials are injected by CI at build time, not read from `.env`.

## Project Structure

```text
src/
  lib/
    audio/          Audio pipeline: playback, capture, pitch detection, onset detection, segmentation
    scoring/        DTW alignment and scoring engine
    music/          Music theory + engraving: scales, keys, intervals, transposition, chords, notation
    phrases/        Phrase generation, mutation, validation, library loading
    tunes/          Tune domain: flatten, book loading, importers, progression detection, lick matching
    notation/       DOM-adjacent chart geometry: hit zones, abcjs adapter, follow-scroll, ending alignment
    matching/       N-gram melodic matcher (attribution + freestyle recognition)
    difficulty/     Adaptive difficulty algorithm and 10-tier profiles
    tonality/       Daily key/scale selection, progressive unlocking
    step-entry/     Manual note-entry helpers (durations, accidentals)
    tour/           driver.js guided-tour definitions and config
    docs/           In-app docs tree, markdown rendering, assistant context
    state/          Svelte 5 runes state modules (.svelte.ts) + their plain logic modules
    persistence/    localStorage/IndexedDB storage + Supabase sync
    components/     UI components (audio, practice, licks, tunes, tune-practice, notation, console, ui)
    supabase/       Client setup and hand-maintained DB types
    types/          TypeScript interfaces grouped by domain
    data/           Curated lick + tune catalogs, progression templates and shapes
  routes/           SvelteKit pages: ear-training, lick-practice, licks, tunes, progress, settings, docs, auth
tests/
  unit/             Unit tests across 8 domains (audio, scoring, music, phrases, ...)
  integration/      Integration tests (auth route chain, etc.)
  e2e/              Playwright browser tests
supabase/
  migrations/       SQL migrations (profiles, progress, settings, licks, tunes, RLS, +evolutions)
documentation/      Player guides, architecture docs, API reference, contributing guides
```

## Architecture Highlights

**Concert pitch canonical** — All MIDI note numbers, scale data, and lick data use concert pitch. Transposition to written pitch (Bb/Eb instruments) happens only at display time in two functions: `phraseToAbc()` and `concertToWritten()`. This eliminates an entire class of transposition bugs.

**Fraction-based rhythm** — Note durations use `[numerator, denominator]` tuples (e.g., `[1, 8]` = eighth note, `[1, 12]` = triplet eighth). No floating-point drift with triplets or dotted rhythms. Conversion to seconds happens only when computing audio timing.

**DTW scoring with latency correction** — Dynamic Time Warping aligns expected and detected note sequences, handling extra notes, missed notes, and tempo drift. The scorer computes the median timing offset across matched pairs and subtracts it, absorbing constant human and detection latency without affecting relative timing accuracy.

**AudioWorklet onset detection** — A custom AudioWorklet processor runs on the audio thread for low-latency onset detection using High-Frequency Content weighting with an adaptive threshold. Falls back to pitch-gap detection in browsers without AudioWorklet support.

**Local-first with optional cloud** — All writes go to localStorage and IndexedDB first for instant feedback and offline resilience. Supabase sync runs in the background when the user opts in. The app is fully functional without any backend.

**Tunes bridge into the Phrase pipeline** — Tunes were added without forking playback, scoring, or notation. `flattenTune` collapses a tune's sections into one continuous timeline (in notation order or repeat-expanded playback order, with index maps between them), and `tuneToPhrase` wraps that in a `Phrase` so the existing engines consume a song form with no new orchestration. See [Tune System](documentation/architecture/tune-system.md).

See [Architecture Overview](documentation/architecture/overview.md) for detailed system design documentation.

## Contributing

Contributions are welcome — whether that is adding jazz licks, improving the scoring algorithm, fixing bugs, or improving documentation.

**Good first contributions:**

- Add curated licks to the catalog ([guide](documentation/contributing/adding-licks.md))
- Add scales to the catalog ([guide](documentation/contributing/adding-scales.md))
- Improve test coverage across any of the 8 test domains
- Report bugs or suggest features via issues

See the full [Contributing Guide](documentation/contributing/contributing.md) for code style, branch naming, commit conventions, and PR process. In short: Svelte 5 runes only, TypeScript strict mode, Conventional Commits.

## Testing

```sh
npm test              # Run unit + integration tests (Vitest)
npm run test:watch    # Watch mode
npm run test:e2e      # Playwright E2E tests
npm run check         # TypeScript + svelte-check
```

See the [Testing Guide](documentation/contributing/testing-guide.md) for patterns, audio mocking strategies, and conventions.

## Nginx deployment

The production nginx config at `nginx/mankunku.conf` is the single source of truth. It is deployed to `/etc/nginx/sites-available/mankunku` on the server by a dedicated CircleCI workflow.

**When does it deploy?** The `nginx-deploy` workflow runs only when a push to `main` changes any of:

- `nginx/**`
- `deploy/nginx/**`
- `.circleci/**`

App-only changes (under `src/`, `tests/`, `static/`, etc.) do not trigger `nginx-deploy`. Path filtering is wired via the [`circleci/path-filtering`](https://circleci.com/developer/orbs/orb/circleci/path-filtering) orb from `.circleci/config.yml`; the actual jobs live in `.circleci/continue-config.yml`. Running this workflow requires "Dynamic config using setup workflows" enabled in CircleCI (Project Settings → Advanced).

**What happens on the server?** The job scp's `nginx/mankunku.conf` and `deploy/nginx/deploy.sh` to `/tmp`, then invokes the script over SSH. The script:

1. Backs up the existing `/etc/nginx/sites-available/mankunku` to `/etc/nginx/backups/mankunku.<timestamp>.conf`.
2. Installs the new config (mode `0644`, owner `root:root`).
3. Ensures the `sites-enabled/mankunku` symlink exists.
4. Runs `sudo nginx -t`.
5. On success, reloads nginx with `sudo systemctl reload nginx`.
6. On failure, restores the backup and exits non-zero (no reload).

**Required CircleCI environment variables** (set in a context or the project):

| Variable | Purpose |
|---|---|
| `DEPLOY_HOST` | Server hostname or IP |
| `DEPLOY_USER` | SSH user (must have passwordless `sudo` for `nginx`, `systemctl`, `install`, `mkdir`, `cp`, `ln`, `rm` on the relevant paths) |
| `DEPLOY_PORT` | *(optional)* SSH port; defaults to `22` |

The SSH key is attached via `add_ssh_keys` using the fingerprint already registered for the app deploy job.

**Manual deploy.** Copy `nginx/mankunku.conf` to the server (e.g. `/tmp/mankunku.nginx.staged`) and run:

```sh
bash deploy/nginx/deploy.sh /tmp/mankunku.nginx.staged
```

The script is idempotent and safe to re-run.

## License

License pending. This project does not yet have a license file — one will be added before the first public release.

### Third-party data

The lick-naming feature uses a derivative index of the [Weimar Jazz Database](https://jazzomat.hfm-weimar.de/) (CC-BY-NC-SA 4.0). See [`docs/wjazzd-attribution.md`](docs/wjazzd-attribution.md) for license details and rebuild instructions.

## Acknowledgments

Named after [Winston "Mankunku" Ngozi](https://en.wikipedia.org/wiki/Winston_Mankunku_Ngozi) (1943-2009), South African jazz tenor saxophonist whose 1968 album *Yakhal' Inkomo* ("Cry of the Bull") remains a landmark of South African jazz.

Built with [SvelteKit](https://svelte.dev), [Tone.js](https://tonejs.github.io), [Pitchy](https://github.com/ianprime0509/pitchy), [smplr](https://github.com/danigb/smplr), [abcjs](https://www.abcjs.net), and [Supabase](https://supabase.com).
