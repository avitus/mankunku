# Note Segmenter — Investigation Notes (2026-05-07)

Captured during the locrian-descent score investigation. Concrete state at the point Tasks 1-3 of `docs/superpowers/plans/2026-05-07-segmenter-three-fixes.md` were committed and the integration test (Task 4) revealed the original plan was incomplete.

This is a working knowledge dump, not a plan. It exists so a future agent (or human) can pick up the thread without re-deriving the analysis.

---

## 1. The fixture under investigation

`/Users/avitus/Downloads/2026-05-07-locrian-descent.wav` (also: `tests/fixtures/segmenter/2026-05-07-locrian-descent.json` — a sidecar diagnostics export with full `PitchReading[]` + worklet onsets + saved score).

- 3.6335s mono 48kHz PCM.
- Phrase: `diminished-chord-002_F` ("Locrian Descent"), tenor sax (Bb), concert key F, tempo 100, swing 0.65.
- Expected concert MIDI: `[65, 62, 60, 60, 57, 55, 53, 53]` = `F D C C A G F F` (8 eighth notes).
- **What the player actually played** (confirmed by the user): `F D C A G F F F` — i.e. they dropped the second C and added one extra F at the end. So the player's pitches are `[65, 62, 60, 57, 55, 53, 53, 53]`.
- Saved score: 49.4% (pitch 50%, rhythm 48.5%).

The user's view: this score is unfair given what they actually played. A correct segmentation of what the player played, run through the existing scorer, should produce ~73%.

---

## 2. Repo state at this checkpoint

Branch `dev`. Recent commits:

```
fa2338f fix(segmenter): accept 2-frame stable runs when flanked by clarity gaps   ← Task 3
35c8d60 chore: remove stray blank line in ear-training page                       ← cleanup
2d5d58b fix(segmenter): collapse cross-run octave artifacts in pre-onset stable runs ← Task 2
563d419 fix(segmenter): split same-pitch re-articulations on reading gaps         ← Task 1
5a3d96d docs: add plan for three independent note-segmenter fixes
c935fc6 Merge pull request #97 from avitus/dev                                    ← BASE
```

Uncommitted (untracked):
- `tests/fixtures/segmenter/2026-05-07-locrian-descent.json` (the diagnostics export, copied from Downloads)
- `tests/integration/segmenter-locrian-descent.test.ts` (failing integration test)

Stashes (do not touch):
- `stash@{0}: On dev: pre-rebase: pre-existing unrelated edits`
- `stash@{1}: On feature/custom-sax-samples: progress/history work in progress`

Test status: 1772/1772 unit tests pass. Integration test fails — see §6.

---

## 3. Pipeline architecture (relevant pieces)

```
mic → [worklet HFC onset detector] → onset times[]
mic → [Pitchy + octave stabilizer] → PitchReading[] (with .midi, .frequency, .clarity, .warmup)

PitchReading[] + onsets[] → resolveOnsets()
                              ├─ validateOnsets()        — drops worklet onsets without nearby readings
                              ├─ findStableRunStarts()   — synthesizes pre-onset onsets from stable pitch runs
                              └─ ATTACK_DEDUP_WINDOW logic — merges near-coincident pre-onset and worklet onsets

resolveOnsets output + readings → segmentNotes()
                                    └─ for each segment between onsets:
                                        ├─ filter readings to [segStart+onsetGuard, segEnd)
                                        ├─ splitByPitchChange()  — split on stable-MIDI transitions inside segment
                                        │   ├─ collapseOctaveArtifacts()  — merge ±12 short-into-longer sub-segs
                                        │   ├─ mergeConsecutiveSameMidi()
                                        │   └─ splitOnReadingGaps()       — Task 1: split same-MIDI on internal gaps ≥75ms
                                        └─ emitNote() per surviving sub-segment
```

Key files:
- `src/lib/audio/note-segmenter.ts` — segmentation, pure
- `src/lib/audio/pitch-frame.ts` — Pitchy wrapper + octave stabilizer
- `src/lib/audio/pitch-detector.ts` — runtime pitch-detector, exposes `resetOctaveStateAt(time)` (currently only called once at session start)
- `src/lib/audio/onset-worklet.js` — HFC-based onset detector

Caller (offline replay path the integration test uses): `src/lib/audio/replay.ts`.

---

## 4. What Tasks 1-3 actually fixed (and what they didn't)

