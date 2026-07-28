import { describe, it, expect } from 'vitest';
import type { Note } from '$lib/types/music';
import type { FlattenedTune } from '$lib/tunes/flatten';
import type { DetectedProgression } from '$lib/tunes/progression-detector';
import type { LickSuggestion } from '$lib/tunes/lick-matcher';
import {
	buildSessionPhrase,
	buildSessionPlan,
	notationBarForPlaybackBar,
	type BuildPlanDeps
} from '$lib/state/tune-practice-plan';
import { flattenTune } from '$lib/tunes/flatten';
import { seg, section, sheet } from '../../helpers/tune-fixtures';

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

describe('buildSessionPlan — head-chorus lead bars', () => {
	it('shifts every window by the head chorus length', () => {
		const det = mkDet({ startOffset: [1, 1], duration: [2, 1], segmentIndices: [0] });
		const flat = mkFlat({
			totalBars: 8,
			harmony: [seg('D', 'min7', [1, 1], [2, 1])],
			segmentSourceIndices: [0]
		});
		const plan = buildSessionPlan(
			planDeps({ flat, notationFlat: flat, detect: () => [det], leadBars: 8 })
		);
		// count-in (1920) + head chorus (8 * 1920) + start offset (1920)
		expect(plan[0].openTick).toBe(1920 + 8 * 1920 + 1920);
		expect(plan[0].closeTick).toBe(1920 + 8 * 1920 + 5760 + 480);
	});

	it('clamps the lead-out to the shifted end of the form', () => {
		const det = mkDet({
			startOffset: [6, 1],
			duration: [4, 1],
			segmentIndices: [0],
			wrapsAround: true
		});
		const flat = mkFlat({
			totalBars: 8,
			harmony: [seg('D', 'min7', [6, 1], [2, 1])],
			segmentSourceIndices: [0]
		});
		const plan = buildSessionPlan(
			planDeps({ flat, notationFlat: flat, detect: () => [det], leadBars: 8 })
		);
		expect(plan[0].closeTick).toBe(1920 + 8 * 1920 + 8 * 1920);
	});
});

describe('buildSessionPhrase', () => {
	const NOTE: Note = { pitch: 60, duration: [1, 4], offset: [0, 1] };
	const flat = (): FlattenedTune =>
		mkFlat({
			totalBars: 2,
			notes: [NOTE],
			harmony: [seg('C', 'maj7', [0, 1], [1, 1]), seg('G', '7', [1, 1], [1, 1])]
		});

	it('with a head: melody plays once, harmony covers head + practice chorus', () => {
		const built = buildSessionPhrase({ flat: flat(), timeSignature: [4, 4], playHead: true });
		expect(built.notes).toHaveLength(1);
		expect(built.notes[0].offset).toEqual([0, 1]);
		expect(built.harmony).toHaveLength(4);
		// Second chorus is the same changes shifted by the form length (2 bars).
		expect(built.harmony[2].chord.root).toBe('C');
		expect(built.harmony[2].startOffset).toEqual([2, 1]);
		expect(built.harmony[3].startOffset).toEqual([3, 1]);
		expect(built.phraseBars).toBe(4);
	});

	it('without a head: no melody, one chorus of changes', () => {
		const built = buildSessionPhrase({ flat: flat(), timeSignature: [4, 4], playHead: false });
		expect(built.notes).toHaveLength(0);
		expect(built.harmony).toHaveLength(2);
		expect(built.harmony[1].startOffset).toEqual([1, 1]);
		expect(built.phraseBars).toBe(2);
	});

	it('shifts the practice chorus in whole-note units of the meter (3/4)', () => {
		const f = mkFlat({
			totalBars: 2,
			harmony: [seg('C', 'maj7', [0, 1], [3, 2])]
		});
		const built = buildSessionPhrase({ flat: f, timeSignature: [3, 4], playHead: true });
		// 2 bars of 3/4 = [3,2] whole notes.
		expect(built.harmony[1].startOffset).toEqual([3, 2]);
	});
});

describe('notationBarForPlaybackBar', () => {
	// A(repeat, 1 bar) | E1(ending 1, 1 bar) | E2(ending 2, 1 bar):
	// playback order A, E1, A, E2 = 4 bars over a 3-bar notation form.
	const endingsSheet = sheet({
		sections: [
			section({ bars: 1, repeatStart: true, harmony: [seg('C', 'maj7', [0, 1], [1, 1])] }),
			section({ bars: 1, ending: 1, repeatEnd: true, harmony: [seg('G', '7', [0, 1], [1, 1])] }),
			section({ bars: 1, ending: 2, harmony: [seg('F', 'maj7', [0, 1], [1, 1])] })
		]
	});
	const flat = flattenTune(endingsSheet, { expandRepeats: true });

	it('maps both passes of a repeated section to the same notation bar', () => {
		expect(notationBarForPlaybackBar(flat.sectionMap, endingsSheet.sections, 0)).toBe(0);
		expect(notationBarForPlaybackBar(flat.sectionMap, endingsSheet.sections, 1)).toBe(1);
		expect(notationBarForPlaybackBar(flat.sectionMap, endingsSheet.sections, 2)).toBe(0);
		expect(notationBarForPlaybackBar(flat.sectionMap, endingsSheet.sections, 3)).toBe(2);
	});

	it('returns null outside the form', () => {
		expect(notationBarForPlaybackBar(flat.sectionMap, endingsSheet.sections, -1)).toBeNull();
		expect(notationBarForPlaybackBar(flat.sectionMap, endingsSheet.sections, 4)).toBeNull();
	});
});
