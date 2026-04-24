# Sessions Log

Newest at the top.

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
