# Decouple Score Pipeline from Audio Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all audio-layer imports from `src/lib/scoring/score-pipeline.ts` so the scoring module is a pure function over data — no dependency on `$lib/audio/*`.

**Architecture:** Move `extractOnsetsFromReadings` and `resolveOnsets` into `src/lib/audio/note-segmenter.ts` (where `validateOnsets` and `segmentNotes` already live). Change `runScorePipeline` to accept `DetectedNote[]` and an optional `BleedFilterResult` instead of raw readings/onsets/schedule. Callers do all audio preprocessing before calling the pipeline.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Move onset functions to note-segmenter

**Files:**
- Modify: `src/lib/audio/note-segmenter.ts`
- Modify: `src/lib/scoring/score-pipeline.ts`

- [ ] **Step 1: Copy `extractOnsetsFromReadings` and `resolveOnsets` to note-segmenter**

Add these two functions at the end of `src/lib/audio/note-segmenter.ts`, after the existing `segmentNotes` function. They depend on `validateOnsets` which is already in the same file, so the import becomes a local call.

```typescript
/**
 * Fallback onset extractor: infer onsets from gaps and pitch changes in
 * readings when the AudioWorklet produced nothing useful.
 */
export function extractOnsetsFromReadings(readings: PitchReading[]): number[] {
	if (readings.length === 0) return [];
	const onsets: number[] = [readings[0].time];
	const GAP_THRESHOLD = 0.1;
	const MIN_ONSET_INTERVAL = 0.08;
	const ATTACK_LATENCY = 0.05;
	for (let i = 1; i < readings.length; i++) {
		const timeSinceLastOnset = readings[i].time - onsets[onsets.length - 1];
		if (timeSinceLastOnset < MIN_ONSET_INTERVAL) continue;
		const gap = readings[i].time - readings[i - 1].time;
		const noteChanged = readings[i].midi !== readings[i - 1].midi;
		if (gap > GAP_THRESHOLD) {
			onsets.push(readings[i].time - ATTACK_LATENCY);
		} else if (noteChanged) {
			onsets.push(readings[i].time);
		}
	}
	return onsets;
}

/** Max backward search window (seconds) for the synthesized-onset anchor */
const PREPEND_BACKWARD_WINDOW = 0.5;
/** Only prepend when the gap between anchor and first onset is meaningful */
const PREPEND_MIN_GAP = 0.05;

/**
 * Resolve the final onset list for segmentation. Worklet onsets are
 * validated against pitch data; if nothing survives, fall back to
 * reading-derived onsets; finally, synthesize an opening onset when the
 * live capture missed the first note.
 */
export function resolveOnsets(
	workletOnsets: number[],
	readings: PitchReading[]
): number[] {
	const validated = validateOnsets(workletOnsets, readings);
	let onsets = validated.length > 0 ? validated : extractOnsetsFromReadings(readings);

	if (readings.length === 0 || onsets.length === 0) return onsets;

	const firstOnset = onsets[0];
	let anchor = -1;
	for (const r of readings) {
		if (r.time >= firstOnset) break;
		if (firstOnset - r.time <= PREPEND_BACKWARD_WINDOW) {
			anchor = r.time;
			break;
		}
	}

	if (anchor >= 0 && firstOnset - anchor > PREPEND_MIN_GAP) {
		onsets = [anchor, ...onsets];
	}
	return onsets;
}
```

- [ ] **Step 2: Remove `extractOnsetsFromReadings`, `resolveOnsets`, and their constants from score-pipeline.ts**

Delete lines 62–125 of `src/lib/scoring/score-pipeline.ts` (the `extractOnsetsFromReadings` function, `PREPEND_BACKWARD_WINDOW`, `PREPEND_MIN_GAP` constants, and `resolveOnsets` function). Also remove the `validateOnsets` and `segmentNotes` imports from line 21.

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `npm test`
Expected: All 1405 tests pass. The score-pipeline tests will fail because they still import `extractOnsetsFromReadings` and `resolveOnsets` from `score-pipeline` — that's expected and fixed in Task 3.

- [ ] **Step 4: Commit**

