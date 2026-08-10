import { describe, expect, it } from 'vitest';
import type { DetectedNote } from '$lib/types/audio';
import type { Trick, TrickContext, TrickParameters, TrickSlotSpec } from '$lib/types/tricks';
import { fractionToFloat } from '$lib/music/intervals';
import { buildEnclosureSlots, enclosuresTrick } from '$lib/tricks/devices/enclosures';
import { allowedSubdivisions } from '$lib/tricks/example-generator';
import { trickVariantKey } from '$lib/types/tricks';
import {
	buildFourEighthsSlots,
	buildTriadPairSlots,
	buildTripletSlots,
	getTriadPairFamily,
	TRIAD_PAIR_STYLES,
	triadPairsTrick
} from '$lib/tricks/devices/triad-pairs';
import { exampleStyleForRound, getTrickById, TRICKS } from '$lib/tricks';

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

/** Pinned mastery-ladder combos (contract t1-t8, the pair-family stages). */
const TRIAD_LADDER: [string, TrickParameters][] = [
	['t1', { pair: 'major-whole' }],
	['t2', { pair: 'major-minor' }],
	['t3', { pair: 'minor-whole' }],
	['t4', { pair: 'major-tritone' }],
	['t5', { pair: 'minor-b9' }],
	['t6', { pair: 'major-sharp11' }],
	['t7', { pair: 'aug-major' }],
	['t8', { pair: 'aug-whole' }]
];

/**
 * Pinned triad pcs per family over a C root (triad a = lower-rooted, led
 * with; pcs in chord order root/third/fifth). Musical content of the table:
 * C·D, C·Dm, Dm·Em, C·G♭, D♭m·E♭m, G♭·A♭, E♭+·F, C+·D+.
 */
const EXPECTED_TRIADS: Record<string, { a: number[]; b: number[] }> = {
	'major-whole': { a: [0, 4, 7], b: [2, 6, 9] },
	'major-minor': { a: [0, 4, 7], b: [2, 5, 9] },
	'minor-whole': { a: [2, 5, 9], b: [4, 7, 11] },
	'major-tritone': { a: [0, 4, 7], b: [6, 10, 1] },
	'minor-b9': { a: [1, 4, 8], b: [3, 6, 10] },
	'major-sharp11': { a: [6, 10, 1], b: [8, 0, 3] },
	'aug-major': { a: [3, 7, 11], b: [5, 9, 0] },
	'aug-whole': { a: [0, 4, 8], b: [2, 6, 10] }
};

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
		// context.level is a PLAYER level (1-100), never a content tier. Levels
		// 1-12 map to tiers 1-2, neither of which has eighths; tier 3 (from level
		// 13) is where they arrive. Pin both sides of that boundary so the
		// fallback is shown to track the level, not a coincidence of magnitude.
		expect(allowedSubdivisions(12)).not.toContain('eighth');
		expect(allowedSubdivisions(13)).toContain('eighth');

		const slots = buildEnclosureSlots(ENCLOSURE_LADDER[0][1], { ...baseContext, level: 12 });
		assertValidSlots(slots);
		for (const slot of slots) {
			expect(fractionToFloat(slot.duration)).toBeCloseTo(0.25, 9);
		}

		const eighths = buildEnclosureSlots(ENCLOSURE_LADDER[0][1], { ...baseContext, level: 13 });
		assertValidSlots(eighths);
		expect(eighths.some((s) => fractionToFloat(s.duration) === 0.125)).toBe(true);
	});
});

