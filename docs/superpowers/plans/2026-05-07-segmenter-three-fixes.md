# Note Segmenter — Three Independent Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three known segmentation issues that artificially depress ear-training scores. Verified against `2026-05-07-locrian-descent.wav` (saved as 49% but the player executed pitches that should score ~73%).

**Architecture:** All three fixes live in `src/lib/audio/note-segmenter.ts`. Each is narrow, additive, and verifiable with a unit test using crafted `PitchReading[]` arrays. A final integration task replays the saved diagnostics JSON through the pipeline and asserts the segmented output matches what the player actually played (`F D C A G F F F`).

**Tech Stack:** TypeScript strict, Vitest, Svelte 5 runes. No new runtime dependencies.

**Background — what each fix addresses:**
1. **Cross-segment octave artifact.** During the D4 attack at t=0.383 in the fixture, Pitchy's McLeod method returned the half-frequency (147 Hz) for 4 frames before locking onto 295 Hz. The octave stabilizer in `pitch-frame.ts:159-176` requires 3 confirm frames for ±12 jumps, so D3 became "stable" before D4 took over. `findStableRunStarts` (`note-segmenter.ts:506`) then promoted both runs to onsets, creating a 67ms phantom D3 segment. The existing `collapseOctaveArtifacts` (`note-segmenter.ts:253`) is designed for exactly this but only operates within a single segment — it never gets a chance because the two octave-related runs end up in *different* segments.
2. **Sub-clarity-threshold brief notes.** A real A3 (~100ms) at t=0.95 only kept 2 readings above the 0.80 clarity threshold. `findStableRunStarts` requires `PITCH_CHANGE_MIN_HOLD=3` consecutive frames, so A3 never qualifies as a stable run and no onset is created.
3. **Same-pitch re-articulations.** Three F3 articulations between t=1.5 and t=2.7 merged into one segment because (a) the audio worklet's HFC onset detector didn't fire on the soft tongue attacks and (b) the segmenter has no clarity-gap-as-boundary signal — same MIDI throughout means `splitByPitchChange` keeps it as one sub-segment.

**Order:** Fix #3 first (most independent — different function). Then Fix #1 (refactor `findStableRunStarts` foundation). Then Fix #2 (builds on the same foundation). Each task self-contained with TDD; commit after each.

**Test fixture path used for the integration check:** `tests/fixtures/segmenter/2026-05-07-locrian-descent.json` (copied from `/Users/avitus/Downloads/`).

---

## Task 1: Fix #3 — Split same-MIDI sub-segments on internal reading gaps

**Files:**
- Modify: `src/lib/audio/note-segmenter.ts:161-214` (`splitByPitchChange` pipeline)
- Test: `tests/unit/scoring/note-segmenter.test.ts`

**Strategy:** Add a post-processing helper `splitOnReadingGaps` that walks each sub-segment's readings and splits where consecutive readings are separated by a gap ≥ threshold. Insert it at the end of the `splitByPitchChange` pipeline, after `mergeConsecutiveSameMidi` so any artifact collapses run first.

**Threshold rationale:** Pitchy emits readings every ~16.67ms (60 fps). A 60ms gap = 4 frame intervals. The fixture's two F3 re-articulation gaps are 84ms and 100ms; surrounding clarity dips during normal sustain are typically 1–2 frames (≤ 33ms). 60ms cleanly separates re-articulations from sustain noise.

- [ ] **Step 1.1: Write the failing test**

Add to `tests/unit/scoring/note-segmenter.test.ts` inside `describe('segmentNotes', ...)`:

