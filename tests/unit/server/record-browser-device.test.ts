import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordBrowserDevice } from '$lib/server/record-browser-device';

const DEVICE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** Build a signed-in request with a configurable browser cookie and a stubbed observation RPC. */
function event(id: string | undefined = DEVICE) {
	const abortSignal = vi.fn().mockResolvedValue({ error: null });
	return {
		request: new Request('https://example.com/', { headers: { 'user-agent': 'Chrome/143.0 (Windows NT 10.0)' } }),
		url: new URL('https://example.com/'),
		cookies: { get: vi.fn().mockReturnValue(id), set: vi.fn() },
		locals: {
			safeGetSession: vi.fn().mockResolvedValue({ user: { id: 'u1' }, degraded: false }),
			supabase: { rpc: vi.fn().mockReturnValue({ abortSignal }) }
		}
	};
}
/** Adapt the minimal request fixture to the server observation boundary. */
const record = (e: ReturnType<typeof event>) => recordBrowserDevice(e as never);
beforeEach(() => vi.unstubAllEnvs());

describe('recordBrowserDevice', () => {
	it('uses a validated cookie and lets the database derive user identity and timestamps', async () => {
		const e = event();
		await record(e);
		expect(e.cookies.set).not.toHaveBeenCalled();
		expect(e.locals.supabase.rpc).toHaveBeenCalledWith('record_user_device', {
			p_device_id: DEVICE, p_browser_name: 'Chrome', p_browser_version: '143.0',
			p_os_name: 'Windows', p_device_type: 'desktop'
		});
		expect(e.locals.supabase.rpc.mock.results[0].value.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
	});
	it.each(['', 'invalid', '../someone-else'])('replaces an absent/invalid cookie: %s', async (id) => {
		const e = event(id);
		await record(e);
		expect(e.cookies.set).toHaveBeenCalledWith('mankunku-browser', expect.stringMatching(/^[\da-f-]{36}$/), {
			path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 31536000
		});
	});
	it.each([{ user: null, degraded: false }, { user: { id: 'u1' }, degraded: true }])('does not record an unverified visitor: %j', async (verdict) => {
		const e = event('');
		e.locals.safeGetSession.mockResolvedValue(verdict);
		await record(e);
		expect(e.cookies.set).not.toHaveBeenCalled();
		expect(e.locals.supabase.rpc).not.toHaveBeenCalled();
	});
	it('does not write in Playwright or on POST requests', async () => {
		const e = event();
		vi.stubEnv('PLAYWRIGHT', '1');
		await record(e);
		vi.unstubAllEnvs();
		e.request = new Request(e.url, { method: 'POST' });
		await record(e);
		expect(e.locals.safeGetSession).not.toHaveBeenCalled();
	});
	it('ignores thrown network failures and returned database failures', async () => {
		const e = event();
		e.locals.supabase.rpc.mockImplementationOnce(() => { throw new Error('offline'); });
		await expect(record(e)).resolves.toBeUndefined();
		e.locals.supabase.rpc.mockReturnValueOnce({ abortSignal: vi.fn().mockResolvedValue({ error: { message: 'unavailable' } }) });
		await expect(record(e)).resolves.toBeUndefined();
	});
});
