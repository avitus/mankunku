import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	loadLickPracticeProgress,
	saveLickPracticeProgress,
	getKeyProgress,
	updateKeyProgress,
	getLickTempo,
	getLickLastPracticed,
	loadUserLickTags,
	saveUserLickTags,
	togglePracticeTag,
	hasPracticeTag,
	isInPracticeSet,
	resolvePracticeFallbackTags,
	getEffectivePracticeLickIds,
	setPracticeTag,
	getPracticeTaggedIds,
	toggleProgressionTag,
	hasProgressionTag,
	getProgressionTags,
	isTaggedForProgression,
	backfillPracticeTags,
	backfillInferredProgressionTags,
	getUnlockedKeyCount,
	bumpUnlockedKeyCount,
	loadUnlockCounts,
	migrateOrphanLickCategories
} from '$lib/persistence/lick-practice-store';
import { getLickCategoryOverrides } from '$lib/persistence/user-licks';
import type { LickPracticeProgress, LickPracticeKeyProgress } from '$lib/types/lick-practice';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';

// Mock localStorage
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

describe('lick practice progress persistence', () => {
	it('loadLickPracticeProgress returns empty object when no data', () => {
		expect(loadLickPracticeProgress()).toEqual({});
	});

	it('saveLickPracticeProgress and loadLickPracticeProgress round-trip', () => {
		const progress: LickPracticeProgress = {
			'lick-1': {
				'C': { currentTempo: 120, lastPracticedAt: 1000, passCount: 3 },
				'F': { currentTempo: 110, lastPracticedAt: 900, passCount: 1 }
			}
		};
		saveLickPracticeProgress(progress);
		expect(loadLickPracticeProgress()).toEqual(progress);
	});

	it('getKeyProgress returns defaults for unknown lick/key', () => {
		const kp = getKeyProgress({}, 'lick-1', 'C');
		expect(kp.currentTempo).toBe(100);
		expect(kp.lastPracticedAt).toBe(0);
		expect(kp.passCount).toBe(0);
	});

	it('getKeyProgress returns stored values', () => {
		const progress: LickPracticeProgress = {
			'lick-1': {
				'C': { currentTempo: 140, lastPracticedAt: 5000, passCount: 7 }
			}
		};
		const kp = getKeyProgress(progress, 'lick-1', 'C');
		expect(kp.currentTempo).toBe(140);
		expect(kp.passCount).toBe(7);
	});

	it('updateKeyProgress creates entry for new lick/key', () => {
		const updated = updateKeyProgress({}, 'lick-1', 'G', {
			currentTempo: 130,
			lastPracticedAt: 2000,
			passCount: 1
		});
		expect(updated['lick-1']!['G']!.currentTempo).toBe(130);
	});

	it('updateKeyProgress merges with existing', () => {
		const progress: LickPracticeProgress = {
			'lick-1': {
				'C': { currentTempo: 100, lastPracticedAt: 1000, passCount: 2 }
			}
		};
		const updated = updateKeyProgress(progress, 'lick-1', 'C', { passCount: 3 });
		expect(updated['lick-1']!['C']!.passCount).toBe(3);
		expect(updated['lick-1']!['C']!.currentTempo).toBe(100);
	});

	it('getLickTempo returns minimum tempo across keys', () => {
		const progress: LickPracticeProgress = {
			'lick-1': {
				'C': { currentTempo: 120, lastPracticedAt: 1000, passCount: 1 },
				'F': { currentTempo: 100, lastPracticedAt: 900, passCount: 1 },
				'G': { currentTempo: 140, lastPracticedAt: 800, passCount: 1 }
			}
		};
		expect(getLickTempo(progress, 'lick-1')).toBe(100);
	});

	it('getLickTempo returns default 100 for unknown lick', () => {
		expect(getLickTempo({}, 'unknown')).toBe(100);
	});

	it('getLickLastPracticed returns max timestamp across keys', () => {
		const progress: LickPracticeProgress = {
			'lick-1': {
				'C': { currentTempo: 100, lastPracticedAt: 1000, passCount: 1 },
				'F': { currentTempo: 100, lastPracticedAt: 3000, passCount: 1 },
				'G': { currentTempo: 100, lastPracticedAt: 2000, passCount: 1 }
			}
		};
		expect(getLickLastPracticed(progress, 'lick-1')).toBe(3000);
	});
});

