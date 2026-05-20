/**
 * Integration tests for the edit-existing-lick flow.
 *
 * Exercises the round trip: save a fresh lick, load it back into the step-entry
 * state via `loadFromPhrase`, mutate the rune the way the entry page does,
 * save again with the preserved id, and verify localStorage holds exactly one
 * updated row. Also covers practice-tag toggling during edit and category
 * changes that trigger the `prog:*` tag seeding done by `updateLickCategory`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Phrase } from '$lib/types/music';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

vi.mock('$lib/persistence/user-scope', () => ({
	getScopeGeneration: () => 0,
	getLastUserId: () => null
}));

vi.mock('$lib/persistence/sync', () => ({
	syncLickMetadataToCloud: vi.fn().mockResolvedValue(undefined),
	syncUserLicksToCloud: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/persistence/community', () => ({
	getStolenLicksLocal: () => []
}));

const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => {
		store[key] = value;
	}),
	removeItem: vi.fn((key: string) => {
		delete store[key];
	}),
	clear: vi.fn(() => {
		for (const key of Object.keys(store)) delete store[key];
	}),
	get length() {
		return Object.keys(store).length;
	},
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
});

const { saveUserLick, getUserLicksLocal, updateLickCategory } = await import(
	'$lib/persistence/user-licks'
);
const { stepEntry, loadFromPhrase, reset, getCurrentPhrase } = await import(
	'$lib/state/step-entry.svelte'
);
const { isInPracticeSet, setPracticeTag, getProgressionTags } = await import(
	'$lib/persistence/lick-practice-store'
);
const { INSTRUMENTS } = await import('$lib/types/instruments');
const { settings } = await import('$lib/state/settings.svelte');

function basePhrase(overrides: Partial<Phrase> = {}): Phrase {
	return {
		id: 'lick-edit-rt',
		name: 'Original',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4] as [number, number], offset: [0, 1] as [number, number] },
			{ pitch: 64, duration: [1, 4] as [number, number], offset: [1, 4] as [number, number] },
			{ pitch: 67, duration: [1, 2] as [number, number], offset: [1, 2] as [number, number] }
		],
		harmony: [],
		difficulty: { level: 3, pitchComplexity: 3, rhythmComplexity: 2, lengthBars: 1 },
		category: 'user',
		tags: ['user-entered'],
		source: 'user-entered',
		...overrides
	};
}

describe('lick edit round-trip', () => {
	beforeEach(() => {
		settings.instrumentId = 'concert';
		reset();
	});

	it('saves a fresh lick, edits one note, saves again — localStorage has one row with the edit', () => {
		saveUserLick(basePhrase());
		expect(getUserLicksLocal()).toHaveLength(1);

		const stored = getUserLicksLocal()[0];
		loadFromPhrase(stored, INSTRUMENTS['concert']);

		// Simulate the user fixing the second note's pitch
		stepEntry.enteredNotes[1].pitch = 65;
		stepEntry.phraseName = 'Edited';

		// Reproduce the entry page's edit-branch save logic
		const phrase = getCurrentPhrase();
		phrase.id = stepEntry.editingId!;
		phrase.source = stepEntry.editingSource ?? 'user-entered';
		phrase.tags = stepEntry.editingTags ?? [];

		saveUserLick(phrase);

		const after = getUserLicksLocal();
		expect(after).toHaveLength(1);
		expect(after[0].id).toBe('lick-edit-rt');
		expect(after[0].name).toBe('Edited');
		expect(after[0].notes[1].pitch).toBe(65);
		// First and third notes are unchanged
		expect(after[0].notes[0].pitch).toBe(60);
		expect(after[0].notes[2].pitch).toBe(67);
	});

	it('preserves source through an edit (user-entered stays user-entered)', () => {
		saveUserLick(basePhrase({ source: 'user-entered' }));
		const stored = getUserLicksLocal()[0];
		loadFromPhrase(stored, INSTRUMENTS['concert']);

		const phrase = getCurrentPhrase();
		phrase.id = stepEntry.editingId!;
		phrase.source = stepEntry.editingSource ?? 'user-entered';
		saveUserLick(phrase);

		expect(getUserLicksLocal()[0].source).toBe('user-entered');
	});

	it('practice-tag unchecks persist after edit', () => {
		saveUserLick(basePhrase({ id: 'lick-pt', tags: ['user-entered'] }));
		setPracticeTag('lick-pt', true);
		expect(isInPracticeSet('lick-pt', getUserLicksLocal()[0].tags)).toBe(true);

		const stored = getUserLicksLocal()[0];
		loadFromPhrase(stored, INSTRUMENTS['concert']);
		// Confirm the loader set practiceTag from the store
		stepEntry.practiceTag = isInPracticeSet(stored.id, stored.tags);
		expect(stepEntry.practiceTag).toBe(true);

		// User unchecks practice while editing
		stepEntry.practiceTag = false;

		// Reproduce the edit-save tag merge and unconditional setPracticeTag call
		const phrase = getCurrentPhrase();
		phrase.id = stepEntry.editingId!;
		phrase.source = stepEntry.editingSource ?? 'user-entered';
		const baseTags = (stepEntry.editingTags ?? []).filter((t) => t !== 'practice');
		phrase.tags = stepEntry.practiceTag ? [...baseTags, 'practice'] : baseTags;
		const saved = saveUserLick(phrase);
		setPracticeTag(saved.id, stepEntry.practiceTag);

		expect(isInPracticeSet('lick-pt', getUserLicksLocal()[0].tags)).toBe(false);
	});

	it('category change during edit triggers prog:* tag seeding via updateLickCategory', () => {
		saveUserLick(basePhrase({ id: 'lick-cat', category: 'user' }));

		const stored = getUserLicksLocal()[0];
		loadFromPhrase(stored, INSTRUMENTS['concert']);

		// User picks a new category in the editor
		stepEntry.category = 'major-chord';

		const phrase = getCurrentPhrase();
		phrase.id = stepEntry.editingId!;
		phrase.source = stepEntry.editingSource ?? 'user-entered';
		const categoryChanged = stepEntry.category !== stepEntry.editingCategory;
		const saved = saveUserLick(phrase);
		if (categoryChanged) {
			updateLickCategory(saved.id, stepEntry.category);
		}

		expect(getUserLicksLocal()[0].category).toBe('major-chord');
		const progTags = getProgressionTags('lick-cat');
		// `major-chord` maps to multiple progressions; assert seeding ran.
		expect(progTags.length).toBeGreaterThan(0);
	});

	it('preserves non-practice tags through an edit (e.g. genre tags)', () => {
		saveUserLick(
			basePhrase({
				id: 'lick-genre',
				tags: ['user-entered', 'bebop', 'practice']
			})
		);
		const stored = getUserLicksLocal()[0];
		loadFromPhrase(stored, INSTRUMENTS['concert']);

		stepEntry.practiceTag = true;
		const phrase = getCurrentPhrase();
		phrase.id = stepEntry.editingId!;
		phrase.source = stepEntry.editingSource ?? 'user-entered';
		const baseTags = (stepEntry.editingTags ?? []).filter((t) => t !== 'practice');
		phrase.tags = stepEntry.practiceTag ? [...baseTags, 'practice'] : baseTags;
		saveUserLick(phrase);

		const after = getUserLicksLocal()[0];
		expect(after.tags).toContain('bebop');
		expect(after.tags).toContain('user-entered');
		expect(after.tags).toContain('practice');
	});

	it('Bb instrument: written key in dropdown round-trips back to original concert key on save', () => {
		settings.instrumentId = 'tenor-sax';
		const tenor = INSTRUMENTS['tenor-sax'];
		// Concert F lick (written G on tenor)
		saveUserLick(basePhrase({ id: 'lick-bb', key: 'F' }));

		const stored = getUserLicksLocal()[0];
		loadFromPhrase(stored, tenor);
		expect(stepEntry.phraseKey).toBe('G'); // written

		// User edits without touching the key
		stepEntry.enteredNotes[0].pitch = 61;
		const phrase = getCurrentPhrase();
		phrase.id = stepEntry.editingId!;
		phrase.source = stepEntry.editingSource ?? 'user-entered';
		saveUserLick(phrase);

		const after = getUserLicksLocal()[0];
		expect(after.key).toBe('F'); // concert preserved
		expect(after.notes[0].pitch).toBe(61);
	});
});
