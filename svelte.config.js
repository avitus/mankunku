import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
				kit: {
				 // adapter-node enables server-side rendering required for authentication hooks and session management.
					adapter: adapter(),

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