describe('practice tag management', () => {
	it('hasPracticeTag returns false when no tags stored', () => {
		expect(hasPracticeTag('lick-1')).toBe(false);
	});

	it('togglePracticeTag adds practice tag', () => {
		const result = togglePracticeTag('lick-1');
		expect(result).toBe(true);
		expect(hasPracticeTag('lick-1')).toBe(true);
	});

	it('togglePracticeTag removes practice tag when already present', () => {
		togglePracticeTag('lick-1');
		const result = togglePracticeTag('lick-1');
		expect(result).toBe(false);
		expect(hasPracticeTag('lick-1')).toBe(false);
	});

	it('getPracticeTaggedIds returns all tagged IDs', () => {
		togglePracticeTag('lick-1');
		togglePracticeTag('lick-3');
		togglePracticeTag('lick-5');
		const ids = getPracticeTaggedIds();
		expect(ids.size).toBe(3);
		expect(ids.has('lick-1')).toBe(true);
		expect(ids.has('lick-3')).toBe(true);
		expect(ids.has('lick-5')).toBe(true);
	});

	it('saveUserLickTags and loadUserLickTags round-trip', () => {
		const tags = { 'lick-1': ['practice', 'favorite'], 'lick-2': ['favorite'] };
		saveUserLickTags(tags);
		expect(loadUserLickTags()).toEqual(tags);
	});

	// Regression: setPracticeTag(id, false) used to silently no-op when the
	// store had no entry for the lick — the UI showed checked via the
	// `lick.tags` fallback, but the gate `if (!tagged && has)` skipped the
	// save+sync path entirely. The first uncheck on a curated 'practice' lick
	// produced no localStorage write and no Supabase request.
	describe('setPracticeTag', () => {
		it('writes an empty entry when removing practice from a lick with no prior store entry', () => {
			expect(loadUserLickTags()['curated-practice-lick']).toBeUndefined();
			setPracticeTag('curated-practice-lick', false);
			const stored = loadUserLickTags();
			expect(stored['curated-practice-lick']).toEqual([]);
			expect(hasPracticeTag('curated-practice-lick')).toBe(false);
		});

		it('writes an entry with practice when adding to a lick with no prior store entry', () => {
			setPracticeTag('lick-1', true);
			expect(loadUserLickTags()['lick-1']).toEqual(['practice']);
			expect(hasPracticeTag('lick-1')).toBe(true);
		});

		it('removes practice from an existing entry while preserving other tags', () => {
			saveUserLickTags({ 'lick-1': ['practice', 'prog:turnaround'] });
			setPracticeTag('lick-1', false);
			expect(loadUserLickTags()['lick-1']).toEqual(['prog:turnaround']);
		});

		it('adds practice to an existing entry without duplicating it', () => {
			saveUserLickTags({ 'lick-1': ['practice', 'prog:turnaround'] });
			setPracticeTag('lick-1', true);
			const stored = loadUserLickTags()['lick-1'] ?? [];
			expect(stored.filter(t => t === 'practice')).toHaveLength(1);
			expect(stored).toContain('prog:turnaround');
		});
	});

	describe('isInPracticeSet', () => {
		it('returns lick.tags fallback when no store entry exists', () => {
			expect(isInPracticeSet('lick-1', ['practice'])).toBe(true);
			expect(isInPracticeSet('lick-1', ['bebop'])).toBe(false);
		});

		it('treats the store entry as authoritative when present', () => {
			saveUserLickTags({ 'lick-1': [] });
			// Entry exists but does not include 'practice' — explicit removal.
			// Must NOT fall through to lick.tags.
			expect(isInPracticeSet('lick-1', ['practice'])).toBe(false);
		});

		it('respects an empty entry as a deliberate "removed" signal', () => {
			setPracticeTag('lick-1', false);
			expect(isInPracticeSet('lick-1', ['practice'])).toBe(false);
		});
	});

	describe('resolvePracticeFallbackTags', () => {
		it('returns lick.tags when no override is present', () => {
			expect(resolvePracticeFallbackTags('lick-1', ['practice'])).toEqual(['practice']);
		});

		it('returns the override when one exists', () => {
			localStorage.setItem(
				'mankunku:lick-tag-overrides',
				JSON.stringify({ 'lick-1': ['practice', 'favorite'] })
			);
			expect(resolvePracticeFallbackTags('lick-1', ['stale'])).toEqual([
				'practice',
				'favorite'
			]);
		});
	});

	describe('getEffectivePracticeLickIds', () => {
		it('includes licks whose practice flag only lives in lick.tags (pre-backfill)', () => {
			const licks = [
				{ id: 'curated-1', tags: ['practice', 'bebop'] },
				{ id: 'curated-2', tags: ['bebop'] }
			];
			const ids = getEffectivePracticeLickIds(licks);
			expect(ids.has('curated-1')).toBe(true);
			expect(ids.has('curated-2')).toBe(false);
		});

		it('treats the store entry as authoritative once it exists', () => {
			saveUserLickTags({ 'lick-1': [] }); // user removed practice
			const licks = [{ id: 'lick-1', tags: ['practice'] }];
			expect(getEffectivePracticeLickIds(licks).has('lick-1')).toBe(false);
		});

		it('honours the legacy tag-override blob over lick.tags', () => {
			localStorage.setItem(
				'mankunku:lick-tag-overrides',
				JSON.stringify({ 'curated-1': ['practice'] })
			);
			const licks = [{ id: 'curated-1', tags: [] }];
			expect(getEffectivePracticeLickIds(licks).has('curated-1')).toBe(true);
		});
	});
});

