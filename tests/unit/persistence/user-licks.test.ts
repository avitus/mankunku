import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Phrase } from '$lib/types/music';
import { INSTRUMENTS } from '$lib/types/instruments';
import {
	saveUserLick,
	getUserLicksLocal,
	updateLickCategory,
	getLickCategoryOverrides,
	migrateUserLicksWrittenToConcert,
	migrateUserLicksKeyWrittenToConcert,
	initUserLicksFromCloud
} from '$lib/persistence/user-licks';

// ─── Mock sync module ────────────────────────────────────────
const mockSyncUserLicksToCloud = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/persistence/sync', () => ({
	syncLickMetadataToCloud: vi.fn().mockResolvedValue(undefined),
	syncUserLicksToCloud: (...args: unknown[]) => mockSyncUserLicksToCloud(...args)
}));

// ─── Mock community module (stolen licks cache) ─────────────
vi.mock('$lib/persistence/community', () => ({
	getStolenLicksLocal: () => []
}));

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
	vi.clearAllMocks();
});

function makePhrase(overrides: Partial<Phrase> = {}): Phrase {
	return {
		id: 'test-lick',
		name: 'Test',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4] as [number, number], offset: [0, 1] as [number, number] },
			{ pitch: 67, duration: [1, 4] as [number, number], offset: [1, 4] as [number, number] },
			{ pitch: null, duration: [1, 4] as [number, number], offset: [1, 2] as [number, number] }
		],
		harmony: [],
		difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
		category: 'user',
		tags: [],
		source: 'user-entered',
		...overrides
	};
}

describe('saveUserLick', () => {
	it('preserves user-entered source from step-entry', () => {
		const phrase = makePhrase({ source: 'user-entered' });
		const saved = saveUserLick(phrase);
		expect(saved.source).toBe('user-entered');
	});

	it('preserves user-recorded source from record page', () => {
		const phrase = makePhrase({ source: 'user-recorded' });
		const saved = saveUserLick(phrase);
		expect(saved.source).toBe('user-recorded');
	});

	it('defaults to user-recorded when no source is set', () => {
		const phrase = makePhrase({ source: '' });
		const saved = saveUserLick(phrase);
		expect(saved.source).toBe('user-recorded');
	});

	it('assigns an ID if none provided', () => {
		const phrase = makePhrase({ id: '' });
		const saved = saveUserLick(phrase);
		expect(saved.id).toBeTruthy();
		expect(saved.id).toMatch(/^user-/);
	});
});

describe('updateLickCategory', () => {
	it('updates the category of an own user lick in localStorage', () => {
		saveUserLick(makePhrase({ id: 'lick-1', category: 'user' }));
		updateLickCategory('lick-1', 'ii-V-I-major');
		const stored = getUserLicksLocal();
		expect(stored.find((l) => l.id === 'lick-1')?.category).toBe('ii-V-I-major');
	});

	it('does not write a curated override when the id matches an own user lick', () => {
		saveUserLick(makePhrase({ id: 'lick-2', category: 'user' }));
		updateLickCategory('lick-2', 'blues');
		expect(getLickCategoryOverrides()['lick-2']).toBeUndefined();
	});

	it('stores a curated override when no own user lick matches', () => {
		updateLickCategory('curated-x', 'modal');
		expect(getLickCategoryOverrides()['curated-x']).toBe('modal');
	});
});

