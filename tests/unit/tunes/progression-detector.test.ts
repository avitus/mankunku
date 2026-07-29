import { describe, it, expect } from 'vitest';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { PitchClass } from '$lib/types/music';
import type { Tune } from '$lib/types/tune';
import { flattenTune, type FlattenOptions } from '$lib/tunes/flatten';
import {
	detectProgressions,
	selectNonOverlapping,
	type DetectedProgression,
	type DetectOptions
} from '$lib/tunes/progression-detector';
import { PROGRESSION_SHAPES } from '$lib/data/progression-shapes';
import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
import { pitchClassInterval, transposePitchClass } from '$lib/music/transposition';
import { MANKUNKU_BLUES } from '$lib/data/tunes/mankunku-blues';
import { WHEN_THE_SAINTS } from '$lib/data/tunes/when-the-saints';
import { AMAZING_GRACE } from '$lib/data/tunes/amazing-grace';
import { seg, section, sheet, simpleSheet } from '../../helpers/tune-fixtures';

function detect(tune: Tune, options?: DetectOptions, flatten?: FlattenOptions): DetectedProgression[] {
	return detectProgressions(flattenTune(tune, flatten), tune, options);
}

function byType(dets: DetectedProgression[], type: ChordProgressionType): DetectedProgression[] {
	return dets.filter((d) => d.type === type);
}

describe('progression shapes mirror PROGRESSION_TEMPLATES', () => {
	it('covers all ten progression types exactly once', () => {
		const types = PROGRESSION_SHAPES.map((s) => s.type);
		expect(new Set(types).size).toBe(10);
		expect(types.length).toBe(10);
	});

	it('every slot matches its template segment (offset, root interval, quality membership)', () => {
		for (const shape of PROGRESSION_SHAPES) {
			const template = PROGRESSION_TEMPLATES[shape.type];
			expect(shape.slots.length).toBe(template.harmony.length);
			shape.slots.forEach((slot, k) => {
				const tSeg = template.harmony[k];
				expect(slot.templateOffset[0] * tSeg.startOffset[1]).toBe(
					tSeg.startOffset[0] * slot.templateOffset[1]
				);
				expect(slot.rootOffset).toBe(pitchClassInterval('C', tSeg.chord.root));
				expect(slot.qualities).toContain(tSeg.chord.quality);
			});
			expect(shape.slots[shape.tonicSlot].rootOffset).toBe(0);
		}
	});
});

