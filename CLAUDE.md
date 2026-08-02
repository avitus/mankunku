# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev            # Dev server at http://localhost:5173
npm run build          # Production build (SvelteKit Node adapter → build/)
npm run preview        # Preview production build locally
npm run check          # TypeScript + svelte-check
npm run check:watch    # Type checking in watch mode
npm test               # Unit + integration tests (Vitest)
npm run test:watch     # Vitest watch mode
npm run test:e2e       # Playwright E2E tests
npx vitest run tests/unit/music/scales.test.ts   # Run a single test file
```

CI pipeline (CircleCI): test → (build, db-migrate) → deploy (main branch only). Deploy rsyncs to a Digital Ocean server and restarts via PM2; db-migrate runs `supabase link` + `supabase db push --linked` against the production database, authenticated via the `SUPABASE_ACCESS_TOKEN` env var (no DB password needed).

### Database migrations

Create new migrations with `npx supabase migration new <name>`, which produces the Supabase-standard `<YYYYMMDDHHMMSS>_<name>.sql` UTC-timestamp filename. **Do not hand-number new migrations.** Migrations `00001`–`00023` use a legacy sequential scheme; the Supabase dashboard derives its "inserted at (UTC)" column by parsing the version string as a timestamp, so those legacy ones render "Unknown" forever. Renaming them retroactively would require rewriting the `version` primary keys in production's `supabase_migrations.schema_migrations` in lockstep — if files and table rows disagree, the CLI treats every migration as pending and CI's db-migrate job fails. So the legacy names stay; only new ones get real dates. Mixed schemes order correctly, since `00023` sorts before any `2026…` string.

`src/lib/supabase/types.ts` is **hand-maintained**, not generator output — edit it by hand when a migration changes the schema, then run `npm run db:types:check` (needs the local stack) to verify it matches the database. There is deliberately no regenerate-in-place script: generating over it drops the source-interface mapping in its header, adds the unused `graphql_public` schema, and widens `public_lick_authors.id` to `string | null`, which would widen the Map key type at three call sites in `persistence/community.ts` for a NOT NULL primary key.

The CLI is linked to the **production** project ref. Local commands need an explicit `--local` (`npx supabase migration up --local`); the `--linked` variants target production. `npm run db:reset` defaults to local but rebuilds from scratch, so prefer `migration up --local` to apply pending migrations in place.

## Architecture

Mankunku is a jazz ear training PWA. It plays a phrase, the user plays it back on their instrument via microphone, and it scores pitch/rhythm accuracy in real time. Built with SvelteKit 2, Svelte 5 (runes), TypeScript strict mode, Tailwind CSS 4, Tone.js, and Pitchy.

### Core module boundaries (`src/lib/`)

- **types/** — Pure TypeScript interfaces grouped by domain. No runtime code.
- **music/** — Pure functions for music theory (scales, intervals, keys, transposition, chords). No side effects.
- **audio/** — Everything touching Web Audio API: playback (Tone.js), capture (mic), pitch detection (Pitchy at 60fps), onset detection (custom AudioWorklet), note segmentation + quantizer, bleed filter, metronome (with a shared event log so playback clicks suppress phantom onsets during segmentation), backing-track rhythm section (bass/comp/drums), voicings, recorder + replay. Segmentation runs same-pitch consolidation and octave-boundary collapse passes that merge artifacts only when no attack evidence exists.
- **scoring/** — Pure functions: `score-pipeline.ts` (bleed filter + scoring orchestrator), `scorer.ts` (DTW + latency correction), per-note pitch/rhythm scorers, grades. No audio or UI dependencies.
- **phrases/** — Phrase generation, mutation, validation, library loading. Depends on music/ only.
- **tunes/** — Tune domain logic: section flattening (`flatten.ts`, notation order vs `expandRepeats` playback order), book loading (`book-loader.ts`) with curated/user/adopted merge + whole-sheet transposition, `to-phrase.ts` bridge into the Phrase-consuming playback/backing engines, `segment-from-symbol.ts` (chord text → HarmonicSegment, shared by entry + importers), structural validation of foreign payloads, and the importers under `import/` (iReal Pro URL parser incl. the irealb:// unscrambler, Band-in-a-Box .SGU/.MGU binary + MusicXML fallback, MuseScore, Claude PDF-extraction JSON conversion). Tunes store their real concert key (unlike licks, which are stored in C); `HarmonicSegment.symbol` carries the raw chord text for display fidelity and `tune-notation.ts` in music/ renders chords/repeats/endings/multi-system ABC while leaving `phraseToAbc` untouched.
- **difficulty/** — Adaptive difficulty: proficiency levels 1-100, 10 content tiers.
- **tonality/** — Daily key/scale selection, progressive unlocking.
- **state/** — Svelte 5 runes state modules (`.svelte.ts` files). Bridge between UI and logic.
- **persistence/** — localStorage wrapper + optional Supabase cloud sync.
- **components/** — Reusable Svelte UI components.
- **data/** — Curated lick catalog JSON files, rhythm pattern templates, progression templates.
- **step-entry/** — Manual lick entry helpers: duration metadata, pitch-input accidentals.
- **supabase/** — Supabase client factories (browser + server), auth helpers, generated DB types.
- **util/** — Small shared utilities (e.g., seeded shuffle).

### Key design decisions

**Concert pitch canonical.** All MIDI note numbers, scale data, and lick data use concert pitch internally. Transposition to written pitch (Bb/Eb instruments) happens only at display time in `phraseToAbc()` (notation.ts) and `concertToWritten()` (transposition.ts).

**Fraction-based rhythm.** Durations use `[numerator, denominator]` tuples (e.g., `[1, 8]` = eighth note, `[1, 12]` = triplet eighth). Conversion to seconds happens only at audio scheduling time.

**DTW scoring with latency correction.** Dynamic Time Warping in `alignment.ts` aligns expected vs detected note sequences. The scorer subtracts the median timing offset across matched pairs, absorbing constant human/detection latency.

**Local-first.** All writes go to localStorage/IndexedDB first. Supabase sync is optional and runs in the background. User data survives offline; page loads still need the network (no service worker — see tech-stack.md, "Installable web app").

**Shared AudioContext.** Tone.js and smplr share one AudioContext (via `audio-context.ts`) so Transport scheduling and sample playback stay on the same timeline.

### State management

State modules in `src/lib/state/` use Svelte 5 runes (`$state()`, `$derived()`, `$effect()`), not Svelte 4 stores. Key modules:
- **session.svelte.ts** — Single-phrase practice session (not persisted)
- **settings.svelte.ts** — User preferences (persisted to localStorage)
- **progress.svelte.ts** — Session history + adaptive state (persisted, bounded to 100 entries)
- **history.svelte.ts** — Long-term daily progress summaries for calendar heatmaps and period comparisons (persisted, survives the 100-session prune window). **Derive-on-write**: summaries are a pure derivation of two source-of-truth tables (`progress.sessions` and `lick-practice-sessions`); every write to either source calls `recomputeDailySummary(date)` so divergence is impossible and replaying a write is a no-op.
- **licks.svelte.ts** — Search state for the Licks page (not persisted, exports the `licks` rune). The /licks route is now focused on the user's *own* book — three derived sections (`needsSetup`, `practiceSet`, `otherLicks`) over user + adopted-community licks; the curated ear-training catalog isn't surfaced here. Category/difficulty browse filters were retired with the refocus; the remaining filters are search and a progression filter (`licks.progressionFilter`), which narrows to licks carrying the matching explicit `prog:*` tag via `getProgressionTags`.
- **lick-practice.svelte.ts** — Multi-key lick-practice flow: progression plans, per-key results, tempo adjustments, gradual key unlocking. Advancement gates: `KEY_PROFICIENT_THRESHOLD = 0.90` (green tier — counts toward unlocks and tempo bumps), `KEY_FLOOR_THRESHOLD = 0.75` (a single key below this blocks tempo *increases* and unlocks; decreases still apply), yellow band 0.75–0.89 (passable but doesn't earn). Tempo moves once per lick per session by `computeAutoTempoAdjustment(avg)`: +2 at ≥ 0.95, +1 at ≥ 0.90, −1 at ≥ 0.75, −3 below. Each unlock requires avg session score ≥ 0.90 AND newest-key `passCount` ≥ `UNLOCK_PASSES_REQUIRED` (3) AND no floor failure; keys appear in alternating sharp/flat-side neighbours of the entry key on the circle of fifths. Three start paths share the engine: **standard sessions** pin to one progression; **Daily Practice** (`startDailyPracticeSession` / `buildDailyPracticePlan`) rotates across every progression the user has `prog:*` tags for, picks each lick's least-recently-practiced compatible progression via `pickProgressionForLick`, and the post-session writer splits the report by progression so the least-recently-practiced lookup stays correct across mixed sessions; **single-lick Deep Practice** (`startSingleLickSession`, launched from the Practice button on a lick's detail page) drills one lick through its currently-unlocked keys only and **derives its progression from the lick's own `prog:*` tags** rather than `config.progressionType` — fixes the major-lick-over-minor-vamp bug — bumps tempo by `tempoBumpBpm` (default 5) when every unlocked key clears ≥ 0.95, and refills the rotation. Licks need an explicit `prog:<progressionType>` tag to be eligible; tags seed automatically on category writes (`updateLickCategory`) and are not auto-inferred on hydrate, so user-removed tags stay removed. The one-time category-inference migration (`backfillInferredProgressionTags`, run via `runLickMetadataMaintenance`) was **removed** in the data-layer simplification (PR #165) along with the orphan reconciler — don't reintroduce inference-on-hydrate. `backfillPracticeTags` does still run on each hydrate, but only to migrate *legacy* `practice` markers out of `lick.tags`/tag overrides, and it is gated on the cloud hydration reporting success (writing over a store that failed to hydrate would push a partial blob over the intact cloud row — the 2026-07-13 incident class). The reserved `__migrations` tag key survives in `persistence/lick-metadata-merge.ts`, where it is always unioned rather than last-writer-wins, so any legacy `prog-backfill-v1` marker is preserved rather than dropped by a merge. Per-lick reset (`resetLick`, backed by `resetLickPersistence` in the store) clears scores + unlock count for one lick (tags preserved) and is surfaced from both the post-session report (for try-again-band licks) and the book detail page. Progress persisted via `persistence/lick-practice-store.ts`.
- **tune-entry.svelte.ts** — Long-form tune entry built ON TOP of the shared `stepEntry` buffer: the section list is authoritative and melody is edited one ≤4-bar PAGE at a time through step-entry (so `PitchEntryPanel`/`DurationSelector`/keyboard entry work unmodified); the buffer commits on page/section navigation and is suspended (committed + emptied) on route exit so `/licks/editor` never sees tune content. Exports the `tuneEntry` rune plus `initNewTune`/`resetTuneEntry`, `loadFromTune`, and `buildDraftTune`. Chords are typed as written-pitch text (`parseChordSymbol`), stored concert with re-derived change-point durations. Manual entry is 4/4-only (`melodyEditingSupported`); imported charts in other meters keep their meter with melody editing gated off so the 4/4 buffer can't corrupt them. `loadDraftForReview` hydrates an unsaved import draft in create mode; the PDF flow uses `loadFromTune` with a pre-assigned id so the stored PDF stays linked. (Not persisted.)
- **tune-community.svelte.ts** — Filter state for the tune community browse page (not persisted, exports `tuneCommunity`).
- **step-entry.svelte.ts** — Manual lick entry UI state: current duration, octave, accidental, entered notes, plus `editingId`/`editingSource`/`editingTags`/`editingCategory` when re-opening an existing user-entered lick. `selectedNoteIndex` tracks a user-selected note (set by clicking a notehead or `selectPrev`/`selectNext` on ←/→); the selected note is the target of `adjustSelectedNotePitch`, `deleteSelectedNote`, and `flipSelectedNoteSpelling`, each falling back to the last pitched note when nothing is selected (`deleteLastNote`/`adjustLastNotePitch`/`flipLastNoteSpelling` remain as aliases). Mid-list deletes shift later offsets and repair straddling ties. `loadFromPhrase(lick)` hydrates the state for edit mode; `/licks/editor` branches on `editingId` to switch button labels, skip duplicate self-match, and redirect to `/licks/<id>` after Update. (Not persisted.)

### Routes (`src/routes/`)

ear-training/ (call-and-response practice, also reachable via `practice/` 308-redirect), lick-practice/ (multi-key flow), licks/ (book + [id] detail + community/ browse + add/ + record/ + editor/), tunes/ (book + [id] detail with written-pitch key selector + editor/ + community/ browse + add/ (method chooser) + import/{ireal,biab,pdf,musescore}), progress/, settings/, scales/, docs/, auth/ (email/password login + email-confirmation callback; no social login), diagnostics/, api/account/, api/chat/, api/tune-parse/ (Claude PDF extraction; manual byte-limited reader, its 15MB cap is the real gate under the 16M BODY_SIZE_LIMIT), api/lick-match/, api/monitoring/

### Tests

- **Vitest** (`tests/unit/`, `tests/integration/`) — unit + integration tests for pure logic (audio algorithms, scoring, music theory, persistence, lick generation). Runs in Node, no browser. Mocks Supabase via fixtures in `tests/helpers/`. CI: `npx vitest run`.
- **Playwright E2E** (`tests/e2e/`) — real-browser tests for user flows on Chromium, Firefox, and WebKit. Mocks the audio pipeline via `fixtures/audio.ts` (replaces `MediaRecorder` + `getUserMedia`) and synthesizes auth via the `e2e-test-user` cookie + the `PLAYWRIGHT=1` env-gated branch in `src/hooks.server.ts`. CI: `npx playwright test`. See `tests/e2e/README.md`.

## Code conventions

- **Svelte 5 runes only** — no `$:` reactive statements, no Svelte 4 stores
- **TypeScript strict mode** — explicit types for parameters and returns
- **File naming**: kebab-case for `.ts` files, PascalCase for `.svelte` components, `.svelte.ts` for state modules
- **Commit style**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`)
- **Scoring weights**: pitch accuracy 60%, rhythm accuracy 40%