describe('migrateUserLicksWrittenToConcert', () => {
	it('shifts step-entered lick pitches down by transposition semitones', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-entered',
			notes: [
				{ pitch: 65, duration: [1, 4], offset: [0, 1] }, // F4 written → Eb3 (51)
				{ pitch: 67, duration: [1, 4], offset: [1, 4] }  // G4 written → F3 (53)
			]
		}));

		const migrated = migrateUserLicksWrittenToConcert(14); // tenor sax
		expect(migrated).toBe(1);

		const licks = getUserLicksLocal();
		expect(licks[0].notes[0].pitch).toBe(51);
		expect(licks[0].notes[1].pitch).toBe(53);
	});

	it('skips user-recorded licks (mic-captured are already concert)', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-recorded',
			tags: ['user-recorded'],
			notes: [{ pitch: 65, duration: [1, 4], offset: [0, 1] }]
		}));

		const migrated = migrateUserLicksWrittenToConcert(14);
		expect(migrated).toBe(0);

		const licks = getUserLicksLocal();
		expect(licks[0].notes[0].pitch).toBe(65); // unchanged
	});

	it('migrates licks with user-entered tag even if source is overridden', () => {
		// Older versions of saveUserLick forced source to 'user-recorded'
		// but the tag remains as a reliable marker.
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-recorded',
			tags: ['user-entered'],
			notes: [{ pitch: 65, duration: [1, 4], offset: [0, 1] }]
		}));

		const migrated = migrateUserLicksWrittenToConcert(14);
		expect(migrated).toBe(1);

		const licks = getUserLicksLocal();
		expect(licks[0].notes[0].pitch).toBe(51);
		// Source is stamped so future runs don't need the tag
		expect(licks[0].source).toBe('user-entered');
	});

	it('preserves null pitches (rests)', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-entered',
			notes: [
				{ pitch: 65, duration: [1, 4], offset: [0, 1] },
				{ pitch: null, duration: [1, 4], offset: [1, 4] },
				{ pitch: 67, duration: [1, 4], offset: [1, 2] }
			]
		}));

		migrateUserLicksWrittenToConcert(14);
		const licks = getUserLicksLocal();
		expect(licks[0].notes[0].pitch).toBe(51);
		expect(licks[0].notes[1].pitch).toBeNull();
		expect(licks[0].notes[2].pitch).toBe(53);
	});

	it('is idempotent — running twice does not shift again', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-entered',
			notes: [{ pitch: 65, duration: [1, 4], offset: [0, 1] }]
		}));

		const first = migrateUserLicksWrittenToConcert(14);
		const second = migrateUserLicksWrittenToConcert(14);

		expect(first).toBe(1);
		expect(second).toBe(0); // flag prevents re-run

		const licks = getUserLicksLocal();
		expect(licks[0].notes[0].pitch).toBe(51); // shifted exactly once
	});

	it('no-op when transpositionSemitones is 0 (concert instrument)', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-entered',
			notes: [{ pitch: 65, duration: [1, 4], offset: [0, 1] }]
		}));

		const migrated = migrateUserLicksWrittenToConcert(0);
		expect(migrated).toBe(0);

		const licks = getUserLicksLocal();
		expect(licks[0].notes[0].pitch).toBe(65); // unchanged

		// Still marks as done so subsequent calls stay no-op
		const second = migrateUserLicksWrittenToConcert(14);
		expect(second).toBe(0);
	});

	it('shifts mixed licks — only the step-entered ones', () => {
		saveUserLick(makePhrase({
			id: 'entered',
			source: 'user-entered',
			notes: [{ pitch: 65, duration: [1, 4], offset: [0, 1] }]
		}));
		saveUserLick(makePhrase({
			id: 'recorded',
			source: 'user-recorded',
			tags: ['user-recorded'],
			notes: [{ pitch: 65, duration: [1, 4], offset: [0, 1] }]
		}));

		const migrated = migrateUserLicksWrittenToConcert(14);
		expect(migrated).toBe(1);

		const licks = getUserLicksLocal();
		const entered = licks.find(l => l.id === 'entered')!;
		const recorded = licks.find(l => l.id === 'recorded')!;
		expect(entered.notes[0].pitch).toBe(51);
		expect(recorded.notes[0].pitch).toBe(65);
	});
});

describe('migrateUserLicksKeyWrittenToConcert', () => {
	const tenorSax = INSTRUMENTS['tenor-sax'];
	const altoSax = INSTRUMENTS['alto-sax'];
	const concertInstr = INSTRUMENTS['concert'];

	it('tenor sax: written D becomes concert C', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-entered',
			key: 'D' // was written D when saved
		}));

		const migrated = migrateUserLicksKeyWrittenToConcert(tenorSax);
		expect(migrated).toBe(1);
		expect(getUserLicksLocal()[0].key).toBe('C');
	});

	it('tenor sax: written Bb becomes concert Ab', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-entered',
			key: 'Bb'
		}));

		migrateUserLicksKeyWrittenToConcert(tenorSax);
		expect(getUserLicksLocal()[0].key).toBe('Ab');
	});

	it('alto sax: written C becomes concert Eb', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-entered',
			key: 'C'
		}));

		migrateUserLicksKeyWrittenToConcert(altoSax);
		expect(getUserLicksLocal()[0].key).toBe('Eb');
	});

	it('skips recorded licks — they were already in concert', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-recorded',
			tags: ['user-recorded'],
			key: 'D'
		}));

		const migrated = migrateUserLicksKeyWrittenToConcert(tenorSax);
		expect(migrated).toBe(0);
		expect(getUserLicksLocal()[0].key).toBe('D'); // unchanged
	});

	it('migrates licks with the user-entered tag even if source was overridden', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-recorded',
			tags: ['user-entered'],
			key: 'D'
		}));

		const migrated = migrateUserLicksKeyWrittenToConcert(tenorSax);
		expect(migrated).toBe(1);
		const saved = getUserLicksLocal()[0];
		expect(saved.key).toBe('C');
		// Stamp the source for future runs
		expect(saved.source).toBe('user-entered');
	});

	it('is idempotent — running twice does not double-convert', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-entered',
			key: 'D'
		}));

		const first = migrateUserLicksKeyWrittenToConcert(tenorSax);
		const second = migrateUserLicksKeyWrittenToConcert(tenorSax);

		expect(first).toBe(1);
		expect(second).toBe(0);
		expect(getUserLicksLocal()[0].key).toBe('C');
	});

	it('no-op for concert instrument (trans=0) but still sets flag', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-entered',
			key: 'D'
		}));

		const migrated = migrateUserLicksKeyWrittenToConcert(concertInstr);
		expect(migrated).toBe(0);
		expect(getUserLicksLocal()[0].key).toBe('D'); // unchanged

		// Subsequent calls stay no-op
		const second = migrateUserLicksKeyWrittenToConcert(tenorSax);
		expect(second).toBe(0);
	});

	it('is independent from the notes migration flag', () => {
		saveUserLick(makePhrase({
			id: 'lick-1',
			source: 'user-entered',
			key: 'D',
			notes: [{ pitch: 65, duration: [1, 4], offset: [0, 1] }]
		}));

		// Run notes migration first
		migrateUserLicksWrittenToConcert(14);
		expect(getUserLicksLocal()[0].key).toBe('D'); // key still unchanged

		// Key migration runs independently
		migrateUserLicksKeyWrittenToConcert(tenorSax);
		const saved = getUserLicksLocal()[0];
		expect(saved.key).toBe('C');
		expect(saved.notes[0].pitch).toBe(51); // notes stayed shifted
	});
});

