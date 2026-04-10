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
	getPracticeTaggedIds,
	toggleProgressionTag,
	hasProgressionTag,
	getProgressionTags,
	isTaggedForProgression,
	backfillPracticeTags
} from '$lib/persistence/lick-practice-store.ts';
import type { LickPracticeProgress } from '$lib/types/lick-practice.ts';

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
		expect(updated['lick-1']['G'].currentTempo).toBe(130);
	});

	it('updateKeyProgress merges with existing', () => {
		const progress: LickPracticeProgress = {
			'lick-1': {
				'C': { currentTempo: 100, lastPracticedAt: 1000, passCount: 2 }
			}
		};
		const updated = updateKeyProgress(progress, 'lick-1', 'C', { passCount: 3 });
		expect(updated['lick-1']['C'].passCount).toBe(3);
		expect(updated['lick-1']['C'].currentTempo).toBe(100);
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

	it('preserves other tags in the store when adding practice', () => {
		// Pre-populate with a progression tag
		toggleProgressionTag('lick-1', 'turnaround');
		expect(hasProgressionTag('lick-1', 'turnaround')).toBe(true);

		const licks = [{ id: 'lick-1', tags: ['practice'] }];
		backfillPracticeTags(licks, {});

		expect(hasPracticeTag('lick-1')).toBe(true);
		expect(hasProgressionTag('lick-1', 'turnaround')).toBe(true);
	});

	it('returns 0 when there is nothing to backfill', () => {
		expect(backfillPracticeTags([], {})).toBe(0);
		expect(backfillPracticeTags([{ id: 'x', tags: [] }], {})).toBe(0);
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
