# Segmenter Future Work — Two Deferred Refactors

> Companion to `2026-05-07-segmenter-three-fixes.md` and `../notes/2026-05-07-segmenter-analysis.md`. The three follow-up fixes (warmup-only sub-segment drop, cross-segment ±12 collapse, gap-flanked last run + MIDI-aware dedup) closed the locrian-descent integration test. This plan covers the two larger improvements that the analysis identified but explicitly deferred.

These are independent and can be done in either order. The natural sequence — and the one this plan recommends — is **Item 1 first, then Item 2**, because Item 1 reduces the noise the segmenter sees, which makes Item 2's design easier to validate.

---

## Item 1 — Wire `resetOctaveStateAt` into the live capture path

**Why this matters.** `pitch-detector.ts:144` exports `resetOctaveStateAt(time)` for exactly this purpose. The offline replay path (`replay.ts:122-124`) already calls `stabilizer.reset()` per worklet onset so each note warms up independently and the McLeod attack subharmonic gets warmup-flagged. The live path does not. Every recording captured today carries the same D3-glitch-at-D4-attack pattern that the locrian fixture exhibits, and the segmenter has to clean it up downstream. Wiring the reset upstream prevents the bug at capture time.

**Scope.** Two routes (`src/routes/record/+page.svelte`, `src/routes/lick-practice/session/+page.svelte`) hold both detector handles in component scope; no state threading is needed. The "practice" route mentioned in `CLAUDE.md` does not exist as a separate consumer (it redirects to `/ear-training`).

**Constraints / risks.**
- The onset detector's API today is **pull-based**: routes accumulate onsets in an internal array and read them at recording end via `getOnsets()`. Per-onset reset needs a **push** signal — either a callback option on `createOnsetDetector`, an attachable listener, or a `getNewOnsetsSince(t)` poller called from the rAF tick that drives `createPitchDetector`.
- `pitchDetector` and `onsetDetector` may be created at different times in lick-practice (the detector is held across the whole session, recording windows open/close around it). The hook must tolerate the pitch-detector handle being late-bound.
- Worklet false-positive onsets fire occasionally on sustained notes (see analysis §9). A per-onset reset there wastes ~5 frames in warmup. Warmup readings are down-weighted (×0.25) not zero-weighted, so the cost is a small confidence dip on the affected pitch vote — acceptable per the analysis discussion.

**Approach.**

1. **Read `src/lib/audio/onset-detector.ts` (or wherever `createOnsetDetector` lives) and pick the smallest API that supports per-onset push.** If the function already accepts an optional `onOnset(time)` callback that's currently unused, just use it. Otherwise add a `subscribe(handler)` method that returns an unsubscribe function. Avoid restructuring the existing pull API — keep `getOnsets()` working so today's end-of-recording aggregation is unchanged.

2. **Route wiring** (record route first, lick-practice second).
    - In `record/+page.svelte` `beginActiveRecording` (~line 152): after both `pitchDetector` and `onsetDetector` exist, attach a handler that calls `pitchDetector.resetOctaveStateAt(time)` for each onset. Detach when recording stops.
    - In `lick-practice/session/+page.svelte`: attach the handler when `openRecordingWindow` fires (~line 556), detach when the window closes (~line 651). The pitch detector is held session-long, so resetting per-onset only during open windows is correct.

3. **Verify there's no double-reset.** Confirm that the pitch detector's existing `start()` call (which already resets the stabilizer once at recording start) doesn't conflict with the new per-onset resets. The first onset is typically on the first note; resetting again should be a no-op for the warmup state, but if tests show it lengthens the warmup window unnaturally, gate the first onset reset.

4. **Tests** (in `tests/unit/audio/` or co-located with the modified files):
    - Unit test on the onset-detector API change (subscribe/unsubscribe, multiple subscribers, no double-fire).
    - Integration-style test that drives a fake mic capture through `replayFromAudioBuffer` semantics + the new wiring, asserts that `resetOctaveStateAt` is invoked for each onset. (The existing `replay.ts` already does this internally, so a small shim on top is enough.)
    - Manual smoke test: record a phrase in dev, export diagnostics, compare warmup-flag distribution to a recording captured before this change. The new recording should have warmup-flagged frames immediately after each onset; the old one shouldn't.