| Task | Where it operates | What it fixed |
|---|---|---|
| 1 — `splitOnReadingGaps` | inside `splitByPitchChange` (post-onset, in-segment) | Same-MIDI re-articulations split on internal reading-gaps ≥75ms |
| 2 — octave-collapse in `findStableRunStarts` | pre-onset only | Brief ±12 stable runs (e.g. D3 glitch before D4) don't synthesize a phantom onset |
| 3 — gap-flanked brief stable runs | pre-onset only | 2-frame stable runs flanked by ≥50ms gaps on both sides become onsets |

**Critical asymmetry I missed in the original plan:** Tasks 2 and 3 only touch the pre-onset path (`findStableRunStarts`). Task 1 only touches the post-onset path (`splitByPitchChange`). None of the fixes apply uniformly across both paths.

---

## 5. Trace of the locrian-descent fixture under current code

### 5.1 `findStableRunStarts` on pre-onset (readings before worklet onset 1.056)

Input filtered (warmup-stripped) readings group into stable runs:

| Run | MIDI | Frames | Start | End |
|---|---|---|---|---|
| F4 | 65 | 14 | 0.083 | 0.300 |
| D3 (glitch) | 50 | 4 | 0.383 | 0.433 |
| D4 | 62 | 8 | 0.450 | 0.567 |
| C4 | 60 | 17 | 0.617 | 0.883 |
| A3 | 57 | 2 | 0.950 | 0.967 |

Phase 2 acceptance:
- F4, D3, D4, C4: all ≥3 frames → unconditional accept.
- A3: 2 frames. `gapBefore = 0.950 − 0.883 = 0.067` ≥ 0.05 ✓. `gapAfter = 0` (edge of `filtered`, no readings after 0.967 in pre-onset) < 0.05 ✗. **Rejected.**

Phase 4 octave-collapse:
- F4 vs D3: |65−50|=15. No collapse.
- D3 vs D4: |50−62|=12, D3(4) < D4(8). **D3 dropped.** ✓
- D4 vs C4: |62−60|=2. No collapse.

Output: `[F4@0.083, D4@0.450, C4@0.617]`.

### 5.2 `resolveOnsets` final output

```
[0.083, 0.450, 0.617, 1.056]
```

(Worklet onset 1.056 survives validation. 2.856 and 3.456 are dropped by `validateOnsets` — no readings within 150ms after them.)

### 5.3 `segmentNotes` per segment

| Segment | Range | Readings inside | sub-segments after splitByPitchChange | Emitted |
|---|---|---|---|---|
| 1 | 0.083 → 0.450 | F4(14) + D3(4) | F4 sub, D3 sub *(no collapse: 65↔50 = 15 semis)* | **F4, D3** |
| 2 | 0.450 → 0.617 | D4(8) | D4 sub | **D4** |
| 3 | 0.617 → 1.056 | C4(17) + A3(2 — too short to split) | C4 sub *(A3 is outlier within C4 sub, no split because A3 < PITCH_CHANGE_MIN_HOLD=3)* | **C4** |
| 4 | 1.056 → 3.6335 | G3 + F3 (sustained, with gaps) + 3 trailing warmup frames at MIDI 81 | G3 sub, F3 sub split into 3 by Task 1 (gaps 84ms / 100ms), C7 sub from 3 warmup frames | **G3, F3, F3, F3, C7** |

### 5.4 Final segmented output

```
MIDI: [65, 50, 62, 60, 55, 53, 53, 53, 81]
       F4  D3  D4  C4  G3  F3  F3  F3  C7
```

vs. ground truth `[65, 62, 60, 57, 55, 53, 53, 53]` = `F D C A G F F F`.

