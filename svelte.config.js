import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
				kit: {
				 // adapter-node enables server-side rendering required for authentication hooks and session management.
					adapter: adapter(),

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