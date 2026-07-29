import { describe, it, expect } from 'vitest';
import type { Note } from '$lib/types/music';
import type { FlattenedTune } from '$lib/tunes/flatten';
import type { DetectedProgression } from '$lib/tunes/progression-detector';
import type { LickSuggestion } from '$lib/tunes/lick-matcher';
import {
	assignSuggestRotation,
	buildSessionPhrase,
	buildSessionPlan,
	headBarsForFlat,
	notationBarForPlaybackBar,
	type BuildPlanDeps,
	type InsertionPoint
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

describe('buildSessionPlan — head chorus', () => {
	it("shift mode (repeat-free chart): every window moves by the head's length", () => {
		const det = mkDet({ startOffset: [1, 1], duration: [2, 1], segmentIndices: [0] });
		const flat = mkFlat({
			totalBars: 8,
			harmony: [seg('D', 'min7', [1, 1], [2, 1])],
			segmentSourceIndices: [0]
		});
		const plan = buildSessionPlan(
			planDeps({ flat, notationFlat: flat, detect: () => [det], head: { bars: 8, mode: 'shift' } })
		);
		// count-in (1920) + head chorus (8 * 1920) + start offset (1920)
		expect(plan[0].openTick).toBe(1920 + 8 * 1920 + 1920);
		expect(plan[0].closeTick).toBe(1920 + 8 * 1920 + 5760 + 480);
	});

	it('shift mode clamps the lead-out to the shifted end of the form', () => {
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
			planDeps({ flat, notationFlat: flat, detect: () => [det], head: { bars: 8, mode: 'shift' } })
		);
		expect(plan[0].closeTick).toBe(1920 + 8 * 1920 + 8 * 1920);
	});

	it('filter mode (repeat form): head-pass detections drop, solo-pass windows stay unshifted', () => {
		// 8-bar expanded form; the head is pass one (bars 0-4), solos are pass two.
		const headDet = mkDet({ startOffset: [1, 1], duration: [2, 1], segmentIndices: [0] });
		const soloDet = mkDet({
			startOffset: [5, 1],
			duration: [2, 1],
			segmentIndices: [1],
			startBar: 5,
			endBarExclusive: 7
		});
		const flat = mkFlat({
			totalBars: 8,
			harmony: [seg('D', 'min7', [1, 1], [2, 1]), seg('D', 'min7', [5, 1], [2, 1])],
			segmentSourceIndices: [0, 0]
		});
		const plan = buildSessionPlan(
			planDeps({
				flat,
				notationFlat: mkFlat({ harmony: [seg('D', 'min7', [1, 1], [2, 1])], segmentSourceIndices: [0] }),
				detect: () => [headDet, soloDet],
				head: { bars: 4, mode: 'filter' }
			})
		);
		expect(plan).toHaveLength(1);
		// Window ticks are absolute on the expanded timeline: count-in + 5 bars.
		expect(plan[0].openTick).toBe(1920 + 5 * 1920);
		expect(plan[0].closeTick).toBe(1920 + 7 * 1920 + 480);
	});
});

describe('headBarsForFlat', () => {
	// A whole-form repeat (mankunku shape): Intro, A(repeatStart),
	// A-ending1(repeatEnd), A-ending2. Playback: Intro, A, e1, A, e2.
	const wholeFormSections = [
		{},
		{ repeatStart: true },
		{ repeatEnd: true, ending: 1 as const },
		{ ending: 2 as const }
	];
	const wholeFormFlat = mkFlat({
		totalBars: 28,
		sectionMap: [
			{ sourceSection: 0, barOffset: 0 },
			{ sourceSection: 1, barOffset: 4 },
			{ sourceSection: 2, barOffset: 14 },
			{ sourceSection: 1, barOffset: 16 },
			{ sourceSection: 3, barOffset: 26 }
		]
	});

	it('splits head/solo at the second body pass of a whole-form repeat', () => {
		expect(headBarsForFlat(wholeFormFlat, wholeFormSections)).toEqual({
			headBars: 16,
			formRepeats: true
		});
	});

	it('a repeat-free chart heads through the whole form', () => {
		const flat = mkFlat({
			totalBars: 8,
			sectionMap: [
				{ sourceSection: 0, barOffset: 0 },
				{ sourceSection: 1, barOffset: 4 }
			]
		});
		expect(headBarsForFlat(flat, [{}, {}])).toEqual({ headBars: 8, formRepeats: false });
	});

	it('an internal repeat with form material after it is NOT a form outline', () => {
		// AABA written `|: A :| B A` — the repeat only wraps the first A, then B
		// and a final A follow. Head must cover the whole form, no split.
		const sections = [
			{ repeatStart: true, repeatEnd: true }, // A (internal repeat)
			{}, // B
			{} // A out
		];
		const flat = mkFlat({
			totalBars: 12,
			sectionMap: [
				{ sourceSection: 0, barOffset: 0 },
				{ sourceSection: 0, barOffset: 4 }, // second A (the internal repeat)
				{ sourceSection: 1, barOffset: 8 },
				{ sourceSection: 2, barOffset: 10 }
			]
		});
		expect(headBarsForFlat(flat, sections)).toEqual({ headBars: 12, formRepeats: false });
	});
});

