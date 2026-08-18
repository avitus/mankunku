import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Phrase, PhraseCategory, HarmonicSegment } from '$lib/types/music';

// ─── Fixtures ────────────────────────────────────────────────────────

const CMAJ_HARMONY: HarmonicSegment[] = [{
	chord: { root: 'C', quality: 'maj7' },
	scaleId: 'major.ionian',
	startOffset: [0, 1],
	duration: [1, 1]
}];

const BLUES_HARMONY: HarmonicSegment[] = [{
	chord: { root: 'C', quality: '7' },
	scaleId: 'blues.minor',
	startOffset: [0, 1],
	duration: [1, 1]
}];

const DM_HARMONY: HarmonicSegment[] = [{
	chord: { root: 'D', quality: 'min7' },
	scaleId: 'major.dorian',
	startOffset: [0, 1],
	duration: [1, 1]
}];

function makePhrase(overrides: Partial<Phrase> = {}): Phrase {
	return {
		id: 'test-lick',
		name: 'Test Lick',
		timeSignature: [4, 4] as [number, number],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4] as [number, number], offset: [0, 1] as [number, number] },
			{ pitch: 64, duration: [1, 4] as [number, number], offset: [1, 4] as [number, number] },
			{ pitch: 67, duration: [1, 4] as [number, number], offset: [1, 2] as [number, number] }
		],
		harmony: CMAJ_HARMONY,
		difficulty: { level: 30, pitchComplexity: 25, rhythmComplexity: 20, lengthBars: 1 },
		category: 'ii-V-I-major' as PhraseCategory,
		tags: ['bebop', 'classic'],
		source: 'curated',
		...overrides
	};
}

const FIXTURE_CURATED: Phrase[] = [
	makePhrase({
		id: 'lick-1',
		name: 'Major ii-V-I Line',
		category: 'ii-V-I-major',
		difficulty: { level: 20, pitchComplexity: 15, rhythmComplexity: 10, lengthBars: 2 },
		tags: ['bebop', 'classic'],
		harmony: CMAJ_HARMONY
	}),
	makePhrase({
		id: 'lick-2',
		name: 'Blues Riff',
		category: 'blues',
		difficulty: { level: 40, pitchComplexity: 35, rhythmComplexity: 30, lengthBars: 2 },
		tags: ['blues', 'funky'],
		harmony: BLUES_HARMONY
	}),
	makePhrase({
		id: 'lick-3',
		name: 'Dorian Minor Pattern',
		category: 'ii-V-I-major',
		difficulty: { level: 60, pitchComplexity: 55, rhythmComplexity: 50, lengthBars: 4 },
		tags: ['modal', 'dorian'],
		harmony: DM_HARMONY
	}),
	makePhrase({
		id: 'lick-4',
		name: 'Pentatonic Run',
		category: 'pentatonic',
		difficulty: { level: 10, pitchComplexity: 8, rhythmComplexity: 5, lengthBars: 1 },
		tags: ['pentatonic', 'easy'],
		harmony: [{
			chord: { root: 'C', quality: 'maj7' },
			scaleId: 'pentatonic.major',
			startOffset: [0, 1] as [number, number],
			duration: [1, 1] as [number, number]
		}]
	}),
	makePhrase({
		id: 'lick-5',
		name: 'Advanced Bebop Enclosure',
		category: 'bebop-lines',
		difficulty: { level: 80, pitchComplexity: 75, rhythmComplexity: 70, lengthBars: 4 },
		tags: ['bebop', 'enclosure', 'advanced'],
		harmony: CMAJ_HARMONY
	})
];

const FIXTURE_USER_LICKS: Phrase[] = [
	makePhrase({
		id: 'user-1',
		name: 'My Custom Lick',
		category: 'user',
		difficulty: { level: 25, pitchComplexity: 20, rhythmComplexity: 15, lengthBars: 1 },
		tags: ['practice', 'custom'],
		source: 'user-entered'
	})
];

// ─── Mocks ───────────────────────────────────────────────────────────

// Mock curated licks data source
vi.mock('$lib/data/licks/index', () => ({
	ALL_CURATED_LICKS: FIXTURE_CURATED
}));

// Mock user licks persistence
const mockGetUserLicksLocal = vi.fn<() => Phrase[]>(() => []);
vi.mock('$lib/persistence/user-licks', () => ({
	getUserLicksLocal: () => mockGetUserLicksLocal()
}));

// Mock community persistence (stolen licks cache)
const mockGetStolenLicksLocal = vi.fn<() => Phrase[]>(() => []);
vi.mock('$lib/persistence/community', () => ({
	getStolenLicksLocal: () => mockGetStolenLicksLocal()
}));

// Mock scale compatibility — default: everything is compatible
const mockIsLickCompatible = vi.fn((_lick: unknown, _scaleType: unknown) => true);
vi.mock('$lib/tonality/scale-compatibility', () => ({
	isLickCompatible: (lick: unknown, scaleType: unknown) => mockIsLickCompatible(lick, scaleType)
}));

