import { describe, it, expect } from 'vitest';
import type { Tune } from '$lib/types/tune';
import {
	validateAdoptedLeadSheet,
	MAX_NOTES_PER_ADOPTED_SHEET,
	MAX_SECTIONS_PER_ADOPTED_SHEET
} from '$lib/leadsheets/adopted-lead-sheet-validator';

function validSheet(overrides: Partial<Tune> = {}): Tune {
	return {
		id: 'sheet-1-abcd',
		title: 'A Fine Tune',
		key: 'F',
		timeSignature: [4, 4],
		tags: ['blues'],
		sections: [{
			label: 'A',
			bars: 4,
			notes: [{ pitch: 65, duration: [1, 4], offset: [0, 1] }],
			harmony: [{
				chord: { root: 'F', quality: '7' },
				scaleId: 'blues.major',
				startOffset: [0, 1],
				duration: [1, 1],
				symbol: 'F7'
			}]
		}],
		source: 'user',
		...overrides
	};
}

describe('validateAdoptedLeadSheet', () => {
	it('accepts a structurally valid sheet', () => {
		const result = validateAdoptedLeadSheet(validSheet());
		expect(result.errors).toEqual([]);
		expect(result.valid).toBe(true);
	});

	it('accepts a harmony-only sheet (empty melody)', () => {
		const sheet = validSheet();
		sheet.sections[0].notes = [];
		expect(validateAdoptedLeadSheet(sheet).valid).toBe(true);
	});

	it('rejects non-objects and missing basics', () => {
		expect(validateAdoptedLeadSheet(null).valid).toBe(false);
		expect(validateAdoptedLeadSheet('x').valid).toBe(false);
		expect(validateAdoptedLeadSheet(validSheet({ id: '' })).valid).toBe(false);
		expect(validateAdoptedLeadSheet(validSheet({ title: '' })).valid).toBe(false);
	});

	it('rejects an invalid key or time signature', () => {
		expect(validateAdoptedLeadSheet(validSheet({ key: 'H' as never })).valid).toBe(false);
		expect(validateAdoptedLeadSheet(validSheet({ timeSignature: [4, 0] })).valid).toBe(false);
	});

	it('rejects a sheet with no sections or no content at all', () => {
		expect(validateAdoptedLeadSheet(validSheet({ sections: [] })).valid).toBe(false);
		const empty = validSheet();
		empty.sections[0].notes = [];
		empty.sections[0].harmony = [];
		expect(validateAdoptedLeadSheet(empty).valid).toBe(false);
	});

	it('rejects malformed notes', () => {
		const badPitch = validSheet();
		badPitch.sections[0].notes = [{ pitch: 300, duration: [1, 4], offset: [0, 1] }];
		expect(validateAdoptedLeadSheet(badPitch).valid).toBe(false);

		const badDuration = validSheet();
		badDuration.sections[0].notes = [{ pitch: 60, duration: [0, 4], offset: [0, 1] }];
		expect(validateAdoptedLeadSheet(badDuration).valid).toBe(false);

		const badOffset = validSheet();
		badOffset.sections[0].notes = [{ pitch: 60, duration: [1, 4], offset: [1, 0] }];
		expect(validateAdoptedLeadSheet(badOffset).valid).toBe(false);
	});

	it('rejects harmony with an unknown chord root or quality', () => {
		const badRoot = validSheet();
		badRoot.sections[0].harmony[0].chord.root = 'X' as never;
		expect(validateAdoptedLeadSheet(badRoot).valid).toBe(false);

		const badQuality = validSheet();
		badQuality.sections[0].harmony[0].chord.quality = 'power-chord' as never;
		expect(validateAdoptedLeadSheet(badQuality).valid).toBe(false);
	});

	it('rejects script-like content in text fields', () => {
		expect(validateAdoptedLeadSheet(validSheet({ title: '<script>alert(1)</script>' })).valid).toBe(false);
		expect(validateAdoptedLeadSheet(validSheet({ composer: 'javascript:alert(1)' })).valid).toBe(false);
		expect(validateAdoptedLeadSheet(validSheet({ tags: ['onload=evil()'] })).valid).toBe(false);
		const badSymbol = validSheet();
		badSymbol.sections[0].harmony[0].symbol = '<img src=x>';
		expect(validateAdoptedLeadSheet(badSymbol).valid).toBe(false);
	});

	it('allows harmless angle brackets and text', () => {
		expect(validateAdoptedLeadSheet(validSheet({ title: 'I <3 Jazz' })).valid).toBe(true);
	});

	it('enforces DoS caps on note and section counts', () => {
		const tooManyNotes = validSheet();
		tooManyNotes.sections[0].notes = Array.from({ length: MAX_NOTES_PER_ADOPTED_SHEET + 1 }, (_, i) => ({
			pitch: 60,
			duration: [1, 4] as [number, number],
			offset: [i, 4] as [number, number]
		}));
		tooManyNotes.sections[0].bars = 10_000;
		expect(validateAdoptedLeadSheet(tooManyNotes).valid).toBe(false);

		const tooManySections = validSheet({
			sections: Array.from({ length: MAX_SECTIONS_PER_ADOPTED_SHEET + 1 }, () => ({
				label: 'A',
				bars: 1,
				notes: [],
				harmony: [{
					chord: { root: 'C' as const, quality: 'maj7' as const },
					scaleId: 'major.ionian',
					startOffset: [0, 1] as [number, number],
					duration: [1, 1] as [number, number]
				}]
			}))
		});
		expect(validateAdoptedLeadSheet(tooManySections).valid).toBe(false);
	});
});