describe('detectProgressions — synthetic harmony', () => {
	it('detects the short ii-V-I in simpleSheet and nothing else', () => {
		const dets = detect(simpleSheet());
		expect(dets).toHaveLength(1);
		const d = dets[0];
		expect(d.type).toBe('ii-V-I-major');
		expect(d.localKey).toBe('C');
		expect(d.tuneKeyDegree.label).toBe('1');
		expect(d.segmentIndices).toEqual([0, 1, 2]);
		expect(d.startOffset).toEqual([0, 1]);
		expect(d.duration).toEqual([2, 1]);
		expect(d.startBar).toBe(0);
		expect(d.endBarExclusive).toBe(2);
		expect(d.wrapsAround).toBe(false);
	});

	it('is transposition-invariant across keys', () => {
		for (const key of ['Eb', 'A', 'F#'] as PitchClass[]) {
			const ii = transposePitchClass(key, 2);
			const V = transposePitchClass(key, 7);
			const tune = sheet({
				key,
				sections: [
					section({
						bars: 2,
						harmony: [
							seg(ii, 'min7', [0, 1], [1, 2]),
							seg(V, '7', [1, 2], [1, 2]),
							seg(key, 'maj7', [1, 1], [1, 1])
						]
					})
				]
			});
			const dets = byType(detect(tune), 'ii-V-I-major');
			expect(dets).toHaveLength(1);
			expect(dets[0].localKey).toBe(key);
			expect(dets[0].tuneKeyDegree.label).toBe('1');
			expect(dets[0].startBar).toBe(0);
			expect(dets[0].endBarExclusive).toBe(2);
		}
	});

	it('detects a long major ii-V-I in a secondary key with the right degree label', () => {
		const tune = sheet({
			key: 'C',
			sections: [
				section({
					bars: 4,
					harmony: [
						seg('C', 'min7', [0, 1], [1, 1]),
						seg('F', '7', [1, 1], [1, 1]),
						seg('Bb', 'maj7', [2, 1], [2, 1])
					]
				})
			]
		});
		const longs = byType(detect(tune), 'ii-V-I-major-long');
		expect(longs).toHaveLength(1);
		expect(longs[0].localKey).toBe('Bb');
		expect(longs[0].tuneKeyDegree.label).toBe('b7');
		expect(longs[0].segmentIndices).toEqual([0, 1, 2]);
		expect(longs[0].startBar).toBe(0);
		expect(longs[0].endBarExclusive).toBe(4);
		expect(byType(detect(tune), 'ii-V-I-major')).toHaveLength(0);
	});

	it('detects the short minor ii-V-i (m7b5 → alt dominant → minor tonic)', () => {
		const tune = sheet({
			key: 'C',
			sections: [
				section({
					bars: 2,
					harmony: [
						seg('D', 'min7b5', [0, 1], [1, 2]),
						seg('G', '7alt', [1, 2], [1, 2]),
						seg('C', 'min7', [1, 1], [1, 1])
					]
				})
			]
		});
		const dets = byType(detect(tune), 'ii-V-I-minor');
		expect(dets).toHaveLength(1);
		expect(dets[0].localKey).toBe('C');
		expect(dets[0].segmentIndices).toEqual([0, 1, 2]);
		expect(byType(detect(tune), 'ii-V-I-major')).toHaveLength(0);
	});

	it('detects the long minor ii-V-i with a 7b9 dominant in G minor', () => {
		const tune = sheet({
			key: 'G',
			sections: [
				section({
					bars: 4,
					harmony: [
						seg('A', 'min7b5', [0, 1], [1, 1]),
						seg('D', '7b9', [1, 1], [1, 1]),
						seg('G', 'min7', [2, 1], [2, 1])
					]
				})
			]
		});
		const dets = byType(detect(tune), 'ii-V-I-minor-long');
		expect(dets).toHaveLength(1);
		expect(dets[0].localKey).toBe('G');
		expect(dets[0].tuneKeyDegree.label).toBe('1');
		expect(dets[0].segmentIndices).toEqual([0, 1, 2]);
	});

	it('detects the extended iii-VI-ii-V-I turnaround and favors it over the embedded ii-V-I', () => {
		const tune = sheet({
			key: 'C',
			sections: [
				section({
					bars: 4,
					harmony: [
						seg('E', 'min7', [0, 1], [1, 2]), // iii
						seg('A', '7', [1, 2], [1, 2]), // VI7 (secondary dominant, not a diatonic vi)
						seg('D', 'min7', [1, 1], [1, 2]), // ii
						seg('G', '7', [3, 2], [1, 2]), // V7
						seg('C', 'maj7', [2, 1], [2, 1]) // I
					]
				})
			]
		});
		const dets = byType(detect(tune), 'iii-VI-ii-V-I');
		expect(dets).toHaveLength(1);
		expect(dets[0].localKey).toBe('C');
		expect(dets[0].tuneKeyDegree.label).toBe('1');
		expect(dets[0].segmentIndices).toEqual([0, 1, 2, 3, 4]);
		expect(dets[0].startBar).toBe(0);
		expect(dets[0].endBarExclusive).toBe(4);
		// The embedded Dm7-G7-Cmaj7 ii-V-I is detected too, but the longer,
		// more specific shape wins the non-overlap selection.
		expect(byType(detect(tune), 'ii-V-I-major')).toHaveLength(1);
		const survivors = selectNonOverlapping(detect(tune));
		expect(survivors.map((d) => d.type)).toEqual(['iii-VI-ii-V-I']);
	});

	it('measures slot durations in bars of the tune meter (3/4 long ii-V-I)', () => {
		const tune = sheet({
			key: 'C',
			timeSignature: [3, 4],
			sections: [
				section({
					bars: 4,
					harmony: [
						seg('D', 'min7', [0, 1], [3, 4]),
						seg('G', '7', [3, 4], [3, 4]),
						seg('C', 'maj7', [3, 2], [3, 2])
					]
				})
			]
		});
		const longs = byType(detect(tune), 'ii-V-I-major-long');
		expect(longs).toHaveLength(1);
		expect(longs[0].startBar).toBe(0);
		expect(longs[0].endBarExclusive).toBe(4);
		expect(byType(detect(tune), 'ii-V-I-major')).toHaveLength(0);
	});

	it('never matches a window across a harmony gap', () => {
		const tune = sheet({
			key: 'C',
			sections: [
				section({
					bars: 3,
					harmony: [
						seg('D', 'min7', [0, 1], [1, 2]),
						seg('G', '7', [1, 2], [1, 2]),
						// bar 1 is silent — the tonic only arrives in bar 2
						seg('C', 'maj7', [2, 1], [1, 1])
					]
				})
			]
		});
		expect(byType(detect(tune), 'ii-V-I-major')).toHaveLength(0);
	});

	it('scans an unsorted harmony array and reports original indices', () => {
		const tune = sheet({
			key: 'C',
			sections: [
				section({
					bars: 2,
					harmony: [
						seg('C', 'maj7', [1, 1], [1, 1]),
						seg('D', 'min7', [0, 1], [1, 2]),
						seg('G', '7', [1, 2], [1, 2])
					]
				})
			]
		});
		const dets = byType(detect(tune), 'ii-V-I-major');
		expect(dets).toHaveLength(1);
		expect(dets[0].segmentIndices).toEqual([1, 2, 0]);
	});

	it('coalesces split same-chord segments into one vamp anchored at the run head', () => {
		const tune = sheet({
			key: 'C',
			sections: [
				section({
					bars: 3,
					harmony: [
						seg('C', 'maj7', [0, 1], [1, 1]),
						seg('C', 'maj7', [1, 1], [1, 1]),
						seg('C', 'maj7', [2, 1], [1, 1])
					]
				})
			]
		});
		const vamps = byType(detect(tune), 'major-vamp');
		expect(vamps).toHaveLength(1);
		expect(vamps[0].segmentIndices).toEqual([0, 1, 2]);
		expect(vamps[0].startBar).toBe(0);
		expect(vamps[0].endBarExclusive).toBe(3);
	});
});

