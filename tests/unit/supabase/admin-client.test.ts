/**
 * Regression tests for createAdminClient's env sourcing.
 *
 * 2026-08-18 production incident: /admin (and /api/account before it,
 * silently) reported "service-role connection could not be reached" because
 * admin.ts read PUBLIC_SUPABASE_URL from the RUNTIME env — but production's
 * runtime.env provisions only the secrets, and the URL is a build-time
 * variable everywhere else (client.ts and server.ts import it from
 * $env/static/public). The factory must need exactly one runtime value: the
 * service-role key.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'https://build-time.supabase.co',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

const dynamicEnv = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>
}));
vi.mock('$env/dynamic/private', () => dynamicEnv);

import { createAdminClient } from '../../../src/lib/supabase/admin';

beforeEach(() => {
	dynamicEnv.env = {};
});

describe('createAdminClient', () => {
	it('needs only the service-role key at runtime — the URL is build-time', () => {
		// The production runtime.env shape: secrets only, no PUBLIC_ vars.
		dynamicEnv.env = { SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key' };

		expect(() => createAdminClient()).not.toThrow();
	});

	it('throws when the service-role key is missing', () => {
		expect(() => createAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
	});
});
