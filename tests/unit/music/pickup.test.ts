import { describe, it, expect } from 'vitest';
import type { Note } from '$lib/types/music';
import type { TuneSection } from '$lib/types/tune';
import {
	isPickupOnlySection,
	pickupFirstBeat,
	pickupLengthFromMelody,
	pickupLengthLabel,
	pickupLengthOptions,
	pickupPrefix,
	resolvePickupLength
} from '$lib/music/pickup';

const FOUR_FOUR: [number, number] = [4, 4];
const THREE_FOUR: [number, number] = [3, 4];

/** A section with the import defaults — blank label, one bar, no content — plus overrides. */
function sec(overrides: Partial<TuneSection>): TuneSection {
	return { label: '', bars: 1, notes: [], harmony: [], ...overrides };
}

/** A sheet with the section under test FOLLOWED by a form, the import shape. */
function sheetOf(s: TuneSection, timeSignature: [number, number] = FOUR_FOUR, ...rest: TuneSection[]) {
	const form = rest.length ? rest : [sec({ label: 'A', bars: 8 })];
	return { timeSignature, sections: [s, ...form] };
}

describe('pickupLengthFromMelody', () => {
	it('reads a one-beat pickup off a note on beat 4 of a 4/4 bar', () => {
		const notes: Note[] = [{ pitch: 46, duration: [1, 4], offset: [3, 4] }];
		expect(pickupLengthFromMelody(notes, FOUR_FOUR)).toEqual([1, 4]);
	});

	it('floors a sub-beat first onset to its beat (the and-of-4 is still a one-beat pickup)', () => {
		const notes: Note[] = [{ pitch: 46, duration: [1, 8], offset: [7, 8] }];
		expect(pickupLengthFromMelody(notes, FOUR_FOUR)).toEqual([1, 4]);
	});

	it('ignores stored rests — an explicit leading rest does not move the pickup start', () => {
		const notes: Note[] = [
			{ pitch: null, duration: [3, 4], offset: [0, 1] },
			{ pitch: 46, duration: [1, 4], offset: [3, 4] }
		];
		expect(pickupLengthFromMelody(notes, FOUR_FOUR)).toEqual([1, 4]);
	});

	it('returns null when the melody starts on the downbeat or bar 0 has no pitched note', () => {
		expect(pickupLengthFromMelody([{ pitch: 60, duration: [1, 4], offset: [0, 1] }], FOUR_FOUR)).toBeNull();
		expect(pickupLengthFromMelody([], FOUR_FOUR)).toBeNull();
		expect(pickupLengthFromMelody([{ pitch: null, duration: [1, 1], offset: [0, 1] }], FOUR_FOUR)).toBeNull();
		// A note in bar 1 says nothing about bar 0.
		expect(pickupLengthFromMelody([{ pitch: 60, duration: [1, 4], offset: [5, 4] }], FOUR_FOUR)).toBeNull();
	});

	it('measures against the actual bar length in 3/4', () => {
		const notes: Note[] = [{ pitch: 60, duration: [1, 8], offset: [5, 8] }];
		// Beat unit is a quarter: 5/8 floors to 1/2; 3/4 − 1/2 = one beat.
		expect(pickupLengthFromMelody(notes, THREE_FOUR)).toEqual([1, 4]);
	});
});

