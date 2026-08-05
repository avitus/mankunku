import { describe, expect, it } from 'vitest';
import type { DetectedNote } from '$lib/types/audio';
import type { TrickContext, TrickParameters, TrickSlotSpec } from '$lib/types/tricks';
import { fractionToFloat } from '$lib/music/intervals';
import { buildEnclosureSlots, enclosuresTrick } from '$lib/tricks/devices/enclosures';
import { trickVariantKey } from '$lib/types/tricks';
import {
	buildFourEighthsSlots,
	buildTriadPairSlots,
	buildTripletSlots,
	TRIAD_PAIR_STYLES,
	triadPairsTrick
} from '$lib/tricks/devices/triad-pairs';
import { getTrickById, TRICKS } from '$lib/tricks';

const baseContext: TrickContext = {
	chordRoot: 'C',
	chordQuality: 'maj7',
	scaleId: 'major.ionian',
	key: 'C',
	timeSignature: [4, 4],
	level: 50,
	tempo: 120
};

/** Pinned mastery-ladder combos (contract e1-e8). */
const ENCLOSURE_LADDER: [string, TrickParameters][] = [
	['e1', { noteCount: '1', shape: 'chromatic-below', targetTone: 'root', beatPlacement: 'downbeat' }],
	['e2', { noteCount: '1', shape: 'scale-above', targetTone: 'third', beatPlacement: 'downbeat' }],
	['e3', { noteCount: '2', shape: 'above-below', targetTone: 'third', beatPlacement: 'downbeat' }],
	['e4', { noteCount: '2', shape: 'below-above', targetTone: 'fifth', beatPlacement: 'downbeat' }],
	['e5', { noteCount: '3', shape: 'above-below', targetTone: 'third', beatPlacement: 'downbeat' }],
	['e6', { noteCount: '2', shape: 'double-chromatic', targetTone: 'third', beatPlacement: 'downbeat' }],
	['e7', { noteCount: '2', shape: 'above-below', targetTone: 'third', beatPlacement: 'offbeat' }],
	['e8', { noteCount: '3', shape: 'double-chromatic', targetTone: 'seventh', beatPlacement: 'offbeat' }]
];

/** Pinned mastery-ladder combos (contract t1-t6). */
const TRIAD_LADDER: [string, TrickParameters][] = [
	['t1', { pair: '4+5', order: 'low-first', beatPlacement: 'downbeat' }],
	['t2', { pair: '4+5', order: 'high-first', beatPlacement: 'downbeat' }],
	['t3', { pair: '1+2', order: 'low-first', beatPlacement: 'downbeat' }],
	['t4', { pair: '5+6', order: 'low-first', beatPlacement: 'downbeat' }],
	['t5', { pair: '4+5', order: 'low-first', beatPlacement: 'offbeat' }],
	['t6', { pair: '1+2', order: 'high-first', beatPlacement: 'offbeat' }]
];

/** Extra enclosure combos exercising shape↔noteCount coercion. */
const ENCLOSURE_COERCION: [string, TrickParameters][] = [
	['1+double-chromatic→chromatic-below', { noteCount: '1', shape: 'double-chromatic', targetTone: 'fifth', beatPlacement: 'downbeat' }],
	['1+above-below→scale-above', { noteCount: '1', shape: 'above-below', targetTone: 'third', beatPlacement: 'downbeat' }],
	['3+chromatic-below→double-chromatic', { noteCount: '3', shape: 'chromatic-below', targetTone: 'root', beatPlacement: 'downbeat' }],
	['2+scale-above→above-below', { noteCount: '2', shape: 'scale-above', targetTone: 'seventh', beatPlacement: 'offbeat' }]
];

const ALL_ENCLOSURE_COMBOS = [...ENCLOSURE_LADDER, ...ENCLOSURE_COERCION];

/** Chord-tone pc for maj7 at C per targetTone. */
const TARGET_PC: Record<string, number> = { root: 0, third: 4, fifth: 7, seventh: 11 };

/** C major scale pcs. */
const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** Diatonic triad pcs on a 1-based degree of C major (alternate steps). */
function cMajorTriad(degree: number): number[] {
	const i = degree - 1;
	return [C_MAJOR[i % 7], C_MAJOR[(i + 2) % 7], C_MAJOR[(i + 4) % 7]];
}

