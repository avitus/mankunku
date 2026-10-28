import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	loadPracticeDuration,
	savePracticeDuration
} from '$lib/persistence/lick-practice-duration';
import { save } from '$lib/persistence/storage';
import { __resetNamespaceCacheForTests, setActiveUid } from '$lib/persistence/namespace';

beforeEach(() => {
	const data = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => data.set(key, value),
		removeItem: (key: string) => data.delete(key),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() { return data.size; }
	});
	__resetNamespaceCacheForTests();
	setActiveUid('alice');
});

describe('lick-practice duration knob', () => {
	it('returns null before anything is saved', () => {
		expect(loadPracticeDuration()).toBeNull();
	});

	it('survives a reload', () => {
		savePracticeDuration(8);
		expect(loadPracticeDuration()).toBe(8);
	});

	it('isolates the setting between users', () => {
		savePracticeDuration(8);
		setActiveUid('bob');
		expect(loadPracticeDuration()).toBeNull();
	});

	it('ignores values the knob cannot show', () => {
		save('lick-practice-duration', 'ten');
		expect(loadPracticeDuration()).toBeNull();
		save('lick-practice-duration', 0);
		expect(loadPracticeDuration()).toBeNull();
		save('lick-practice-duration', 60);
		expect(loadPracticeDuration()).toBe(20);
		save('lick-practice-duration', 1);
		expect(loadPracticeDuration()).toBe(3);
	});
});
