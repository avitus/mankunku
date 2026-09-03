/**
 * The abcjs engine is a ~500 KB chunk that nothing in the app needs until a
 * staff is engraved. `createAbcjsLoader` owns ONE import of it: every caller
 * shares the same in-flight promise, a resolved module is handed back
 * synchronously so a component mounting after the fetch can engrave in its
 * first effect flush, and a failed fetch is retried on the next call rather
 * than poisoning every future staff.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAbcjsLoader, type AbcjsModule } from '$lib/notation/abcjs-loader';

// The loader never touches the module; a stand-in with the right identity is
// all the tests need.
const fakeModule = { renderAbc: () => {} } as unknown as AbcjsModule;

describe('createAbcjsLoader', () => {
	it('reports nothing loaded before the first load resolves, then the module', async () => {
		const loader = createAbcjsLoader(async () => fakeModule);
		expect(loader.loaded()).toBeNull();
		const pending = loader.load();
		expect(loader.loaded()).toBeNull();
		expect(await pending).toBe(fakeModule);
		expect(loader.loaded()).toBe(fakeModule);
	});

	it('imports once: concurrent and later callers share the same fetch', async () => {
		const importer = vi.fn(async () => fakeModule);
		const loader = createAbcjsLoader(importer);
		const [a, b] = await Promise.all([loader.load(), loader.load()]);
		expect(a).toBe(fakeModule);
		expect(b).toBe(fakeModule);
		expect(await loader.load()).toBe(fakeModule);
		expect(importer).toHaveBeenCalledTimes(1);
	});

	it('retries after a failed import instead of caching the failure', async () => {
		let attempts = 0;
		const loader = createAbcjsLoader(async () => {
			attempts++;
			if (attempts === 1) throw new Error('chunk fetch failed');
			return fakeModule;
		});
		await expect(loader.load()).rejects.toThrow('chunk fetch failed');
		expect(loader.loaded()).toBeNull();
		expect(await loader.load()).toBe(fakeModule);
		expect(attempts).toBe(2);
	});
});
