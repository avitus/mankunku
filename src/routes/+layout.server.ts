import type { LayoutServerLoad } from './$types';

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
export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	const { session, user } = await locals.safeGetSession();

	let isAdmin = false;
	if (user) {
		const { data } = await locals.supabase
			.from('user_profiles')
			.select('is_admin')
			.eq('id', user.id)
			.single();
		isAdmin = data?.is_admin ?? false;
	}

	return {
		session,
		user,
		isAdmin,
		cookies: cookies.getAll().filter(
			(c) => c.name.startsWith('sb-') || c.name.startsWith('supabase-')
		)
	};
};
