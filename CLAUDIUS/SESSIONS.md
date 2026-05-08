# Sessions Log

Newest at the top.

## 2026-05-07 — Calendar wasn't recording lick-practice sessions

**What happened:**

- User reported the progress calendar didn't reflect their lick-practice sessions.
- Bug was in `rebuildHistoryIfNeeded()` in `src/lib/state/history.svelte.ts`. That function runs on every authenticated page load (twice, in `+layout.ts`) and re-derives daily summaries from `progress.sessions`. But `progress.sessions` only contains ear-training sessions — `recordLickPracticeAttempt` deliberately writes lick attempts straight into the daily summary without polluting the session log.
- For mixed days (ear + lick), the derived summary undercounts the day by exactly the lick-practice contribution. The "earliest derived date" guard (existing.sessionCount > derived.sessionCount → skip) was the right shape but only ran for the earliest derived date, citing pruning. For every other mixed day, `Object.assign(existing, derivedSummary)` silently wiped lick-practice contributions on each reload.
- Fix: extended the existing-wins guard to all dates. Added an integration regression test covering a multi-day history with one mixed non-earliest day.
- All 1781 tests pass; type check clean.

**Notes:**

- Two callers exist for `aggregateSession`: `recordAttempt` (ear-training, full session log + cloud sync) and `recordLickPracticeAttempt` (lick-only, lightweight aggregate sync). The asymmetry is intentional — lick attempts must not pollute adaptive difficulty or per-key proficiency. But that asymmetry is the trap: any consumer that re-derives state from `progress.sessions` will silently lose lick-practice signal. Two existing places do this re-derivation: `migrateScaleProficiency` and `migrateKeyProficiency` both correctly skip non-ear-training sessions. The third place — `rebuildHistoryIfNeeded` — was the one that didn't account for it. Worth flagging as a category of bug: anything reading `progress.sessions` as if it were the full activity log is wrong.
- The cloud round-trip *would* have papered over the bug for a single reload (mergeCloudSummaries restores from the `daily_summaries` table), but the layout calls `rebuildHistoryIfNeeded` a second time after the cloud merge as a safety net for slow hydrations, which wiped again. The layout's safety-net rebuild is now harmless because the guard preserves existing-wins everywhere.

---

## 2026-04-20 — Documentation refresh pass

**What happened:**

- Audited all `src/lib/` modules, routes, types, migrations against `documentation/`. Several docs had drifted significantly since the three-domain palette landed, the score pipeline was extracted, and the backing-track + bleed-filter path was added.
- Rewrote `documentation/architecture/design-system.md` end-to-end: replaced the old blue/green palette with the current peacock teal (ear-training), terracotta (lick-practice), slate (neutral) identity. Documented the full brass decorative palette (`--color-brass`, `--color-brass-soft`, `--color-paper`), the on-air recording red, the Fraunces display serif, and the `.jazz-rule` / `.smallcaps` / `.grain-overlay` utilities.
- Rewrote `documentation/architecture/scoring-algorithm.md`: corrected the rhythm penalty formula from `× 1.5` to the tempo-scaled `min(1.0, 0.5 + tempo/300)` curve, added octave-insensitive matching, documented the new `score-pipeline.ts` orchestrator, the bleed-filter A/B, and the `TimingDiagnostics` field on `Score`. Added `GRADE_CAPTIONS` to the grade table.
- Updated `overview.md` module diagram (persistence, new audio modules, pipeline wrapper), `audio-pipeline.md` (backing track, bleed filter, quantizer, recorder/replay sections + updated awaiting-input behavior), `tech-stack.md` (current CSS token values + domain overrides + Fraunces note), `data-model.md` (Score.timing + BleedFilterLog + TimingDiagnostics).
- Fixed `api-reference/components.md` LickCard difficulty colors to reflect the actual 10-band table in `difficulty/display.ts`.
- Rewrote the `documentation/getting-started.md` project-structure tree to match real counts (20 audio files, 7 state modules, 8 type files, 12 migrations, nested components by domain, etc.).
- Updated `README.md` migration count (5 → 12) and `CLAUDE.md` module descriptions for audio/ and scoring/.

**Notes:**

- The underlying insight worth keeping: documentation drift in this project concentrates in visual/design artifacts (palette docs lag the CSS by months) and in the scoring layer (formulas in prose go stale even when `api-reference/scoring.md` — which is generated from signatures — is current). Architecture docs that paraphrase code are fragile; docs that describe *decisions* survive longer. Future doc passes should lean harder on the "why" of each section.
- The api-reference directory held up better than the architecture directory. That pattern probably means refreshing it is already someone's habit. The architecture docs need explicit prompting.

---

## 2026-04-16 — Fix chord/demo alignment in continuous lick practice

**What happened:**

- Diagnosed the recurring chord/demo alignment bug in continuous lick practice mode (second lick onwards)
- Root cause: visual tracking used seconds-based anchors computed with constant-BPM formula, which diverges from actual `transport.seconds` when tempo changes between licks (~3 second / ~5 beat error)
- Fix: replaced seconds-based tracking with tick-based; applied BPM synchronously; cleaned up backing Part start pattern
- Files changed: `src/routes/lick-practice/session/+page.svelte`, `src/lib/audio/backing-track.ts`
- All 1341 tests pass, zero new type errors

---

## 2026-04-16 — Session start; memory restructure

**What happened:**

- User established new operating principles: in-project `MEMORY.md`, default-location stub reduced to the 6-point instruction set, CLAUDIUS folder for sessions and independent notes.
- Migrated all existing memory content from the default local Claude memory location into `MEMORY.md` at the project root, structured as: preamble + user profile + working agreements + reference map.
- Stub at default location now contains only points (1)–(6) per instruction.
- Created `CLAUDIUS/README.md`, `CLAUDIUS/SESSIONS.md`, `CLAUDIUS/observations.md`.
- Reviewed the project from a fresh start: PRD, README, `CLAUDE.md`, design system, architecture overview, source layout, recent git history.

**Open / awaiting:**

- User to communicate what we're working on next.

**Notes:**

- Old per-topic memory files at the default location are left in place as historical artifacts. They're no longer referenced by the stub, so they don't load into context. The user can prune them at will.
