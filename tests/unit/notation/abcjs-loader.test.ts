/**
 * The abcjs engine is a ~500 KB chunk that nothing in the app needs until a
 * staff is engraved. `createAbcjsLoader` owns ONE import of it: every caller
 * shares the same in-flight promise, a resolved module is handed back
 * synchronously so a component mounting after the fetch can engrave in its
 * first effect flush, and a failed fetch is retried on the next call rather
 * than poisoning every future staff.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAbcjsLoader, joinAbcjsLoad, type AbcjsModule } from '$lib/notation/abcjs-loader';

// The loader never touches the module; a stand-in with the right identity is
// all the tests need.
const fakeModule = { renderAbc: () => {} } as unknown as AbcjsModule;

/** An importer the test settles by hand, to order it against a cancel. */
function deferredImporter() {
	let resolve!: (m: AbcjsModule) => void;
	let reject!: (err: unknown) => void;
	const importer = vi.fn(
		() =>
			new Promise<AbcjsModule>((res, rej) => {
				resolve = res;
				reject = rej;
			})
	);
	return { importer, resolve: (m: AbcjsModule) => resolve(m), reject: (e: unknown) => reject(e) };
}

/** Let every settled promise's handlers run (and Node's unhandled-rejection check with them). */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

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

/**
 * NotationDisplay joins the import from an effect whose cleanup is the
 * cancel. A navigation that cuts the fetch off rejects the import, and WebKit
 * logged that as an unhandled rejection (the e2e console guard's catch); a
 * genuine failure left the chart blank with no word and no retry.
 */
describe('joinAbcjsLoad', () => {
	it('hands the module to a live consumer', async () => {
		const loaded = vi.fn();
		const failed = vi.fn();
		joinAbcjsLoad(createAbcjsLoader(async () => fakeModule), { loaded, failed });
		await flush();
		expect(loaded).toHaveBeenCalledWith(fakeModule);
		expect(failed).not.toHaveBeenCalled();
	});

	it('reports a failed import to a live consumer', async () => {
		const loaded = vi.fn();
		const failed = vi.fn();
		const err = new TypeError('Importing a module script failed.');
		joinAbcjsLoad(
			createAbcjsLoader(async () => {
				throw err;
			}),
			{ loaded, failed }
		);
		await flush();
		expect(failed).toHaveBeenCalledWith(err);
		expect(loaded).not.toHaveBeenCalled();
	});

	it('drops a rejection that lands after cancel, and leaves it handled', async () => {
		const { importer, reject } = deferredImporter();
		const loaded = vi.fn();
		const failed = vi.fn();
		const unhandled = vi.fn();
		process.on('unhandledRejection', unhandled);
		try {
			const cancel = joinAbcjsLoad(createAbcjsLoader(importer), { loaded, failed });
			cancel(); // the chart unmounts: navigation away
			reject(new TypeError('Importing a module script failed.'));
			await flush();
			expect(failed).not.toHaveBeenCalled();
			expect(loaded).not.toHaveBeenCalled();
			expect(unhandled).not.toHaveBeenCalled();
		} finally {
			process.off('unhandledRejection', unhandled);
		}
	});

	it('drops a module that lands after cancel', async () => {
		const { importer, resolve } = deferredImporter();
		const loaded = vi.fn();
		const cancel = joinAbcjsLoad(createAbcjsLoader(importer), { loaded, failed: vi.fn() });
		cancel();
		resolve(fakeModule);
		await flush();
		expect(loaded).not.toHaveBeenCalled();
	});

	it('a re-join while the import is in flight shares it; only the live consumer hears', async () => {
		// The effect re-runs on a new chart: the old run's cleanup cancels, the
		// new run joins the SAME pending import rather than starting another.
		const { importer, reject } = deferredImporter();
		const loader = createAbcjsLoader(importer);
		const stale = { loaded: vi.fn(), failed: vi.fn() };
		const current = { loaded: vi.fn(), failed: vi.fn() };
		joinAbcjsLoad(loader, stale)();
		joinAbcjsLoad(loader, current);
		reject(new Error('chunk fetch failed'));
		await flush();
		expect(importer).toHaveBeenCalledTimes(1);
		expect(stale.failed).not.toHaveBeenCalled();
		expect(current.failed).toHaveBeenCalledTimes(1);
	});

	it('the next join after a failure retries the import', async () => {
		let attempts = 0;
		const loader = createAbcjsLoader(async () => {
			attempts++;
			if (attempts === 1) throw new Error('offline');
			return fakeModule;
		});
		const first = { loaded: vi.fn(), failed: vi.fn() };
		joinAbcjsLoad(loader, first);
		await flush();
		expect(first.failed).toHaveBeenCalledTimes(1);

		const second = { loaded: vi.fn(), failed: vi.fn() };
		joinAbcjsLoad(loader, second);
		await flush();
		expect(second.loaded).toHaveBeenCalledWith(fakeModule);
		expect(attempts).toBe(2);
	});
});
