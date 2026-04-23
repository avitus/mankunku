/**
 * Integration test for the duplicate-detection pipeline on the entry page.
 *
 * Covers the end-to-end flow: saveUserLick persists the padded phrase →
 * getAllLicks() merges curated + user-local + stolen-local → findDuplicateLick
 * matches an unpadded entered phrase back to the saved one, across keys and
 * when the saved version has trailing-rest padding from getPaddedNotes().
 *
 * These are the real code paths taken by /entry's Save → Steal button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock localStorage ────────────────────────────────────────────────
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() { return store.size; },
	clear: vi.fn(() => store.clear())
});

// Prevent any cloud-sync side effects from the real code paths.
vi.mock('$lib/persistence/sync', () => ({
	syncLickMetadataToCloud: vi.fn().mockResolvedValue(undefined),
	syncUserLicksToCloud: vi.fn().mockResolvedValue(undefined),
	loadLickMetadataFromCloud: vi.fn().mockResolvedValue(null),
	syncSettingsToCloud: vi.fn().mockResolvedValue(undefined),
	loadSettingsFromCloud: vi.fn().mockResolvedValue(null),
	syncProgressToCloud: vi.fn().mockResolvedValue(undefined),
	loadProgressFromCloud: vi.fn().mockResolvedValue(null)
}));

// Curated licks are bundled; empty fixture keeps assertions focused on
// user-local + stolen-local matching.
vi.mock('$lib/data/licks/index', () => ({
	ALL_CURATED_LICKS: []
}));

import { saveUserLick } from '$lib/persistence/user-licks';
import { getAllLicks } from '$lib/phrases/library-loader';
import { findDuplicateLick } from '$lib/phrases/duplicate-detection';
import { save } from '$lib/persistence/storage';
import type { Phrase, PitchClass, Note } from '$lib/types/music';

/**
 * Build a phrase the same way the entry page would: notes with explicit
 * durations, no trailing padding. `saveUserLick` receives a padded version;
 * `findDuplicateLick` receives the unpadded live version.
 */
function makeEnteredPhrase(
	notes: Array<[number | null, [number, number]]>,
	key: PitchClass = 'C',
	name: string = 'Entered'
): Phrase {
	return {
		id: '',
		name,
		timeSignature: [4, 4],
		key,
		notes: notes.map(([pitch, duration], i) => ({
			pitch,
			duration,
			offset: [i, 4]
		}) satisfies Note),
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'user',
		tags: ['user-entered'],
		source: 'user-entered'
	};
}

/** Clone + append a trailing half-bar rest, mirroring getPaddedNotes() output. */
function padWithTrailingRest(phrase: Phrase, restDuration: [number, number]): Phrase {
	const lastOffset = phrase.notes.reduce<[number, number]>(
		(acc, n) => {
			const aNum = acc[0] * n.duration[1] + n.duration[0] * acc[1];
			const aDen = acc[1] * n.duration[1];
			const g = (function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a || 1; })(aNum, aDen);
			return [aNum / g, aDen / g];
		},
		[0, 1]
	);
	return {
		...phrase,
		notes: [
			...phrase.notes,
			{ pitch: null, duration: restDuration, offset: lastOffset }
		]
	};
}

const FIVE_NOTE_CMAJ: Array<[number, [number, number]]> = [
	[60, [1, 4]], [62, [1, 4]], [64, [1, 4]], [65, [1, 4]], [67, [1, 4]]
];

beforeEach(() => {
	store.clear();
});