Score with this output: **0.6006** (up from saved 0.494 — Task 1's three F splits did help).

---

## 6. The three issues my plan didn't address

### Issue A — D3 phantom inside Segment 1

**Root cause:** Pitchy McLeod returns the half-frequency for ~67ms at the D4 attack. Task 2 stops it from becoming an *onset*, but the D3 readings still live inside Segment 1 (which ends at the D4 onset, 0.450). `splitByPitchChange` correctly identifies D3 and F4 as separate stable runs and produces two sub-segments.

`collapseOctaveArtifacts` looks for ±12 between **adjacent sub-segments within the same segment** (note-segmenter.ts:253). F4 vs D3 = 15 semitones, not 12. The ±12 partner (D4) is the next *segment*, so it's invisible to this function.

**The cleanest fix is upstream, not downstream.** `pitch-detector.ts` exports `resetOctaveStateAt(time)` already — it queues a stabilizer reset for the next frame. If this were called whenever an onset fires (during recording AND during offline replay), the McLeod glitch frames at each new attack would be marked `warmup: true`, and existing warmup-filtering would handle them. Currently the API is only invoked at session start.

This requires changes in two paths:
- Live capture: wire onset events to `resetOctaveStateAt` in the practice/lick-practice route audio plumbing.
- Offline replay: `replay.ts` would need to do the same when it dispatches onset events through Pitchy.

### Issue B — A3 lost as outlier inside Segment 3

**Root cause:** A3's 2 readings (0.950, 0.967) are *inside* Segment 3 (0.617 → 1.056), not in the pre-onset window. `splitByPitchChange` requires `PITCH_CHANGE_MIN_HOLD=3` consecutive frames at a different MIDI to split, so 2 frames of A3 inside a C4 sub-segment never trigger a split. Task 3's gap-flanked logic operates only in `findStableRunStarts`, which never sees in-segment readings.

Note: A3 *is* in the pre-onset window for `findStableRunStarts`. But it's the LAST run there — `gapAfter = 0` (edge of filtered array, by Task 3's deliberate semantics that preserve `tests/unit/scoring/score-pipeline.test.ts:191`). The next reading after A3 in the unfiltered stream is the worklet onset itself (1.056), 89ms later — which is a real flanking gap if we knew to look for it.

**Two viable fixes:**
- (B1) In `findStableRunStarts`, accept a `nextEventTime` parameter (the worklet onset time). For the last run in pre-onset, use `nextEventTime - filtered[endIdx].time` as `gapAfter`. Verified compatible with `score-pipeline.test.ts:191` (its 2-frame run has `gapBefore=0` regardless, which still rejects).
- (B2) Add an in-segment short-run promoter that mirrors Task 3's logic for sub-segments. More code, more complexity.

(B1) is simpler and more localized.

### Issue C — Trailing C7 phantom from warmup readings

**Root cause:** 3 trailing readings at MIDI 81 (mouthpiece artifact / breath sound at end of recording, all marked `warmup: true`) form a stable run inside Segment 4. `splitByPitchChange` does NOT filter warmup readings — only `findStableRunStarts` does (note-segmenter.ts:510). So the 3 frames trigger a stable-MIDI transition split, and `emitNote` emits them as a note (3 readings ≥ `minReadings=3`).