```bash
git add src/lib/audio/note-segmenter.ts src/lib/scoring/score-pipeline.ts
git commit -m "refactor: move onset functions from score-pipeline to note-segmenter"
```

---

### Task 2: Change `runScorePipeline` to accept preprocessed data

**Files:**
- Modify: `src/lib/scoring/score-pipeline.ts`

- [ ] **Step 1: Update `ScorePipelineInputs` interface**

Replace the current interface with one that accepts preprocessed data. Remove `readings`, `workletOnsets`, `phraseDuration`, `schedule`. Add `detected` and `bleedResult`.

```typescript
export interface ScorePipelineInputs {
	detected: DetectedNote[];
	phrase: Phrase;
	tempo: number;
	transportSeconds: number;
	swing: number;
	bleedFilterEnabled: boolean;
	/** Pre-computed bleed filter result. When present, a filtered score is also computed. */
	bleedResult?: { kept: DetectedNote[]; filtered: DetectedNote[] } | null;
	octaveInsensitive?: boolean;
}
```

- [ ] **Step 2: Rewrite `runScorePipeline` to use preprocessed inputs**

The function no longer calls `resolveOnsets`, `segmentNotes`, or `filterBleed`. It receives `detected` notes directly and an optional `bleedResult`.

```typescript
export function runScorePipeline(inputs: ScorePipelineInputs): ScorePipelineResult {
	const {
		detected,
		phrase,
		tempo,
		transportSeconds,
		swing,
		bleedFilterEnabled,
		bleedResult,
		octaveInsensitive = false
	} = inputs;

	const unfilteredScore = scoreAttempt(
		phrase, detected, tempo, transportSeconds, swing, octaveInsensitive
	);

	let filteredScore: Score | null = null;
	let filteredNotes: DetectedNote[] = detected;
	let bleedLog: BleedFilterLog | null = null;

	if (bleedResult) {
		filteredNotes = bleedResult.kept;
		filteredScore = scoreAttempt(
			phrase, filteredNotes, tempo, transportSeconds, swing, octaveInsensitive
		);
		bleedLog = {
			totalNotes: detected.length,
			keptNotes: bleedResult.kept.length,
			filteredNotes: bleedResult.filtered,
			unfilteredScore,
			filteredScore
		};
	}

	const useFiltered = bleedFilterEnabled && filteredScore != null;
	const chosen = useFiltered ? (filteredScore as Score) : unfilteredScore;

	return {
		detected, filteredNotes, unfilteredScore, filteredScore,
		chosen, useFiltered, bleedLog
	};
}
```

- [ ] **Step 3: Remove all audio-layer imports**

Remove these lines from score-pipeline.ts (they should be the only remaining audio imports):
```typescript
import type { PitchReading } from '$lib/audio/pitch-detector';
import type { BackingTrackSchedule } from '$lib/audio/backing-track-schedule';
import { segmentNotes, validateOnsets } from '$lib/audio/note-segmenter';
import { filterBleed } from '$lib/audio/bleed-filter';
```

The only imports remaining should be:
```typescript
import type { Phrase } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';
import type { Score, BleedFilterLog } from '$lib/types/scoring';
import { scoreAttempt } from './scorer';
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/scoring/score-pipeline.ts
git commit -m "refactor: score-pipeline accepts preprocessed DetectedNote[]"
```

---

### Task 3: Update tests for the new interface

**Files:**
- Modify: `tests/unit/scoring/score-pipeline.test.ts`

- [ ] **Step 1: Remove audio mocks and update imports**

Remove the `vi.mock('$lib/audio/note-segmenter')` and `vi.mock('$lib/audio/bleed-filter')` blocks (lines 3–12). Keep the scorer mock.

Update imports: remove `validateOnsets`, `segmentNotes`, `filterBleed` imports. Import `extractOnsetsFromReadings` and `resolveOnsets` from `$lib/audio/note-segmenter` instead of `$lib/scoring/score-pipeline`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock scorer
vi.mock('$lib/scoring/scorer', () => ({
	scoreAttempt: vi.fn(() => ({
		overall: 0.85,
		pitchAccuracy: 0.90,
		rhythmAccuracy: 0.78,
		grade: 'great' as const,
		noteResults: [],
		notesHit: 1,
		notesTotal: 1,
		timing: {
			meanOffsetMs: 0,
			medianOffsetMs: 0,
			stdDevMs: 0,
			latencyCorrectionMs: 0,
			perNoteOffsetMs: [],
		},
	})),
}));

