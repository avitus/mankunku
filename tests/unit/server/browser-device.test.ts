import { describe, expect, it } from 'vitest';
import { describeBrowserDevice } from '$lib/server/browser-device';

describe('browser/device diagnostics', () => {
	it.each([
		['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36 Edg/143.0.1', 'Edge', '143.0.1', 'Windows', 'desktop'],
		['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 'Safari', '18.0', 'iOS', 'phone'],
		['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari', '18.0', 'iOS', 'tablet'],
		['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/143.0.0.0 Mobile/15E148 Safari/604.1', 'Chrome', '143.0.0.0', 'iOS', 'phone'],
		['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) FxiOS/143.0 Mobile/15E148 Safari/605.1.15', 'Firefox', '143.0', 'iOS', 'phone'],
		['Mozilla/5.0 (Linux; Android 16; K) Chrome/143.0.0.0 Mobile Safari/537.36', 'Chrome', '143.0.0.0', 'Android', 'phone'],
		['Mozilla/5.0 (Linux; Android 16; K) Chrome/143.0.0.0 Safari/537.36', 'Chrome', '143.0.0.0', 'Android', 'tablet'],
		['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15', 'Safari', '18.0', 'macOS', 'desktop'],
		['Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0', 'Firefox', '143.0', 'Linux', 'desktop'],
		['Mozilla/5.0 (X11; CrOS x86_64 123) Chrome/143.0.0.0 Safari/537.36', 'Chrome', '143.0.0.0', 'ChromeOS', 'desktop']
	])('classifies %s', (ua, browserName, browserVersion, osName, deviceType) => {
		expect(describeBrowserDevice(ua)).toEqual({ browserName, browserVersion, osName, deviceType });
	});
	it('keeps unknown and missing data explicitly unknown', () => {
		for (const ua of [null, '', 'SomeNewBrowser']) {
			expect(describeBrowserDevice(ua)).toEqual({ browserName: 'Unknown', browserVersion: null, osName: 'Unknown', deviceType: 'unknown' });
		}
	});
	it('bounds untrusted input and version lengths', () => {
		expect(describeBrowserDevice('x'.repeat(1024) + ' Chrome/123').browserName).toBe('Unknown');
		expect(describeBrowserDevice('Chrome/' + '1'.repeat(100)).browserVersion).toHaveLength(32);
	});
});
