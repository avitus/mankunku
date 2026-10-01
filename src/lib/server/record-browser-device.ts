import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { describeBrowserDevice } from './browser-device';

const COOKIE = 'mankunku-browser';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Observe signed-in page loads; SQL owns identity, timestamps and the hourly write throttle. */
export async function recordBrowserDevice(
	event: Pick<RequestEvent, 'locals' | 'cookies' | 'request' | 'url'>
): Promise<void> {
	if (process.env.PLAYWRIGHT === '1' || event.request.method !== 'GET') return;
	try {
		const { user, degraded } = await event.locals.safeGetSession();
		if (!user || degraded) return;
		let deviceId = event.cookies.get(COOKIE);
		if (!deviceId || !UUID.test(deviceId)) {
			deviceId = randomUUID();
			event.cookies.set(COOKIE, deviceId, {
				path: '/', httpOnly: true, sameSite: 'lax',
				secure: event.url.protocol === 'https:', maxAge: 365 * 24 * 60 * 60
			});
		}
		const device = describeBrowserDevice(event.request.headers.get('user-agent'));
		await event.locals.supabase.rpc('record_user_device', {
			p_device_id: deviceId,
			p_browser_name: device.browserName,
			p_browser_version: device.browserVersion,
			p_os_name: device.osName,
			p_device_type: device.deviceType
		}).abortSignal(AbortSignal.timeout(1500));
	} catch {
		// Optional diagnostics must never turn an auth/network failure into a failed page.
	}
}
