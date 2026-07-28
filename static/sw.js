/**
 * Kill-switch service worker.
 *
 * The app no longer uses a service worker (the @vite-pwa/sveltekit setup was
 * removed 2026-07-25 — its worker was never registered by SSR pages and its
 * generated sw.js threw mid-evaluation; see vite.config.ts). But devices that
 * registered a worker under OLDER builds still have one, and a registered
 * worker keeps update-checking this URL. This replacement takes over on that
 * next update check, deletes every cache the old workers left behind (the
 * months-stale precaches behind the 2026-07-13 "two-week-old content"
 * incident class), unregisters itself, and reloads its tabs so they reattach
 * to the network with no controller.
 *
 * Keep this file deployed indefinitely: serving a 404 here would also
 * eventually unregister old workers, but only after browsers' slow retry
 * schedule, and it would leave their stale caches in place.
 */
self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.map((key) => caches.delete(key)));
			await self.registration.unregister();
			const clients = await self.clients.matchAll({ type: 'window' });
			await Promise.all(clients.map((client) => client.navigate(client.url)));
		})()
	);
});