import {
	runScorePipeline,
} from '$lib/scoring/score-pipeline';
import type { ScorePipelineInputs } from '$lib/scoring/score-pipeline';
import {
	extractOnsetsFromReadings,
	resolveOnsets,
} from '$lib/audio/note-segmenter';
import { scoreAttempt } from '$lib/scoring/scorer';
import type { PitchReading } from '$lib/audio/pitch-detector';
import type { DetectedNote } from '$lib/types/audio';
import type { Phrase } from '$lib/types/music';
```

- [ ] **Step 2: Update `makePipelineInputs` helper**

Replace the helper to match the new `ScorePipelineInputs`:

```typescript
function makePipelineInputs(overrides: Partial<ScorePipelineInputs> = {}): ScorePipelineInputs {
	return {
		detected: [],
		phrase: minimalPhrase,
		tempo: 120,
		transportSeconds: 0,
		swing: 0.5,
		bleedFilterEnabled: false,
		...overrides,
	};
}
```

- [ ] **Step 3: Rewrite `runScorePipeline` tests**

The `extractOnsetsFromReadings` and `resolveOnsets` test blocks stay unchanged — they test the same functions, just imported from a different path.

The `runScorePipeline` tests need updating because the function no longer calls `validateOnsets`/`segmentNotes`/`filterBleed`. Replace the `runScorePipeline` describe block:

```typescript
describe('runScorePipeline', () => {
	const mockDetected: DetectedNote[] = [
		{ midi: 60, cents: 0, onsetTime: 0, duration: 0.5, clarity: 0.95 },
	];

	const mockScore = {
		overall: 0.85,
		pitchAccuracy: 0.90,
		rhythmAccuracy: 0.78,
		grade: 'great' as const,
		noteResults: [],
		notesHit: 1,
		notesTotal: 1,
		timing: {
			meanOffsetMs: 0,
			medianOffsetMs: 0,
			stdDevMs: 0,
			latencyCorrectionMs: 0,
			perNoteOffsetMs: [],
		},
	};

	const mockFilteredScore = {
		...mockScore,
		overall: 0.92,
		pitchAccuracy: 0.95,
	};

	beforeEach(() => {
		vi.mocked(scoreAttempt).mockReset().mockReturnValue(mockScore);
	});

	it('scores detected notes and returns unfilteredScore', () => {
		const inputs = makePipelineInputs({ detected: mockDetected });
		const result = runScorePipeline(inputs);
		expect(scoreAttempt).toHaveBeenCalledWith(
			minimalPhrase, mockDetected, 120, 0, 0.5, false
		);
		expect(result.unfilteredScore).toBe(mockScore);
	});

	it('sets filteredScore to null when no bleedResult provided', () => {
		const inputs = makePipelineInputs();
		const result = runScorePipeline(inputs);
		expect(result.filteredScore).toBeNull();
	});

	it('sets bleedLog to null when no bleedResult provided', () => {
		const inputs = makePipelineInputs();
		const result = runScorePipeline(inputs);
		expect(result.bleedLog).toBeNull();
	});

	it('computes filteredScore when bleedResult is provided', () => {
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)
			.mockReturnValueOnce(mockFilteredScore);
		const bleedResult = { kept: mockDetected, filtered: [] as DetectedNote[] };
		const inputs = makePipelineInputs({ detected: mockDetected, bleedResult });
		const result = runScorePipeline(inputs);
		expect(scoreAttempt).toHaveBeenCalledTimes(2);
		expect(result.filteredScore).toBe(mockFilteredScore);
	});

	it('chosen equals unfilteredScore when bleedFilterEnabled is false', () => {
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)
			.mockReturnValueOnce(mockFilteredScore);
		const bleedResult = { kept: mockDetected, filtered: [] as DetectedNote[] };
		const inputs = makePipelineInputs({
			detected: mockDetected,
			bleedResult,
			bleedFilterEnabled: false,
		});
		const result = runScorePipeline(inputs);
		expect(result.chosen).toBe(result.unfilteredScore);
		expect(result.useFiltered).toBe(false);
	});

	it('chosen equals filteredScore when bleedFilterEnabled is true and bleedResult provided', () => {
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)
			.mockReturnValueOnce(mockFilteredScore);
		const bleedResult = { kept: mockDetected, filtered: [] as DetectedNote[] };
		const inputs = makePipelineInputs({
			detected: mockDetected,
			bleedResult,
			bleedFilterEnabled: true,
		});
		const result = runScorePipeline(inputs);
		expect(result.chosen).toBe(result.filteredScore);
		expect(result.useFiltered).toBe(true);
	});

	it('chosen falls back to unfilteredScore when bleedFilterEnabled but no bleedResult', () => {
		const inputs = makePipelineInputs({ bleedFilterEnabled: true });
		const result = runScorePipeline(inputs);
		expect(result.chosen).toBe(result.unfilteredScore);
		expect(result.useFiltered).toBe(false);
	});

	it('populates bleedLog with note counts and both scores', () => {
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)
			.mockReturnValueOnce(mockFilteredScore);
		const kept = [mockDetected[0]];
		const filtered: DetectedNote[] = [
			{ midi: 72, cents: 0, onsetTime: 0.6, duration: 0.2, clarity: 0.80 },
		];
		const allDetected = [...kept, ...filtered];
		const bleedResult = { kept, filtered };
		const inputs = makePipelineInputs({ detected: allDetected, bleedResult });
		const result = runScorePipeline(inputs);
		expect(result.bleedLog).not.toBeNull();
		expect(result.bleedLog!.totalNotes).toBe(2);
		expect(result.bleedLog!.keptNotes).toBe(1);
		expect(result.bleedLog!.filteredNotes).toBe(filtered);
		expect(result.bleedLog!.unfilteredScore).toBe(mockScore);
		expect(result.bleedLog!.filteredScore).toBe(mockFilteredScore);
	});

	it('detected array is passed through to result', () => {
		const inputs = makePipelineInputs({ detected: mockDetected });
		const result = runScorePipeline(inputs);
		expect(result.detected).toBe(mockDetected);
	});

	it('defaults octaveInsensitive to false', () => {
		const inputs = makePipelineInputs({ detected: mockDetected });
		runScorePipeline(inputs);
		expect(vi.mocked(scoreAttempt)).toHaveBeenCalledWith(
			expect.anything(), expect.anything(), expect.anything(),
			expect.anything(), expect.anything(), false
		);
	});

	it('forwards octaveInsensitive=true to scoreAttempt', () => {
		const inputs = makePipelineInputs({ detected: mockDetected, octaveInsensitive: true });
		runScorePipeline(inputs);
		expect(vi.mocked(scoreAttempt)).toHaveBeenCalledWith(
			expect.anything(), expect.anything(), expect.anything(),
			expect.anything(), expect.anything(), true
		);
	});

	it('forwards octaveInsensitive=true to both scoreAttempt calls when bleedResult present', () => {
		vi.mocked(scoreAttempt)
			.mockReturnValueOnce(mockScore)
			.mockReturnValueOnce(mockFilteredScore);
		const bleedResult = { kept: mockDetected, filtered: [] as DetectedNote[] };
		const inputs = makePipelineInputs({
			detected: mockDetected,
			bleedResult,
			octaveInsensitive: true,
		});
		runScorePipeline(inputs);
		const calls = vi.mocked(scoreAttempt).mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[0][5]).toBe(true);
		expect(calls[1][5]).toBe(true);
	});
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass for score-pipeline. Some route files may have compile errors — those are fixed in Task 4.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/scoring/score-pipeline.test.ts
git commit -m "test: update score-pipeline tests for new preprocessed interface"
```

---

### Task 4: Update callers to do preprocessing

**Files:**
- Modify: `src/routes/practice/+page.svelte`
- Modify: `src/routes/lick-practice/session/+page.svelte`
- Modify: `src/routes/diagnostics/+page.svelte`

- [ ] **Step 1: Update `practice/+page.svelte`**

Add imports for preprocessing functions:
```typescript
import { resolveOnsets, segmentNotes } from '$lib/audio/note-segmenter';
import { filterBleed } from '$lib/audio/bleed-filter';
```

Update the `finishRecording` call site (around line 348). Before `runScorePipeline`, add preprocessing:

```typescript
const onsets = resolveOnsets(workletOnsets, readings);
const detected = segmentNotes(readings, onsets, phraseDuration);
const schedule = getActiveSchedule();
const bleedResult = schedule
    ? filterBleed(detected, schedule, recordingTransportSeconds)
    : null;