```typescript
it('splits same-MIDI re-articulations on internal reading gaps', () => {
    // F3 sustained but with two clarity-dropout gaps simulating soft re-tonguing.
    // Three articulations → three notes, even though pitch never changes.
    const readings: PitchReading[] = [
        // First F3 (90ms)
        makeReading(53, 1.50),
        makeReading(53, 1.5167),
        makeReading(53, 1.5333),
        makeReading(53, 1.55),
        makeReading(53, 1.5833),
        // Gap (84ms) — re-tongue
        makeReading(53, 1.6667),
        makeReading(53, 1.6833),
        makeReading(53, 1.70),
        makeReading(53, 1.85),
        makeReading(53, 2.00),
        makeReading(53, 2.1667),
        // Gap (100ms) — re-tongue
        makeReading(53, 2.2667),
        makeReading(53, 2.30),
        makeReading(53, 2.50),
        makeReading(53, 2.70)
    ];
    // Single onset at the start; no other onsets — re-articulations are
    // entirely gap-driven, simulating the worklet missing soft tongues.
    const onsets = [1.50];
    const notes = segmentNotes(readings, onsets, 2.8);

    expect(notes).toHaveLength(3);
    expect(notes.map((n) => n.midi)).toEqual([53, 53, 53]);
    expect(notes[0].onsetTime).toBeCloseTo(1.50, 2);
    expect(notes[1].onsetTime).toBeCloseTo(1.6667, 2);
    expect(notes[2].onsetTime).toBeCloseTo(2.2667, 2);
});

it('does NOT split same-MIDI run on small clarity blips (< gap threshold)', () => {
    // Single F3 sustain with a 33ms blip (typical sustain noise) — should NOT split.
    const readings: PitchReading[] = [
        makeReading(53, 1.50),
        makeReading(53, 1.5167),
        makeReading(53, 1.5333),
        makeReading(53, 1.55),
        // 33ms blip — too short to count as articulation
        makeReading(53, 1.5833),
        makeReading(53, 1.60),
        makeReading(53, 1.65),
        makeReading(53, 1.70)
    ];
    const notes = segmentNotes(readings, [1.50], 1.8);

    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(53);
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```sh
npx vitest run tests/unit/scoring/note-segmenter.test.ts
```

Expected: the new "splits same-MIDI re-articulations" case fails (`Expected length: 3, Received length: 1`). The "does NOT split" case passes (current behavior — no splitting).

- [ ] **Step 1.3: Implement `splitOnReadingGaps` and wire into the pipeline**

Add to `src/lib/audio/note-segmenter.ts`, after `mergeConsecutiveSameMidi` (around line 322):

```typescript
/**
 * Minimum reading gap that signals a re-articulation of the same pitch.
 * Pitchy emits at ~60fps (16.67ms intervals); a 60ms gap = 4 missed frames,
 * which is much longer than typical sustain-noise dropouts (1–2 frames) and
 * matches the clarity-dropout signature of soft tongue attacks that the
 * audio worklet doesn't catch.
 */
const READING_GAP_SPLIT_THRESHOLD = 0.06;

/**
 * Split same-MIDI sub-segments on internal reading gaps. A clarity-driven
 * gap of >= READING_GAP_SPLIT_THRESHOLD inside a sub-segment signals a
 * soft re-articulation that the HFC onset worklet missed.
 */
function splitOnReadingGaps(
    subs: SubSegment[],
    threshold: number = READING_GAP_SPLIT_THRESHOLD
): SubSegment[] {
    const result: SubSegment[] = [];
    for (const sub of subs) {
        if (sub.readings.length < 2) {
            result.push(sub);
            continue;
        }
        let curStart = sub.start;
        let curStartIdx = 0;
        for (let i = 1; i < sub.readings.length; i++) {
            const gap = sub.readings[i].time - sub.readings[i - 1].time;
            if (gap >= threshold) {
                result.push({
                    start: curStart,
                    end: sub.readings[i].time,
                    readings: sub.readings.slice(curStartIdx, i),
                    primaryMidi: sub.primaryMidi
                });
                curStart = sub.readings[i].time;
                curStartIdx = i;
            }
        }
        result.push({
            start: curStart,
            end: sub.end,
            readings: sub.readings.slice(curStartIdx),
            primaryMidi: sub.primaryMidi
        });
    }
    return result;
}
```

Then change the return statement in `splitByPitchChange` (line 213) from:

```typescript
return mergeConsecutiveSameMidi(collapseOctaveArtifacts(subs));
```

to:

```typescript
return splitOnReadingGaps(mergeConsecutiveSameMidi(collapseOctaveArtifacts(subs)));
```

- [ ] **Step 1.4: Run tests to verify both pass**

```sh
npx vitest run tests/unit/scoring/note-segmenter.test.ts
```

Expected: both new tests pass. All existing tests in the file still pass. No new failures.

- [ ] **Step 1.5: Run the full unit-test suite to catch regressions**

```sh
npm test
```

Expected: full suite passes. If any other test broke, the gap threshold or the wiring needs adjustment — investigate before proceeding.

- [ ] **Step 1.6: Commit**

```sh
git add src/lib/audio/note-segmenter.ts tests/unit/scoring/note-segmenter.test.ts
git commit -m "$(cat <<'EOF'
fix(segmenter): split same-pitch re-articulations on reading gaps

