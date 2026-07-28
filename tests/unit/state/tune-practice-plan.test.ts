import { describe, it, expect } from 'vitest';
import type { Fraction, Note } from '$lib/types/music';
import type { FlattenedTune } from '$lib/tunes/flatten';
import type { DetectedProgression } from '$lib/tunes/progression-detector';
import type { LickSuggestion } from '$lib/tunes/lick-matcher';
import {
	buildSessionPlan,
	carveMelody,
	type BuildPlanDeps
} from '$lib/state/tune-practice-plan';
import { seg } from '../../helpers/tune-fixtures';

function mkFlat(overrides: Partial<FlattenedTune>): FlattenedTune {
	return {
		notes: [],
		harmony: [],
		totalBars: 8,
		noteSourceIndices: [],
		segmentSourceIndices: [],
		sectionMap: [{ sourceSection: 0, barOffset: 0 }],
		...overrides
	};
}

function mkDet(overrides: Partial<DetectedProgression>): DetectedProgression {
	return {
		type: 'ii-V-I-major',
		slots: [],
		segmentIndices: [0],
		localKey: 'C',
		tuneKeyDegree: { semitones: 0, degree: 1, accidental: null, label: '1' },
		startOffset: [0, 1],
		duration: [2, 1],
		startBar: 0,
		endBarExclusive: 2,
		wrapsAround: false,
		...overrides
	};
}

function mkSuggestion(lickId: string): LickSuggestion {
	return {
		lickId,
		lickName: lickId,
		category: 'ii-V-I-major',
		targetKey: 'C',
		insertionOffset: [0, 1],
		insertionBar: 0,
		templateAlignmentOffset: [0, 1],
		masteryTier: 'unknown',
		matchSources: ['category'],
		substitution: null,
		inPracticeSet: false,
		difficultyLevel: 20
	};
}

function planDeps(overrides: Partial<BuildPlanDeps>): BuildPlanDeps {
	return {
		flat: mkFlat({}),
		notationFlat: mkFlat({}),
		timeSignature: [4, 4],
		ppq: 480,
		detect: () => [],
		match: () => ({ suggestions: [], uncategorized: [] }),
		...overrides
	};
}