5. **Decide whether to revert Tasks 2/3 of the original three-fixes plan**, the analysis suggested in §10. With per-onset reset:
    - The cross-run octave collapse in `findStableRunStarts` Phase 4 (Task 2) becomes mostly redundant — the glitch frames at attack get warmup-flagged and filtered. Keep the code; it's cheap insurance for any case the live wiring doesn't catch (e.g. legato transitions where the worklet doesn't fire).
    - The 2-frame gap-flanked acceptance (Task 3) is independent — it recovers brief notes that the clarity threshold drops. Keep it.
    - **Recommendation: do not revert anything.** The defensive layers cost little and protect against worklet edge cases the live reset can't reach.

**Files to touch.**
- `src/lib/audio/onset-detector.ts` (or equivalent — verify the file path; the existing fixture trace suggests it's in `src/lib/audio/` but the exact name needs checking) — add push-subscription API.
- `src/routes/record/+page.svelte` (~line 152) — wire the reset on each onset.
- `src/routes/lick-practice/session/+page.svelte` (~lines 556, 651) — wire and unwire per recording window.
- `tests/unit/audio/onset-detector.test.ts` (or co-located) — push API tests.
- New: a short manual-verification recipe documented in `docs/` so future regressions are caught.

**Verification.**
- All existing tests still pass (`npm test`).
- Type check clean (`npm run check`).
- Manual: record three short phrases (one with known octave-glitch-prone fast leap, one with sustained notes, one with re-articulations) and confirm via the `/diagnostics` panel that warmup flags align with worklet onsets.
- Save one of those recordings as a new fixture so this wiring is regression-tested end-to-end.

**Estimate.** Small-to-medium. ~150-300 lines across the API change, two routes, and tests.

---

## Item 2 — Unified single-pass stable-run extractor

**Why this matters.** The current pipeline has *two* parallel stable-run paths (analysis §7):

- **Pre-onset** (`findStableRunStarts`): runs once on readings before the first worklet onset. Has warmup filtering, ephemeral-run-min-hold acceptance with flanking gaps, and Phase 4 octave-collapse.
- **Post-onset** (`splitByPitchChange`, called per inter-onset segment): has its own stable-MIDI walk, `collapseOctaveArtifacts` (within-segment), `mergeConsecutiveSameMidi`, and `splitOnReadingGaps`. Does NOT filter warmup. Does NOT have ephemeral-run acceptance.

Every fix to one path begs an equivalent for the other. The three follow-up fixes from today are a clean example: Fix A (cross-segment artifact) is the post-onset analogue of pre-onset Phase 4; Fix B (`nextEventTime`) extends pre-onset gap-flanking to know about the next worklet onset; Fix C (warmup drop) is the post-onset analogue of pre-onset's warmup filter. The duplication is real and the test surface is correspondingly bloated.

**Goal.** Replace the current `resolveOnsets` + `segmentNotes` pair with a single function that:
1. Runs **one stable-run extractor over the entire recording's readings** with warmup filtering, octave-collapse, and gap-flanked acceptance applied uniformly.
2. Treats **worklet onsets as evidence (priors), not as hard segment walls.** A worklet onset within `ATTACK_DEDUP_WINDOW` of a stable-run boundary snaps the boundary to the worklet timestamp; an onset that doesn't align with any boundary becomes a confidence-boosted boundary on its own.
3. Emits `DetectedNote[]` with the same shape currently produced — the DTW scorer downstream is contract-frozen.

**Constraints / risks.**
- **High blast radius.** This is the centerpiece of the audio→detection pipeline. The DTW scorer in `src/lib/scoring/scorer.ts`, the score-pipeline orchestrator, the diagnostics page, the record/lick-practice/diagnostics callers — all assume the current `resolveOnsets` + `segmentNotes` decomposition.
- **Test churn.** All ~25 segmenter unit tests and the locrian integration test must port to the new function. Either the new function preserves the exact current signatures (and the existing tests stay) or it doesn't (and we rewrite). Recommend the former.
- **Risk of subtle output drift.** DTW scoring is sensitive to the exact onset times and MIDI sequence emitted. A "logically equivalent" refactor that shifts onset times by a few milliseconds will drift scores. Lock down behavior with a regression-fixture suite *before* touching the code.

**Approach.**

1. **Lock the current behavior into regression fixtures first.**
    - Capture diagnostics JSON for 5-10 representative recordings (curated to cover: clean fast lines, sustained notes with re-articulations, attack-glitch leaps, soft-tongue runs, multi-key phrases). Store in `tests/fixtures/segmenter/`.
    - For each, snapshot the current `resolveOnsets` output and `segmentNotes` output. Add tests that assert these snapshots are byte-equal.
    - Commit this *before* refactoring. Now any drift is detectable.

2. **Design the new API on paper.** Sketch:
    ```
    extractNotes(
      readings: PitchReading[],
      workletOnsets: number[],
      recordingDuration: number,
      opts?: { minNoteDuration; onsetGuard; minReadings }
    ): DetectedNote[]
    ```
    Internally, the extractor does:
    1. Filter warmup readings (uniformly across the recording).
    2. Walk the filtered stream once, identifying stable runs with the same Phase 1-4 logic that `findStableRunStarts` uses today, but applied to the entire timeline.
    3. For each stable-run boundary, look for a worklet onset within `ATTACK_DEDUP_WINDOW`. If one exists, snap the boundary to the worklet timestamp.
    4. For worklet onsets that don't align with any stable-run boundary (e.g. mid-sustain false positive), drop them — the current `validateOnsets` logic gets folded in.
    5. For each segment, run the same emit-time aggregation that `emitNote` currently does (pitch-class vote + nearest-octave tie-break), including the warmup down-weight, the short-note fallback, and the all-warmup reject.
    6. Apply cross-segment ±12 collapse as a post-emit pass (today's Fix A logic, kept as-is).

3. **Implement behind a feature flag.** Add an internal `useUnifiedExtractor: boolean` toggle in `note-segmenter.ts` (default off). The new code path lives next to the old one until the regression-fixture suite is green.

4. **Switch the flag, run the full suite, watch for snapshot drift.** Investigate every failure individually — do *not* update snapshots without confirming the new output is at least as good as the old.

5. **Delete the old code paths** (`resolveOnsets` body becomes a thin shim over `extractNotes`, or callers migrate directly). Constants that were duplicated across the two paths consolidate to a single set. Internal helpers (`splitByPitchChange`, `collapseOctaveArtifacts`, `splitOnReadingGaps`, `findStableRunStarts`) merge or disappear.

6. **Migrate callers** (`record/+page.svelte`, `lick-practice/session/+page.svelte`, `diagnostics/+page.svelte`, the test suites). If the public API kept `segmentNotes`/`resolveOnsets` as names (recommended for minimal churn), no migration is needed — just delete the internals.

**Files to touch.**
- `src/lib/audio/note-segmenter.ts` — large rewrite. Eventually shrinks substantially (removed duplication).
- `tests/unit/scoring/note-segmenter.test.ts` — new fixture-based regression suite added before the refactor; existing unit tests preserved if behavior is preserved.
- `tests/fixtures/segmenter/` — new fixtures.
- No caller-side changes if the public API names are preserved.

**Verification.**
- Regression fixtures byte-equal old vs new (this is the test).
- All ~25 unit tests pass without alteration.
- `npm run check` and `npm test` clean.
- Locrian-descent integration test still produces `[65, 62, 60, 57, 55, 53, 53, 53]` and score in `(0.65, 0.78)`.
- Manual: rescore 3-5 saved recordings and confirm overall scores are within ±2% of pre-refactor values.

**Estimate.** Medium-to-large. Two-to-three days of focused work, dominated by fixture capture and snapshot alignment, not the refactor itself. The actual code shrinks; the discipline cost is the regression suite.

---

## Order recommendation

1. **Item 1 first.** Smaller diff, higher leverage per line of code, fixes a class of bugs at the source. Reduces the noise Item 2 has to handle.
2. **Item 2 second.** Higher blast radius; benefits from the cleaner inputs Item 1 produces and from any further evidence accumulated about edge cases between now and then.

Neither item is on the critical path for the locrian-descent fix, which is already complete on the `dev` branch (commits `f2cd4fc`, `9da67de`, `ced1a79`, `f4b91b6`).