function makeDetected(midi: number, onsetTime: number): DetectedNote {
	return { midi, cents: 0, onsetTime, duration: 0.3, clarity: 0.9 };
}

/** Onset seconds of a slot at 120 BPM (beat = 0.5 s). */
function slotOnsetSeconds(slot: TrickSlotSpec): number {
	return fractionToFloat(slot.offset) * 4 * 0.5;
}

function assertValidSlots(slots: TrickSlotSpec[]): void {
	expect(slots.length).toBeGreaterThanOrEqual(4);
	for (const slot of slots) {
		const pcs = [...slot.exactPcs, ...(slot.patternPcs ?? [])];
		if (slot.generatePc !== undefined) pcs.push(slot.generatePc);
		for (const pc of pcs) {
			expect(Number.isInteger(pc)).toBe(true);
			expect(pc).toBeGreaterThanOrEqual(0);
			expect(pc).toBeLessThanOrEqual(11);
		}
		expect(slot.exactPcs.length).toBeGreaterThan(0);
		expect(fractionToFloat(slot.duration)).toBeGreaterThan(0);
		expect(slot.generatePc).toBeDefined();
		expect(slot.role.length).toBeGreaterThan(0);
	}
	for (let i = 1; i < slots.length; i++) {
		const prevStart = fractionToFloat(slots[i - 1].offset);
		const prevEnd = prevStart + fractionToFloat(slots[i - 1].duration);
		const start = fractionToFloat(slots[i].offset);
		expect(start).toBeGreaterThan(prevStart);
		expect(start).toBeGreaterThanOrEqual(prevEnd - 1e-9);
	}
}

describe('buildEnclosureSlots', () => {
	it.each(ALL_ENCLOSURE_COMBOS)('produces valid slots for %s', (_name, params) => {
		assertValidSlots(buildEnclosureSlots(params, baseContext));
	});

	it.each(ALL_ENCLOSURE_COMBOS)(
		'approach slots for %s sit within 3 semitones of the target on the correct side',
		(_name, params) => {
			const slots = buildEnclosureSlots(params, baseContext);
			const target = TARGET_PC[params.targetTone];
			const approaches = slots.filter(
				(s) => s.role === 'approach-above' || s.role === 'chromatic-below'
			);
			expect(approaches.length).toBeGreaterThan(0);
			for (const slot of approaches) {
				for (const pc of [...slot.exactPcs, ...(slot.patternPcs ?? [])]) {
					const above = (pc - target + 12) % 12;
					const below = (target - pc + 12) % 12;
					if (slot.role === 'approach-above') {
						expect(above).toBeGreaterThanOrEqual(1);
						expect(above).toBeLessThanOrEqual(3);
					} else {
						expect(below).toBeGreaterThanOrEqual(1);
						expect(below).toBeLessThanOrEqual(3);
					}
				}
			}
		}
	);

	it('targets land on the strong-beat grid, an eighth later when offbeat', () => {
		const down = buildEnclosureSlots(ENCLOSURE_LADDER[2][1], baseContext);
		const downTargets = down.filter((s) => s.role === 'target');
		expect(downTargets.map((s) => fractionToFloat(s.offset) * 4)).toEqual([2, 4]);

		const off = buildEnclosureSlots(ENCLOSURE_LADDER[6][1], baseContext);
		const offTargets = off.filter((s) => s.role === 'target');
		expect(offTargets.map((s) => fractionToFloat(s.offset) * 4)).toEqual([2.5, 4.5]);
	});

	it('double-chromatic (noteCount 2) yields two chromatic-below pcs per group', () => {
		const slots = buildEnclosureSlots(ENCLOSURE_LADDER[5][1], baseContext); // e6, target = 3rd (pc 4)
		const chromatic = slots.filter((s) => s.role === 'chromatic-below');
		expect(chromatic.map((s) => s.exactPcs[0])).toEqual([2, 3, 2, 3]);
	});

	it('every target slot is exactly the chosen chord tone', () => {
		for (const [, params] of ENCLOSURE_LADDER) {
			const slots = buildEnclosureSlots(params, baseContext);
			for (const slot of slots.filter((s) => s.role === 'target')) {
				expect(slot.exactPcs).toEqual([TARGET_PC[params.targetTone]]);
			}
		}
	});

	it('falls back to quarter notes when the level profile lacks eighths', () => {
		// getProfile treats levels ≤ 10 as content tiers; tier 2 has no eighths.
		const slots = buildEnclosureSlots(ENCLOSURE_LADDER[0][1], { ...baseContext, level: 2 });
		assertValidSlots(slots);
		for (const slot of slots) {
			expect(fractionToFloat(slot.duration)).toBeCloseTo(0.25, 9);
		}
	});
});