describe('detectProgressions — cyclic wraparound', () => {
	const wrapTune = () =>
		sheet({
			key: 'C',
			sections: [
				section({
					bars: 4,
					harmony: [
						seg('C', 'maj7', [0, 1], [2, 1]),
						seg('D', 'min7', [2, 1], [1, 1]),
						seg('G', '7', [3, 1], [1, 1])
					]
				})
			]
		});

	it('resolves a trailing ii-V to the top of the form when cyclic', () => {
		const dets = detect(wrapTune());
		const longs = byType(dets, 'ii-V-I-major-long');
		expect(longs).toHaveLength(1);
		const d = longs[0];
		expect(d.wrapsAround).toBe(true);
		expect(d.segmentIndices).toEqual([1, 2, 0]);
		expect(d.localKey).toBe('C');
		expect(d.startOffset).toEqual([2, 1]);
		expect(d.duration).toEqual([4, 1]);
		expect(d.startBar).toBe(2);
		expect(d.endBarExclusive).toBe(6);
		expect(byType(dets, 'major-vamp')).toHaveLength(1);
		expect(dets).toHaveLength(2);
	});

	it('finds only the vamp when cyclic is disabled', () => {
		const dets = detect(wrapTune(), { cyclic: false });
		expect(dets.map((d) => d.type)).toEqual(['major-vamp']);
	});

	it('never wraps a coalescing run across the form boundary', () => {
		const dets = detect(WHEN_THE_SAINTS);
		expect(dets.every((d) => !d.wrapsAround)).toBe(true);
	});
});