Soft tongue attacks on a sustained note don't produce strong HFC peaks,
so the audio worklet often misses them. Without a same-pitch boundary,
multiple re-articulations were merged into one note. Use the
clarity-dropout gap (≥60ms between consecutive readings of the same
MIDI) as a boundary signal.
EOF
)"
```

---

## Task 2: Fix #1 — Collapse octave artifacts across stable-run starts

**Files:**
- Modify: `src/lib/audio/note-segmenter.ts:506-535` (`findStableRunStarts`)
- Test: `tests/unit/scoring/note-segmenter.test.ts`

**Strategy:** Refactor `findStableRunStarts` to track each stable run as `{midi, startIdx}` instead of just emitting timestamps. Then after the walk, drop any run that is exactly ±12 from the next run AND shorter than it. This is the same logic as `collapseOctaveArtifacts` (line 253) but applied to stable-run starts before they become onsets, so the octave-glitched portion of a note attack never gets promoted to its own segment.

**Test approach:** Direct test of `resolveOnsets` (exported), constructed so worklet onsets are empty (or only valid after the octave artifact). The phantom run, if not collapsed, would appear as a pre-onset.

- [ ] **Step 2.1: Write the failing test**

Add to `tests/unit/scoring/note-segmenter.test.ts`. (Add an import for `resolveOnsets` at the top if not present: `import { segmentNotes, resolveOnsets } from '$lib/audio/note-segmenter';`)

```typescript
describe('resolveOnsets — octave-artifact collapse for pre-onset stable runs', () => {
    it('drops a brief ±12 stable run preceding a longer one (D4 attack glitch)', () => {
        // Mimics the Locrian-Descent fixture: F4 sustained, then 4 frames of
        // D3 (Pitchy octave-half glitch at D4 attack) followed by sustained D4.
        // The D3 portion has only 4 frames (~67ms) — shorter than D4 — and
        // is exactly 12 semitones below D4. Should collapse, not produce
        // a phantom onset.
        const readings: PitchReading[] = [
            // F4 sustained (10 frames)
            makeReading(65, 0.083), makeReading(65, 0.10), makeReading(65, 0.117),
            makeReading(65, 0.133), makeReading(65, 0.15), makeReading(65, 0.167),
            makeReading(65, 0.20), makeReading(65, 0.25), makeReading(65, 0.28), makeReading(65, 0.30),
            // D3 octave-glitch (4 frames, 67ms)
            makeReading(50, 0.383), makeReading(50, 0.40), makeReading(50, 0.417), makeReading(50, 0.433),
            // D4 sustained (8 frames)
            makeReading(62, 0.45), makeReading(62, 0.467), makeReading(62, 0.483),
            makeReading(62, 0.50), makeReading(62, 0.517), makeReading(62, 0.533),
            makeReading(62, 0.55), makeReading(62, 0.567)
        ];
        // Worklet found nothing in the pre-onset region, then a real onset later.
        const workletOnsets = [1.0];
        const resolved = resolveOnsets(workletOnsets, readings);

        // Expect: F4 stable start, D4 stable start, and the worklet onset.
        // The D3 phantom must NOT appear.
        const preOnsetStarts = resolved.filter((t) => t < 1.0);
        expect(preOnsetStarts).toHaveLength(2);
        expect(preOnsetStarts[0]).toBeCloseTo(0.083, 2); // F4
        expect(preOnsetStarts[1]).toBeCloseTo(0.45, 2);  // D4 (NOT 0.383)
    });

    it('keeps a ±12 stable run when it is the longer one (genuine octave change)', () => {
        // Inverse case: a SHORT F4 attack glitch followed by a LONG F3 sustain.
        // We do NOT want to collapse because the longer run IS the real note,
        // and dropping the shorter one is correct behavior (already handled).
        // This is a sanity-check that the rule is "drop the shorter of the
        // ±12 pair", not "drop the second one".
        const readings: PitchReading[] = [
            // Brief F4 (3 frames, 33ms) — attack-transient glitch
            makeReading(65, 0.0), makeReading(65, 0.0167), makeReading(65, 0.0333),
            // Long F3 sustain (12 frames)
            makeReading(53, 0.05), makeReading(53, 0.067), makeReading(53, 0.083),
            makeReading(53, 0.10), makeReading(53, 0.117), makeReading(53, 0.133),
            makeReading(53, 0.15), makeReading(53, 0.167), makeReading(53, 0.183),
            makeReading(53, 0.20), makeReading(53, 0.217), makeReading(53, 0.233)
        ];
        const resolved = resolveOnsets([1.0], readings);
        const preOnsetStarts = resolved.filter((t) => t < 1.0);

        // Only F3 should remain — the brief F4 collapses into it.
        expect(preOnsetStarts).toHaveLength(1);
        expect(preOnsetStarts[0]).toBeCloseTo(0.05, 2);
    });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

```sh
npx vitest run tests/unit/scoring/note-segmenter.test.ts -t "octave-artifact collapse"
```

Expected: first test fails (length 3, not 2 — phantom D3 onset present). Second test may pass or fail depending on existing behavior — the assertion is the goal regardless.

- [ ] **Step 2.3: Refactor `findStableRunStarts` to track run lengths and add octave collapse**

Replace the existing `findStableRunStarts` function (`note-segmenter.ts:506-535`) with:

```typescript
/**
 * Find the start time of every stable pitch run in a sequence of readings.
 * A "stable run" is `minHold` consecutive frames at the same MIDI note.
 * Warmup readings are skipped because the McLeod attack subharmonic can
 * dominate the warmup mode pick and seed a ghost run one octave below
 * the actual note.
 *
 * Cross-run octave-artifact collapse: if a stable run is exactly ±12
 * semitones from the next stable run AND shorter than it, drop it.
 * This handles the case where Pitchy's octave stabilizer locks onto
 * the half-frequency for a few frames at a note attack before settling
 * on the true fundamental — without the collapse, those 3-4 glitch
 * frames would seed their own pre-onset and split the real note in two.
 */
function findStableRunStarts(
    readings: PitchReading[],
    minHold: number = PITCH_CHANGE_MIN_HOLD
): number[] {
    const filtered = readings.filter((r) => !r.warmup);
    if (filtered.length < minHold) return [];

    // Phase 1: walk and collect stable runs as { midi, startIdx, endIdx }.
    type Run = { midi: number; startIdx: number; endIdx: number };
    const runs: Run[] = [];
    let runMidi: number | null = null;
    let runCount = 0;
    let runStartIdx = 0;
    let stableMidi: number | null = null;
    let stableStartIdx = 0;

    for (let i = 0; i < filtered.length; i++) {
        const m = filtered[i].midi;
        if (m === runMidi) {
            runCount++;
        } else {
            runMidi = m;
            runCount = 1;
            runStartIdx = i;
        }

        if (runCount === minHold && runMidi !== stableMidi) {
            if (stableMidi !== null) {
                runs.push({ midi: stableMidi, startIdx: stableStartIdx, endIdx: runStartIdx - 1 });
            }
            stableMidi = runMidi;
            stableStartIdx = runStartIdx;
        }
    }
    if (stableMidi !== null) {
        runs.push({ midi: stableMidi, startIdx: stableStartIdx, endIdx: filtered.length - 1 });
    }

    // Phase 2: collapse cross-run octave artifacts. If run[i] is exactly
    // ±12 from run[i+1] AND shorter, it's a McLeod-method octave glitch
    // at the next note's attack — drop it.
    const collapsed: Run[] = [];
    for (let i = 0; i < runs.length; i++) {
        const cur = runs[i];
        const next = runs[i + 1];
        const curLen = cur.endIdx - cur.startIdx + 1;
        if (next) {
            const nextLen = next.endIdx - next.startIdx + 1;
            if (Math.abs(cur.midi - next.midi) === 12 && curLen < nextLen) {
                continue; // drop cur — it is the octave glitch on next's attack
            }
        }
        collapsed.push(cur);
    }

    return collapsed.map((r) => filtered[r.startIdx].time);
}
```

Note: this preserves the warmup-filter and minHold-walking semantics of the original. The only behavior change is the post-walk octave collapse.

- [ ] **Step 2.4: Run the new tests to verify they pass**

```sh
npx vitest run tests/unit/scoring/note-segmenter.test.ts -t "octave-artifact collapse"
```

Expected: both pass.

- [ ] **Step 2.5: Run the full segmenter test file to catch regressions**

```sh
npx vitest run tests/unit/scoring/note-segmenter.test.ts
```

Expected: all existing tests still pass. The Task 1 tests still pass.

- [ ] **Step 2.6: Run the full unit-test suite**

```sh
npm test
```

Expected: full suite passes.

- [ ] **Step 2.7: Commit**

```sh
git add src/lib/audio/note-segmenter.ts tests/unit/scoring/note-segmenter.test.ts
git commit -m "$(cat <<'EOF'
fix(segmenter): collapse cross-run octave artifacts in pre-onset stable runs

Pitchy's McLeod method can return the half-frequency for 3-4 frames at
the start of a note's attack before the octave stabilizer locks on.
findStableRunStarts was promoting both the brief glitch run and the real
run to onsets, splitting one note into two segments — the real note
got matched against the wrong expected slot in DTW. The existing
collapseOctaveArtifacts handles this within a segment but never sees the
pre-onset case. Apply the same rule (drop shorter ±12 neighbor) to the
stable-run list before returning onsets.
EOF
)"
```

---

## Task 3: Fix #2 — Detect brief stable runs flanked by clarity gaps

**Files:**
- Modify: `src/lib/audio/note-segmenter.ts` (`findStableRunStarts` from Task 2)
- Test: `tests/unit/scoring/note-segmenter.test.ts`

**Strategy:** Lower the minimum hold from 3 to 2 *only when* the candidate run is flanked by clarity-dropout gaps on both sides. Gaps indicate the player moved through a transient pitch fast — a brief but real note. A 2-frame run in mid-sustain (no flanking gaps) stays rejected, so this doesn't reintroduce the glitch-noise that the 3-frame minimum was added to suppress.

**Threshold rationale:** The same 50ms gap threshold used elsewhere in the file (`extractOnsetsFromReadings:435` uses 100ms; `splitByPitchChange` uses 3 frames ≈ 50ms). 50ms is well above normal frame spacing (16.67ms) but smaller than `READING_GAP_SPLIT_THRESHOLD` (60ms) so we don't over-trigger on long re-articulation gaps that Fix #3 already handles.

- [ ] **Step 3.1: Write the failing test**

Add to `tests/unit/scoring/note-segmenter.test.ts`:

```typescript
describe('resolveOnsets — gap-flanked brief stable runs', () => {
    it('accepts a 2-frame stable run flanked by clarity gaps as a real note', () => {
        // Mimics the Locrian-Descent A3: C4 sustained, gap (~67ms), 2 frames
        // of A3, gap (~183ms), G3 sustained. The A3 is real but Pitchy
        // dropped most of its frames below clarity threshold.
        const readings: PitchReading[] = [
            // C4 sustained (8 frames)
            makeReading(60, 0.617), makeReading(60, 0.633), makeReading(60, 0.65),
            makeReading(60, 0.667), makeReading(60, 0.70), makeReading(60, 0.75),
            makeReading(60, 0.80), makeReading(60, 0.883),
            // Gap of 67ms (clarity dropout) — then 2 frames of A3
            makeReading(57, 0.95), makeReading(57, 0.967),
            // Gap of 183ms — then G3 sustained
            makeReading(55, 1.15), makeReading(55, 1.167), makeReading(55, 1.183),
            makeReading(55, 1.20), makeReading(55, 1.25), makeReading(55, 1.30)
        ];
        const resolved = resolveOnsets([2.0], readings); // worklet onset way later

        const preOnsetStarts = resolved.filter((t) => t < 2.0);
        // Expect 3 stable starts: C4, A3, G3 — the A3 must appear.
        expect(preOnsetStarts).toHaveLength(3);
        expect(preOnsetStarts[0]).toBeCloseTo(0.617, 2);
        expect(preOnsetStarts[1]).toBeCloseTo(0.95, 2);
        expect(preOnsetStarts[2]).toBeCloseTo(1.15, 2);
    });

    it('rejects a 2-frame run NOT flanked by gaps (suppresses sustain glitches)', () => {
        // Mimics a fast vibrato or detector wobble: F4 sustained with a brief
        // 2-frame F#4 in the middle, no surrounding gaps. Must NOT promote.
        const readings: PitchReading[] = [
            // F4 sustained
            makeReading(65, 0.0), makeReading(65, 0.0167), makeReading(65, 0.0333),
            makeReading(65, 0.05), makeReading(65, 0.067),
            // 2 frames of F#4 — wobble, no gaps
            makeReading(66, 0.083), makeReading(66, 0.10),
            // Back to F4
            makeReading(65, 0.117), makeReading(65, 0.133), makeReading(65, 0.15),
            makeReading(65, 0.167), makeReading(65, 0.183), makeReading(65, 0.20)
        ];
        const resolved = resolveOnsets([1.0], readings);
        const preOnsetStarts = resolved.filter((t) => t < 1.0);

        // Only F4 should be a stable start — the F#4 wobble does NOT promote.
        expect(preOnsetStarts).toHaveLength(1);
        expect(preOnsetStarts[0]).toBeCloseTo(0.0, 2);
    });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```sh
npx vitest run tests/unit/scoring/note-segmenter.test.ts -t "gap-flanked brief"
```

Expected: first test fails (length 2, not 3 — A3 missing). Second test passes (current minHold=3 already rejects 2-frame runs).

- [ ] **Step 3.3: Extend `findStableRunStarts` to accept gap-flanked short runs**

In `note-segmenter.ts`, near the top of the file with the other constants (around line 144), add:

```typescript
/**
 * Minimum frames for a stable run that is flanked by clarity-dropout gaps
 * on both sides. Real but brief notes (transient pitches during fast
 * lines) often only register 2 frames before the detector loses
 * confidence. The flanking-gap context distinguishes these from
 * mid-sustain glitches, which never have gaps around them.
 */
const EPHEMERAL_RUN_MIN_HOLD = 2;

/** Minimum frame-to-frame gap that flags a clarity dropout. ~3 frames at 60fps. */
const EPHEMERAL_FLANKING_GAP = 0.05;
```

Then replace the `findStableRunStarts` function (the version installed in Task 2) with:

```typescript
function findStableRunStarts(
    readings: PitchReading[],
    minHold: number = PITCH_CHANGE_MIN_HOLD
): number[] {
    const filtered = readings.filter((r) => !r.warmup);
    if (filtered.length < EPHEMERAL_RUN_MIN_HOLD) return [];

    // Phase 1: collect every contiguous run of length >= EPHEMERAL_RUN_MIN_HOLD.
    type Run = { midi: number; startIdx: number; endIdx: number };
    const candidates: Run[] = [];
    let curStart = 0;
    for (let i = 1; i <= filtered.length; i++) {
        const isBoundary = i === filtered.length || filtered[i].midi !== filtered[curStart].midi;
        if (isBoundary) {
            const length = i - curStart;
            if (length >= EPHEMERAL_RUN_MIN_HOLD) {
                candidates.push({ midi: filtered[curStart].midi, startIdx: curStart, endIdx: i - 1 });
            }
            curStart = i;
        }
    }

    // Phase 2: keep runs of length >= minHold; for shorter runs (>=
    // EPHEMERAL_RUN_MIN_HOLD), require a clarity-dropout gap on BOTH sides
    // — a real but brief note registers 2 frames between two pitch-detection
    // gaps, while sustain-noise glitches sit in the middle of a continuous
    // reading stream.
    const accepted: Run[] = [];
    for (const cur of candidates) {
        const length = cur.endIdx - cur.startIdx + 1;
        if (length >= minHold) {
            accepted.push(cur);
            continue;
        }
        const gapBefore =
            cur.startIdx > 0
                ? filtered[cur.startIdx].time - filtered[cur.startIdx - 1].time
                : Infinity;
        const gapAfter =
            cur.endIdx < filtered.length - 1
                ? filtered[cur.endIdx + 1].time - filtered[cur.endIdx].time
                : Infinity;
        if (gapBefore >= EPHEMERAL_FLANKING_GAP && gapAfter >= EPHEMERAL_FLANKING_GAP) {
            accepted.push(cur);
        }
    }

    // Phase 3: dedup consecutive same-MIDI runs (only emit on MIDI change).
    const dedup: Run[] = [];
    let lastMidi: number | null = null;
    for (const run of accepted) {
        if (run.midi !== lastMidi) {
            dedup.push(run);
            lastMidi = run.midi;
        }
    }

    // Phase 4: collapse cross-run octave artifacts (Fix #1, preserved).
    const collapsed: Run[] = [];
    for (let i = 0; i < dedup.length; i++) {
        const cur = dedup[i];
        const next = dedup[i + 1];
        const curLen = cur.endIdx - cur.startIdx + 1;
        if (next) {
            const nextLen = next.endIdx - next.startIdx + 1;
            if (Math.abs(cur.midi - next.midi) === 12 && curLen < nextLen) {
                continue;
            }
        }
        collapsed.push(cur);
    }

    return collapsed.map((r) => filtered[r.startIdx].time);
}
```

- [ ] **Step 3.4: Run the new tests to verify they pass**

```sh
npx vitest run tests/unit/scoring/note-segmenter.test.ts -t "gap-flanked brief"
```

Expected: both pass.

- [ ] **Step 3.5: Run the full segmenter test file**

```sh
npx vitest run tests/unit/scoring/note-segmenter.test.ts
```

Expected: every test in the file passes — including the Fix #1 octave-artifact tests from Task 2 (Phase 4 still does the collapse).

- [ ] **Step 3.6: Run the full unit-test suite**

```sh
npm test
```

Expected: full suite passes.

- [ ] **Step 3.7: Commit**

```sh
git add src/lib/audio/note-segmenter.ts tests/unit/scoring/note-segmenter.test.ts
git commit -m "$(cat <<'EOF'
fix(segmenter): accept 2-frame stable runs when flanked by clarity gaps

Brief but real notes (transients during fast lines) often register only
2 confident pitch frames before the detector loses clarity. The 3-frame
minimum was suppressing these along with sustain-noise glitches. Use the
flanking-gap context to distinguish: real brief notes sit between two
clarity dropouts; sustain wobbles sit in the middle of a continuous
reading stream. The mid-sustain wobble case stays rejected.
EOF
)"
```

---

## Task 4: Integration check against the saved Locrian Descent recording

**Files:**
- Create: `tests/fixtures/segmenter/2026-05-07-locrian-descent.json`
- Create: `tests/integration/segmenter-locrian-descent.test.ts`

**Strategy:** Load the saved diagnostics JSON (which already contains the full pitch-reading stream and the worklet onsets), run `resolveOnsets` + `segmentNotes` end-to-end, and assert the segmented output matches what the player actually played: 8 notes with MIDIs `[F4, D4, C4, A3, G3, F3, F3, F3]`. Also assert the score, when run through `runScorePipeline`, lands in the expected ~73% range.

This is the test that proves all three fixes compose correctly on real-world data.

- [ ] **Step 4.1: Copy the fixture JSON into the repo**

```sh
mkdir -p tests/fixtures/segmenter
cp /Users/avitus/Downloads/2026-05-07-locrian-descent.json tests/fixtures/segmenter/2026-05-07-locrian-descent.json
```

Verify the file is committable (it's already a JSON dump, no secrets):

```sh
ls -la tests/fixtures/segmenter/2026-05-07-locrian-descent.json
```

Expected: ~36 KB file present.

- [ ] **Step 4.2: Write the failing integration test**

Create `tests/integration/segmenter-locrian-descent.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOnsets, segmentNotes } from '$lib/audio/note-segmenter';
import { runScorePipeline } from '$lib/scoring/score-pipeline';
import type { PitchReading } from '$lib/audio/pitch-detector';
import type { Phrase } from '$lib/types/music';

