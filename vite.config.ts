import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
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
		})
	],
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'node'
	}
});