// ─── initUserLicksFromCloud ──────────────────────────────────
describe('initUserLicksFromCloud', () => {
	function createMockSupabase(cloudLicks: Partial<Phrase>[] = []) {
		const rows = cloudLicks.map((l) => ({
			id: l.id ?? 'cloud-1',
			name: l.name ?? 'Cloud Lick',
			key: l.key ?? 'C',
			time_signature: l.timeSignature ?? [4, 4],
			notes: l.notes ?? [],
			harmony: l.harmony ?? [],
			difficulty: l.difficulty ?? { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
			category: l.category ?? 'user',
			tags: l.tags ?? [],
			source: l.source ?? 'user-entered'
		}));

		return {
			auth: {
				getUser: vi.fn().mockResolvedValue({
					data: { user: { id: 'user-123' } },
					error: null
				})
			},
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					data: rows,
					error: null,
					then: undefined
				}),
				upsert: vi.fn().mockResolvedValue({ error: null })
			})
		} as any;
	}

	beforeEach(() => {
		mockSyncUserLicksToCloud.mockResolvedValue(undefined);
	});

	it('pushes local licks to cloud then pulls cloud set', async () => {
		const local = makePhrase({ id: 'local-1', name: 'Local' });
		saveUserLick(local);

		const supabase = createMockSupabase([{ id: 'local-1', name: 'Local' }]);
		await initUserLicksFromCloud(supabase);

		expect(mockSyncUserLicksToCloud).toHaveBeenCalledWith(
			supabase,
			expect.arrayContaining([expect.objectContaining({ id: 'local-1' })])
		);
		expect(getUserLicksLocal()).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: 'local-1' })])
		);
	});

	it('pulls cloud-only licks from other devices', async () => {
		// No local licks
		const supabase = createMockSupabase([
			{ id: 'device-b-1', name: 'From Device B' },
			{ id: 'device-b-2', name: 'Also Device B' }
		]);
		await initUserLicksFromCloud(supabase);

		const local = getUserLicksLocal();
		expect(local).toHaveLength(2);
		expect(local.map(l => l.id)).toEqual(['device-b-1', 'device-b-2']);
	});

	it('preserves local licks not yet in cloud (race protection)', async () => {
		saveUserLick(makePhrase({ id: 'lick-a' }));
		saveUserLick(makePhrase({ id: 'lick-b' }));
		saveUserLick(makePhrase({ id: 'lick-c' }));

		// Cloud only has A and B — C was added locally during the await
		// (or the push hasn't propagated yet). Merge must keep it.
		const supabase = createMockSupabase([
			{ id: 'lick-a' },
			{ id: 'lick-b' }
		]);
		await initUserLicksFromCloud(supabase);

		const local = getUserLicksLocal();
		expect(local.map(l => l.id)).toContain('lick-a');
		expect(local.map(l => l.id)).toContain('lick-b');
		expect(local.map(l => l.id)).toContain('lick-c');
	});

	it('preserves local licks when cloud fetch fails', async () => {
		saveUserLick(makePhrase({ id: 'offline-lick' }));

		const supabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({
					data: { user: { id: 'user-123' } },
					error: null
				})
			},
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					data: null,
					error: { message: 'network error' },
					then: undefined
				}),
				upsert: vi.fn().mockResolvedValue({ error: null })
			})
		} as any;

		await initUserLicksFromCloud(supabase);

		const local = getUserLicksLocal();
		expect(local).toHaveLength(1);
		expect(local[0].id).toBe('offline-lick');
	});

	it('skips push when no local licks exist', async () => {
		const supabase = createMockSupabase([{ id: 'cloud-1' }]);
		await initUserLicksFromCloud(supabase);

		expect(mockSyncUserLicksToCloud).not.toHaveBeenCalled();
		expect(getUserLicksLocal()).toHaveLength(1);
	});

	it('preserves local licks when auth is expired', async () => {
		saveUserLick(makePhrase({ id: 'my-lick' }));

		const supabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({
					data: { user: null },
					error: null
				})
			},
			from: vi.fn()
		} as any;

		await initUserLicksFromCloud(supabase);

		expect(getUserLicksLocal()).toHaveLength(1);
		expect(getUserLicksLocal()[0].id).toBe('my-lick');
		expect(supabase.from).not.toHaveBeenCalled();
	});
});
