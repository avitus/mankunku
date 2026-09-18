import adapter from '@sveltejs/adapter-node';
import { withoutEmptyChunkWarnings } from './scripts/quiet-empty-chunks.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
				kit: {
				 // adapter-node enables server-side rendering required for authentication hooks and session management.
				 // Its Rollup pass warns "Generated an empty chunk" for every browser-only
				 // module tree-shaken out of the server bundle (wake lock, IndexedDB
				 // recordings, SvelteKit's own env stub) — true, unactionable, and the
				 // adapter takes no Rollup options, so the step runs with that ONE
				 // message dropped. See scripts/quiet-empty-chunks.js.
					adapter: withoutEmptyChunkWarnings(adapter()),

				 // Poll for new deployments so a long-lived tab notices its cached chunk
				 // hashes are stale. When a newer build is live, `updated.current` flips
				 // true and the beforeNavigate guard in +layout.svelte does a full-page
				 // load before the next lazy import() can 404. Pin the version name to the
				 // commit SHA in CI (matches the Sentry release); SvelteKit's timestamp
				 // default covers local builds. See Sentry MANKUNKU-8.
				 version: {
					 ...(process.env.CIRCLE_SHA1 ? { name: process.env.CIRCLE_SHA1 } : {}),
					 pollInterval: 60000
					},

				 experimental: {
					 tracing: {
						 server: true
						},

					 instrumentation: {
						 server: true
						}
					}
				},
				vitePlugin: {
								dynamicCompileOptions: ({ filename }) =>
												filename.includes('node_modules') ? undefined : { runes: true }
				}
};

export default config;