describe('buildTriadPairSlots', () => {
	it.each(TRIAD_LADDER)('produces valid slots for %s', (_name, params) => {
		assertValidSlots(buildTriadPairSlots(params, baseContext));
	});

	it.each(TRIAD_LADDER)('%s alternates triads per order with pcs from the pair', (_name, params) => {
		const slots = buildTriadPairSlots(params, baseContext);
		expect(slots).toHaveLength(8);

		const [lowDeg, highDeg] = params.pair.split('+').map(Number);
		const low = cMajorTriad(lowDeg);
		const high = cMajorTriad(highDeg);
		const [triadA, triadB] = params.order === 'low-first' ? [low, high] : [high, low];
		const union = new Set([...low, ...high]);

		expect(slots.map((s) => s.role)).toEqual([
			'triad-a', 'triad-a', 'triad-a',
			'triad-b', 'triad-b', 'triad-b',
			'triad-a', 'triad-a'
		]);
		expect(slots.map((s) => s.generatePc)).toEqual([
			triadA[0], triadA[1], triadA[2],
			triadB[0], triadB[1], triadB[2],
			triadA[0], triadA[1]
		]);
		for (const slot of slots) {
			const own = slot.role === 'triad-a' ? triadA : triadB;
			const other = slot.role === 'triad-a' ? triadB : triadA;
			expect(new Set(slot.exactPcs)).toEqual(new Set(own));
			expect(new Set(slot.patternPcs)).toEqual(new Set(other));
			for (const pc of slot.exactPcs) expect(union.has(pc)).toBe(true);
		}
	});

	it('offbeat shifts the cell an eighth later', () => {
		const down = buildTriadPairSlots(TRIAD_LADDER[0][1], baseContext);
		const off = buildTriadPairSlots(TRIAD_LADDER[4][1], baseContext);
		expect(fractionToFloat(down[0].offset)).toBeCloseTo(0, 9);
		expect(fractionToFloat(off[0].offset)).toBeCloseTo(1 / 8, 9);
		off.forEach((slot, i) => {
			expect(fractionToFloat(slot.offset)).toBeCloseTo(fractionToFloat(down[i].offset) + 1 / 8, 9);
		});
	});
});

describe('buildTripletSlots', () => {
	it.each(TRIAD_LADDER)('produces valid slots for %s', (_name, params) => {
		assertValidSlots(buildTripletSlots(params, baseContext));
	});

	it.each(TRIAD_LADDER)(
		'%s: four beat-aligned triplet groups alternating triads per order',
		(_name, params) => {
			const slots = buildTripletSlots(params, baseContext);
			expect(slots).toHaveLength(12);

			const [lowDeg, highDeg] = params.pair.split('+').map(Number);
			const low = cMajorTriad(lowDeg);
			const high = cMajorTriad(highDeg);
			const [triadA, triadB] = params.order === 'low-first' ? [low, high] : [high, low];

			slots.forEach((slot, i) => {
				expect(fractionToFloat(slot.offset)).toBeCloseTo(i / 12, 9);
				expect(fractionToFloat(slot.duration)).toBeCloseTo(1 / 12, 9);
				const group = Math.floor(i / 3);
				const own = group % 2 === 0 ? triadA : triadB;
				const other = group % 2 === 0 ? triadB : triadA;
				expect(slot.role).toBe(group % 2 === 0 ? 'triad-a' : 'triad-b');
				expect(new Set(slot.exactPcs)).toEqual(new Set(own));
				expect(new Set(slot.patternPcs)).toEqual(new Set(other));
				expect(slot.generatePc).toBe(own[i % 3]);
			});
		}
	);

	it('ignores beatPlacement: offbeat variants keep triplets on the beat', () => {
		const down = buildTripletSlots(TRIAD_LADDER[0][1], baseContext); // downbeat
		const off = buildTripletSlots(TRIAD_LADDER[4][1], baseContext); // offbeat
		expect(off.map((s) => fractionToFloat(s.offset))).toEqual(
			down.map((s) => fractionToFloat(s.offset))
		);
	});
});

