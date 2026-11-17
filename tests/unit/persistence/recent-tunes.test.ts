import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRecentTuneIds, recordRecentTune } from '$lib/persistence/recent-tunes';
import { setActiveUid, __resetNamespaceCacheForTests } from '$lib/persistence/namespace';
import { save } from '$lib/persistence/storage';

beforeEach(() => {
	const values = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
		key: (index: number) => [...values.keys()][index] ?? null,
		/** Match the browser Storage length contract for the namespace helper. */
		get length(): number { return values.size; }
	});
	__resetNamespaceCacheForTests();
	setActiveUid(null);
});

afterEach(() => {
	__resetNamespaceCacheForTests();
	vi.unstubAllGlobals();
});

describe('recent tunes', () => {
	it('starts empty and moves repeated visits to the front without duplicates', () => {
		expect(getRecentTuneIds()).toEqual([]);
		recordRecentTune('a'); recordRecentTune('b'); recordRecentTune('c');
		recordRecentTune('a'); recordRecentTune('a');
		expect(getRecentTuneIds()).toEqual(['a', 'c', 'b']);
	});

	it('retains a bounded fallback history for tunes that leave the book', () => {
		for (let index = 0; index < 60; index++) recordRecentTune(`tune-${index}`);
		expect(getRecentTuneIds()).toHaveLength(50);
		expect(getRecentTuneIds()[0]).toBe('tune-59');
		expect(getRecentTuneIds().at(-1)).toBe('tune-10');
	});

	it('rejects corrupt storage and sanitizes mixed or duplicate entries', () => {
		localStorage.setItem('mankunku:recent-tunes', '{broken');
		expect(getRecentTuneIds()).toEqual([]);
		save('recent-tunes', { id: 'wrong shape' });
		expect(getRecentTuneIds()).toEqual([]);
		save('recent-tunes', [null, 'a', 3, '', ' ', {}, 'b', 'a']);
		expect(getRecentTuneIds()).toEqual(['a', 'b']);
		recordRecentTune(''); recordRecentTune('  ');
		expect(getRecentTuneIds()).toEqual(['a', 'b']);
	});

	it('isolates anonymous and signed-in histories on a shared browser', () => {
		recordRecentTune('anonymous');
		setActiveUid('alice');
		expect(getRecentTuneIds()).toEqual([]);
		recordRecentTune('alice-tune');
		setActiveUid('bob');
		expect(getRecentTuneIds()).toEqual([]);
		recordRecentTune('bob-tune');
		setActiveUid('alice');
		expect(getRecentTuneIds()).toEqual(['alice-tune']);
		setActiveUid(null);
		expect(getRecentTuneIds()).toEqual(['anonymous']);
	});

	it('treats unavailable storage as an empty history without breaking navigation', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => { throw new Error('Unavailable'); },
			setItem: () => { throw new Error('Unavailable'); }
		});
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(getRecentTuneIds()).toEqual([]);
		expect(() => recordRecentTune('a')).not.toThrow();
		warning.mockRestore();
	});
});