const FIXTURE_PATH = join(
    __dirname,
    '../fixtures/segmenter/2026-05-07-locrian-descent.json'
);

interface DiagnosticsExport {
    audio: { duration: number; sampleRate: number };
    context: { tempo: number; swing: number };
    detection: { rawWorkletOnsets: number[]; readings: PitchReading[] };
    scoring: { savedScore: { noteResults: Array<{ expected: { pitch: number; duration: [number, number]; offset: [number, number] } }> } };
}

describe('segmenter integration: Locrian Descent (2026-05-07)', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as DiagnosticsExport;
    const { readings, rawWorkletOnsets } = fixture.detection;

    it('segments the recording into 8 notes matching what the player actually played', () => {
        const onsets = resolveOnsets(rawWorkletOnsets, readings);
        const notes = segmentNotes(readings, onsets, fixture.audio.duration);

        // Ground truth from the player: F D C A G F F F (8 notes).
        // MIDI: [65, 62, 60, 57, 55, 53, 53, 53].
        expect(notes.map((n) => n.midi)).toEqual([65, 62, 60, 57, 55, 53, 53, 53]);

        // First F at t≈0.083, A3 at t≈0.95, first F3 at t≈1.5,
        // last F3 attack at t≈2.27 (within 50ms tolerance).
        expect(notes[0].onsetTime).toBeCloseTo(0.083, 2);
        expect(notes[3].onsetTime).toBeCloseTo(0.95, 1);
        expect(notes[5].onsetTime).toBeCloseTo(1.5, 2);
        expect(notes[7].onsetTime).toBeGreaterThan(2.20);
        expect(notes[7].onsetTime).toBeLessThan(2.32);
    });

    it('scores the recording in the expected post-fix range (≈73%)', () => {
        const onsets = resolveOnsets(rawWorkletOnsets, readings);
        const detected = segmentNotes(readings, onsets, fixture.audio.duration);

        // Reconstruct the phrase from saved noteResults — the JSON does not
        // store the Phrase object directly, so we rebuild it from the
        // expected-pitch list. timeSignature is 4/4 (default for the lick
        // library), all durations are 1/8.
        const expected = fixture.scoring.savedScore.noteResults.map((nr) => ({
            pitch: nr.expected.pitch,
            duration: nr.expected.duration,
            offset: nr.expected.offset
        }));
        const phrase: Phrase = {
            id: 'fixture',
            name: 'Locrian Descent',
            timeSignature: [4, 4],
            key: 'F',
            notes: expected,
            harmony: [],
            difficulty: { level: 20, pitchComplexity: 18, rhythmComplexity: 18, lengthBars: 1 },
            category: 'diminished-chord',
            tags: [],
            source: 'curated'
        };

        // transportSeconds derived from the saved alignment: gridAligned
        // shift was -0.964s in the saved score, so transportSeconds passed
        // to the scorer at recording start was -0.964 (or equivalent).
        // Use the same so we replay the exact alignment context.
        const result = runScorePipeline({
            detected,
            phrase,
            tempo: fixture.context.tempo,
            transportSeconds: -0.964,
            swing: fixture.context.swing,
            bleedFilterEnabled: false,
            octaveInsensitive: false
        });

        // Saved score was 0.494. With all three fixes the player gets:
        // 5/8 pitch matches via DTW (in-order with three mismatches), and
        // rhythm aligns much better with the 8 well-distributed onsets.
        // Target: 0.65-0.78 (allows for DTW tie-break variation).
        expect(result.chosen.overall).toBeGreaterThan(0.65);
        expect(result.chosen.overall).toBeLessThan(0.78);
        expect(result.chosen.notesHit).toBeGreaterThanOrEqual(5);
    });
});
```

- [ ] **Step 4.3: Run the integration test**

```sh
npx vitest run tests/integration/segmenter-locrian-descent.test.ts
```

Expected: both assertions pass. `notes.map(n => n.midi)` should produce `[65, 62, 60, 57, 55, 53, 53, 53]`. The score should land between 0.65 and 0.78.

If either assertion fails, do NOT loosen the assertion. Investigate which fix isn't producing the expected output:
- Wrong MIDI sequence with extra entry → Fix #1 didn't collapse the D3 phantom.
- Missing 57 (A3) → Fix #2 didn't pick up the gap-flanked A3.
- Wrong number of trailing 53s → Fix #3 didn't split the F3 sustain.

- [ ] **Step 4.4: Run the full test suite to confirm no regressions**

```sh
npm test && npm run check
```

Expected: full suite passes, no type errors.

- [ ] **Step 4.5: Commit**

```sh
git add tests/fixtures/segmenter/2026-05-07-locrian-descent.json tests/integration/segmenter-locrian-descent.test.ts
git commit -m "$(cat <<'EOF'
test(segmenter): integration check against Locrian Descent recording

End-to-end verification that the three independent segmenter fixes
(Tasks 1-3) compose correctly on a real recording. Asserts the
player's 8-note performance is recovered from the audio and the
score moves from 49% (saved) to the post-fix ~73% range.
EOF
)"
```

---

## Self-review

- **Spec coverage:** All three fixes from the user's spec are addressed (Task 1 = re-articulation merge, Task 2 = octave artifact, Task 3 = sub-clarity-threshold note). Task 4 verifies on real data. ✓
- **Placeholder scan:** No "TBD"/"implement later"/"appropriate handling" placeholders. Each step contains the actual code or command. ✓
- **Type consistency:** `Run` type defined in Tasks 2 and 3 has matching shape (`{midi, startIdx, endIdx}`). `SubSegment` (existing) is used unchanged in Task 1. `splitOnReadingGaps` signature matches the call site. ✓
- **Cross-task interaction:** Task 2's `findStableRunStarts` is fully replaced by Task 3's version (Task 3 preserves Task 2's Phase 4 octave-collapse logic verbatim). Documented in Task 3's strategy paragraph. ✓
