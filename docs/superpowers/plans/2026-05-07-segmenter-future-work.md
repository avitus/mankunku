# Segmenter Future Work — Status Tracker

> Companion to `2026-05-07-segmenter-three-fixes.md` and `../notes/2026-05-07-segmenter-analysis.md`. The three follow-up fixes (warmup-only sub-segment drop, cross-segment ±12 collapse, gap-flanked last run + MIDI-aware dedup) closed the locrian-descent integration test on 2026-05-07.

This file tracks the two larger improvements the analysis identified.

---

## Item 1 — Wire `resetOctaveStateAt` into the live capture path  ✅ DONE

Shipped 2026-05-07 in commit `37247d1`. `createOnsetDetector`'s existing `onOnset(time)` callback was wired in both `src/routes/record/+page.svelte` (gated on `recordState === 'recording'`) and `src/routes/lick-practice/session/+page.svelte` (gated on `isRecording`). The closure pattern handles late-bound pitch-detector via optional chaining; no API change was needed since the callback parameter already existed.

Result: live capture now matches offline `replay.ts:122-124` behavior — each note attack warms up the octave stabilizer independently, so the McLeod attack subharmonic gets warmup-flagged at capture time.

---

## Item 2 — Unified single-pass stable-run extractor  🟡 DEFERRED

**Status as of 2026-05-07.** Not started. Preconditions not yet met (see below).

### Why this matters

The current pipeline has *two* parallel stable-run paths (analysis §7):

- **Pre-onset** (`findStableRunStarts`): warmup filtering + ephemeral-run-min-hold acceptance with flanking gaps + Phase 4 octave-collapse.
- **Post-onset** (`splitByPitchChange`, called per inter-onset segment): its own stable-MIDI walk + `collapseOctaveArtifacts` (within-segment) + `mergeConsecutiveSameMidi` + `splitOnReadingGaps`. Does NOT filter warmup. Does NOT have ephemeral-run acceptance.

Every fix to one path begs an equivalent on the other. The three follow-up fixes from 2026-05-07 are a clean example: Fix A (cross-segment artifact) is the post-onset analogue of pre-onset Phase 4; Fix B (`nextEventTime`) extends pre-onset gap-flanking to know about the next worklet onset; Fix C (warmup drop) is the post-onset analogue of pre-onset's warmup filter.

### Why it's deferred

Item 2 is fundamentally an *architectural* change — it treats worklet onsets as evidence (priors that snap or boost candidate boundaries) rather than as hard segment walls. That shift is meaningful enough to require **byte-equal regression coverage on real recordings before refactoring**, otherwise small onset-time shifts will silently drift DTW scores and the user will discover them the next time they practice.

The codebase currently has 4 .wav fixture recordings (in `tests/fixtures/recordings/`):

| Fixture | What it covers |
|---|---|
| `2026-04-14-a4-c5-tenor-sax.wav` | Octave-detection non-determinism |
| `2026-04-14-a3-c4-tenor-noisefloor.wav` | Noisy preamble before signal |
| `2026-04-19-upper-neighbor-on-root.wav` | Legato pre-onset notes |
| `2026-05-07-locrian-descent.wav` | Octave glitch + brief note + warmup phantom |

That's substantial coverage but the analysis recommended 5-10 recordings spanning more scenarios. **Specifically still missing**:

- **Soft-tongue rapid re-articulations** on a sustained pitch (the segmenter's `splitOnReadingGaps` logic — Task 1 from the original three-fixes plan — needs real-data validation under uniform warmup-filtering)
- **Long sustained notes with subtle clarity dropouts** (vibrato bends, breath swells — would test that the unified extractor doesn't fragment them)
- **Multi-key phrases** captured from a real lick-practice session (recordings spanning multiple key changes, longer-duration recordings)

Once 2-3 more .wav fixtures land in `tests/fixtures/recordings/` covering these scenarios, Item 2 has the byte-equal regression substrate it needs.

### Resume plan when ready

1. **Capture fixtures.** Use the dev server + `/diagnostics` export to produce .wav files for the three missing scenarios above. Drop them in `tests/fixtures/recordings/` with `YYYY-MM-DD-<short-name>.wav` naming.
2. **Add regression tests.** For each new fixture, add a `describe(...)` block in `tests/integration/pitch-replay.test.ts` matching the pattern of the existing four — assert deterministic replay, the expected MIDI sequence, and (if the recording was practice-scored) a score range.
3. **Snapshot full outputs.** For each of the 7 fixtures, add a test that snapshots `resolveOnsets(...)` + `segmentNotes(...)` as flat arrays (or with `toMatchSnapshot()`) — so any byte-level drift fails loudly.
4. **Then refactor.** Per the original Item 2 plan: design `extractNotes(readings, workletOnsets, recordingDuration)`, implement behind a flag, switch the flag, watch the snapshots, delete the old code paths.

### Design sketch (kept for when work resumes)

```
extractNotes(
  readings: PitchReading[],
  workletOnsets: number[],
  recordingDuration: number,
  opts?: { minNoteDuration; onsetGuard; minReadings }
): DetectedNote[]
```

Internally:
1. Filter warmup readings (uniformly).
2. Walk the filtered stream once, identifying stable runs with the same Phase 1-4 logic `findStableRunStarts` uses today, but applied to the entire timeline.
3. For each stable-run boundary, look for a worklet onset within `ATTACK_DEDUP_WINDOW`. If one exists, snap the boundary to the worklet timestamp.
4. For worklet onsets that don't align with any stable-run boundary, drop them — folds in `validateOnsets`.
5. For each segment, run the same emit-time aggregation `emitNote` does today (pitch-class vote + nearest-octave tie-break, warmup down-weight, short-note fallback, all-warmup reject).
6. Apply cross-segment ±12 collapse as a post-emit pass (today's Fix A logic, preserved).

### Risks (still relevant)

- **High blast radius.** Centerpiece of the audio→detection pipeline. Touches the DTW scorer, score-pipeline orchestrator, diagnostics page, record/lick-practice callers — all assume the current `resolveOnsets` + `segmentNotes` decomposition. Mitigation: keep the public API names; the rewrite stays internal.
- **Subtle output drift.** A "logically equivalent" refactor that shifts onset times by a few milliseconds will drift scores. Mitigation: the regression-fixture step above is the safety net.
- **Semantic shifts.** Applying pre-onset gap-flanked 2-frame acceptance uniformly across the recording would change behavior for mid-recording brief notes that `splitByPitchChange` currently rejects via `PITCH_CHANGE_MIN_HOLD`. Some shifts are improvements; some might be regressions. Decide explicitly per-shift, don't paper over.

### Estimate

Medium-to-large. Two-to-three days of focused work, dominated by fixture capture and snapshot alignment, not the refactor itself. The actual code shrinks; the discipline cost is the regression suite.

---

## Backstop

Neither item is on the critical path for the locrian-descent fix, which is fully shipped on `dev`:
- `f2cd4fc` Fix C (warmup-only sub-segment drop)
- `9da67de` Fix A (cross-segment ±12 collapse)
- `ced1a79` Fix B (gap-flanked last run + MIDI-aware dedup)
- `f4b91b6 → 6081047` integration test (now consolidated into `pitch-replay.test.ts`)
- `37247d1` Item 1 (live `resetOctaveStateAt` wiring) — see above.
