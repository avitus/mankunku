import type { LayoutServerLoad } from './$types';
import { recordBrowserDevice } from '$lib/server/record-browser-device';

/**
 * Server-side layout load function that runs on every page request.
 *
 * Retrieves the authenticated session and user from `event.locals.safeGetSession()`
 * (attached by `hooks.server.ts`) and passes them to the client-side layout load
 * function (`+layout.ts`). The `safeGetSession` helper internally calls `getUser()`
 * to validate the JWT — not just `getSession()` — ensuring the returned session is
 * cryptographically verified on every request.
 *
 * The returned `session` and `user` objects become available to:
 * - `+layout.ts` via its `data` parameter
 * - All descendant routes via `$page.data`
 */
export const load: LayoutServerLoad = async (event) => {
	const { locals, cookies, depends } = event;
	// Re-run this server load (not just the universal +layout.ts) when
	// `invalidate('supabase:auth')` fires from onAuthStateChange. Without
	// this, +layout.ts re-runs against CACHED server data, so a transient
	// `degraded: true` verdict (or a stale null session) would stick for the
	// lifetime of the tab even after the browser client refreshed fine.
	depends('supabase:auth');

	const { session, user, degraded } = await locals.safeGetSession();

	const observation = recordBrowserDevice(event);
	let isAdmin = false;
	if (user) {
		const { data } = await locals.supabase
			.from('user_profiles')
			.select('is_admin')
			.eq('id', user.id)
			.single();
		isAdmin = data?.is_admin ?? false;
	}

	await observation;
	return {
		session,
		user,
		// True when auth verification was unavailable (not a signed-out verdict) —
		// +layout.ts must skip user-scope reconciliation rather than wipe.
		degraded,
		isAdmin,
		cookies: cookies.getAll().filter(
			(c) => c.name.startsWith('sb-') || c.name.startsWith('supabase-')
		)
	};
};