describe('buildFourEighthsSlots', () => {
	it.each(TRIAD_LADDER)('produces valid slots for %s', (_name, params) => {
		assertValidSlots(buildFourEighthsSlots(params, baseContext));
	});

	it.each(TRIAD_LADDER)(
		'%s: four eighths of triad A then four of triad B, contour root-3rd-5th-3rd',
		(_name, params) => {
			const slots = buildFourEighthsSlots(params, baseContext);
			expect(slots).toHaveLength(8);

			const [lowDeg, highDeg] = params.pair.split('+').map(Number);
			const low = cMajorTriad(lowDeg);
			const high = cMajorTriad(highDeg);
			const [triadA, triadB] = params.order === 'low-first' ? [low, high] : [high, low];
			const contour = [0, 1, 2, 1];

			slots.forEach((slot, i) => {
				expect(fractionToFloat(slot.offset)).toBeCloseTo(i / 8, 9);
				expect(fractionToFloat(slot.duration)).toBeCloseTo(1 / 8, 9);
				const own = i < 4 ? triadA : triadB;
				const other = i < 4 ? triadB : triadA;
				expect(slot.role).toBe(i < 4 ? 'triad-a' : 'triad-b');
				expect(new Set(slot.exactPcs)).toEqual(new Set(own));
				expect(new Set(slot.patternPcs)).toEqual(new Set(other));
				expect(slot.generatePc).toBe(own[contour[i % 4]]);
			});
		}
	);

	it('ignores beatPlacement: offbeat variants keep the eighths on the beat', () => {
		const down = buildFourEighthsSlots(TRIAD_LADDER[0][1], baseContext);
		const off = buildFourEighthsSlots(TRIAD_LADDER[4][1], baseContext);
		expect(off.map((s) => fractionToFloat(s.offset))).toEqual(
			down.map((s) => fractionToFloat(s.offset))
		);
	});
});

describe('triad-pairs best-of style scoring', () => {
	const params = TRIAD_LADDER[0][1]; // 4+5, low-first, downbeat
	const offParams = TRIAD_LADDER[4][1]; // 4+5, low-first, offbeat

	/** Play a spec's canonical pcs near middle C at each slot's onset. */
	function playSpec(slots: TrickSlotSpec[]): DetectedNote[] {
		return slots.map((slot) => makeDetected(60 + slot.generatePc!, slotOnsetSeconds(slot)));
	}

	it('declares the three styles in canonical order', () => {
		expect(TRIAD_PAIR_STYLES).toEqual(['cell', 'triplets', 'four-eighths']);
		expect(triadPairsTrick.exampleStyles).toEqual(['cell', 'triplets', 'four-eighths']);
		expect(enclosuresTrick.exampleStyles).toBeUndefined();
	});

	it('a perfect cell performance wins as "cell" with patternScore 1', () => {
		const result = triadPairsTrick.scoreConformance(
			playSpec(buildTriadPairSlots(params, baseContext)),
			params,
			baseContext
		);
		expect(result.style).toBe('cell');
		expect(result.patternScore).toBe(1);
		expect(result.slots).toHaveLength(8);
	});

	it('a perfect alternating-triplet performance wins as "triplets" with patternScore 1', () => {
		const result = triadPairsTrick.scoreConformance(
			playSpec(buildTripletSlots(params, baseContext)),
			params,
			baseContext
		);
		expect(result.style).toBe('triplets');
		expect(result.patternScore).toBe(1);
		expect(result.slots).toHaveLength(12);
		expect(result.extraCount).toBe(0);
	});

	it('the motivating C-E-G-E / D-F#-A-F# line scores 1 as "four-eighths" (4+5 in G)', () => {
		const gContext: TrickContext = { ...baseContext, chordRoot: 'G', key: 'G' };
		const played = [60, 64, 67, 64, 62, 66, 69, 66].map((midi, i) =>
			makeDetected(midi, i * 0.25)
		);
		const result = triadPairsTrick.scoreConformance(played, params, gContext);
		expect(result.style).toBe('four-eighths');
		expect(result.patternScore).toBe(1);
	});

	it('any inversion/combination within each four-eighths half still scores 1', () => {
		const gContext: TrickContext = { ...baseContext, chordRoot: 'G', key: 'G' };
		const played = [64, 67, 60, 67, 66, 69, 62, 69].map((midi, i) =>
			makeDetected(midi, i * 0.25)
		);
		const result = triadPairsTrick.scoreConformance(played, params, gContext);
		expect(result.style).toBe('four-eighths');
		expect(result.patternScore).toBe(1);
	});

	it('offbeat variants accept the shifted cell AND on-beat alternates', () => {
		const shiftedCell = triadPairsTrick.scoreConformance(
			playSpec(buildTriadPairSlots(offParams, baseContext)),
			offParams,
			baseContext
		);
		expect(shiftedCell.style).toBe('cell');
		expect(shiftedCell.patternScore).toBe(1);

		const onBeatTriplets = triadPairsTrick.scoreConformance(
			playSpec(buildTripletSlots(offParams, baseContext)),
			offParams,
			baseContext
		);
		expect(onBeatTriplets.style).toBe('triplets');
		expect(onBeatTriplets.patternScore).toBe(1);
	});

	it('eight eighths all from triad A earn only partial credit', () => {
		const slots = buildFourEighthsSlots(params, baseContext);
		const aOnly = slots.map((slot, i) =>
			makeDetected(60 + slots[i % 4].generatePc!, slotOnsetSeconds(slot))
		);
		const result = triadPairsTrick.scoreConformance(aOnly, params, baseContext);
		expect(result.patternScore).toBeLessThan(0.9);
	});

	it('style never enters the variant key', () => {
		expect(trickVariantKey('triad-pairs', params)).toBe(
			'triad-pairs:beatPlacement=downbeat,order=low-first,pair=4+5'
		);
	});
});

