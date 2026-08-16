import { describe, it, expect } from 'vitest';
import { realizeTrickExample, allowedSubdivisions } from '$lib/tricks/example-generator';
import type { TrickExampleArgs } from '$lib/tricks/example-generator';
import type { TrickContext, TrickSlotSpec } from '$lib/types/tricks';
import type { Fraction } from '$lib/types/music';

function makeContext(overrides: Partial<TrickContext> = {}): TrickContext {
	return {
		chordRoot: 'C',
		chordQuality: 'maj7',
		scaleId: 'major.ionian',
		key: 'C',
		timeSignature: [4, 4],
		level: 50,
		tempo: 120,
		...overrides
	};
}

function makeSlot(
	pc: number,
	offset: Fraction,
	duration: Fraction = [1, 8],
	role = 'target'
): TrickSlotSpec {
	return { offset, duration, exactPcs: [pc], role };
}

function makeArgs(overrides: Partial<TrickExampleArgs> = {}): TrickExampleArgs {
	return {
		trickId: 'enclosures',
		name: 'Test Trick',
		category: 'enclosures',
		tags: ['trick', 'enclosures'],
		slots: [
			makeSlot(0, [0, 1]),
			makeSlot(4, [1, 8]),
			makeSlot(7, [1, 4]),
			makeSlot(11, [3, 8])
		],
		parameters: { noteCount: '1', shape: 'chromatic-below' },
		context: makeContext(),
		...overrides
	};
}

describe('realizeTrickExample', () => {
	it('realizes a 4-slot spec over C maj7 into a valid Phrase', () => {
		const args = makeArgs();
		const phrase = realizeTrickExample(args);
		expect(phrase).not.toBeNull();

		expect(phrase!.notes).toHaveLength(4);
		phrase!.notes.forEach((note, i) => {
			expect(note.offset).toEqual(args.slots[i].offset);
			expect(note.duration).toEqual(args.slots[i].duration);
			expect(note.pitch).not.toBeNull();
			expect(note.pitch! % 12).toBe(args.slots[i].exactPcs[0]);
			expect(note.pitch!).toBeGreaterThanOrEqual(44);
			expect(note.pitch!).toBeLessThanOrEqual(75);
		});

		// Deterministic walk: seed nearest middle C, then nearest instances
		expect(phrase!.notes.map((n) => n.pitch)).toEqual([60, 64, 67, 71]);

		expect(phrase!.harmony).toHaveLength(1);
		const segment = phrase!.harmony[0];
		expect(segment.symbol).toBe('CΔ7');
		expect(segment.chord.root).toBe('C');
		expect(segment.chord.quality).toBe('maj7');
		expect(segment.scaleId).toBe('major.ionian');
		expect(segment.startOffset).toEqual([0, 1]);
		expect(segment.duration).toEqual([1, 1]);

		expect(phrase!.key).toBe('C');
		expect(phrase!.timeSignature).toEqual([4, 4]);
		expect(phrase!.category).toBe('enclosures');
		expect(phrase!.tags).toEqual(['trick', 'enclosures']);
		expect(phrase!.name).toBe('Test Trick');
		expect(phrase!.source).toBe('generated');
		expect(
			phrase!.id.startsWith('trick-enclosures:noteCount=1,shape=chromatic-below-C-')
		).toBe(true);
		expect(phrase!.difficulty.level).toBeGreaterThanOrEqual(1);
	});

	it('mints distinct ids for repeated generations of the same variant', () => {
		const a = realizeTrickExample(makeArgs());
		const b = realizeTrickExample(makeArgs());
		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		expect(a!.id).not.toBe(b!.id);
	});

	it('rounds the harmonic segment up to whole notes', () => {
		const phrase = realizeTrickExample(
			makeArgs({
				slots: [makeSlot(0, [0, 1], [1, 4]), makeSlot(4, [1, 1], [1, 4])]
			})
		);
		expect(phrase).not.toBeNull();
		expect(phrase!.harmony[0].duration).toEqual([2, 1]);
	});

	it('prefers generatePc over exactPcs[0] when realizing', () => {
		const slots: TrickSlotSpec[] = [
			{ offset: [0, 1], duration: [1, 8], exactPcs: [0], generatePc: 4, role: 'target' },
			makeSlot(7, [1, 8])
		];
		const phrase = realizeTrickExample(makeArgs({ slots }));
		expect(phrase).not.toBeNull();
		expect(phrase!.notes[0].pitch! % 12).toBe(4);
	});

	it('returns null when a pitch class has no in-range instance', () => {
		const phrase = realizeTrickExample(
			makeArgs({
				slots: [makeSlot(0, [0, 1]), makeSlot(7, [1, 8])],
				rangeLow: 60,
				rangeHigh: 63 // window contains pcs 0-3 only; G (7) is unrealizable
			})
		);
		expect(phrase).toBeNull();
	});

	it('returns null for an empty slot spec', () => {
		expect(realizeTrickExample(makeArgs({ slots: [] }))).toBeNull();
	});

	it('keeps consecutive intervals bounded on a wide-leap spec at level 1 and 90', () => {
		// Alternating tritones — the leapiest pc walk possible. Nearest-instance
		// realization must never exceed 6 semitones between neighbours here.
		const slots = [
			makeSlot(0, [0, 1]),
			makeSlot(6, [1, 8]),
			makeSlot(0, [1, 4]),
			makeSlot(6, [3, 8])
		];
		for (const level of [1, 90]) {
			const phrase = realizeTrickExample(makeArgs({ slots, context: makeContext({ level }) }));
			expect(phrase).not.toBeNull();
			const pitches = phrase!.notes.map((n) => n.pitch!);
			for (let i = 1; i < pitches.length; i++) {
				expect(Math.abs(pitches[i] - pitches[i - 1])).toBeLessThanOrEqual(6);
			}
		}
	});

	it('falls back to nearest-in-range when the window forces a leap past the profile bound', () => {
		// Level 1 profile allows 4 semitones, but the only Ab in [60, 68] is an
		// 8-semitone leap — the walk takes it, and relaxed validation (min cap 9)
		// still accepts the phrase.
		const phrase = realizeTrickExample(
			makeArgs({
				slots: [makeSlot(0, [0, 1], [1, 4]), makeSlot(8, [1, 4], [1, 4])],
				context: makeContext({ level: 1 }),
				rangeLow: 60,
				rangeHigh: 68
			})
		);
		expect(phrase).not.toBeNull();
		expect(phrase!.notes.map((n) => n.pitch)).toEqual([60, 68]);
	});

	it('returns null when validation rejects a forced leap past the relaxed cap', () => {
		// The only B in [60, 71] is 11 semitones from C — beyond max(4, 9)
		const phrase = realizeTrickExample(
			makeArgs({
				slots: [makeSlot(0, [0, 1], [1, 4]), makeSlot(11, [1, 4], [1, 4])],
				context: makeContext({ level: 1 }),
				rangeLow: 60,
				rangeHigh: 71
			})
		);
		expect(phrase).toBeNull();
	});

	it('realizes chromatic (out-of-scale) pcs by nearest-octave math', () => {
		// Db (1) and F# (6) are outside C ionian
		const phrase = realizeTrickExample(
			makeArgs({
				slots: [
					makeSlot(0, [0, 1]),
					makeSlot(1, [1, 8]),
					makeSlot(6, [1, 4]),
					makeSlot(7, [3, 8])
				]
			})
		);
		expect(phrase).not.toBeNull();
		expect(phrase!.notes.map((n) => n.pitch)).toEqual([60, 61, 66, 67]);
	});
});

