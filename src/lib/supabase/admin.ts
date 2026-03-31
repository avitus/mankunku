/**
 * Server-side Supabase admin client factory.
 *
 * Creates a Supabase client authenticated with the service_role key for
 * privileged operations that bypass RLS (e.g., account deletion).
 *
 * This module is SERVER-ONLY — the private env import ensures SvelteKit
 * will never bundle it into client-side code.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { env } from '$env/dynamic/private';

export function createAdminClient() {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL;
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl) {
		throw new Error('PUBLIC_SUPABASE_URL is not set');
	}
	if (!serviceRoleKey) {
		throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
	}

	return createClient<Database>(supabaseUrl, serviceRoleKey, {
		auth: {
			autoRefreshToken: false,
			persistSession: false
		}
	});
}