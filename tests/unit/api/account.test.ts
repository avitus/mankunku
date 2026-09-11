/**
 * DELETE /api/account — the one failure path the integration suite
 * (tests/integration/account-deletion.test.ts) cannot reach: it mocks
 * `createAdminClient` as a working factory, so the factory THROWING (no
 * SUPABASE_SERVICE_ROLE_KEY in the runtime env — the shared/runtime.env
 * class of incident) is never exercised there. The route must answer a
 * generic 500 and never reach the deletion helper, rather than crash the
 * request with the factory's own error text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const deleteUserAccount = vi.fn();

vi.mock('$lib/supabase/admin', () => ({
	createAdminClient: () => {
		throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
	}
}));

vi.mock('$lib/server/account-deletion', () => ({
	deleteUserAccount: (...args: unknown[]) => deleteUserAccount(...args)
}));

import { DELETE } from '../../../src/routes/api/account/+server';

function eventFor(user: { id: string } | null) {
	return {
		locals: {
			safeGetSession: async () => ({ session: user ? { access_token: 't' } : null, user })
		}
	} as unknown as Parameters<typeof DELETE>[0];
}

beforeEach(() => {
	vi.restoreAllMocks();
	deleteUserAccount.mockReset();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('DELETE /api/account — admin client unavailable', () => {
	it('answers a generic 500 and never starts the deletion', async () => {
		const res = await DELETE(eventFor({ id: 'user-1' }));
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe('Failed to delete account. Please try again.');
		// The factory's message names an env var — it must not leak to the client.
		expect(JSON.stringify(body)).not.toContain('SUPABASE');
		expect(deleteUserAccount).not.toHaveBeenCalled();
	});

	it('still refuses an unauthenticated caller before touching the admin client', async () => {
		const res = await DELETE(eventFor(null));
		expect(res.status).toBe(401);
		expect(console.error).not.toHaveBeenCalled();
	});
});
