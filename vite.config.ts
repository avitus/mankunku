import { existsSync } from 'node:fs';
import { sentrySvelteKit } from "@sentry/sveltekit";
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vitest/config';

// Release creation + source-map upload need a Sentry auth token (SENTRY_AUTH_TOKEN
// env var or the local .env.sentry-build-plugin file). Skip the upload step for
// throwaway e2e builds (PLAYWRIGHT=1, set by playwright.config.ts webServer) and
// for token-less environments (e.g. CI e2e), where sentry-vite-plugin would only
// emit "No auth token" warnings on every build. autoInstrument is unaffected, so
// the built app matches production either way.
const uploadSourceMaps =
    process.env.PLAYWRIGHT !== '1' &&
    (Boolean(process.env.SENTRY_AUTH_TOKEN) || existsSync('.env.sentry-build-plugin'));

export default defineConfig({
	plugins: [sentrySvelteKit({
        org: "veetle",
        project: "mankunku",
        autoUploadSourceMaps: uploadSourceMaps
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
