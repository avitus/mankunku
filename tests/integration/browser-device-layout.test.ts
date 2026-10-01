import { describe, expect, it, vi } from 'vitest';
import { load } from '../../src/routes/+layout.server';

/** Build a layout request with controlled authentication and a private browser cookie. */
function event(signedIn: boolean) {
	const user = signedIn ? { id: 'u1' } : null;
	const query: Record<string, unknown> = {};
	for (const name of ['select', 'eq']) query[name] = vi.fn(() => query);
	query.single = vi.fn().mockResolvedValue({ data: { is_admin: false } });
	return {
		request: new Request('https://example.com/'),
		url: new URL('https://example.com/'),
		depends: vi.fn(),
		cookies: {
			get: vi.fn().mockReturnValue('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
			set: vi.fn(),
			getAll: () => [
				{ name: 'sb-project-auth-token', value: 'session' },
				{ name: 'mankunku-browser', value: 'private-browser-id' }
			]
		},
		locals: {
			safeGetSession: vi.fn().mockResolvedValue({ user, session: user ? { user } : null, degraded: false }),
			supabase: {
				from: vi.fn(() => query),
				rpc: vi.fn(() => ({ abortSignal: vi.fn().mockResolvedValue({ error: null }) }))
			}
		}
	};
}

describe('root layout device observation', () => {
	it('records a verified page visit without exposing the browser cookie to client data', async () => {
		const e = event(true);
		const result = await load(e as never);
		expect(e.locals.supabase.rpc).toHaveBeenCalledOnce();
		expect(result).toMatchObject({ user: { id: 'u1' }, cookies: [{ name: 'sb-project-auth-token', value: 'session' }] });
	});
	it('does not record anonymous visitors', async () => {
		const e = event(false);
		await load(e as never);
		expect(e.locals.supabase.rpc).not.toHaveBeenCalled();
	});
	it('preserves the page session when device tracking fails', async () => {
		const e = event(true);
		e.locals.supabase.rpc.mockImplementation(() => { throw new Error('offline'); });
		expect(await load(e as never)).toMatchObject({ user: { id: 'u1' }, degraded: false });
	});
});
