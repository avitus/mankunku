/**
 * One import of the abcjs engine for the whole app.
 *
 * abcjs is the second-largest chunk in the bundle (~500 KB raw, ~125 KB
 * brotli) and nothing needs it until a staff is engraved, so it stays a
 * dynamic import. But a lazy import is only cheap if it starts early: the
 * first NotationDisplay of a lick-practice session used to issue the fetch
 * from its own onMount — the moment the key stack was built, which is the
 * moment the count-in starts — so on a cold cache the Daily path paid the
 * download during the bars before the first sheet had to be read. Routes
 * that will engrave call `load()` as early as they can (session mount) and
 * the component picks the module up from here.
 *
 * `loaded()` hands back a resolved module synchronously, so a component
 * that mounts after the fetch engraves in its first effect flush instead of
 * one microtask later. A failed import is not cached: the next `load()`
 * retries, as the per-instance import did on every mount.
 */

export type AbcjsModule = typeof import('abcjs');

export interface AbcjsLoader {
	/** Start (or join) the import; resolves to the module. */
	load(): Promise<AbcjsModule>;
	/** The module if an import has resolved, else null. Never fetches. */
	loaded(): AbcjsModule | null;
}

/** Build a loader over an importer — the default below, or a fake in tests. */
export function createAbcjsLoader(importer: () => Promise<AbcjsModule>): AbcjsLoader {
	let module: AbcjsModule | null = null;
	let pending: Promise<AbcjsModule> | null = null;
	return {
		load() {
			if (module) return Promise.resolve(module);
			if (!pending) {
				pending = importer().then(
					(m) => {
						module = m;
						return m;
					},
					(err) => {
						pending = null;
						throw err;
					}
				);
			}
			return pending;
		},
		loaded() {
			return module;
		}
	};
}

/** The app's shared loader. Browser-only: never call `load()` during SSR. */
export const abcjsLoader: AbcjsLoader = createAbcjsLoader(() => import('abcjs'));
