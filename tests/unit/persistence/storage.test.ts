import { describe, it, expect, beforeEach, vi } from 'vitest';
import { save, load, remove, listKeys, clearAll } from '$lib/persistence/storage';

function createLocalStorageMock() {
	const store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			for (const k of Object.keys(store)) delete store[k];
		},
		get length() {
			return Object.keys(store).length;
		},
		key: (index: number) => Object.keys(store)[index] ?? null,
		_store: store
	};
}

let mock: ReturnType<typeof createLocalStorageMock>;

beforeEach(() => {
	mock = createLocalStorageMock();
	Object.defineProperty(globalThis, 'localStorage', { value: mock, writable: true });
});

describe('save', () => {
	it('stores JSON-serialized value with mankunku: prefix', () => {
		save('settings', { volume: 0.8 });
		expect(mock._store['mankunku:settings']).toBe(JSON.stringify({ volume: 0.8 }));
	});

	it('handles string values', () => {
		save('name', 'hello');
		expect(mock._store['mankunku:name']).toBe('"hello"');
	});

	it('handles number values', () => {
		save('count', 42);
		expect(mock._store['mankunku:count']).toBe('42');
	});

	it('handles boolean values', () => {
		save('flag', true);
		expect(mock._store['mankunku:flag']).toBe('true');
	});

	it('handles object values', () => {
		const obj = { a: 1, b: 'two' };
		save('data', obj);
		expect(mock._store['mankunku:data']).toBe(JSON.stringify(obj));
	});

	it('handles array values', () => {
		const arr = [1, 'two', false];
		save('list', arr);
		expect(mock._store['mankunku:list']).toBe(JSON.stringify(arr));
	});

	it('handles null values', () => {
		save('empty', null);
		expect(mock._store['mankunku:empty']).toBe('null');
	});

	it('calls syncCallback after successful save', () => {
		const callback = vi.fn();
		save('key', 'value', callback);
		expect(callback).toHaveBeenCalledOnce();
	});

	it('catches syncCallback errors without throwing', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const callback = vi.fn(() => {
			throw new Error('sync failed');
		});

		expect(() => save('key', 'value', callback)).not.toThrow();
		expect(warnSpy).toHaveBeenCalledOnce();
		expect(warnSpy.mock.calls[0][0]).toContain('Sync callback failed for key');

		warnSpy.mockRestore();
	});

	it('catches localStorage.setItem errors without throwing', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mock.setItem = () => {
			throw new DOMException('QuotaExceededError');
		};

		expect(() => save('key', 'value')).not.toThrow();
		expect(warnSpy).toHaveBeenCalledOnce();
		expect(warnSpy.mock.calls[0][0]).toContain('Failed to save key');

		warnSpy.mockRestore();
	});
});

describe('load', () => {
	it('returns parsed object for existing key', () => {
		mock._store['mankunku:settings'] = JSON.stringify({ volume: 0.8, muted: false });
		const result = load<{ volume: number; muted: boolean }>('settings');
		expect(result).toEqual({ volume: 0.8, muted: false });
	});

	it('returns parsed array for existing key', () => {
		mock._store['mankunku:history'] = JSON.stringify([1, 2, 3]);
		const result = load<number[]>('history');
		expect(result).toEqual([1, 2, 3]);
	});

	it('returns parsed number for existing key', () => {
		mock._store['mankunku:level'] = '5';
		const result = load<number>('level');
		expect(result).toBe(5);
	});

	it('returns null for missing key', () => {
		const result = load('nonexistent');
		expect(result).toBeNull();
	});

	it('returns null for invalid/corrupt JSON in storage', () => {
		mock._store['mankunku:corrupt'] = '{not valid json!!!';
		const result = load('corrupt');
		expect(result).toBeNull();
	});
});

describe('remove', () => {
	it('removes key with mankunku: prefix from storage', () => {
		mock._store['mankunku:settings'] = '"data"';
		remove('settings');
		expect(mock._store['mankunku:settings']).toBeUndefined();
	});

	it('does not throw for non-existent key', () => {
		expect(() => remove('nonexistent')).not.toThrow();
	});
});

describe('listKeys', () => {
	it('returns empty array when localStorage is empty', () => {
		expect(listKeys()).toEqual([]);
	});

	it('returns only mankunku: prefixed keys with prefix stripped', () => {
		mock._store['mankunku:settings'] = '{}';
		mock._store['mankunku:progress'] = '[]';
		const keys = listKeys();
		expect(keys).toContain('settings');
		expect(keys).toContain('progress');
		expect(keys).toHaveLength(2);
	});

	it('ignores keys from other apps', () => {
		mock._store['other-app:data'] = '{}';
		mock._store['random-key'] = '123';
		mock._store['mankunku:settings'] = '{}';
		const keys = listKeys();
		expect(keys).toEqual(['settings']);
	});

	it('returns all mankunku keys when multiple exist', () => {
		mock._store['mankunku:a'] = '1';
		mock._store['mankunku:b'] = '2';
		mock._store['mankunku:c'] = '3';
		const keys = listKeys();
		expect(keys).toHaveLength(3);
		expect(keys).toContain('a');
		expect(keys).toContain('b');
		expect(keys).toContain('c');
	});
});

describe('clearAll', () => {
	it('removes all mankunku: prefixed keys', () => {
		mock._store['mankunku:settings'] = '{}';
		mock._store['mankunku:progress'] = '[]';
		mock._store['mankunku:history'] = '[]';
		clearAll();
		expect(mock._store['mankunku:settings']).toBeUndefined();
		expect(mock._store['mankunku:progress']).toBeUndefined();
		expect(mock._store['mankunku:history']).toBeUndefined();
	});

	it('does not remove non-mankunku keys', () => {
		mock._store['mankunku:settings'] = '{}';
		mock._store['other-app:data'] = '"keep"';
		mock._store['plain-key'] = '"also-keep"';
		clearAll();
		expect(mock._store['other-app:data']).toBe('"keep"');
		expect(mock._store['plain-key']).toBe('"also-keep"');
		expect(mock._store['mankunku:settings']).toBeUndefined();
	});

	it('works when localStorage is already empty', () => {
		expect(() => clearAll()).not.toThrow();
		expect(listKeys()).toEqual([]);
	});
});