// Mock scale/key modules used by transposeLick internals
vi.mock('$lib/music/scales', () => ({
	getScale: () => null
}));
vi.mock('$lib/music/keys', () => ({
	realizeScale: () => []
}));

// ─── Import module under test AFTER mocks are set up ─────────────────

const {
	getAllLicks,
	getLickById,
	getBaseLickFromId,
	queryLicks
} = await import('$lib/phrases/library-loader');

// ─── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	mockGetUserLicksLocal.mockReturnValue([]);
	mockGetStolenLicksLocal.mockReturnValue([]);
	mockIsLickCompatible.mockReturnValue(true);
});

describe('getAllLicks', () => {
	it('returns curated licks when no user licks', () => {
		const all = getAllLicks();
		expect(all).toHaveLength(FIXTURE_CURATED.length);
		expect(all.map(l => l.id)).toEqual(FIXTURE_CURATED.map(l => l.id));
	});

	it('combines curated and user licks', () => {
		mockGetUserLicksLocal.mockReturnValue(FIXTURE_USER_LICKS);
		const all = getAllLicks();
		expect(all).toHaveLength(FIXTURE_CURATED.length + FIXTURE_USER_LICKS.length);
		expect(all.map(l => l.id)).toContain('user-1');
		expect(all.map(l => l.id)).toContain('lick-1');
	});

	it('returns a new array each call (not reference to internal state)', () => {
		const first = getAllLicks();
		const second = getAllLicks();
		expect(first).not.toBe(second);
		expect(first).toEqual(second);
	});

	it('includes stolen community licks alongside curated + user licks', () => {
		const stolen = [makePhrase({ id: 'stolen-1', name: 'Stolen Lick', source: 'user-recorded' })];
		mockGetUserLicksLocal.mockReturnValue(FIXTURE_USER_LICKS);
		mockGetStolenLicksLocal.mockReturnValue(stolen);
		const all = getAllLicks();
		expect(all.map(l => l.id)).toContain('stolen-1');
		expect(all).toHaveLength(FIXTURE_CURATED.length + FIXTURE_USER_LICKS.length + 1);
	});

	it('dedups when the same id appears in user and stolen caches (safety net)', () => {
		const shared = makePhrase({ id: 'shared-id', name: 'Shared' });
		mockGetUserLicksLocal.mockReturnValue([shared]);
		mockGetStolenLicksLocal.mockReturnValue([shared]);
		const all = getAllLicks();
		const count = all.filter(l => l.id === 'shared-id').length;
		expect(count).toBe(1);
	});

	it('dedups duplicate ids within the user cache, keeping the first', () => {
		// Anonymous/offline clients never run the cloud Map-merge, so a stray
		// duplicate row can persist in localStorage. getAllLicks() must collapse
		// it rather than render two cards (and collide in the id-keyed {#each}).
		mockGetUserLicksLocal.mockReturnValue([
			makePhrase({ id: 'dup', name: 'First', source: 'user-entered' }),
			makePhrase({ id: 'dup', name: 'Second', source: 'user-entered' })
		]);
		const all = getAllLicks();
		const matches = all.filter(l => l.id === 'dup');
		expect(matches).toHaveLength(1);
		expect(matches[0].name).toBe('First');
		expect(all).toHaveLength(FIXTURE_CURATED.length + 1);
	});
});

describe('getLickById', () => {
	it('finds curated lick by ID', () => {
		const lick = getLickById('lick-2');
		expect(lick).toBeDefined();
		expect(lick!.name).toBe('Blues Riff');
	});

	it('finds user lick by ID', () => {
		mockGetUserLicksLocal.mockReturnValue(FIXTURE_USER_LICKS);
		const lick = getLickById('user-1');
		expect(lick).toBeDefined();
		expect(lick!.name).toBe('My Custom Lick');
	});

	it('returns undefined for unknown ID', () => {
		const lick = getLickById('nonexistent-id');
		expect(lick).toBeUndefined();
	});
});