**Fix options:**
- (C1) Filter warmup readings in `segmentNotes` (note-segmenter.ts:94) before passing to `splitByPitchChange`. Risk: the very first note's startup-warmup readings get dropped — but the note isn't lost, only its first ~5 frames disappear from the vote. Acceptable.
- (C2) In `emitNote`, return null if every reading in the sub-segment is warmup. Most surgical fix.
- (C3) Per-onset stabilizer reset (Issue A's fix) might also mark the C7 burst as warmup-but-then-promoted-to-stable depending on confirmFrames semantics — needs verification.

(C2) is the smallest diff with the least chance of side-effects.

---

## 7. Architecture observations

The dual pre-onset / post-onset paths in `note-segmenter.ts` are the structural source of the asymmetric fixes:

- **Pre-onset path** (`findStableRunStarts`): runs once on readings before the first worklet onset. Has warmup filtering, stable-run minimum, octave collapse (Task 2), gap-flanked acceptance (Task 3).
- **Post-onset path** (`splitByPitchChange` per segment): runs per inter-onset segment. Has its own stable-MIDI walk, octave collapse, reading-gap split (Task 1). Does *not* filter warmup. Does *not* have the same brief-note acceptance.

Each fix to one path begs an equivalent fix in the other. A unified pre-process step (denoise readings before any segmentation) would eliminate this duplication. The cleanest version of that idea:

> Run a single "stable-pitch-run extractor" over the *entire* recording's readings, with octave-collapse + gap-flanked acceptance + warmup-filtering applied uniformly. Use the resulting runs as the canonical note boundaries. Treat worklet onsets as *evidence* (priors that boost confidence) rather than as hard segment walls.

This would be a meaningful refactor but the resulting code would be much smaller than the current pipeline, and the test surface would shrink too.

---

## 8. The deeper question: should pitch detection re-warmup per onset?

The `pitch-detector.ts:144` `resetOctaveStateAt(_time: number)` API exists explicitly for this purpose:

```typescript
* Queue a reset of the octave stabilizer. The reset is applied at the
* start of the next rAF tick, so an in-flight `detect()` call sees a
* coherent state. Used by onset plumbing to warm up each note
* independently (Phase 4b).
```

The "Phase 4b" comment suggests this was planned but never wired. If wired:

- McLeod's first-frame glitch at every new attack would be marked `warmup: true`.
- The existing `findStableRunStarts` warmup filter would naturally suppress those frames.
- `collapseOctaveArtifacts` becomes mostly redundant for cross-attack glitches (still useful for mid-note vibrato pulls).
- Trailing artifacts at end-of-recording (the C7 case) would also fall under warmup if the worklet fires an onset there — though it doesn't currently fire reliably for those.

**This is the highest-leverage fix.** It addresses Issue A directly, possibly Issue C, and may reduce the need for Tasks 2/3 entirely.

The wiring needed:
- `replay.ts` (offline path used by integration tests): needs to invoke `resetOctaveStateAt` when an onset is detected.
- Live capture path (capture.ts → practice routes): needs the same hookup.
- Verify the AudioWorklet onset detector's onset events are accessible in both paths.

This is *not* a small change — it touches the audio plumbing across multiple files. But it eliminates a class of bugs rather than patching them one-by-one.

---

## 9. Things I'm uncertain about

- **Is per-onset reset actually safe?** The stabilizer's warmup window is 5 frames (~83ms). If an onset fires mid-note (which can happen on worklet false-positives), we'd waste 83ms re-warming for no reason. The warmup penalty is just down-weighting in the pitch-class vote, so it's not catastrophic, but it could shift a borderline pitch decision.
- **Why does the worklet fire an onset at 2.856 in the locrian fixture?** That's mid-F3 sustain, after the third re-articulation. `validateOnsets` filters it out (last F3 reading is at 2.7666, no readings in [2.856, 3.006]). But why did the HFC peak there at all? Could be a real soft tongue that the player didn't fully voice. Either way, suggests the worklet is *more* sensitive than the pitch detector's clarity threshold for soft attacks.
- **Was the implementer's `Infinity → 0` change in Task 3 the right move?** The spec-reviewer subagent wrongly claimed no test required it; the test does exist (`score-pipeline.test.ts:191`). The implementer's choice of `0` is conservative-correct. The cost is what we hit in §6 Issue B — but that's recoverable with fix (B1).
- **What is the impact on score of fixing each issue independently?** The integration test currently shows 0.6006. I haven't measured what we'd get from fixing only A, only B, only C, or pairs. The plan estimate was ~0.73 with all three; that's a back-of-envelope DTW analysis, not a measured number.

---

## 10. What to do next (just options, not a plan)

In rough order of leverage:

1. **Wire `resetOctaveStateAt` to onset events in `replay.ts`.** Verify this alone fixes Issue A and possibly Issue C on the locrian fixture. May make Tasks 2 and 3 redundant; consider reverting them if so.
2. **Add Issue B fix (`nextEventTime` parameter to `findStableRunStarts`).** Small, contained, addresses A3.
3. **Add Issue C fix (skip all-warmup sub-segments in `emitNote`).** Tiny, defensive.
4. **Or — refactor toward the unified single-pass stable-run extractor described in §7.** Bigger change but better long-term.

The user's `MEMORY.md` notes a preference for minimal-diff fixes for "simple, reliable infra asks." But the per-onset reset wiring is meaningful infra — the scope is big enough that it warrants a plan.

---

## 11. Files of interest

| Path | Why |
|---|---|
| `src/lib/audio/note-segmenter.ts` | Where Tasks 1-3 landed; where in-segment fixes for A, B, C would land |
| `src/lib/audio/pitch-detector.ts` | Has `resetOctaveStateAt` (Phase 4b TODO) |
| `src/lib/audio/pitch-frame.ts` | Octave stabilizer; the source of McLeod glitch frames |
| `src/lib/audio/onset-worklet.js` | HFC onset detector |
| `src/lib/audio/replay.ts` | Offline replay path the integration test uses |
| `src/lib/audio/capture.ts` | Live capture path |
| `tests/unit/scoring/note-segmenter.test.ts` | Existing segmenter tests |
| `tests/unit/scoring/score-pipeline.test.ts` | Has the `does NOT prepend when fewer than 3 stable pre-onset readings` test (line 191) |
| `tests/integration/segmenter-locrian-descent.test.ts` | Failing integration test (uncommitted) |
| `tests/fixtures/segmenter/2026-05-07-locrian-descent.json` | The diagnostics export (uncommitted) |
| `docs/superpowers/plans/2026-05-07-segmenter-three-fixes.md` | The original (incomplete) plan |