describe('backfillPracticeTags', () => {
	it('adds practice tag to store when present in lick.tags but missing from store', () => {
		const licks = [
			{ id: 'lick-1', tags: ['practice', 'user-entered'] },
			{ id: 'lick-2', tags: ['user-entered'] },
			{ id: 'lick-3', tags: ['practice'] }
		];
		const added = backfillPracticeTags(licks, {});
		expect(added).toBe(2);
		expect(hasPracticeTag('lick-1')).toBe(true);
		expect(hasPracticeTag('lick-2')).toBe(false);
		expect(hasPracticeTag('lick-3')).toBe(true);
	});

	it('adds practice tag from curated lick tag-override entries', () => {
		const tagOverrides = {
			'curated-1': ['practice', 'bebop'],
			'curated-2': ['bebop']
		};
		const added = backfillPracticeTags([], tagOverrides);
		expect(added).toBe(1);
		expect(hasPracticeTag('curated-1')).toBe(true);
		expect(hasPracticeTag('curated-2')).toBe(false);
	});

	it('does not duplicate an existing practice tag in the store', () => {
		togglePracticeTag('lick-1');
		expect(hasPracticeTag('lick-1')).toBe(true);

		const licks = [{ id: 'lick-1', tags: ['practice'] }];
		const added = backfillPracticeTags(licks, {});
		expect(added).toBe(0);

		// Should still be tagged once — toggle removes cleanly
		togglePracticeTag('lick-1');
		expect(hasPracticeTag('lick-1')).toBe(false);
	});

	it('respects an existing entry — does not re-add practice to a lick the user has already touched', () => {
		// Pre-populate with a progression tag — this creates an entry the
		// user owns. Re-adding 'practice' here would silently undo any
		// deliberate removal the user might have performed before tagging
		// the progression. Backfill should only seed entries that don't
		// yet exist.
		toggleProgressionTag('lick-1', 'turnaround');
		expect(hasProgressionTag('lick-1', 'turnaround')).toBe(true);

		const licks = [{ id: 'lick-1', tags: ['practice'] }];
		const added = backfillPracticeTags(licks, {});

		expect(added).toBe(0);
		expect(hasPracticeTag('lick-1')).toBe(false);
		expect(hasProgressionTag('lick-1', 'turnaround')).toBe(true);
	});

	it('respects an empty entry written by a prior removal', () => {
		// User removes 'practice' from a curated lick on this device.
		setPracticeTag('lick-1', false);
		expect(loadUserLickTags()['lick-1']).toEqual([]);

		// Backfill runs (e.g., user navigates to /lick-practice).
		const licks = [{ id: 'lick-1', tags: ['practice'] }];
		const added = backfillPracticeTags(licks, {});

		// Removal sticks — backfill must not undo it.
		expect(added).toBe(0);
		expect(hasPracticeTag('lick-1')).toBe(false);
	});

	it('returns 0 when there is nothing to backfill', () => {
		expect(backfillPracticeTags([], {})).toBe(0);
		expect(backfillPracticeTags([{ id: 'x', tags: [] }], {})).toBe(0);
	});
});

