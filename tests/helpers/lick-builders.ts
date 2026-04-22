/**
 * Shared factories for building Phrase objects in tests.
 *
 * These mirror the ad-hoc `makePhrase()` helpers found inline in existing test
 * files, but are exported so test files for cloud sync and lick adoption can
 * share a single source of truth for what a valid phrase looks like.
 *
 * The `makeMalformedPhrase` factory produces deliberately-broken phrases for
 * each class of invariant we care about when licks arrive from external
 * authors (the lick-adoption feature).
 */

import type {
	Phrase,
	Note,
	HarmonicSegment,
	DifficultyMetadata,
	PitchClass
} from '$lib/types/music';
import type { AdoptedAuthor } from '$lib/persistence/community';

export interface AuthorMeta {
	id: string;
	displayName: string | null;
	avatarUrl: string | null;
}

function defaultNotes(): Note[] {
	// Four quarter notes that exactly span one whole note so the default
	// harmony (one [1,1] segment) fits without extending past the phrase end.
	return [
		{ pitch: 60, duration: [1, 4], offset: [0, 1] },
		{ pitch: 62, duration: [1, 4], offset: [1, 4] },
		{ pitch: 64, duration: [1, 4], offset: [2, 4] },
		{ pitch: 65, duration: [1, 4], offset: [3, 4] }
	];
}

function defaultHarmony(): HarmonicSegment[] {
	return [
		{
			chord: { root: 'C', quality: 'maj7' },
			scaleId: 'major-ionian',
			startOffset: [0, 1],
			duration: [1, 1]
		}
	];
}

function defaultDifficulty(): DifficultyMetadata {
	return { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 };
}

/**
 * Build a valid Phrase with sensible defaults. Override any subset of fields
 * via `overrides`.
 */
export function makePhrase(overrides: Partial<Phrase> = {}): Phrase {
	return {
		id: overrides.id ?? 'test-lick-1',
		name: overrides.name ?? 'Test Lick',
		timeSignature: overrides.timeSignature ?? [4, 4],
		key: overrides.key ?? 'C',
		notes: overrides.notes ?? defaultNotes(),
		harmony: overrides.harmony ?? defaultHarmony(),
		difficulty: overrides.difficulty ?? defaultDifficulty(),
		category: overrides.category ?? 'ii-V-I-major',
		tags: overrides.tags ?? ['practice'],
		source: overrides.source ?? 'user-entered'
	};
}

/**
 * Build an adopted-lick pair: the Phrase plus the author metadata that
 * accompanies it in the `community-adopted-authors` localStorage cache.
 */
export function makeAdoptedLick(
	author: AuthorMeta,
	phrase: Partial<Phrase> = {}
): { phrase: Phrase; author: AdoptedAuthor } {
	return {
		phrase: makePhrase(phrase),
		author: {
			authorId: author.id,
			authorName: author.displayName,
			authorAvatarUrl: author.avatarUrl
		}
	};
}

export type MalformedKind =
	| 'empty-notes'
	| 'all-rests'
	| 'negative-duration'
	| 'zero-denominator'
	| 'midi-below-range'
	| 'midi-above-range'
	| 'html-in-name'
	| 'html-in-tag'
	| 'absurdly-long'
	| 'offset-past-end'
	| 'overlapping-harmony'
	| 'harmony-past-end'
	| 'unknown-category'
	| 'unknown-scale-id'
	| 'missing-key'
	| 'missing-time-signature';

/**
 * Build a phrase that deliberately violates a known invariant. Used by the
 * adoption-validation test suite to assert that the app either rejects or
 * sanitizes each class of malformed input.
 *
 * The returned value is intentionally cast to `Phrase` even when its shape
 * doesn't fully conform — production code pulling from Supabase cannot trust
 * its input to match the TypeScript types.
 */
export function makeMalformedPhrase(kind: MalformedKind): Phrase {
	const base = makePhrase();
	switch (kind) {
		case 'empty-notes':
			return { ...base, notes: [] };

		case 'all-rests':
			return {
				...base,
				notes: [
					{ pitch: null, duration: [1, 4], offset: [0, 1] },
					{ pitch: null, duration: [1, 4], offset: [1, 4] },
					{ pitch: null, duration: [1, 4], offset: [2, 4] }
				]
			};

		case 'negative-duration':
			return {
				...base,
				notes: [
					{ pitch: 60, duration: [-1, 8] as [number, number], offset: [0, 1] },
					{ pitch: 62, duration: [1, 8], offset: [1, 8] }
				]
			};

		case 'zero-denominator':
			return {
				...base,
				notes: [
					{ pitch: 60, duration: [1, 0] as [number, number], offset: [0, 1] },
					{ pitch: 62, duration: [1, 8], offset: [1, 8] }
				]
			};

		case 'midi-below-range':
			return {
				...base,
				notes: [
					{ pitch: -5, duration: [1, 8], offset: [0, 1] },
					{ pitch: 62, duration: [1, 8], offset: [1, 8] }
				]
			};

		case 'midi-above-range':
			return {
				...base,
				notes: [
					{ pitch: 60, duration: [1, 8], offset: [0, 1] },
					{ pitch: 200, duration: [1, 8], offset: [1, 8] }
				]
			};

		case 'html-in-name':
			return { ...base, name: '<script>alert("xss")</script>Lick' };

		case 'html-in-tag':
			return { ...base, tags: ['practice', '<img src=x onerror=alert(1)>'] };

		case 'absurdly-long': {
			const notes: Note[] = [];
			for (let i = 0; i < 5000; i++) {
				notes.push({
					pitch: 60 + (i % 12),
					duration: [1, 16],
					offset: [i, 16]
				});
			}
			return { ...base, notes };
		}

		case 'offset-past-end':
			return {
				...base,
				notes: [
					{ pitch: 60, duration: [1, 8], offset: [0, 1] },
					{ pitch: 62, duration: [1, 8], offset: [999, 1] }
				]
			};

		case 'overlapping-harmony':
			return {
				...base,
				harmony: [
					{
						chord: { root: 'C', quality: 'maj7' },
						scaleId: 'major-ionian',
						startOffset: [0, 1],
						duration: [1, 2]
					},
					{
						chord: { root: 'F', quality: 'maj7' },
						scaleId: 'major-ionian',
						startOffset: [1, 4],
						duration: [1, 2]
					}
				]
			};

		case 'harmony-past-end':
			return {
				...base,
				harmony: [
					{
						chord: { root: 'C', quality: 'maj7' },
						scaleId: 'major-ionian',
						startOffset: [0, 1],
						duration: [99, 1]
					}
				]
			};

		case 'unknown-category':
			return { ...base, category: 'not-a-real-category' as Phrase['category'] };

		case 'unknown-scale-id':
			return {
				...base,
				harmony: [
					{
						chord: { root: 'C', quality: 'maj7' },
						scaleId: 'nonsense-scale',
						startOffset: [0, 1],
						duration: [1, 1]
					}
				]
			};

		case 'missing-key':
			return { ...base, key: undefined as unknown as PitchClass };

		case 'missing-time-signature':
			return { ...base, timeSignature: undefined as unknown as [number, number] };
	}
}

/**
 * Build a valid phrase tagged for a specific progression category and the
 * "practice" flow. Useful when setting up the lick-practice plan in tests.
 */
export function makePracticeReadyPhrase(
	id: string,
	category: Phrase['category'],
	overrides: Partial<Phrase> = {}
): Phrase {
	const tags = overrides.tags ?? ['practice', category];
	return makePhrase({
		id,
		category,
		...overrides,
		tags
	});
}