const result = runScorePipeline({
    detected,
    phrase: session.phrase,
    tempo: session.tempo,
    transportSeconds: recordingTransportSeconds,
    swing: settings.swing,
    bleedFilterEnabled: settings.bleedFilterEnabled,
    bleedResult
});
```

Apply the same pattern to the rescore call site (around line 520):

```typescript
const onsets = resolveOnsets(replay.onsets, replay.readings);
const detected = segmentNotes(replay.readings, onsets, phraseDuration);
const bleedResult = schedule
    ? filterBleed(detected, schedule, transportSeconds)
    : null;

const result = runScorePipeline({
    detected,
    phrase,
    tempo,
    transportSeconds,
    swing,
    bleedFilterEnabled,
    bleedResult
});
```

- [ ] **Step 2: Update `lick-practice/session/+page.svelte`**

Add imports for preprocessing functions:
```typescript
import { resolveOnsets, segmentNotes } from '$lib/audio/note-segmenter';
import { filterBleed } from '$lib/audio/bleed-filter';
```

Update the call site (around line 645):

```typescript
const onsets = resolveOnsets(workletOnsets, rebased);
const detected = segmentNotes(rebased, onsets, phraseDuration);
const bleedResult = window.schedule
    ? filterBleed(detected, window.schedule, window.recordingTransportSeconds)
    : null;