describe('generateExample (every pinned ladder combo)', () => {
	const cases: [string, TrickParameters, typeof enclosuresTrick, (p: TrickParameters, c: TrickContext) => TrickSlotSpec[]][] = [
		...ENCLOSURE_LADDER.map(([name, params]): [string, TrickParameters, typeof enclosuresTrick, (p: TrickParameters, c: TrickContext) => TrickSlotSpec[]] =>
			[name, params, enclosuresTrick, buildEnclosureSlots]),
		...TRIAD_LADDER.map(([name, params]): [string, TrickParameters, typeof triadPairsTrick, (p: TrickParameters, c: TrickContext) => TrickSlotSpec[]] =>
			[name, params, triadPairsTrick, buildTriadPairSlots])
	];

	it.each(cases)('%s realizes a non-null phrase matching slot pcs', (_name, params, trick, build) => {
		const phrase = trick.generateExample(params, baseContext);
		expect(phrase).not.toBeNull();

		const slots = build(params, baseContext);
		expect(phrase!.notes).toHaveLength(slots.length);
		phrase!.notes.forEach((note, i) => {
			expect(note.pitch).not.toBeNull();
			const pc = ((note.pitch! % 12) + 12) % 12;
			expect(pc).toBe(slots[i].generatePc ?? slots[i].exactPcs[0]);
		});
	});

	it.each(cases)('%s: a perfect performance scores ≥ 0.99, scrambled < 0.6', (_name, params, trick, build) => {
		const phrase = trick.generateExample(params, baseContext);
		expect(phrase).not.toBeNull();

		const slots = build(params, baseContext);
		const played = phrase!.notes.map((note, i) =>
			makeDetected(note.pitch!, slotOnsetSeconds(slots[i]))
		);
		const perfect = trick.scoreConformance(played, params, baseContext);
		expect(perfect.patternScore).toBeGreaterThanOrEqual(0.99);

		const scrambled = played.map((note) => ({ ...note, midi: note.midi + 6 }));
		const bad = trick.scoreConformance(scrambled, params, baseContext);
		expect(bad.patternScore).toBeLessThan(0.6);
	});
});

describe('trick catalog', () => {
	it('exposes exactly the two tricks', () => {
		expect(TRICKS.map((t) => t.id)).toEqual(['enclosures', 'triad-pairs']);
	});

	it('getTrickById round-trips both ids and rejects unknowns', () => {
		expect(getTrickById('enclosures')).toBe(enclosuresTrick);
		expect(getTrickById('triad-pairs')).toBe(triadPairsTrick);
		expect(getTrickById('digital-patterns')).toBeUndefined();
		expect(getTrickById('')).toBeUndefined();
	});
});
