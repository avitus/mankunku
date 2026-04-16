# Sessions Log

Newest at the top.

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