describe('unlocked key count', (): void => {
	it('returns 1 for a brand-new lick with no progress and no stored count', (): void => {
		expect(getUnlockedKeyCount({}, 'lick-new')).toBe(1);
	});

	it('returns 12 for a lick with progress in all 12 keys and no stored count (grandfathered)', (): void => {
		const allKeysProgress: Partial<Record<PitchClass, LickPracticeKeyProgress>> = {};
		for (const k of PITCH_CLASSES) {
			allKeysProgress[k] = { currentTempo: 100, lastPracticedAt: 1000, passCount: 1 };
		}
		const progress: LickPracticeProgress = { 'lick-old': allKeysProgress };
		expect(getUnlockedKeyCount(progress, 'lick-old')).toBe(12);
	});

	it('returns 1 for a lick with partial progress (e.g. failed first session) and no stored count', (): void => {
		// A new lick whose entry-key session failed will have progress in 1
		// key but no stored unlock count. We must not grandfather it to 12.
		const progress: LickPracticeProgress = {
			'lick-failed-first': {
				'C': { currentTempo: 60, lastPracticedAt: 1000, passCount: 0 }
			}
		};
		expect(getUnlockedKeyCount(progress, 'lick-failed-first')).toBe(1);
	});

	it('returns the stored count when one exists, clamped to [1, 12]', (): void => {
		bumpUnlockedKeyCount({}, 'lick-x'); // 1 → 2
		bumpUnlockedKeyCount({}, 'lick-x'); // 2 → 3
		expect(getUnlockedKeyCount({}, 'lick-x')).toBe(3);
	});

	it('clamps a corrupt stored value below 1 up to 1', (): void => {
		// Storage module prefixes keys with 'mankunku:' — write through the
		// same path so getUnlockedKeyCount actually sees the corrupt value.
		localStorageMock.setItem(
			'mankunku:lick-unlock-count',
			JSON.stringify({ 'lick-x': 0 })
		);
		expect(getUnlockedKeyCount({}, 'lick-x')).toBe(1);
	});

	it('clamps a corrupt stored value above 12 down to 12', (): void => {
		localStorageMock.setItem(
			'mankunku:lick-unlock-count',
			JSON.stringify({ 'lick-x': 99 })
		);
		expect(getUnlockedKeyCount({}, 'lick-x')).toBe(12);
	});

	it('falls back to default when stored value is NaN (e.g. corrupted store)', (): void => {
		// JSON.stringify converts NaN to null, so simulate manual corruption by
		// writing the raw payload directly. Math.max(1, NaN) returns NaN, which
		// would silently break session planning if it leaked through.
		localStorageMock.setItem(
			'mankunku:lick-unlock-count',
			'{"lick-x": null}'
		);
		expect(getUnlockedKeyCount({}, 'lick-x')).toBe(1);
	});

	it('falls back to default when stored value is Infinity', (): void => {
		localStorageMock.setItem(
			'mankunku:lick-unlock-count',
			'{"lick-x": 1e999}'
		);
		expect(Number.isFinite(JSON.parse('{"lick-x": 1e999}')['lick-x'])).toBe(false);
		expect(getUnlockedKeyCount({}, 'lick-x')).toBe(1);
	});

	it('truncates fractional stored values to integers', (): void => {
		// Without truncation, slice(0, 1.5) unlocks 1 key but bumping would
		// persist 2.5 — the stored counter drifts from the actual unlocked set.
		localStorageMock.setItem(
			'mankunku:lick-unlock-count',
			JSON.stringify({ 'lick-x': 2.7 })
		);
		expect(getUnlockedKeyCount({}, 'lick-x')).toBe(2);

		// And the bump from a fractional base lands on a clean integer.
		expect(bumpUnlockedKeyCount({}, 'lick-x')).toBe(3);
		expect(loadUnlockCounts()['lick-x']).toBe(3);
	});

	it('bumpUnlockedKeyCount increments from 1 to 2 on first call for a new lick', (): void => {
		const next = bumpUnlockedKeyCount({}, 'lick-new');
		expect(next).toBe(2);
		expect(loadUnlockCounts()['lick-new']).toBe(2);
	});

	it('bumpUnlockedKeyCount keeps a grandfathered lick at 12 instead of resetting to 2', (): void => {
		const allKeysProgress: Partial<Record<PitchClass, LickPracticeKeyProgress>> = {};
		for (const k of PITCH_CLASSES) {
			allKeysProgress[k] = { currentTempo: 100, lastPracticedAt: 1000, passCount: 1 };
		}
		const progress: LickPracticeProgress = { 'lick-old': allKeysProgress };
		const next = bumpUnlockedKeyCount(progress, 'lick-old');
		expect(next).toBe(12);
		expect(loadUnlockCounts()['lick-old']).toBe(12);
	});

	it('bumpUnlockedKeyCount caps at 12', (): void => {
		localStorageMock.setItem(
			'mankunku:lick-unlock-count',
			JSON.stringify({ 'lick-x': 12 })
		);
		expect(bumpUnlockedKeyCount({}, 'lick-x')).toBe(12);
		expect(loadUnlockCounts()['lick-x']).toBe(12);
	});

	it('multiple licks track independent unlock counts', (): void => {
		bumpUnlockedKeyCount({}, 'lick-a');
		bumpUnlockedKeyCount({}, 'lick-a');
		bumpUnlockedKeyCount({}, 'lick-b');
		expect(getUnlockedKeyCount({}, 'lick-a')).toBe(3);
		expect(getUnlockedKeyCount({}, 'lick-b')).toBe(2);
		expect(getUnlockedKeyCount({}, 'lick-c')).toBe(1);
	});
});

