/**
 * Integration tests for adopted licks flowing through the shared library
 * loader and query pipeline.
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

const { getAllLicks, getLickById, transposeLick } = await import(
	'$lib/phrases/library-loader'
);
const { makePhrase } = await import('../helpers/lick-builders');

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
