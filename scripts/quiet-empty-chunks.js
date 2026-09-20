/**
 * Build-time helper for `svelte.config.js`: run an adapter with Rollup's
 * "Generated an empty chunk" warning dropped.
 *
 * adapter-node re-bundles Vite's server output with Rollup, and its
 * `manualChunks` forces every Vite server file to stay its own chunk (it
 * keeps the file structure to avoid a circular import chain, sveltejs/kit
 * #16092). Rollup then tree-shakes browser-only code out of the SERVER bundle
 * and warns once per chunk it left empty. Measured 2026-09-18, three lines on
 * every build:
 *
 *   chunks/wake-lock.js   — with `acquireScreenWakeLock` unused on the server,
 *                           `held` is a constant false and the release call
 *                           the pages' onDestroy keeps is a no-op
 *   chunks/audio-store.js — IndexedDB recordings; the server pages import it
 *                           for side effects it does not have
 *   chunks/env.js         — SvelteKit's own `__sveltekit/env` stub
 *
 * The warning is true and unactionable: nothing on the server should run that
 * code, the third module is not the app's, and the adapter takes no Rollup
 * options (it calls `rollup()` with no `onwarn`, so the message goes to
 * `console.warn`). So the filter lives here, scoped to the adapter step and to
 * this one message — every other warning still prints.
 */

/** Rollup's message for a chunk tree-shaking left with no code. */
const EMPTY_CHUNK_WARNING = /^Generated an empty chunk: /;

/**
 * Wrap an adapter so its `adapt` step runs with Rollup's empty-chunk warning
 * dropped. `console.warn` is restored when the step ends, thrown or not.
 *
 * @param {import('@sveltejs/kit').Adapter} adapter
 * @returns {import('@sveltejs/kit').Adapter}
 */
export function withoutEmptyChunkWarnings(adapter) {
	return {
		...adapter,
		async adapt(builder) {
			const warn = console.warn;
			console.warn = (...args) => {
				if (args.length === 1 && typeof args[0] === 'string' && EMPTY_CHUNK_WARNING.test(args[0])) {
					return;
				}
				warn.apply(console, args);
			};
			try {
				await adapter.adapt(builder);
			} finally {
				console.warn = warn;
			}
		}
	};
}