describe('resolvePickupLength', () => {
	it('returns a valid explicit pickupLength', () => {
		const s = sec({ label: 'A', bars: 9, pickupLength: [1, 4], notes: [{ pitch: 46, duration: [1, 4], offset: [3, 4] }] });
		expect(resolvePickupLength(sheetOf(s), 0)).toEqual([1, 4]);
		// Works on any section index, any bar count, and alone — the field is per-section.
		expect(resolvePickupLength({ timeSignature: FOUR_FOUR, sections: [sec({ label: 'A' }), s] }, 1)).toEqual([1, 4]);
		expect(resolvePickupLength({ timeSignature: FOUR_FOUR, sections: [s] }, 0)).toEqual([1, 4]);
	});

	it('rejects an explicit length whose silent prefix holds a pitched note', () => {
		const s = sec({ pickupLength: [1, 4], notes: [{ pitch: 60, duration: [1, 4], offset: [1, 2] }] });
		expect(resolvePickupLength(sheetOf(s), 0)).toBeNull();
	});

	it('rejects an explicit length that is not strictly inside one bar', () => {
		expect(resolvePickupLength(sheetOf(sec({ pickupLength: [1, 1], label: 'A' })), 0)).toBeNull();
		expect(resolvePickupLength(sheetOf(sec({ pickupLength: [5, 4], label: 'A' })), 0)).toBeNull();
		expect(resolvePickupLength(sheetOf(sec({ pickupLength: [0, 1], label: 'A' })), 0)).toBeNull();
		expect(resolvePickupLength(sheetOf(sec({ pickupLength: [3, 4], label: 'A' }), THREE_FOUR), 0)).toBeNull();
	});

	it('infers the length for a legacy lone pickup section (blank label, one bar, first section)', () => {
		// The shape every MuseScore/PDF import wrote before the field existed.
		const s = sec({ notes: [{ pitch: 46, duration: [1, 4], offset: [3, 4] }] });
		expect(resolvePickupLength(sheetOf(s), 0)).toEqual([1, 4]);
		// …including rows the editor has re-saved with an explicit leading rest.
		const edited = sec({
			notes: [
				{ pitch: null, duration: [3, 4], offset: [0, 1] },
				{ pitch: 46, duration: [1, 4], offset: [3, 4] }
			]
		});
		expect(resolvePickupLength(sheetOf(edited), 0)).toEqual([1, 4]);
	});

	it('never infers outside the legacy shape', () => {
		const late = [{ pitch: 46, duration: [1, 4], offset: [3, 4] }] as Note[];
		expect(resolvePickupLength(sheetOf(sec({ label: 'A', notes: late })), 0)).toBeNull();
		expect(resolvePickupLength(sheetOf(sec({ bars: 2, notes: late })), 0)).toBeNull();
		expect(resolvePickupLength({ timeSignature: FOUR_FOUR, sections: [sec({ label: 'A' }), sec({ notes: late })] }, 1)).toBeNull();
		// A lone blank section is a lick's lead-sheet window, never a pickup —
		// the section builder only splits an anacrusis off when a form follows.
		expect(resolvePickupLength({ timeSignature: FOUR_FOUR, sections: [sec({ notes: late })] }, 0)).toBeNull();
		// A one-bar blank-label section whose melody starts on the downbeat is
		// front matter, not a pickup.
		expect(resolvePickupLength(sheetOf(sec({ notes: [{ pitch: 60, duration: [1, 1], offset: [0, 1] }] })), 0)).toBeNull();
	});
});

describe('pickupPrefix / pickupFirstBeat', () => {
	it('derives the silent prefix and the first printed beat from the length', () => {
		expect(pickupPrefix([1, 4], FOUR_FOUR)).toEqual([3, 4]);
		expect(pickupFirstBeat([1, 4], FOUR_FOUR)).toBe(3);
		expect(pickupFirstBeat([1, 8], FOUR_FOUR)).toBe(3.5);
		expect(pickupPrefix([1, 4], THREE_FOUR)).toEqual([1, 2]);
		expect(pickupFirstBeat([1, 4], THREE_FOUR)).toBe(2);
	});
});