describe('progression tag management', () => {
	it('hasProgressionTag returns false when no tags stored', () => {
		expect(hasProgressionTag('lick-1', 'ii-V-I-major')).toBe(false);
	});

	it('toggleProgressionTag adds a progression tag', () => {
		const result = toggleProgressionTag('lick-1', 'ii-V-I-major');
		expect(result).toBe(true);
		expect(hasProgressionTag('lick-1', 'ii-V-I-major')).toBe(true);
	});

	it('toggleProgressionTag removes tag when already present', () => {
		toggleProgressionTag('lick-1', 'blues');
		const result = toggleProgressionTag('lick-1', 'blues');
		expect(result).toBe(false);
		expect(hasProgressionTag('lick-1', 'blues')).toBe(false);
	});

	it('multiple progression tags on same lick', () => {
		toggleProgressionTag('lick-1', 'ii-V-I-major');
		toggleProgressionTag('lick-1', 'blues');
		toggleProgressionTag('lick-1', 'turnaround');

		const tags = getProgressionTags('lick-1');
		expect(tags).toHaveLength(3);
		expect(tags).toContain('ii-V-I-major');
		expect(tags).toContain('blues');
		expect(tags).toContain('turnaround');
	});

	it('progression tags are independent from practice tag', () => {
		togglePracticeTag('lick-1');
		toggleProgressionTag('lick-1', 'ii-V-I-minor');

		expect(hasPracticeTag('lick-1')).toBe(true);
		expect(hasProgressionTag('lick-1', 'ii-V-I-minor')).toBe(true);

		togglePracticeTag('lick-1');
		expect(hasPracticeTag('lick-1')).toBe(false);
		expect(hasProgressionTag('lick-1', 'ii-V-I-minor')).toBe(true);
	});

	it('getProgressionTags returns empty array for untagged lick', () => {
		expect(getProgressionTags('unknown')).toEqual([]);
	});

	it('isTaggedForProgression mirrors hasProgressionTag', () => {
		toggleProgressionTag('lick-1', 'ii-V-I-major-long');
		expect(isTaggedForProgression('lick-1', 'ii-V-I-major-long')).toBe(true);
		expect(isTaggedForProgression('lick-1', 'blues')).toBe(false);
	});

	it('removing all progression tags cleans up the entry', () => {
		toggleProgressionTag('lick-1', 'blues');
		toggleProgressionTag('lick-1', 'blues');
		expect(getProgressionTags('lick-1')).toEqual([]);
	});
});