describe('assignSuggestRotation', () => {
	const mkIp = (
		id: string,
		type: InsertionPoint['progressionType'],
		lickIds: string[]
	): InsertionPoint => ({
		id,
		progressionType: type,
		localKey: 'C',
		degreeLabel: '1',
		startOffset: [0, 1],
		duration: [2, 1],
		playbackBarRange: { start: 0, endExclusive: 2 },
		notationSegmentIndices: [0],
		notationBarRange: { start: 0, endExclusive: 2 },
		markerKey: id,
		suggestions: lickIds.map((lid) => mkSuggestion(lid)),
		uncategorizedCount: 0,
		openTick: 0,
		closeTick: 1
	});

	it('cycles the shared lick pool across same-type points (least-used wins)', () => {
		const pool = ['x', 'y', 'z'];
		const plan = [
			mkIp('a', 'blues', pool),
			mkIp('b', 'ii-V-I-major', ['p', 'q']),
			mkIp('c', 'blues', pool),
			mkIp('d', 'blues', pool),
			mkIp('e', 'blues', pool),
			mkIp('f', 'ii-V-I-major', ['p', 'q'])
		];
		expect(assignSuggestRotation(plan)).toEqual({ a: 0, b: 0, c: 1, d: 2, e: 0, f: 1 });
	});

	it('surfaces a lick even when it is not first in every point (the index-modulo bug)', () => {
		// Two points, same type, same two licks in DIFFERENT rank order. Positional
		// modulo would pick index 0 at both → the practice-set lick never appears.
		const plan = [mkIp('a', 'blues', ['known', 'other']), mkIp('b', 'blues', ['other', 'known'])];
		const picks = assignSuggestRotation(plan);
		// Point a picks 'known' (idx 0); point b then favors the unused 'other'
		// (idx 0 there) — so BOTH distinct licks are surfaced.
		const chosen = [
			plan[0].suggestions[picks['a']].lickId,
			plan[1].suggestions[picks['b']].lickId
		];
		expect(new Set(chosen)).toEqual(new Set(['known', 'other']));
	});

	it('skips insertion points with no suggestions', () => {
		expect(assignSuggestRotation([mkIp('a', 'blues', [])])).toEqual({});
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
	const noRepeat = [{}];

	it('with a head (repeat-free): melody plays once, harmony covers head + practice chorus', () => {
		const built = buildSessionPhrase({
			flat: flat(),
			sections: noRepeat,
			timeSignature: [4, 4],
			playHead: true
		});
		expect(built.notes).toHaveLength(1);
		expect(built.notes[0].offset).toEqual([0, 1]);
		expect(built.harmony).toHaveLength(4);
		expect(built.harmony[2].chord.root).toBe('C');
		expect(built.harmony[2].startOffset).toEqual([2, 1]);
		expect(built.harmony[3].startOffset).toEqual([3, 1]);
		expect(built.phraseBars).toBe(4);
		expect(built.duplicatedForm).toBe(true);
	});

	it('with a head (whole-form repeat): keeps pass-one melody only, no doubling', () => {
		// Two-bar form repeated: sources [0,0], melody in both passes.
		const f = mkFlat({
			totalBars: 4,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 62, duration: [1, 4], offset: [2, 1] } // second pass
			],
			harmony: [seg('C', 'maj7', [0, 1], [1, 1]), seg('C', 'maj7', [2, 1], [1, 1])],
			sectionMap: [
				{ sourceSection: 0, barOffset: 0 },
				{ sourceSection: 0, barOffset: 2 }
			]
		});
		const built = buildSessionPhrase({
			flat: f,
			sections: [{ repeatStart: true, repeatEnd: true }],
			timeSignature: [4, 4],
			playHead: true
		});
		// Only the first-pass note survives; harmony is untouched (no append).
		expect(built.notes.map((n) => n.pitch)).toEqual([60]);
		expect(built.harmony).toHaveLength(2);
		expect(built.phraseBars).toBe(4);
		expect(built.headBars).toBe(2);
		expect(built.duplicatedForm).toBe(false);
	});

	it('without a head: no melody, one chorus of changes', () => {
		const built = buildSessionPhrase({
			flat: flat(),
			sections: noRepeat,
			timeSignature: [4, 4],
			playHead: false
		});
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
		const built = buildSessionPhrase({
			flat: f,
			sections: noRepeat,
			timeSignature: [3, 4],
			playHead: true
		});
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