describe('detectProgressions — curated tunes', () => {
	it('Mankunku Blues: both ii-V-Is, both turnarounds, blues bars, no vamps', () => {
		const dets = detect(MANKUNKU_BLUES);

		const shorts = byType(dets, 'ii-V-I-major');
		expect(shorts.map((d) => d.segmentIndices)).toEqual([
			[7, 8, 9],
			[17, 18, 19]
		]);
		const [toBb, toF] = shorts;
		expect(toBb.localKey).toBe('Bb');
		expect(toBb.tuneKeyDegree.label).toBe('4');
		expect(toBb.startBar).toBe(7);
		expect(toBb.endBarExclusive).toBe(9);
		expect(toF.localKey).toBe('F');
		expect(toF.tuneKeyDegree.label).toBe('1');
		expect(toF.startBar).toBe(15);
		expect(toF.endBarExclusive).toBe(17);

		const longs = byType(dets, 'ii-V-I-major-long');
		expect(longs.map((d) => d.segmentIndices)).toEqual([[13, 14, 15]]);
		expect(longs[0].localKey).toBe('F');
		expect(longs[0].startBar).toBe(12);
		expect(longs[0].endBarExclusive).toBe(15);

		const turnarounds = byType(dets, 'turnaround');
		expect(turnarounds.map((d) => d.segmentIndices)).toEqual([
			[11, 12, 13, 14],
			[15, 16, 17, 18]
		]);
		expect(turnarounds[0].startBar).toBe(10);
		expect(turnarounds[0].endBarExclusive).toBe(14);
		expect(turnarounds[1].startBar).toBe(14);
		expect(turnarounds[1].endBarExclusive).toBe(16);
		expect(turnarounds.every((d) => d.localKey === 'F')).toBe(true);

		const blues = byType(dets, 'blues');
		expect(blues.map((d) => d.segmentIndices)).toEqual([[0], [2], [4], [6], [11], [19]]);
		expect(blues.every((d) => d.localKey === 'F')).toBe(true);

		expect(byType(dets, 'major-vamp')).toHaveLength(0);
		expect(byType(dets, 'minor-vamp')).toHaveLength(0);
		expect(byType(dets, 'dominant-vamp')).toHaveLength(0);
		expect(byType(dets, 'ii-V-I-minor')).toHaveLength(0);
		expect(byType(dets, 'ii-V-I-minor-long')).toHaveLength(0);
		expect(dets).toHaveLength(11);
	});

	it('When the Saints: vamps and one blues bar, zero ii-V', () => {
		const dets = detect(WHEN_THE_SAINTS);

		const majors = byType(dets, 'major-vamp');
		expect(majors.map((d) => [d.segmentIndices, d.localKey, d.startBar, d.endBarExclusive])).toEqual([
			[[0], 'C', 0, 6],
			[[4], 'F', 10, 12],
			[[5], 'C', 12, 14]
		]);

		const doms = byType(dets, 'dominant-vamp');
		expect(doms.map((d) => [d.segmentIndices, d.localKey, d.startBar, d.endBarExclusive])).toEqual([
			[[1], 'G', 6, 8]
		]);
		expect(doms[0].tuneKeyDegree.label).toBe('5');

		const blues = byType(dets, 'blues');
		expect(blues.map((d) => [d.segmentIndices, d.localKey, d.startBar])).toEqual([[[3], 'C', 9]]);

		expect(dets).toHaveLength(5);
	});

	it('Amazing Grace (3/4): meter-relative vamps, rejects the vi-V-I', () => {
		const dets = detect(AMAZING_GRACE);

		const majors = byType(dets, 'major-vamp');
		expect(majors.map((d) => [d.segmentIndices, d.startBar, d.endBarExclusive])).toEqual([
			[[0], 0, 3],
			[[6], 9, 11],
			[[11], 15, 17]
		]);

		const doms = byType(dets, 'dominant-vamp');
		expect(doms.map((d) => [d.segmentIndices, d.localKey, d.startBar, d.endBarExclusive])).toEqual([
			[[5], 'C', 7, 9]
		]);

		const blues = byType(dets, 'blues');
		expect(blues.map((d) => [d.segmentIndices, d.localKey, d.startBar, d.endBarExclusive])).toEqual([
			[[1], 'F', 3, 4]
		]);

		expect(byType(dets, 'ii-V-I-major')).toHaveLength(0);
		expect(byType(dets, 'ii-V-I-major-long')).toHaveLength(0);
		expect(dets).toHaveLength(5);
	});

	it('expandRepeats surfaces the second-pass ii-V occurrences', () => {
		const dets = detect(MANKUNKU_BLUES, undefined, { expandRepeats: true });
		const bbShorts = byType(dets, 'ii-V-I-major').filter((d) => d.localKey === 'Bb');
		expect(bbShorts.map((d) => d.startBar)).toEqual([7, 19]);
	});
});

