/**
 * Server-side authorization gate for /admin.
 *
 * Every refusal is a 404 so the route never confirms its own existence to
 * probers (it is also absent from the sitemap and disallowed in robots.txt).
 * The one exception is a degraded auth backend: `degraded: true` means auth
 * verification was UNAVAILABLE, not that the caller is signed out, so the
 * honest answer is 503 — only the owner will ever see it.
 *
 * The is_admin lookup is the same own-row query +layout.server.ts runs
 * (RLS-safe under "Users can view own profile"); it must be repeated here
 * because form actions cannot read layout data and locals carries no isAdmin.
 */

import { error } from '@sveltejs/kit';
import type { User } from '@supabase/supabase-js';

export async function requireAdmin(locals: App.Locals): Promise<User> {
	const { user, degraded } = await locals.safeGetSession();

	if (degraded) {
		throw error(503, 'Temporarily unavailable');
	}
	if (!user) {
		throw error(404, 'Not Found');
	}

	const { data, error: profileError } = await locals.supabase
		.from('user_profiles')
		.select('is_admin')
		.eq('id', user.id)
		.single();

	// Fail closed: a query error is treated the same as not-admin.
	if (profileError || !data?.is_admin) {
		throw error(404, 'Not Found');
	}

	return user;
}
