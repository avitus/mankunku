import { test as base, type ConsoleMessage } from '@playwright/test';

/**
 * Patterns we choose to ignore in the console-error fixture.
 *
 * Add an entry only when the noise is unavoidable in the test environment
 * (e.g. dev tooling, third-party scripts whose warnings we cannot suppress)
 * AND benign in production. Every entry must have a comment explaining why.
 */
const IGNORED_PATTERNS: RegExp[] = [
	// Vite preview occasionally logs HMR-style messages even in preview mode.
	/\[vite\]/i,
	// Chrome DevTools Protocol noise that surfaces only via Playwright's
	// console hook, not in real browsers' devtools.
	/Failed to load resource: net::ERR_INTERNET_DISCONNECTED/,
	// Sentry surfaces a one-time info log when it boots in dev mode.
	// Production builds don't emit this — see fix in commit 1fe8365.
	/\[Sentry\] (?:Initializing|Setting transport)/i,
	// WebKit-specific transient that fires when Sentry's beacon tries to
	// flush its envelope to /api/monitoring as the page is navigating away
	// (e.g. window.location.href change during account deletion). Chromium
	// and Firefox tolerate the in-flight request; WebKit raises a CORS-style
	// "access control checks" error that surfaces as a pageerror. Production
	// users see this as a no-op because the page already moved on. Pinned to
	// the /api/monitoring path so unrelated CORS regressions still fail.
	/Fetch API cannot load .*\/api\/monitoring(?:[/?#].*)? due to access control checks/
];

/**
 * Pattern-based allowlist for the auto-emitted "Failed to load resource"
 * lines the browser writes to console.error on any non-2xx fetch. We only
 * suppress this when BOTH the status is in a known-benign range AND the
 * URL is one of the endpoints we expect to fail in unauthenticated tests
 * (notably anonymous Supabase REST calls that the app fires-and-forgets).
 *
 * Anything else — a 500 from /api/account, an unexpected 404 — surfaces
 * as a real failure rather than getting swept under a global regex.
 */
const RESOURCE_FAILURE = /Failed to load resource: the server responded with a status of (\d{3})/;
const BENIGN_STATUS = new Set(['400', '401', '403', '404']);
const BENIGN_URL_PATTERNS: RegExp[] = [
	// Supabase REST and auth endpoints — anonymous fire-and-forget paths.
	/\/rest\/v1\//,
	/\/auth\/v1\//
];

function isBenignResourceFailure(text: string, url: string): boolean {
	const match = text.match(RESOURCE_FAILURE);
	if (!match) return false;
	if (!BENIGN_STATUS.has(match[1])) return false;
	return BENIGN_URL_PATTERNS.some((p) => p.test(url));
}

function isIgnored(text: string, url: string): boolean {
	if (IGNORED_PATTERNS.some((pattern) => pattern.test(text))) return true;
	if (isBenignResourceFailure(text, url)) return true;
	return false;
}

export interface ConsoleCollector {
	errors: string[];
	warnings: string[];
	pageErrors: string[];
}

export const test = base.extend<{ consoleCollector: ConsoleCollector }>({
	consoleCollector: async ({ page }, use, testInfo): Promise<void> => {
		const errors: string[] = [];
		const warnings: string[] = [];
		const pageErrors: string[] = [];

		const onConsole = (msg: ConsoleMessage): void => {
			const text = msg.text();
			const url = msg.location()?.url ?? '';
			if (isIgnored(text, url)) return;
			// Keep the URL in the recorded text. The browser's auto-emitted
			// "Failed to load resource: ... 400" carries no URL in its message,
			// so without this a failure reports a status and nothing else —
			// which is not enough to act on, and cost a full debugging session.
			const detail = url ? `${text}  [${url}]` : text;
			if (msg.type() === 'error') errors.push(detail);
			if (msg.type() === 'warning') warnings.push(detail);
		};
		const onPageError = (err: Error): void => {
			const text = err.stack ?? err.message;
			// pageerror events don't expose the originating URL, so URL-gated
			// patterns can't apply — only the global IGNORED_PATTERNS list does.
			if (isIgnored(text, '')) return;
			pageErrors.push(text);
		};

		page.on('console', onConsole);
		page.on('pageerror', onPageError);

		const collector: ConsoleCollector = { errors, warnings, pageErrors };
		await use(collector);

		page.off('console', onConsole);
		page.off('pageerror', onPageError);

		// Attach the collected output to the test result so it's visible
		// in the HTML report regardless of whether the test passed.
		// Reviewing this output is the whole point of the smoke layer.
		if (errors.length || warnings.length || pageErrors.length) {
			await testInfo.attach('console-output', {
				body: JSON.stringify(collector, null, 2),
				contentType: 'application/json'
			});
		}

		// Fail the test if any uncaught error or unhandled rejection fired.
		// Warnings are surfaced via attachment but don't fail by default —
		// to fail on warnings, assert in the spec: expect(warnings).toEqual([]).
		if (errors.length || pageErrors.length) {
			const summary = [
				...errors.map((e) => `console.error: ${e}`),
				...pageErrors.map((e) => `pageerror: ${e}`)
			].join('\n');
			throw new Error(`Unexpected browser errors:\n${summary}`);
		}
	}
});

export { expect } from '@playwright/test';