describe('isPickupOnlySection', () => {
	it('is true only for a blank-labelled one-bar section with a resolvable pickup', () => {
		const late = [{ pitch: 46, duration: [1, 4], offset: [3, 4] }] as Note[];
		expect(isPickupOnlySection(sheetOf(sec({ pickupLength: [1, 4], notes: late })), 0)).toBe(true);
		expect(isPickupOnlySection(sheetOf(sec({ notes: late })), 0)).toBe(true); // legacy
		expect(isPickupOnlySection(sheetOf(sec({ label: 'A', pickupLength: [1, 4], notes: late })), 0)).toBe(false);
		expect(isPickupOnlySection(sheetOf(sec({ bars: 2, pickupLength: [1, 4], notes: late })), 0)).toBe(false);
		expect(isPickupOnlySection(sheetOf(sec({})), 0)).toBe(false);
		expect(isPickupOnlySection(sheetOf(sec({})), 5)).toBe(false);
	});
});

describe('pickupLengthOptions', () => {
	it('offers every eighth-note multiple strictly inside the bar', () => {
		expect(pickupLengthOptions(FOUR_FOUR)).toEqual([
			[1, 8], [1, 4], [3, 8], [1, 2], [5, 8], [3, 4], [7, 8]
		]);
		expect(pickupLengthOptions(THREE_FOUR)).toEqual([[1, 8], [1, 4], [3, 8], [1, 2], [5, 8]]);
	});
});

describe('curated charts', () => {
	it('carry their pickups explicitly (in-section, so the legacy rule cannot see them)', async () => {
		const { AMAZING_GRACE } = await import('$lib/data/tunes/amazing-grace');
		const { WHEN_THE_SAINTS } = await import('$lib/data/tunes/when-the-saints');
		expect(resolvePickupLength(AMAZING_GRACE, 0)).toEqual([1, 4]); // 3/4: "A-" on beat 3
		expect(resolvePickupLength(WHEN_THE_SAINTS, 0)).toEqual([3, 4]); // "Oh when the" on 2-3-4
	});
});

describe('pickupLengthLabel', () => {
	it('names a length in the meter\'s beats', () => {
		expect(pickupLengthLabel([1, 8], FOUR_FOUR)).toBe('½ beat');
		expect(pickupLengthLabel([1, 4], FOUR_FOUR)).toBe('1 beat');
		expect(pickupLengthLabel([3, 8], FOUR_FOUR)).toBe('1½ beats');
		expect(pickupLengthLabel([1, 2], FOUR_FOUR)).toBe('2 beats');
		expect(pickupLengthLabel([5, 8], THREE_FOUR)).toBe('2½ beats');
	});

	it('keeps a length finer than half a beat exact instead of rounding it to the nearest half', () => {
		const TWO_TWO: [number, number] = [2, 2];
		const SIX_EIGHT: [number, number] = [6, 8];
		expect(pickupLengthLabel([1, 16], FOUR_FOUR)).toBe('¼ beat');
		expect(pickupLengthLabel([3, 16], FOUR_FOUR)).toBe('¾ beat');
		expect(pickupLengthLabel([5, 16], FOUR_FOUR)).toBe('1¼ beats');
		expect(pickupLengthLabel([1, 12], FOUR_FOUR)).toBe('⅓ beat');
		expect(pickupLengthLabel([1, 32], FOUR_FOUR)).toBe('⅛ beat');
		// 2/2: the beat is a half note, so the editor's eighth-note options are quarter beats.
		expect(pickupLengthLabel([1, 8], TWO_TWO)).toBe('¼ beat');
		expect(pickupLengthLabel([3, 8], TWO_TWO)).toBe('¾ beat');
		// 6/8: the beat is an eighth.
		expect(pickupLengthLabel([1, 8], SIX_EIGHT)).toBe('1 beat');
		expect(pickupLengthLabel([3, 8], SIX_EIGHT)).toBe('3 beats');
		// No glyph for the remainder: spelled out, never an empty label.
		expect(pickupLengthLabel([1, 64], FOUR_FOUR)).toBe('1/16 beat');
		expect(pickupLengthLabel([17, 64], FOUR_FOUR)).toBe('1 1/16 beats');
	});
});
