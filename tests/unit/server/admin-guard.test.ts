/**
 * Unit tests for requireAdmin — the server-side gate for /admin.
 *
 * Refusals are 404 (the route must not confirm it exists to probers), with
 * one exception: a degraded auth backend is 503, because "auth unavailable"
 * is not a verdict about the caller.
 */

import { describe, it, expect, vi } from 'vitest';
import { requireAdmin } from '../../../src/lib/server/admin-guard';

function makeLocals(options: {
	user?: { id: string; email?: string } | null;
	degraded?: boolean;
	isAdmin?: boolean;
	profileError?: { message: string } | null;
}) {
	const user = options.user ?? null;
	const single = vi.fn().mockResolvedValue(
		options.profileError
			? { data: null, error: options.profileError }
			: { data: { is_admin: options.isAdmin ?? false }, error: null }
	);
	const eq = vi.fn().mockReturnValue({ single });
	const select = vi.fn().mockReturnValue({ eq });
	const from = vi.fn().mockReturnValue({ select });
	return {
		locals: {
			supabase: { from },
			safeGetSession: vi.fn().mockResolvedValue({
				session: user ? { access_token: 'token' } : null,
				user,
				degraded: options.degraded ?? false
			})
		} as never,
		from,
		eq
	};
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
	try {
		await promise;
	} catch (err) {
		return (err as { status: number }).status;
	}
	throw new Error('expected requireAdmin to throw');
}

describe('requireAdmin', () => {
	it('throws 404 when signed out', async () => {
		const { locals } = makeLocals({ user: null });
		expect(await statusOf(requireAdmin(locals))).toBe(404);
	});

	it('throws 503 when auth verification is degraded (outage is not a verdict)', async () => {
		const { locals } = makeLocals({
			user: { id: 'user-1' },
			degraded: true,
			isAdmin: true
		});
		expect(await statusOf(requireAdmin(locals))).toBe(503);
	});

	it('throws 404 for a signed-in non-admin', async () => {
		const { locals } = makeLocals({ user: { id: 'user-1' }, isAdmin: false });
		expect(await statusOf(requireAdmin(locals))).toBe(404);
	});

	it('throws 404 when the profile query errors (fail closed)', async () => {
		const { locals } = makeLocals({
			user: { id: 'user-1' },
			profileError: { message: 'connection refused' }
		});
		expect(await statusOf(requireAdmin(locals))).toBe(404);
	});

	it('resolves with the verified user for an admin', async () => {
		const { locals, from, eq } = makeLocals({
			user: { id: 'admin-1', email: 'owner@example.com' },
			isAdmin: true
		});

		const user = await requireAdmin(locals);

		expect(user.id).toBe('admin-1');
		// own-row query, keyed by the JWT-verified user id
		expect(from).toHaveBeenCalledWith('user_profiles');
		expect(eq).toHaveBeenCalledWith('id', 'admin-1');
	});
});
