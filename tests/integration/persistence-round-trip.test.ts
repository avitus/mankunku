/**
 * Integration tests for local persistence round-trip cycle.
 *
 * Verifies the full mutation → localStorage save → reload → state hydrated
 * correctly cycle for both the generic storage API and the lick practice store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage with a Map-based store
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() { return store.size; },
	clear: vi.fn(() => store.clear())
});

// Mock the sync module to prevent Supabase calls
vi.mock('$lib/persistence/sync', () => ({
	syncLickMetadataToCloud: vi.fn().mockResolvedValue(undefined),
	loadLickMetadataFromCloud: vi.fn().mockResolvedValue(null),
	syncSettingsToCloud: vi.fn().mockResolvedValue(undefined),
	loadSettingsFromCloud: vi.fn().mockResolvedValue(null),
	syncProgressToCloud: vi.fn().mockResolvedValue(undefined),
	loadProgressFromCloud: vi.fn().mockResolvedValue(null)
}));

import { save, load, remove, listKeys, clearAll } from '$lib/persistence/storage';
import {
	saveLickPracticeProgress,
	loadLickPracticeProgress,
	updateKeyProgress,
	getKeyProgress,
	getLickTempo
} from '$lib/persistence/lick-practice-store';
import type { LickPracticeProgress } from '$lib/types/lick-practice';

beforeEach(() => {
	store.clear();
});

describe('storage round-trip', () => {
	it('save and load round-trip for object', () => {
		const data = { instrument: 'tenor-sax', tempo: 120 };
		save('test-settings', data);
		const loaded = load<typeof data>('test-settings');
		expect(loaded).toEqual(data);
	});

	it('save and load round-trip for array', () => {
		save('test-list', [1, 2, 3]);
		const loaded = load<number[]>('test-list');
		expect(loaded).toEqual([1, 2, 3]);
	});

	it('load returns null for non-existent key', () => {
		const loaded = load('does-not-exist');
		expect(loaded).toBeNull();
	});

	it('corrupted JSON falls back gracefully', () => {
		// Manually inject invalid JSON under the mankunku prefix
		store.set('mankunku:broken', '{not valid json!!!');
		const loaded = load('broken');
		expect(loaded).toBeNull();
	});

	it('clearAll removes only mankunku keys', () => {
		save('key-a', { a: 1 });
		save('key-b', { b: 2 });
		// Insert a non-mankunku key directly
		store.set('other-app:data', JSON.stringify({ x: 99 }));

		expect(store.has('mankunku:key-a')).toBe(true);
		expect(store.has('mankunku:key-b')).toBe(true);
		expect(store.has('other-app:data')).toBe(true);

		clearAll();

		expect(store.has('mankunku:key-a')).toBe(false);
		expect(store.has('mankunku:key-b')).toBe(false);
		// Non-mankunku key should survive
		expect(store.has('other-app:data')).toBe(true);
		expect(store.get('other-app:data')).toBe(JSON.stringify({ x: 99 }));
	});

	it('listKeys returns all saved keys', () => {
		save('alpha', 1);
		save('beta', 2);
		save('gamma', 3);

		const keys = listKeys();
		expect(keys).toHaveLength(3);
		expect(keys).toContain('alpha');
		expect(keys).toContain('beta');
		expect(keys).toContain('gamma');
	});
});

describe('lick practice progress round-trip', () => {
	it('updateKeyProgress persists and survives reload', () => {
		let progress = loadLickPracticeProgress();
		progress = updateKeyProgress(progress, 'lick-1', 'C', {
			currentTempo: 110,
			lastPracticedAt: Date.now(),
			passCount: 3
		});
		saveLickPracticeProgress(progress);

		// Reload from storage
		const reloaded = loadLickPracticeProgress();
		const keyProg = getKeyProgress(reloaded, 'lick-1', 'C');

		expect(keyProg.currentTempo).toBe(110);
		expect(keyProg.passCount).toBe(3);
	});

	it('getLickTempo returns stored tempo after round-trip', () => {
		let progress = loadLickPracticeProgress();
		progress = updateKeyProgress(progress, 'lick-2', 'Bb', {
			currentTempo: 140,
			lastPracticedAt: Date.now(),
			passCount: 1
		});
		progress = updateKeyProgress(progress, 'lick-2', 'F', {
			currentTempo: 120,
			lastPracticedAt: Date.now(),
			passCount: 2
		});
		saveLickPracticeProgress(progress);

		const reloaded = loadLickPracticeProgress();
		// getLickTempo returns the minimum across all keys
		expect(getLickTempo(reloaded, 'lick-2')).toBe(120);
	});

	it('saveLickPracticeProgress and loadLickPracticeProgress are symmetric', () => {
		const progress: LickPracticeProgress = {
			'lick-a': {
				'C': { currentTempo: 100, lastPracticedAt: 1000, passCount: 5 },
				'G': { currentTempo: 110, lastPracticedAt: 2000, passCount: 3 }
			},
			'lick-b': {
				'Eb': { currentTempo: 90, lastPracticedAt: 3000, passCount: 1 },
				'Bb': { currentTempo: 130, lastPracticedAt: 4000, passCount: 7 }
			},
			'lick-c': {
				'F#': { currentTempo: 80, lastPracticedAt: 5000, passCount: 0 }
			}
		};

		saveLickPracticeProgress(progress);
		const loaded = loadLickPracticeProgress();

		expect(loaded).toEqual(progress);
	});

	it('empty storage returns empty default progress', () => {
		// Storage is already cleared by beforeEach
		const progress = loadLickPracticeProgress();
		expect(progress).toEqual({});
	});
});
