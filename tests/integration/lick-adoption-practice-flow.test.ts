/**
 * Integration tests for adopted licks flowing through the shared library
 * loader, query pipeline, and practice-tag store.
 *
 * These test the behaviors the practice flow depends on WITHOUT pulling in
 * the full `lick-practice.svelte.ts` state machine (which couples to settings
 * runes and audio state). If these invariants hold, `getPracticeLicks()`
 * treats adopted licks the same as user-authored and curated licks — which is
 * the core contract of lick adoption.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

vi.mock('$lib/persistence/user-scope', () => ({
	getScopeGeneration: () => 0
}));

// ─── localStorage stub ───────────────────────────────────────────────

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

// ─── Imports under test ──────────────────────────────────────────────

const { getAllLicks, getLickById, queryLicks, transposeLick } = await import(
	'$lib/phrases/library-loader'
);
const { getPracticeTaggedIds, setPracticeTag } = await import(
	'$lib/persistence/lick-practice-store'
);
const { makePhrase, makePracticeReadyPhrase } = await import('../helpers/lick-builders');

// Helper: seed localStorage with an adopted-lick payload.
function seedAdopted(phrases: ReturnType<typeof makePhrase>[]): void {
	localStorageMock.setItem(
		'mankunku:community-adopted-payloads',
		JSON.stringify(phrases)
	);
	localStorageMock.setItem(
		'mankunku:community-adoptions',
		JSON.stringify(phrases.map((p) => p.id))
	);
}

// Helper: seed localStorage with a user-authored lick.
function seedUserLicks(phrases: ReturnType<typeof makePhrase>[]): void {
	localStorageMock.setItem('mankunku:user-licks', JSON.stringify(phrases));
}

// ---------------------------------------------------------------------------
// getAllLicks — origin blending
// ---------------------------------------------------------------------------

describe('getAllLicks with adopted licks', () => {
	it('includes adopted licks alongside curated and user-authored', () => {
		const adopted = makePhrase({ id: 'adopted-1', name: 'Adopted' });
		const userOwn = makePhrase({ id: 'user-1', name: 'Mine' });
		seedAdopted([adopted]);
		seedUserLicks([userOwn]);

		const all = getAllLicks();
		expect(all.some((l) => l.id === 'adopted-1')).toBe(true);
		expect(all.some((l) => l.id === 'user-1')).toBe(true);
	});

	it('dedupes when the same id is in both user-owned and adopted pools', () => {
		// Self-adoption is blocked at the DB layer, but the client guard is
		// cheap insurance. If a collision sneaks through, neither entry should
		// appear twice.
		const duplicate = makePhrase({ id: 'dup-1', name: 'Dup' });
		seedAdopted([duplicate]);
		seedUserLicks([duplicate]);

		const matches = getAllLicks().filter((l) => l.id === 'dup-1');
		expect(matches).toHaveLength(1);
	});

	it('returns an empty adopted-lick list gracefully when cache is absent', () => {
		// No localStorage seeding — getAllLicks should still return curated
		// licks without throwing.
		const all = getAllLicks();
		expect(all.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// getLickById — adopted pool search
// ---------------------------------------------------------------------------

describe('getLickById reaches into the adopted pool', () => {
	it('locates adopted licks by id', () => {
		const adopted = makePhrase({ id: 'adopted-42', name: 'Adopted 42' });
		seedAdopted([adopted]);

		const found = getLickById('adopted-42');
		expect(found?.name).toBe('Adopted 42');
	});

	it('returns undefined for an id that is nowhere', () => {
		expect(getLickById('no-such-id')).toBeUndefined();
	});

	it('prefers curated or user-authored over adopted when ids collide', () => {
		// The loader searches curated → user → adopted in that order. A collision
		// is unlikely in practice but this pins down the resolution rule.
		const adopted = makePhrase({ id: 'dup-id', name: 'From Adoption' });
		const userOwn = makePhrase({ id: 'dup-id', name: 'Mine' });
		seedAdopted([adopted]);
		seedUserLicks([userOwn]);

		expect(getLickById('dup-id')?.name).toBe('Mine');
	});
});

// ---------------------------------------------------------------------------
// Category / difficulty filtering over adopted content
// ---------------------------------------------------------------------------

describe('queryLicks over adopted licks', () => {
	it('filters adopted licks by category', () => {
		seedAdopted([
			makePhrase({ id: 'a-ii-V', category: 'ii-V-I-major' }),
			makePhrase({ id: 'a-blues', category: 'blues' })
		]);

		const iiVs = queryLicks({ category: 'ii-V-I-major' });
		const iiVIds = iiVs.map((l) => l.id);
		expect(iiVIds).toContain('a-ii-V');
		expect(iiVIds).not.toContain('a-blues');
	});

	it('filters adopted licks by max difficulty', () => {
		seedAdopted([
			makePhrase({
				id: 'easy-adopted',
				difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 }
			}),
			makePhrase({
				id: 'hard-adopted',
				difficulty: { level: 90, pitchComplexity: 90, rhythmComplexity: 90, lengthBars: 1 }
			})
		]);

		const easy = queryLicks({ maxDifficulty: 50 });
		const ids = easy.map((l) => l.id);
		expect(ids).toContain('easy-adopted');
		expect(ids).not.toContain('hard-adopted');
	});

	it('text search over adopted names and tags is origin-agnostic', () => {
		seedAdopted([
			makePhrase({ id: 'needle', name: 'needle-in-a-haystack' }),
			makePhrase({ id: 'haystack', name: 'different' })
		]);

		const hits = queryLicks({ search: 'needle' });
		expect(hits.map((l) => l.id)).toContain('needle');
		expect(hits.map((l) => l.id)).not.toContain('haystack');
	});
});

// ---------------------------------------------------------------------------
// Transposition over adopted content
// ---------------------------------------------------------------------------

describe('transposeLick over adopted licks', () => {
	it('transposes pitches and harmony together', () => {
		const lick = makePhrase({
			id: 'adopted-transp',
			key: 'C',
			harmony: [
				{
					chord: { root: 'C', quality: 'maj7' },
					scaleId: 'major-ionian',
					startOffset: [0, 1],
					duration: [1, 1]
				}
			]
		});

		const transposed = transposeLick(lick, 'F');
		expect(transposed.key).toBe('F');
		// Chord root shifted by the same interval.
		expect(transposed.harmony[0].chord.root).toBe('F');
		// Notes shifted — any non-null pitch should have moved.
		const origFirstPitched = lick.notes.find((n) => n.pitch !== null)!.pitch!;
		const newFirstPitched = transposed.notes.find((n) => n.pitch !== null)!.pitch!;
		expect(newFirstPitched).not.toBe(origFirstPitched);
		// Shifted by a multiple of semitones (maybe with an octave correction).
		expect((newFirstPitched - origFirstPitched) % 12).toBe(5); // C → F is +5 semitones
	});
});

// ---------------------------------------------------------------------------
// Practice-tag store — adopted licks are taggable like any other lick
// ---------------------------------------------------------------------------

describe('practice-tag store with adopted licks', () => {
	it('setPracticeTag adds an adopted lick to the practice-tagged set', () => {
		seedAdopted([makePracticeReadyPhrase('adopted-practice', 'ii-V-I-major', { tags: [] })]);

		expect(getPracticeTaggedIds().has('adopted-practice')).toBe(false);
		setPracticeTag('adopted-practice', true);
		expect(getPracticeTaggedIds().has('adopted-practice')).toBe(true);
	});

	it('setPracticeTag can be cleared', () => {
		seedAdopted([makePhrase({ id: 'adopted-clear' })]);

		setPracticeTag('adopted-clear', true);
		setPracticeTag('adopted-clear', false);
		expect(getPracticeTaggedIds().has('adopted-clear')).toBe(false);
	});

	it('untagged adopted licks are not in the practice set', () => {
		seedAdopted([
			makePhrase({ id: 'adopted-tagged' }),
			makePhrase({ id: 'adopted-untagged' })
		]);
		setPracticeTag('adopted-tagged', true);

		const tagged = getPracticeTaggedIds();
		expect(tagged.has('adopted-tagged')).toBe(true);
		expect(tagged.has('adopted-untagged')).toBe(false);
	});
});