describe('migrateOrphanLickCategories', () => {
	const PREFIX = 'mankunku:';

	function seedUserLick(id: string, category: string, name = id): void {
		const existing = JSON.parse(store[PREFIX + 'user-licks'] ?? '[]');
		existing.push({
			id,
			name,
			timeSignature: [4, 4],
			key: 'C',
			notes: [],
			harmony: [],
			difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
			category,
			tags: [],
			source: 'user'
		});
		store[PREFIX + 'user-licks'] = JSON.stringify(existing);
	}

	function seedCategoryOverride(id: string, category: string): void {
		const overrides = JSON.parse(store[PREFIX + 'lick-category-overrides'] ?? '{}');
		overrides[id] = category;
		store[PREFIX + 'lick-category-overrides'] = JSON.stringify(overrides);
	}

	it('returns 0 when no licks carry orphan categories', () => {
		seedUserLick('lk1', 'ii-V-I-major');
		expect(migrateOrphanLickCategories()).toBe(0);
	});

	it('remaps user-lick category and adds the inferred prog:* tag', () => {
		seedUserLick('lk1', 'long-ii-V-I-major', "Don't Get Around Much Anymore");

		const migrated = migrateOrphanLickCategories();

		expect(migrated).toBe(1);
		const userLicks = JSON.parse(store[PREFIX + 'user-licks']);
		expect(userLicks[0].category).toBe('ii-V-I-major');
		expect(getProgressionTags('lk1')).toEqual(['ii-V-I-major-long']);
	});

	it('handles long-ii-V-I-minor symmetrically', () => {
		seedUserLick('lk2', 'long-ii-V-I-minor');

		expect(migrateOrphanLickCategories()).toBe(1);
		const userLicks = JSON.parse(store[PREFIX + 'user-licks']);
		expect(userLicks[0].category).toBe('ii-V-I-minor');
		expect(getProgressionTags('lk2')).toEqual(['ii-V-I-minor-long']);
	});

	it('rewrites curated category overrides too', () => {
		seedCategoryOverride('curated-1', 'long-ii-V-I-major');

		expect(migrateOrphanLickCategories()).toBe(1);
		expect(getLickCategoryOverrides()['curated-1']).toBe('ii-V-I-major');
		expect(getProgressionTags('curated-1')).toEqual(['ii-V-I-major-long']);
	});

	it('is idempotent — second run touches nothing', () => {
		seedUserLick('lk1', 'long-ii-V-I-major');
		expect(migrateOrphanLickCategories()).toBe(1);
		expect(migrateOrphanLickCategories()).toBe(0);
		// Tag wasn't double-added.
		expect(getProgressionTags('lk1')).toEqual(['ii-V-I-major-long']);
	});

	it('preserves an already-present prog tag instead of duplicating', () => {
		seedUserLick('lk1', 'long-ii-V-I-major');
		toggleProgressionTag('lk1', 'ii-V-I-major-long');
		expect(getProgressionTags('lk1')).toEqual(['ii-V-I-major-long']);

		migrateOrphanLickCategories();
		expect(getProgressionTags('lk1')).toEqual(['ii-V-I-major-long']);
	});
});

describe('backfillInferredProgressionTags', () => {
	const PREFIX = 'mankunku:';

	function seedUserLick(id: string, category: string): void {
		const existing = JSON.parse(store[PREFIX + 'user-licks'] ?? '[]');
		existing.push({
			id,
			name: id,
			timeSignature: [4, 4],
			key: 'C',
			notes: [],
			harmony: [],
			difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
			category,
			tags: [],
			source: 'user'
		});
		store[PREFIX + 'user-licks'] = JSON.stringify(existing);
	}

	it('adds the inferred prog:* tag for user licks with a bucket-A category', () => {
		seedUserLick('lk_vi', 'V-I-major');
		seedUserLick('lk_blues', 'blues');
		seedUserLick('lk_short', 'short-ii-V-I-minor');

		backfillInferredProgressionTags();

		expect(getProgressionTags('lk_vi')).toContain('ii-V-I-major-long');
		expect(getProgressionTags('lk_blues')).toContain('blues');
		expect(getProgressionTags('lk_short')).toContain('ii-V-I-minor');
	});

	it('does nothing for licks whose category is multi-fit (bucket B)', () => {
		seedUserLick('lk_mc', 'major-chord');
		seedUserLick('lk_mn', 'minor-chord');

		backfillInferredProgressionTags();

		expect(getProgressionTags('lk_mc')).toEqual([]);
		expect(getProgressionTags('lk_mn')).toEqual([]);
	});

	it('is idempotent — second run touches no new licks', () => {
		seedUserLick('lk1', 'V-I-minor');
		expect(backfillInferredProgressionTags()).toBeGreaterThanOrEqual(1);
		expect(getProgressionTags('lk1')).toEqual(['ii-V-I-minor-long']);

		// Re-run: the seeded lick already has its tag, so it's a no-op for it.
		// The count may still include curated licks newly tagged on first run —
		// but those too are now stable.
		const second = backfillInferredProgressionTags();
		expect(second).toBe(0);
	});
});
