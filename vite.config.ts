import { sentrySvelteKit } from "@sentry/sveltekit";
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sentrySvelteKit({
        org: "veetle",
        project: "mankunku"
    }), tailwindcss(), sveltekit(), SvelteKitPWA({
        registerType: 'autoUpdate',
        manifest: {
            name: 'Mankunku',
            short_name: 'Mankunku',
            description: 'Jazz ear training — call and response',
            theme_color: '#0f172a',
            background_color: '#0f172a',
            display: 'standalone',
            icons: [
                { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
                { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' }
            ]
        },
        workbox: {
            navigateFallbackDenylist: [/^\/auth/],
            globPatterns: ['**/*.{js,css,html,svg,woff2}'],
            // Purge precache entries from previous builds so a stale SW can't
            // serve an index.html that references chunk hashes the server no
            // longer has. See Sentry MANKUNKU-8.
            cleanupOutdatedCaches: true,
            // Take over open tabs immediately on activate so the user lands
            // on the new build's chunks rather than the previous build's
            // cached references.
            skipWaiting: true,
            clientsClaim: true,
            runtimeCaching: [
                {
                    urlPattern: /\.sf2$/,
                    handler: 'CacheFirst',
                    options: {
                        cacheName: 'soundfonts',
                        expiration: { maxEntries: 5, maxAgeSeconds: 30 * 24 * 60 * 60 }
                    }
                },
                {
                    urlPattern: /^https:\/\/.*\.supabase\.co\/.*/,
                    handler: 'NetworkFirst',
                    options: {
                        cacheName: 'supabase-api',
                        expiration: {
                            maxEntries: 50,
                            maxAgeSeconds: 5 * 60
                        },
                        networkTimeoutSeconds: 10
                    }
                }
            ]
        }
    })],
	test: {
		include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
		environment: 'node',
		setupFiles: ['./vitest.setup.ts']
	}
});