describe('pickupBars metadata', () => {
	it('stamps difficulty.pickupBars when provided, including an explicit 0', () => {
		expect(realizeTrickExample(makeArgs({ pickupBars: 1 }))!.difficulty.pickupBars).toBe(1);
		expect(realizeTrickExample(makeArgs({ pickupBars: 0 }))!.difficulty.pickupBars).toBe(0);
	});

	it('leaves difficulty.pickupBars absent when the arg is omitted', () => {
		expect(realizeTrickExample(makeArgs())!.difficulty.pickupBars).toBeUndefined();
	});
});

describe('internal-gap rest fill', () => {
	it('bridges a gap between slots with an explicit rest', () => {
		// Eighth at 0, gap of an eighth, eighth at 1/4.
		const slots = [makeSlot(0, [0, 1], [1, 8]), makeSlot(7, [1, 4], [1, 8])];
		const phrase = realizeTrickExample(makeArgs({ slots }));
		expect(phrase).not.toBeNull();
		expect(phrase!.notes).toHaveLength(3);
		const rest = phrase!.notes[1];
		expect(rest.pitch).toBeNull();
		expect(rest.offset).toEqual([1, 8]);
		expect(rest.duration).toEqual([1, 8]);
		// Neighbours are the realized slot notes, untouched.
		expect(phrase!.notes[0].pitch).not.toBeNull();
		expect(phrase!.notes[2].pitch).not.toBeNull();
	});

	it('adds no rests when slots are contiguous', () => {
		const phrase = realizeTrickExample(makeArgs());
		expect(phrase!.notes.every((n) => n.pitch !== null)).toBe(true);
	});

	it('never pads before the first note — the anacrusis stays a true partial bar', () => {
		// A pickup figure: first note at beat 4 of bar 0, target on bar 1.
		const slots = [makeSlot(11, [3, 4], [1, 4]), makeSlot(0, [1, 1], [1, 4])];
		const phrase = realizeTrickExample(makeArgs({ slots, pickupBars: 1 }));
		expect(phrase).not.toBeNull();
		expect(phrase!.notes[0].pitch).not.toBeNull();
		expect(phrase!.notes[0].offset).toEqual([3, 4]);
		// ...and never after the last note either.
		expect(phrase!.notes.at(-1)!.pitch).not.toBeNull();
	});
});

describe('allowedSubdivisions', () => {
	it('returns the level profile rhythm types', () => {
		expect(allowedSubdivisions(1)).toEqual(['quarter']);
		expect(allowedSubdivisions(50)).toEqual(['quarter', 'eighth', 'triplet']);
		expect(allowedSubdivisions(100)).toContain('sixteenth');
	});

	it('reads its argument as a PLAYER level across the whole 1-100 range', () => {
		// Levels 1-12 map to tiers 1-2, which are quarter-notes-only. The old
		// magnitude heuristic read 1-10 as tier indices, so a level of 10
		// returned tier 10's full vocabulary — sixteenths included.
		for (let level = 1; level <= 12; level++) {
			expect(allowedSubdivisions(level), `level ${level}`).toEqual(['quarter']);
		}
		expect(allowedSubdivisions(13)).toContain('eighth');
	});

	it('widens monotonically as the level rises', () => {
		let prev = 0;
		for (let level = 1; level <= 100; level++) {
			const count = allowedSubdivisions(level).length;
			expect(count, `level ${level}`).toBeGreaterThanOrEqual(prev);
			prev = count;
		}
	});
});