describe('duplicate detection end-to-end', () => {
	it('anonymous save (no supabase) makes the lick visible to duplicate detection', () => {
		const entered = makeEnteredPhrase(FIVE_NOTE_CMAJ);
		const saved = saveUserLick(entered); // no supabase client

		expect(saved.id).toBeTruthy();
		expect(getAllLicks().some((l) => l.id === saved.id)).toBe(true);

		const reEntered = makeEnteredPhrase(FIVE_NOTE_CMAJ);
		const match = findDuplicateLick(reEntered, getAllLicks());
		expect(match?.id).toBe(saved.id);
	});

	it('matches despite trailing-rest padding added by saveUserLick callers', () => {
		// Mimic what /entry does: pass a padded phrase to saveUserLick, then
		// attempt to re-enter the same melody WITHOUT the trailing rest.
		const entered = makeEnteredPhrase(FIVE_NOTE_CMAJ);
		// 5 quarter notes = 5/4; pad with 3/4 rest to land on a 2-bar boundary.
		const padded = padWithTrailingRest(entered, [3, 4]);
		const saved = saveUserLick(padded);

		const reEnteredUnpadded = makeEnteredPhrase(FIVE_NOTE_CMAJ);
		expect(findDuplicateLick(reEnteredUnpadded, getAllLicks())?.id).toBe(saved.id);
	});

	it('matches across keys (C lick in library, Bb lick entered)', () => {
		const cLick = makeEnteredPhrase(FIVE_NOTE_CMAJ, 'C', 'C-major fragment');
		const saved = saveUserLick(padWithTrailingRest(cLick, [3, 4]));

		// +10 semitones transposes C → Bb (pitch-class identity is what matters).
		const bbNotes: Array<[number, [number, number]]> = FIVE_NOTE_CMAJ.map(
			([p, d]) => [(p as number) + 10, d]
		);
		const bbEntry = makeEnteredPhrase(bbNotes, 'Bb', 'Bb entry');
		expect(findDuplicateLick(bbEntry, getAllLicks())?.id).toBe(saved.id);
	});

	it('rejects a match when rhythm differs', () => {
		const saved = saveUserLick(
			padWithTrailingRest(makeEnteredPhrase(FIVE_NOTE_CMAJ), [3, 4])
		);

		// Same pitch classes, first note shortened to an eighth.
		const altered: Array<[number, [number, number]]> = FIVE_NOTE_CMAJ.map(
			([p, d], i) => [p as number, i === 0 ? [1, 8] : d]
		);
		const entered = makeEnteredPhrase(altered);
		expect(findDuplicateLick(entered, getAllLicks())).toBeNull();
		// Sanity: the saved lick is still in the library, the mismatch is the issue.
		expect(getAllLicks().some((l) => l.id === saved.id)).toBe(true);
	});

	it('returns null while the phrase has fewer than 4 pitched notes', () => {
		saveUserLick(padWithTrailingRest(makeEnteredPhrase(FIVE_NOTE_CMAJ), [3, 4]));

		const threeNotes = makeEnteredPhrase(FIVE_NOTE_CMAJ.slice(0, 3));
		expect(findDuplicateLick(threeNotes, getAllLicks())).toBeNull();
	});

	it('finds a stolen community lick cached in localStorage', () => {
		// Mimic the post-initCommunityFromCloud state: a stolen payload in the
		// community-adopted-payloads cache (key string kept intentionally under
		// the old name to preserve existing users' data).
		const stolen: Phrase = makeEnteredPhrase(FIVE_NOTE_CMAJ, 'C', 'Stolen Lick');
		const stolenWithId: Phrase = { ...stolen, id: 'author-original-id' };
		save('community-adopted-payloads', [stolenWithId]);

		const reEntered = makeEnteredPhrase(FIVE_NOTE_CMAJ);
		expect(findDuplicateLick(reEntered, getAllLicks())?.id).toBe('author-original-id');
	});

	it('does not self-match when the entered phrase has the same id as a library lick', () => {
		// After Save, if the user re-opens their just-saved lick for edit, the
		// entry page phrase could carry its old id. findDuplicateLick should
		// skip that lick to avoid flagging it as a duplicate of itself.
		const saved = saveUserLick(padWithTrailingRest(makeEnteredPhrase(FIVE_NOTE_CMAJ), [3, 4]));
		const reOpened = { ...makeEnteredPhrase(FIVE_NOTE_CMAJ), id: saved.id };
		expect(findDuplicateLick(reOpened, getAllLicks())).toBeNull();
	});
});