describe('buildTriadPairSlots', () => {
	it.each(TRIAD_LADDER)('produces valid slots for %s', (_name, params) => {
		assertValidSlots(buildTriadPairSlots(params, baseContext));
	});

	it.each(TRIAD_LADDER)('%s alternates the family triads, leading with the lower', (_name, params) => {
		const slots = buildTriadPairSlots(params, baseContext);
		expect(slots).toHaveLength(8);

		const { a: triadA, b: triadB } = EXPECTED_TRIADS[params.pair];
		const union = new Set([...triadA, ...triadB]);

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

	it.each(TRIAD_LADDER)('%s: the two triads are disjoint pc sets', (_name, params) => {
		const { a, b } = EXPECTED_TRIADS[params.pair];
		expect(a.filter((pc) => b.includes(pc))).toEqual([]);
	});

	it('the cell sits on the straight eighth grid from the downbeat', () => {
		for (const [, params] of TRIAD_LADDER) {
			const slots = buildTriadPairSlots(params, baseContext);
			slots.forEach((slot, i) => {
				expect(fractionToFloat(slot.offset)).toBeCloseTo(i / 8, 9);
			});
		}
	});
});

describe('buildTripletSlots', () => {
	it.each(TRIAD_LADDER)('produces valid slots for %s', (_name, params) => {
		assertValidSlots(buildTripletSlots(params, baseContext));
	});

	it.each(TRIAD_LADDER)(
		'%s: four beat-aligned triplet groups alternating the family triads',
		(_name, params) => {
			const slots = buildTripletSlots(params, baseContext);
			expect(slots).toHaveLength(12);

			const { a: triadA, b: triadB } = EXPECTED_TRIADS[params.pair];

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

			const { a: triadA, b: triadB } = EXPECTED_TRIADS[params.pair];
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
});

describe('triad-pairs best-of style scoring', () => {
	// major-whole over C = C·D majors — the motivating C-E-G-E, D-F#-A-F# pair.
	const params: TrickParameters = { pair: 'major-whole' };

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

	it('a perfect alternating-triplet performance scores 1 with no extras', () => {
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

	it('the motivating C-E-G-E / D-F#-A-F# line scores 1 as "four-eighths"', () => {
		const played = [60, 64, 67, 64, 62, 66, 69, 66].map((midi, i) =>
			makeDetected(midi, i * 0.25)
		);
		const result = triadPairsTrick.scoreConformance(played, params, baseContext);
		expect(result.style).toBe('four-eighths');
		expect(result.patternScore).toBe(1);
	});

	it('any inversion/combination within each four-eighths half still scores 1', () => {
		const played = [64, 67, 60, 67, 66, 69, 62, 69].map((midi, i) =>
			makeDetected(midi, i * 0.25)
		);
		const result = triadPairsTrick.scoreConformance(played, params, baseContext);
		expect(result.style).toBe('four-eighths');
		expect(result.patternScore).toBe(1);
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
		expect(trickVariantKey('triad-pairs', params)).toBe('triad-pairs:pair=major-whole');
	});
});

describe('triad-pairs generateExample styles', () => {
	const params: TrickParameters = { pair: 'major-whole' };

	it('honors exampleStyle "triplets": 12 notes on the triplet grid', () => {
		const phrase = triadPairsTrick.generateExample(params, {
			...baseContext,
			exampleStyle: 'triplets'
		});
		expect(phrase).not.toBeNull();
		expect(phrase!.notes).toHaveLength(12);
		const slots = buildTripletSlots(params, baseContext);
		phrase!.notes.forEach((note, i) => {
			expect(fractionToFloat(note.offset)).toBeCloseTo(i / 12, 9);
			expect(fractionToFloat(note.duration)).toBeCloseTo(1 / 12, 9);
			expect(((note.pitch! % 12) + 12) % 12).toBe(slots[i].generatePc);
		});
	});

	it('honors exampleStyle "four-eighths" with the root-3rd-5th-3rd contour', () => {
		const phrase = triadPairsTrick.generateExample(params, {
			...baseContext,
			exampleStyle: 'four-eighths'
		});
		expect(phrase).not.toBeNull();
		expect(phrase!.notes).toHaveLength(8);
		const slots = buildFourEighthsSlots(params, baseContext);
		phrase!.notes.forEach((note, i) => {
			expect(fractionToFloat(note.offset)).toBeCloseTo(i / 8, 9);
			expect(((note.pitch! % 12) + 12) % 12).toBe(slots[i].generatePc);
		});
	});

	it('defaults to the cell when exampleStyle is absent or unknown', () => {
		const absent = triadPairsTrick.generateExample(params, baseContext);
		const unknown = triadPairsTrick.generateExample(params, {
			...baseContext,
			exampleStyle: 'nope'
		});
		const cellSlots = buildTriadPairSlots(params, baseContext);
		for (const phrase of [absent, unknown]) {
			expect(phrase).not.toBeNull();
			expect(phrase!.notes).toHaveLength(8);
			// Cell slot 3 is triad B's root — distinct from four-eighths' slot 3
			// (triad A's 3rd), so this pins the cell shape specifically.
			expect(((phrase!.notes[3].pitch! % 12) + 12) % 12).toBe(cellSlots[3].generatePc);
		}
	});
});

describe('triad-pair family applicability', () => {
	it('pins per-family chord qualities, most characteristic first', () => {
		const q = (value: string) => getTriadPairFamily(value)!.qualities;
		expect(q('major-whole')).toEqual(['maj7', 'maj6', '7']); // the broad family
		expect(q('major-minor')).toEqual(['maj7', 'maj6']);
		expect(q('minor-whole')).toEqual(['maj7', 'maj6']);
		expect(q('major-tritone')).toEqual(['7', '7b9', '7#9', '7#11']);
		expect(q('minor-b9')).toEqual(['7alt', '7', '7b9', '7#9', '7#11', '7b13']);
		expect(q('major-sharp11')).toEqual(['7alt', '7', '7b9', '7#9', '7#11', '7b13']);
		expect(q('aug-major')).toEqual(['minMaj7', 'min6', 'min7']);
		expect(q('aug-whole')).toEqual(['7', 'aug7', '7#11', '7b13']);
	});

	it('pins per-family practice beds', () => {
		const bed = (value: string) => triadPairsTrick.practiceBed!({ pair: value });
		expect(bed('major-whole')).toBe('major-vamp');
		expect(bed('major-minor')).toBe('major-vamp');
		expect(bed('minor-whole')).toBe('major-vamp');
		expect(bed('major-tritone')).toBe('dominant-vamp');
		expect(bed('minor-b9')).toBe('dominant-vamp');
		expect(bed('major-sharp11')).toBe('dominant-vamp');
		expect(bed('aug-major')).toBe('minor-vamp');
		expect(bed('aug-whole')).toBe('dominant-vamp');
	});

	it('compatibleQualitiesFor mirrors the family and falls back to stage 1', () => {
		expect(triadPairsTrick.compatibleQualitiesFor!({ pair: 'minor-b9' })).toEqual(
			getTriadPairFamily('minor-b9')!.qualities
		);
		expect(triadPairsTrick.compatibleQualitiesFor!({})).toEqual(
			getTriadPairFamily('major-whole')!.qualities
		);
	});
});

describe('generateExample (every pinned ladder combo)', () => {
	type Builder = (p: TrickParameters, c: TrickContext) => TrickSlotSpec[];
	// Scramble shift per device: +6 breaks every enclosure, but the tritone
	// and whole-tone pair families are symmetric under +6 (each triad lands
	// on its partner ⇒ everything scores in-pattern), so triad pairs scramble
	// by +1 — no family maps into itself or its partner a semitone up.
	const cases: [string, TrickParameters, Trick, Builder, number][] = [
		...ENCLOSURE_LADDER.map(([name, params]): [string, TrickParameters, Trick, Builder, number] =>
			[name, params, enclosuresTrick, buildEnclosureSlots, 6]),
		...TRIAD_LADDER.map(([name, params]): [string, TrickParameters, Trick, Builder, number] =>
			[name, params, triadPairsTrick, buildTriadPairSlots, 1])
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

	it.each(cases)('%s: a perfect performance scores ≥ 0.99, scrambled < 0.6', (_name, params, trick, build, scramble) => {
		const phrase = trick.generateExample(params, baseContext);
		expect(phrase).not.toBeNull();

		const slots = build(params, baseContext);
		const played = phrase!.notes.map((note, i) =>
			makeDetected(note.pitch!, slotOnsetSeconds(slots[i]))
		);
		const perfect = trick.scoreConformance(played, params, baseContext);
		expect(perfect.patternScore).toBeGreaterThanOrEqual(0.99);

		const scrambled = played.map((note) => ({ ...note, midi: note.midi + scramble }));
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

	it('exampleStyleForRound rotates triad-pair styles and cycles', () => {
		expect(exampleStyleForRound(triadPairsTrick, 1)).toBe('cell');
		expect(exampleStyleForRound(triadPairsTrick, 2)).toBe('triplets');
		expect(exampleStyleForRound(triadPairsTrick, 3)).toBe('four-eighths');
		expect(exampleStyleForRound(triadPairsTrick, 4)).toBe('cell');
		expect(exampleStyleForRound(triadPairsTrick, 7)).toBe('cell');
	});

	it('exampleStyleForRound is undefined for single-style tricks and clamps bad rounds', () => {
		expect(exampleStyleForRound(enclosuresTrick, 1)).toBeUndefined();
		expect(exampleStyleForRound(triadPairsTrick, 0)).toBe('cell');
	});
});
