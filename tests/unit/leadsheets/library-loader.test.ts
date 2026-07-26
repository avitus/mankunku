import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Tune } from '$lib/types/tune';
import {
	getAllLeadSheets,
	getLeadSheetById,
	isCuratedLeadSheetId,
	transposeLeadSheet
} from '$lib/leadsheets/library-loader';
import { ALL_CURATED_LEAD_SHEETS } from '$lib/data/leadsheets/index';
import { save } from '$lib/persistence/storage';
import { __resetNamespaceCacheForTests } from '$lib/persistence/namespace';

// ─── Mock localStorage ────────────────────────────────────────
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
	removeItem: vi.fn((key: string) => { delete store[key]; }),
	clear: vi.fn(() => { for (const key of Object.keys(store)) delete store[key]; }),
	get length() { return Object.keys(store).length; },
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
	localStorageMock.clear();
	__resetNamespaceCacheForTests();
});

function userSheet(overrides: Partial<Tune> = {}): Tune {
	return {
		id: 'sheet-123-abcd',
		title: 'My Tune',
		key: 'C',
		timeSignature: [4, 4],
		tags: [],
		sections: [{
			label: 'A',
			bars: 2,
			notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }],
			harmony: [{
				chord: { root: 'D', quality: 'min7' },
				scaleId: 'major.dorian',
				startOffset: [0, 1],
				duration: [1, 1],
				symbol: 'D-7'
			}]
		}],
		source: 'user',
		...overrides
	};
}

describe('getAllLeadSheets', () => {
	it('returns the curated catalog when no user data exists', () => {
		const all = getAllLeadSheets();
		expect(all.length).toBeGreaterThanOrEqual(ALL_CURATED_LEAD_SHEETS.length);
		for (const curated of ALL_CURATED_LEAD_SHEETS) {
			expect(all.some((s) => s.id === curated.id)).toBe(true);
		}
	});

	it('merges user lead sheets from local storage', () => {
		save('user-leadsheets', [userSheet()]);
		const all = getAllLeadSheets();
		expect(all.some((s) => s.id === 'sheet-123-abcd')).toBe(true);
	});

	it('merges adopted community lead sheets', () => {
		save('leadsheet-adopted-payloads', [userSheet({ id: 'sheet-999-zzzz', title: 'Adopted' })]);
		const all = getAllLeadSheets();
		expect(all.some((s) => s.id === 'sheet-999-zzzz')).toBe(true);
	});

	it('dedups by id with the earlier source winning', () => {
		const curatedId = ALL_CURATED_LEAD_SHEETS[0].id;
		save('user-leadsheets', [
			userSheet({ id: curatedId, title: 'Impostor' }),
			userSheet(),
			userSheet() // duplicate user id
		]);
		save('leadsheet-adopted-payloads', [userSheet({ id: 'sheet-123-abcd', title: 'Also Impostor' })]);

		const all = getAllLeadSheets();
		expect(all.filter((s) => s.id === curatedId)).toHaveLength(1);
		expect(all.find((s) => s.id === curatedId)?.title).not.toBe('Impostor');
		expect(all.filter((s) => s.id === 'sheet-123-abcd')).toHaveLength(1);
		expect(all.find((s) => s.id === 'sheet-123-abcd')?.title).toBe('My Tune');
	});
});

describe('getLeadSheetById / isCuratedLeadSheetId', () => {
	it('finds curated sheets by id', () => {
		const curated = ALL_CURATED_LEAD_SHEETS[0];
		expect(getLeadSheetById(curated.id)?.title).toBe(curated.title);
		expect(isCuratedLeadSheetId(curated.id)).toBe(true);
	});

	it('finds user sheets by id and reports them as not curated', () => {
		save('user-leadsheets', [userSheet()]);
		expect(getLeadSheetById('sheet-123-abcd')?.title).toBe('My Tune');
		expect(isCuratedLeadSheetId('sheet-123-abcd')).toBe(false);
	});

	it('returns undefined for unknown ids', () => {
		expect(getLeadSheetById('nope')).toBeUndefined();
	});
});

describe('transposeLeadSheet', () => {
	it('returns the sheet unchanged for the same key', () => {
		const sheet = userSheet();
		expect(transposeLeadSheet(sheet, 'C')).toBe(sheet);
	});

	it('shifts melody, harmony roots, key, and id', () => {
		const transposed = transposeLeadSheet(userSheet(), 'D');
		expect(transposed.key).toBe('D');
		expect(transposed.id).toBe('sheet-123-abcd_D');
		expect(transposed.sections[0].notes[0].pitch).toBe(62);
		expect(transposed.sections[0].harmony[0].chord.root).toBe('E');
	});

	it('re-derives the raw chord symbol in the new key', () => {
		const transposed = transposeLeadSheet(userSheet(), 'D');
		expect(transposed.sections[0].harmony[0].symbol).toBe('E-7');
	});

	it('drops unparseable raw symbols rather than leaving them wrong', () => {
		const sheet = userSheet();
		sheet.sections[0].harmony[0].symbol = 'D(mystery)';
		const transposed = transposeLeadSheet(sheet, 'D');
		expect(transposed.sections[0].harmony[0].symbol).toBeUndefined();
	});

	it('keeps the melody within the requested range via octave adjustment', () => {
		const sheet = userSheet();
		sheet.sections[0].notes = [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },
			{ pitch: 74, duration: [1, 4], offset: [1, 4] }
		];
		// Transposing up a 6th would exceed the ceiling; expect an octave drop.
		const transposed = transposeLeadSheet(sheet, 'A', 60, 75);
		for (const n of transposed.sections[0].notes) {
			expect(n.pitch).not.toBeNull();
			expect(n.pitch!).toBeLessThanOrEqual(75);
			expect(n.pitch!).toBeGreaterThanOrEqual(60);
		}
	});
});
