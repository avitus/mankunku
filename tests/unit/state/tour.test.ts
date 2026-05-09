/**
 * Per-function unit tests for `src/lib/state/tour.svelte.ts`.
 *
 * The integration test (`tests/integration/tour-state-sync.test.ts`) covers
 * cross-device UNION sync semantics and user-switch isolation.  This file
 * fills the gaps: the local-only state machine.  Without it, swapping the
 * order of add/delete inside markComplete or losing the dismissed→completed
 * promotion would not show up as a regression.
 *
 * `tour.svelte.ts` reads localStorage at module load via `loadInitial()`,
 * so the standard pattern is to seed localStorage, `vi.resetModules()`, then
 * import the module.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();

vi.stubGlobal('localStorage', {
	getItem: vi.fn((k: string) => store.get(k) ?? null),
	setItem: vi.fn((k: string, v: string) => {
		store.set(k, v);
	}),
	removeItem: vi.fn((k: string) => store.delete(k)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});
// Stub `window` so the tour module's `typeof window === 'undefined'` guard
// runs the localStorage path on import.
vi.stubGlobal('window', { document: {} });

beforeEach(() => {
	store.clear();
	vi.resetModules();
});

const STORAGE_KEY = 'mankunku:tour-state';

function persisted(): { completed: string[]; dismissed: string[] } {
	const raw = store.get(STORAGE_KEY);
	return raw ? JSON.parse(raw) : { completed: [], dismissed: [] };
}

describe('hasSeen', () => {
	it('returns false for tours the user has never interacted with', async () => {
		const m = await import('$lib/state/tour.svelte');
		expect(m.hasSeen('welcome')).toBe(false);
	});

	it('returns true after a tour is completed', async () => {
		const m = await import('$lib/state/tour.svelte');
		m.markComplete('welcome');
		expect(m.hasSeen('welcome')).toBe(true);
	});

	it('returns true after a tour is dismissed (without being completed)', async () => {
		const m = await import('$lib/state/tour.svelte');
		m.markDismissed('library-intro');
		expect(m.hasSeen('library-intro')).toBe(true);
	});
});

describe('markComplete', () => {
	it('adds the tour id to completedTours and persists', async () => {
		const m = await import('$lib/state/tour.svelte');
		m.markComplete('welcome');
		expect(m.tourState.completedTours.has('welcome')).toBe(true);
		expect(persisted().completed).toContain('welcome');
	});

	it('promotes a previously-dismissed tour to completed (deletes from dismissed)', async () => {
		// Realistic flow: user closes the tour, later finishes it from Settings.
		// The dismissed flag must NOT linger — otherwise the Settings page
		// could surface the tour as "dismissed" while it's also "completed".
		const m = await import('$lib/state/tour.svelte');
		m.markDismissed('practice-tour');
		expect(m.tourState.dismissedTours.has('practice-tour')).toBe(true);

		m.markComplete('practice-tour');

		expect(m.tourState.dismissedTours.has('practice-tour')).toBe(false);
		expect(m.tourState.completedTours.has('practice-tour')).toBe(true);
		expect(persisted().dismissed).not.toContain('practice-tour');
		expect(persisted().completed).toContain('practice-tour');
	});

	it('is idempotent — calling twice produces a single entry (Set semantics)', async () => {
		const m = await import('$lib/state/tour.svelte');
		m.markComplete('welcome');
		m.markComplete('welcome');
		expect(m.tourState.completedTours.size).toBe(1);
		expect(persisted().completed).toEqual(['welcome']);
	});
});

describe('markDismissed', () => {
	it('adds the tour id to dismissedTours and persists', async () => {
		const m = await import('$lib/state/tour.svelte');
		m.markDismissed('library-intro');
		expect(m.tourState.dismissedTours.has('library-intro')).toBe(true);
		expect(persisted().dismissed).toContain('library-intro');
	});

	it('is a no-op when the tour is already completed (completion sticky)', async () => {
		// Once a user has finished a tour, hitting "X" later should NOT roll
		// it back to dismissed — the integration sync would re-broadcast
		// the dismissal and de-promote on other devices.
		const m = await import('$lib/state/tour.svelte');
		m.markComplete('welcome');
		const setItemBefore = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.length;

		m.markDismissed('welcome');

		expect(m.tourState.completedTours.has('welcome')).toBe(true);
		expect(m.tourState.dismissedTours.has('welcome')).toBe(false);
		// And no new write happened — the early return must skip the
		// `saveTourState` call entirely so we don't churn localStorage.
		const setItemAfter = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.length;
		expect(setItemAfter).toBe(setItemBefore);
	});
});

describe('resetTours', () => {
	it('clears completed, dismissed, AND tourInProgress', async () => {
		const m = await import('$lib/state/tour.svelte');
		m.markComplete('a');
		m.markDismissed('b');
		m.tourState.tourInProgress = 'c';

		m.resetTours();

		expect(m.tourState.completedTours.size).toBe(0);
		expect(m.tourState.dismissedTours.size).toBe(0);
		expect(m.tourState.tourInProgress).toBeNull();
		// And a write was issued so the cleared state lands in localStorage.
		expect(persisted()).toEqual({ completed: [], dismissed: [] });
	});
});

describe('module-level loadInitial', () => {
	it('hydrates from localStorage on first import', async () => {
		store.set(
			STORAGE_KEY,
			JSON.stringify({ completed: ['welcome'], dismissed: ['library-intro'] })
		);
		const m = await import('$lib/state/tour.svelte');
		expect([...m.tourState.completedTours]).toEqual(['welcome']);
		expect([...m.tourState.dismissedTours]).toEqual(['library-intro']);
	});

	it('falls back to empty arrays when persisted shape is malformed', async () => {
		// Persisted as a string instead of the expected object — load() will
		// return null/wrong-shape; the guards on `Array.isArray(saved?.completed)`
		// must default to [].
		store.set(STORAGE_KEY, JSON.stringify({ completed: 'not-an-array' }));
		const m = await import('$lib/state/tour.svelte');
		expect(m.tourState.completedTours.size).toBe(0);
		expect(m.tourState.dismissedTours.size).toBe(0);
	});
});