describe('buildSessionPlan — window tick math', () => {
	it('offsets every window by the 1-bar count-in and adds a 1-beat lead-out (4/4)', () => {
		const det = mkDet({
			startOffset: [1, 1],
			duration: [2, 1],
			segmentIndices: [0],
			startBar: 1,
			endBarExclusive: 3
		});
		const flat = mkFlat({
			harmony: [seg('D', 'min7', [1, 1], [2, 1])],
			segmentSourceIndices: [0]
		});
		const plan = buildSessionPlan(
			planDeps({ flat, notationFlat: flat, detect: () => [det] })
		);
		expect(plan).toHaveLength(1);
		// barTicks = 4 * 480 = 1920; start = 1 whole note = 1920 ticks
		expect(plan[0].openTick).toBe(1920 + 1920);
		// end = 3 whole notes = 5760 ticks; +1 beat (480) lead-out
		expect(plan[0].closeTick).toBe(1920 + 5760 + 480);
		expect(plan[0].playbackBarRange).toEqual({ start: 1, endExclusive: 3 });
	});

	it('computes bar-correct ticks in 3/4', () => {
		const det = mkDet({ startOffset: [3, 4], duration: [3, 2], segmentIndices: [0] });
		const flat = mkFlat({
			totalBars: 8,
			harmony: [seg('D', 'min7', [3, 4], [3, 2])],
			segmentSourceIndices: [0]
		});
		const plan = buildSessionPlan(
			planDeps({ flat, notationFlat: flat, timeSignature: [3, 4], detect: () => [det] })
		);
		// barTicks = 3 * 480 = 1440; [3,4] whole notes = bar 1 = 1440 ticks
		expect(plan[0].openTick).toBe(1440 + 1440);
		// end = 2.25 whole notes = 4320 ticks; lead-out one beat
		expect(plan[0].closeTick).toBe(1440 + 4320 + 480);
	});

	it('clamps the lead-out to the next window open', () => {
		const d1 = mkDet({ startOffset: [0, 1], duration: [1, 1], segmentIndices: [0] });
		const d2 = mkDet({ startOffset: [1, 1], duration: [1, 1], segmentIndices: [1] });
		const flat = mkFlat({
			harmony: [seg('D', 'min7', [0, 1], [1, 1]), seg('G', '7', [1, 1], [1, 1])],
			segmentSourceIndices: [0, 1]
		});
		const plan = buildSessionPlan(
			planDeps({ flat, notationFlat: flat, detect: () => [d1, d2] })
		);
		expect(plan[0].closeTick).toBe(plan[1].openTick);
		expect(plan[0].closeTick).toBe(1920 + 1920);
	});

	it('clamps a wrapped window to the end of the form', () => {
		const det = mkDet({
			startOffset: [6, 1],
			duration: [4, 1], // loop-extended past the 8-bar form
			segmentIndices: [0],
			wrapsAround: true
		});
		const flat = mkFlat({
			totalBars: 8,
			harmony: [seg('D', 'min7', [6, 1], [2, 1])],
			segmentSourceIndices: [0]
		});
		const plan = buildSessionPlan(planDeps({ flat, notationFlat: flat, detect: () => [det] }));
		// form end = 8 bars * 1920 + count-in bar
		expect(plan[0].closeTick).toBe(1920 + 8 * 1920);
	});

	it('groups repeat occurrences under one markerKey and projects notation bars', () => {
		// Playback flat has two passes: segments [0,1] (first pass) and [2,3]
		// (second pass) both mapping to notation segments [0,1].
		const notationFlat = mkFlat({
			harmony: [seg('D', 'min7', [0, 1], [1, 1]), seg('G', '7', [1, 1], [1, 1])],
			segmentSourceIndices: [0, 1],
			totalBars: 2
		});
		const flat = mkFlat({
			harmony: [
				seg('D', 'min7', [0, 1], [1, 1]),
				seg('G', '7', [1, 1], [1, 1]),
				seg('D', 'min7', [2, 1], [1, 1]),
				seg('G', '7', [3, 1], [1, 1])
			],
			segmentSourceIndices: [0, 1, 0, 1],
			totalBars: 4
		});
		const d1 = mkDet({ startOffset: [0, 1], duration: [2, 1], segmentIndices: [0, 1] });
		const d2 = mkDet({ startOffset: [2, 1], duration: [2, 1], segmentIndices: [2, 3] });
		const plan = buildSessionPlan(
			planDeps({ flat, notationFlat, detect: () => [d1, d2] })
		);
		expect(plan[0].markerKey).toBe(plan[1].markerKey);
		expect(plan[0].notationSegmentIndices).toEqual([0, 1]);
		expect(plan[1].notationSegmentIndices).toEqual([0, 1]);
		expect(plan[1].notationBarRange).toEqual({ start: 0, endExclusive: 2 });
		expect(plan[0].id).not.toBe(plan[1].id);
	});

	it('attaches ranked suggestions and the uncategorized count from the matcher', () => {
		const det = mkDet({ segmentIndices: [0] });
		const flat = mkFlat({
			harmony: [seg('D', 'min7', [0, 1], [2, 1])],
			segmentSourceIndices: [0]
		});
		const plan = buildSessionPlan(
			planDeps({
				flat,
				notationFlat: flat,
				detect: () => [det],
				match: () => ({
					suggestions: [mkSuggestion('a'), mkSuggestion('b')],
					uncategorized: [{}, {}, {}]
				})
			})
		);
		expect(plan[0].suggestions.map((s) => s.lickId)).toEqual(['a', 'b']);
		expect(plan[0].uncategorizedCount).toBe(3);
	});
});

describe('carveMelody', () => {
	const quarter = (offset: Fraction, pitch: number | null = 60): Note => ({
		pitch,
		duration: [1, 4],
		offset
	});

	it('nulls pitches inside a window, preserving array length and offsets', () => {
		const notes = [quarter([0, 1]), quarter([1, 1]), quarter([5, 4]), quarter([2, 1])];
		const carved = carveMelody(notes, [{ start: [1, 1], end: [2, 1] }]);
		expect(carved).toHaveLength(4);
		expect(carved.map((n) => n.pitch)).toEqual([60, null, null, 60]);
		expect(carved.map((n) => n.offset)).toEqual(notes.map((n) => n.offset));
	});

	it('treats window bounds as half-open', () => {
		// Note ending exactly at window start, and note starting exactly at
		// window end — neither is carved.
		const notes = [quarter([3, 4]), quarter([2, 1])];
		const carved = carveMelody(notes, [{ start: [1, 1], end: [2, 1] }]);
		expect(carved.map((n) => n.pitch)).toEqual([60, 60]);
	});

	it('a note straddling the window open is carved', () => {
		const notes = [{ pitch: 60, duration: [1, 2], offset: [3, 4] } as Note];
		const carved = carveMelody(notes, [{ start: [1, 1], end: [2, 1] }]);
		expect(carved[0].pitch).toBeNull();
	});

	it('leaves rests untouched and handles multiple windows', () => {
		const notes = [quarter([0, 1], null), quarter([1, 1]), quarter([3, 1])];
		const carved = carveMelody(notes, [
			{ start: [1, 1], end: [2, 1] },
			{ start: [3, 1], end: [4, 1] }
		]);
		expect(carved.map((n) => n.pitch)).toEqual([null, null, null]);
	});
});