describe('getBaseLickFromId', () => {
	it('returns the lick when id matches directly', () => {
		const lick = getBaseLickFromId('lick-1');
		expect(lick?.id).toBe('lick-1');
	});

	it('strips a transposition `_<KEY>` suffix to find the base lick', () => {
		// transposeLick produces ids like `${baseId}_${targetKey}`
		const lick = getBaseLickFromId('lick-1_F#');
		expect(lick?.id).toBe('lick-1');
	});

	it('handles every pitch class as a stripped suffix', () => {
		const keys = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
		for (const k of keys) {
			expect(getBaseLickFromId(`lick-3_${k}`)?.id).toBe('lick-3');
		}
	});

	it('does not strip a non-pitch-class suffix', () => {
		// "_xyz" is not a valid pitch class — should not be stripped
		expect(getBaseLickFromId('lick-1_xyz')).toBeUndefined();
	});

	it('returns undefined when neither direct nor stripped id matches', () => {
		expect(getBaseLickFromId('does-not-exist_C')).toBeUndefined();
	});

	it('returns undefined for an id with no underscore that does not match', () => {
		expect(getBaseLickFromId('mystery')).toBeUndefined();
	});

	it('prefers a direct id hit over the stripped fallback', () => {
		// A user-created lick whose id ends in `_C` and exists verbatim
		// must not be stripped down to a different lick.
		mockGetUserLicksLocal.mockReturnValue([
			makePhrase({ id: 'lick-1_C', name: 'User Lick Ending In C' })
		]);
		const lick = getBaseLickFromId('lick-1_C');
		expect(lick?.name).toBe('User Lick Ending In C');
	});

	it('finds user lick via stripped suffix', () => {
		mockGetUserLicksLocal.mockReturnValue(FIXTURE_USER_LICKS);
		const lick = getBaseLickFromId('user-1_Bb');
		expect(lick?.id).toBe('user-1');
	});
});


describe('queryLicks', () => {
	it('returns all licks when query is empty', () => {
		const results = queryLicks({});
		expect(results).toHaveLength(FIXTURE_CURATED.length);
	});

	it('returns all licks when query is undefined fields', () => {
		const results = queryLicks({
			category: undefined,
			maxDifficulty: undefined,
			minDifficulty: undefined,
			tags: undefined,
			search: undefined,
			scaleType: undefined
		});
		expect(results).toHaveLength(FIXTURE_CURATED.length);
	});

	it('filters by category', () => {
		const results = queryLicks({ category: 'blues' });
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe('lick-2');
	});

	it('filters by maxDifficulty (difficulty.level <= threshold)', () => {
		const results = queryLicks({ maxDifficulty: 30 });
		// lick-1 (20), lick-4 (10) pass; lick-2 (40), lick-3 (60), lick-5 (80) fail
		expect(results).toHaveLength(2);
		expect(results.every(l => l.difficulty.level <= 30)).toBe(true);
	});

	it('filters by minDifficulty (difficulty.level >= threshold)', () => {
		const results = queryLicks({ minDifficulty: 50 });
		// lick-3 (60) and lick-5 (80) pass
		expect(results).toHaveLength(2);
		expect(results.every(l => l.difficulty.level >= 50)).toBe(true);
	});

	it('filters by tags (any match)', () => {
		const results = queryLicks({ tags: ['funky'] });
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe('lick-2');
	});

	it('filters by multiple tags with OR semantics', () => {
		const results = queryLicks({ tags: ['funky', 'easy'] });
		// lick-2 has 'funky', lick-4 has 'easy'
		expect(results).toHaveLength(2);
		const ids = results.map(l => l.id);
		expect(ids).toContain('lick-2');
		expect(ids).toContain('lick-4');
	});

	it('filters by search term matching name (case-insensitive)', () => {
		const results = queryLicks({ search: 'blues' });
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe('lick-2');
	});

	it('filters by search term matching name case-insensitively', () => {
		const results = queryLicks({ search: 'PENTATONIC' });
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe('lick-4');
	});

	it('filters by search term matching tags', () => {
		const results = queryLicks({ search: 'enclosure' });
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe('lick-5');
	});

	it('filters by scaleType via isLickCompatible', () => {
		// Make only the blues lick compatible with the queried scale type
		mockIsLickCompatible.mockImplementation(
			(lick: unknown) => (lick as Phrase).category === 'blues'
		);
		const results = queryLicks({ scaleType: 'blues' });
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe('lick-2');
		expect(mockIsLickCompatible).toHaveBeenCalled();
	});

	it('combines multiple filters (intersection)', () => {
		const results = queryLicks({
			category: 'ii-V-I-major',
			maxDifficulty: 30
		});
		// lick-1 (category match, level 20) passes; lick-3 (category match, level 60) fails
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe('lick-1');
	});

	it('combines category + tags filters', () => {
		const results = queryLicks({
			category: 'ii-V-I-major',
			tags: ['modal']
		});
		// lick-3 matches both ii-V-I-major category and 'modal' tag
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe('lick-3');
	});

	it('combines difficulty range filters', () => {
		const results = queryLicks({
			minDifficulty: 30,
			maxDifficulty: 70
		});
		// lick-2 (40) and lick-3 (60) pass
		expect(results).toHaveLength(2);
		expect(results.every(l => l.difficulty.level >= 30 && l.difficulty.level <= 70)).toBe(true);
	});

	it('includes user licks in query results', () => {
		mockGetUserLicksLocal.mockReturnValue(FIXTURE_USER_LICKS);
		const results = queryLicks({ category: 'user' });
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe('user-1');
	});

	it('returns empty array when no licks match', () => {
		const results = queryLicks({ search: 'nonexistent-term-xyz' });
		expect(results).toEqual([]);
	});
});
