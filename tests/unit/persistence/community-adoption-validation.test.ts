/**
 * Validation of externally-authored lick content at the adoption boundary.
 *
 * Adopted licks are live references to rows authored by someone else. The app
 * must not trust their shape — these tests pin down the structural invariants
 * we enforce before caching an adopted payload locally or surfacing it to the
 * practice pipeline.
 *
 * Runs on top of `validateAdoptedPhrase` (structural checks) and `adoptLick`
 * (integration: invalid payloads don't poison the local cache).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/persistence/user-scope', () => ({
	getScopeGeneration: () => 0
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

const {
	validateAdoptedPhrase,
	MAX_NOTES_PER_ADOPTED_PHRASE
} = await import('$lib/phrases/adopted-phrase-validator');
const { adoptLick, getAdoptedLicksLocal, getAdoptionsLocal } = await import(
	'$lib/persistence/community'
);
const { makePhrase, makeMalformedPhrase } = await import('../../helpers/lick-builders');

// ---------------------------------------------------------------------------
// validateAdoptedPhrase — structural invariants
// ---------------------------------------------------------------------------

describe('validateAdoptedPhrase', () => {
	it('accepts a well-formed phrase', () => {
		const result = validateAdoptedPhrase(makePhrase());
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it('rejects a non-object input', () => {
		expect(validateAdoptedPhrase(null).valid).toBe(false);
		expect(validateAdoptedPhrase('not an object').valid).toBe(false);
		expect(validateAdoptedPhrase(42).valid).toBe(false);
	});

	it('rejects a phrase with a negative duration numerator', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('negative-duration'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/duration/i);
	});

	it('rejects a phrase with a zero denominator in any fraction', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('zero-denominator'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/denominator/i);
	});

	it('rejects an empty notes array', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('empty-notes'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/empty/i);
	});

	it('rejects a phrase consisting only of rests', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('all-rests'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/pitched|rest/i);
	});

	it('rejects MIDI pitches below 0', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('midi-below-range'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/midi/i);
	});

	it('rejects MIDI pitches above 127', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('midi-above-range'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/midi/i);
	});

	it('rejects names containing <script> as a defense-in-depth', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('html-in-name'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/name|disallowed/i);
	});

	it('rejects tags containing obvious XSS vectors', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('html-in-tag'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/tag|disallowed/i);
	});

	it('rejects absurdly long phrases to prevent scheduler DoS', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('absurdly-long'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/notes/i);
	});

	it('defines a sane maximum note count', () => {
		expect(MAX_NOTES_PER_ADOPTED_PHRASE).toBeGreaterThan(100);
		expect(MAX_NOTES_PER_ADOPTED_PHRASE).toBeLessThan(10_000);
	});

	it('rejects overlapping harmony segments', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('overlapping-harmony'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/overlap/i);
	});

	it('rejects harmony that extends past the phrase end', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('harmony-past-end'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/past.*end|extend/i);
	});

	it('rejects a phrase with a missing key', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('missing-key'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/key/i);
	});

	it('rejects a phrase with a missing time signature', () => {
		const result = validateAdoptedPhrase(makeMalformedPhrase('missing-time-signature'));
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/timeSignature/i);
	});

	it('tolerates an unknown category (falls back at render time)', () => {
		// Unknown categories are not an adoption-time failure: the library UI
		// already treats any unfamiliar category as "user".
		const result = validateAdoptedPhrase(makeMalformedPhrase('unknown-category'));
		expect(result.valid).toBe(true);
	});

	it('accepts harmony with a scaleId not in the local scale library', () => {
		// Scale-id cross-referencing happens in the practice pipeline's fallback.
		// Validation at the adoption boundary only requires a non-empty string.
		const result = validateAdoptedPhrase(makeMalformedPhrase('unknown-scale-id'));
		expect(result.valid).toBe(true);
	});

	it('rejects a note whose offset numerator is negative', () => {
		const phrase = makePhrase({
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [-1, 4] as [number, number] },
				{ pitch: 62, duration: [1, 4], offset: [1, 4] }
			]
		});
		const result = validateAdoptedPhrase(phrase);
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/offset/i);
	});
});

// ---------------------------------------------------------------------------
// Integration: adoptLick respects the validator
// ---------------------------------------------------------------------------

interface QueryState {
	filters: Array<{ op: string; args: unknown[] }>;
}

function makeSupabaseMock(response: {
	user?: { id: string } | null;
	singleRows?: Record<string, unknown>;
	onInsert?: (table: string) => { error: Error | null };
	onDelete?: (table: string) => { error: Error | null };
}): unknown {
	return {
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: response.user ?? null } })
		},
		from(table: string) {
			const q: QueryState = { filters: [] };
			const chain = {
				select() {
					return chain;
				},
				eq(col: string, val: unknown) {
					q.filters.push({ op: 'eq', args: [col, val] });
					return chain;
				},
				single() {
					const row = response.singleRows?.[table];
					return Promise.resolve({
						data: row ?? null,
						error: row ? null : new Error('no row')
					});
				},
				insert() {
					return Promise.resolve(response.onInsert?.(table) ?? { error: null });
				},
				delete() {
					return {
						eq() {
							return {
								eq() {
									return Promise.resolve(response.onDelete?.(table) ?? { error: null });
								}
							};
						}
					};
				},
				then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
					return Promise.resolve({ data: [], error: null }).then(resolve);
				}
			};
			return chain;
		}
	};
}

describe('adoptLick — payload validation integration', () => {
	it('does not cache a malformed lick payload', async () => {
		const malformedRow = {
			id: 'lick-malformed',
			user_id: 'author-1',
			name: 'Bad',
			key: 'C',
			time_signature: [4, 4],
			notes: [], // invalid: empty notes
			harmony: [],
			difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
			category: 'user',
			tags: [],
			source: 'user-recorded',
			audio_url: null,
			created_at: '',
			updated_at: '',
			favorite_count: 0
		};

		const sb = makeSupabaseMock({
			user: { id: 'u1' },
			singleRows: {
				user_licks: malformedRow,
				public_lick_authors: { id: 'author-1', display_name: 'Bad Author', avatar_url: null }
			}
		}) as Parameters<typeof adoptLick>[0];

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await adoptLick(sb, 'lick-malformed');

		// Adoption row on the server was accepted — user's intent is recorded.
		expect(getAdoptionsLocal().has('lick-malformed')).toBe(true);
		// But the malformed payload must not land in the local library cache.
		expect(getAdoptedLicksLocal().find((l) => l.id === 'lick-malformed')).toBeUndefined();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('caches a well-formed lick payload', async () => {
		const goodRow = {
			id: 'lick-good',
			user_id: 'author-1',
			name: 'Nice ii-V',
			key: 'C',
			time_signature: [4, 4],
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 62, duration: [1, 4], offset: [1, 4] },
				{ pitch: 64, duration: [1, 4], offset: [2, 4] },
				{ pitch: 65, duration: [1, 4], offset: [3, 4] }
			],
			harmony: [
				{
					chord: { root: 'D', quality: 'min7' },
					scaleId: 'major-dorian',
					startOffset: [0, 1],
					duration: [1, 1]
				}
			],
			difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
			category: 'ii-V-I-major',
			tags: ['practice'],
			source: 'user-entered',
			audio_url: null,
			created_at: '',
			updated_at: '',
			favorite_count: 0
		};

		const sb = makeSupabaseMock({
			user: { id: 'u1' },
			singleRows: {
				user_licks: goodRow,
				public_lick_authors: { id: 'author-1', display_name: 'OK', avatar_url: null }
			}
		}) as Parameters<typeof adoptLick>[0];

		await adoptLick(sb, 'lick-good');

		expect(getAdoptionsLocal().has('lick-good')).toBe(true);
		expect(getAdoptedLicksLocal().find((l) => l.id === 'lick-good')).toBeDefined();
	});
});
