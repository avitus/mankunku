/** Best-effort diagnostics, not hardware identification or an authorization signal. */
export function describeBrowserDevice(userAgent: string | null) {
	const ua = (userAgent ?? '').slice(0, 1024);
	const browsers: [string, RegExp][] = [
		['Edge', /(?:EdgA|EdgiOS|Edg)\/([\d.]+)/],
		['Opera', /(?:OPR|OPiOS)\/([\d.]+)/],
		['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
		['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
		['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
		['Safari', /Version\/([\d.]+).*Safari\//]
	];
	const browser = browsers.find(([, pattern]) => pattern.test(ua));
	const browserName = browser?.[0] ?? 'Unknown';
	const browserVersion = browser?.[1].exec(ua)?.[1].slice(0, 32) ?? null;
	const osName = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
		: /Android/.test(ua) ? 'Android'
		: /CrOS/.test(ua) ? 'ChromeOS'
		: /Windows/.test(ua) ? 'Windows'
		: /Macintosh|Mac OS X/.test(ua) ? 'macOS'
		: /Linux/.test(ua) ? 'Linux' : 'Unknown';
	const deviceType = /iPad|Tablet/.test(ua) || (osName === 'Android' && !/Mobile/.test(ua))
		? 'tablet' : /iPhone|iPod|Mobile/.test(ua) ? 'phone'
		: ['Windows', 'macOS', 'Linux', 'ChromeOS'].includes(osName) ? 'desktop' : 'unknown';
	return { browserName, browserVersion, osName, deviceType };
}