describe('selectNonOverlapping', () => {
	it('keeps the Mankunku survivor set in chart order', () => {
		const kept = selectNonOverlapping(detect(MANKUNKU_BLUES));
		expect(kept.map((d) => [d.type, d.startBar])).toEqual([
			['blues', 0],
			['blues', 2],
			['blues', 4],
			['blues', 6],
			['ii-V-I-major', 7],
			['turnaround', 10],
			['turnaround', 14],
			['blues', 16]
		]);
	});

	it('prefers the more specific progression over a vamp sharing segments', () => {
		const dets = detect(
			sheet({
				key: 'C',
				sections: [
					section({
						bars: 4,
						harmony: [
							seg('C', 'maj7', [0, 1], [2, 1]),
							seg('D', 'min7', [2, 1], [1, 1]),
							seg('G', '7', [3, 1], [1, 1])
						]
					})
				]
			})
		);
		const kept = selectNonOverlapping(dets);
		expect(kept.map((d) => d.type)).toEqual(['ii-V-I-major-long']);
	});

	it('is deterministic under input shuffling', () => {
		const dets = detect(MANKUNKU_BLUES);
		const shuffled = [...dets].reverse();
		const [a, b] = [selectNonOverlapping(dets), selectNonOverlapping(shuffled)];
		expect(b).toEqual(a);
	});

	it('always favors the longer progression when detections overlap', () => {
		// A jazz-practice rule: a longer stretch of harmony beats a shorter,
		// nominally more "specific" one. A 3-bar vamp must survive against an
		// overlapping 1-bar blues detection despite blues's higher shape rank.
		const mk = (over: Partial<DetectedProgression>): DetectedProgression => ({
			type: 'blues',
			slots: [],
			segmentIndices: [0],
			localKey: 'C',
			tuneKeyDegree: { semitones: 0, degree: 1, accidental: null, label: '1' },
			startOffset: [0, 1],
			duration: [1, 1],
			startBar: 0,
			endBarExclusive: 1,
			wrapsAround: false,
			...over
		});
		const shortBlues = mk({ type: 'blues', segmentIndices: [1], startOffset: [1, 1] });
		const longVamp = mk({
			type: 'dominant-vamp',
			segmentIndices: [0, 1, 2],
			duration: [3, 1],
			endBarExclusive: 3
		});
		const kept = selectNonOverlapping([shortBlues, longVamp]);
		expect(kept.map((d) => d.type)).toEqual(['dominant-vamp']);
	});
});