const result = runScorePipeline({
    detected,
    phrase: window.phrase,
    tempo: lickPractice.currentTempo,
    transportSeconds: window.recordingTransportSeconds,
    swing: settings.swing,
    bleedFilterEnabled: settings.bleedFilterEnabled,
    bleedResult,
    octaveInsensitive: lickPractice.config.practiceMode === 'continuous'
});
```

- [ ] **Step 3: Update `diagnostics/+page.svelte`**

Change the `resolveOnsets` import from `$lib/scoring/score-pipeline` to `$lib/audio/note-segmenter`:

```typescript
import { segmentNotes, resolveOnsets } from '$lib/audio/note-segmenter';
```

Remove the old import:
```typescript
// DELETE: import { resolveOnsets } from '$lib/scoring/score-pipeline';
```

- [ ] **Step 4: Run full test suite and type check**

Run: `npm run check && npm test`
Expected: 0 errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/practice/+page.svelte src/routes/lick-practice/session/+page.svelte src/routes/diagnostics/+page.svelte
git commit -m "refactor: callers preprocess audio data before score pipeline"
```

---

### Task 5: Verify clean decoupling

- [ ] **Step 1: Verify no audio imports remain in scoring module**

Run: `grep -r "from '\$lib/audio" src/lib/scoring/`
Expected: No matches.

- [ ] **Step 2: Run full test suite and type check**

Run: `npm run check && npm test`
Expected: 0 errors, all 1405+ tests pass.

- [ ] **Step 3: Update module header comment**

In `src/lib/scoring/score-pipeline.ts`, the header comment (lines 1–14) references the old design. Update it:

```typescript
/**
 * Unified scoring pipeline.
 *
 * Pure scoring orchestrator: takes pre-segmented DetectedNote[] and
 * returns both unfiltered and (optionally) bleed-filtered scores.
 * Callers handle all audio preprocessing (onset resolution, note
 * segmentation, bleed filtering) before calling runScorePipeline.
 *
 * No audio-layer dependencies. Safe to call from:
 *   - the live finishRecording() path in practice / lick-practice routes
 *   - the post-hoc rescore path (replayFromBlob → runScorePipeline)
 *   - /diagnostics replay panel
 *   - unit tests without audio mocks
 */
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/scoring/score-pipeline.ts
git commit -m "docs: update score-pipeline header to reflect decoupled design"
```
