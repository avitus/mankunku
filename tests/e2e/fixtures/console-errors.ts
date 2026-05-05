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
	// Browser-emitted message for any non-2xx fetch — this is automatic
	// console output from the browser itself, not application logic. Real
	// API failures are tested via response codes in dedicated specs (e.g.,
	// Supabase calls in auth specs verify 401/400 explicitly via page.route).
	// Without this allowlist, every anonymous Supabase upsert (which the app
	// fires-and-forgets) would fail every interactive spec.
	/Failed to load resource: the server responded with a status of \d{3}/,
	// WebKit-specific transient that fires when Sentry's beacon tries to
	// flush its envelope to /api/monitoring as the page is navigating away
	// (e.g. window.location.href change during account deletion). Chromium
	// and Firefox tolerate the in-flight request; WebKit raises a CORS-style
	// "access control checks" error that surfaces as a pageerror. Production
	// users see this as a no-op because the page already moved on.
	/Fetch API cannot load .* due to access control checks/
];

function isIgnored(text: string): boolean {
	return IGNORED_PATTERNS.some((pattern) => pattern.test(text));
}

export interface ConsoleCollector {
	errors: string[];
	warnings: string[];
	pageErrors: string[];
}

export const test = base.extend<{ consoleCollector: ConsoleCollector }>({
	consoleCollector: async ({ page }, use, testInfo) => {
		const errors: string[] = [];
		const warnings: string[] = [];
		const pageErrors: string[] = [];

		const onConsole = (msg: ConsoleMessage) => {
			const text = msg.text();
			if (isIgnored(text)) return;
			if (msg.type() === 'error') errors.push(text);
			if (msg.type() === 'warning') warnings.push(text);
		};
		const onPageError = (err: Error) => {
			const text = err.stack ?? err.message;
			if (isIgnored(text)) return;
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
