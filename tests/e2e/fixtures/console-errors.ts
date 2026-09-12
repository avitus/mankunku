import { test as base, type ConsoleMessage, type Page, type Response } from '@playwright/test';

/**
 * Patterns we choose to ignore in the console-error fixture.
 *
 * Add an entry only when the noise is unavoidable in the test environment
 * (e.g. dev tooling, third-party scripts whose warnings we cannot suppress)
 * AND benign in production. Every entry must have a comment explaining why.
 */
type IgnoreRule = RegExp | ((text: string, url: string) => boolean);

const IGNORED_PATTERNS: IgnoreRule[] = [
	// WebKit-specific transient that fires when Sentry's beacon tries to
	// flush its envelope to /api/monitoring as the page is navigating away
	// (e.g. window.location.href change during account deletion). Chromium
	// and Firefox tolerate the in-flight request; WebKit raises a CORS-style
	// "access control checks" error that surfaces as a pageerror. Production
	// users see this as a no-op because the page already moved on. Pinned to
	// the /api/monitoring path so unrelated CORS regressions still fail.
	/Fetch API cannot load .*\/api\/monitoring(?:[/?#].*)? due to access control checks/,
	// The Chromium face of the same beacon race, seen as a console.error
	// rather than a pageerror: `net::ERR_CONNECTION_RESET` on the tunnel POST.
	// It reproduces only in backing-render-audio.spec, which blocks the main
	// thread for seconds at a time decoding whole WAVs sample-by-sample, and
	// it is not new here — the spec fails the same way on dev's tip before
	// this rule. The endpoint itself is healthy throughout —
	// it answers a direct POST in ~1 ms and the server logs nothing — so what
	// is lost is one telemetry envelope, which is exactly what a user closing
	// a busy tab loses too. Pinned to BOTH the reset and the /api/monitoring
	// path: any other connection reset, and any other failure on this path,
	// still fails the test.
	(text, url) =>
		/net::ERR_CONNECTION_RESET/.test(text) && /\/api\/monitoring(?:[/?#]|$)/.test(url),
	// Firefox-only Playwright artifact: when a pointer action's hit-target
	// check races DOM that mounts/unmounts under the cursor (click-expanded
	// panels; hover-revealed popovers before them), the harness's own injected
	// script — Firefox names it "debugger eval code" — logs this Gecko error.
	// It fires 1:1 with the racing actions, never as a pageerror, never from
	// an app bundle, and Chromium / WebKit runs of the same interactions are
	// clean. Pinned to the injected-script source on BOTH ends: the text must
	// name it, and the message's own source URL must be absent or the eval
	// source — a real app NS_ERROR (which carries an app file URL) still fails.
	(text, url) =>
		/NS_ERROR_NOT_INITIALIZED.*debugger eval code/.test(text) &&
		(url === '' || /debugger eval code/.test(url))
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
	const matches = (rule: IgnoreRule): boolean =>
		rule instanceof RegExp ? rule.test(text) : rule(text, url);
	if (IGNORED_PATTERNS.some(matches)) return true;
	if (isBenignResourceFailure(text, url)) return true;
	return false;
}

/** The browser's own line for a navigated document that answered 404 (Chromium, WebKit; Firefox logs none). */
const DOCUMENT_404 = /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/;

export interface ConsoleCollector {
	errors: string[];
	warnings: string[];
	pageErrors: string[];
}

interface ConsoleGuardFixtures {
	consoleCollector: ConsoleCollector;
}

interface ConsoleGuardOptions {
	/**
	 * Opt-in for specs whose subject IS a 404 page (`test.use({ allowDocument404: true })`).
	 * Admits exactly one kind of line: the browser's "Failed to load resource:
	 * ... 404 (Not Found)" console.error whose source URL is a MAIN-FRAME
	 * NAVIGATION that actually answered 404 — the document under test, one line
	 * per such navigation. A fetch, an asset or an API call that 404s still
	 * fails (even at the same URL), as does every other console.error and
	 * every pageerror. No pageerror is admitted on any engine.
	 */
	allowDocument404: boolean;
}

export const test = base.extend<ConsoleGuardFixtures & ConsoleGuardOptions>({
	allowDocument404: [false, { option: true }],
	// goto() additionally waits for the app to hydrate before returning.
	// Until PR #229 the SSR'd onboarding overlay covered every page and
	// incidentally blocked clicks until hydration tore it down; with the
	// overlay gone from SSR, a click fired straight after navigation can land
	// before Svelte attaches handlers and silently do nothing (that race cost
	// account.spec its delete-account toggle on CI). The root layout stamps
	// data-hydrated="true" from its onMount; waiting for it here fixes the
	// class for every spec instead of sprinkling per-test waits. The wait is
	// deliberately NOT caught: every spec navigates to app routes (including
	// error pages, which render inside the root layout), so a missing marker
	// means hydration itself broke — fail loudly here, not confusingly later.
	page: async ({ page }, use: (page: Page) => Promise<void>): Promise<void> => {
		const originalGoto = page.goto.bind(page);
		page.goto = (async (
			url: string,
			options?: Parameters<Page['goto']>[1]
		): Promise<Response | null> => {
			const response = await originalGoto(url, options);
			await page
				.locator('[data-hydrated="true"]')
				.first()
				.waitFor({ state: 'attached', timeout: 15000 });
			return response;
		}) as typeof page.goto;
		await use(page);
	},
	// AUTO: every test gets the guard whether or not it names the fixture — a
	// spec that forgot to destructure `consoleCollector` used to run unguarded.
	// Naming it is still how a test reads the collected output mid-test.
	consoleCollector: [
		async ({ page, allowDocument404 }, use, testInfo): Promise<void> => {
			const errors: string[] = [];
			const warnings: string[] = [];
			const pageErrors: string[] = [];

			// allowDocument404 bookkeeping: how many main-frame navigations
			// answered 404, per URL, and every candidate 404 line. Settled at
			// teardown — the response and console events travel separately, so
			// their order isn't guaranteed — one admitted line per such navigation.
			const document404Navigations = new Map<string, number>();
			const candidateDocument404: Array<{ url: string; detail: string }> = [];
			const onResponse = (response: Response): void => {
				const request = response.request();
				if (
					response.status() === 404 &&
					request.isNavigationRequest() &&
					request.frame() === page.mainFrame()
				) {
					const url = response.url();
					document404Navigations.set(url, (document404Navigations.get(url) ?? 0) + 1);
				}
			};

			const onConsole = (msg: ConsoleMessage): void => {
				const text = msg.text();
				const url = msg.location()?.url ?? '';
				if (isIgnored(text, url)) return;
				// Keep the URL in the recorded text. The browser's auto-emitted
				// "Failed to load resource: ... 400" carries no URL in its message,
				// so without this a failure reports a status and nothing else —
				// which is not enough to act on, and cost a full debugging session.
				const detail = url ? `${text}  [${url}]` : text;
				if (msg.type() === 'error') {
					if (allowDocument404 && DOCUMENT_404.test(text) && url !== '') {
						candidateDocument404.push({ url, detail });
						return;
					}
					errors.push(detail);
				}
				if (msg.type() === 'warning') warnings.push(detail);
			};
			const onPageError = (err: Error): void => {
				const text = err.stack ?? err.message;
				// pageerror events don't expose the originating URL, so URL-gated
				// patterns can't apply — only the global IGNORED_PATTERNS list does.
				if (isIgnored(text, '')) return;
				pageErrors.push(text);
			};

			if (allowDocument404) page.on('response', onResponse);
			page.on('console', onConsole);
			page.on('pageerror', onPageError);

			const collector: ConsoleCollector = { errors, warnings, pageErrors };
			await use(collector);

			if (allowDocument404) page.off('response', onResponse);
			page.off('console', onConsole);
			page.off('pageerror', onPageError);

			// A 404 line beyond the count of main-frame navigations that answered
			// 404 at its URL was a fetch or an asset, not the document under test.
			for (const { url, detail } of candidateDocument404) {
				const remaining = document404Navigations.get(url) ?? 0;
				if (remaining > 0) document404Navigations.set(url, remaining - 1);
				else errors.push(detail);
			}

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
		},
		{ auto: true }
	]
});

export { expect } from '@playwright/test';
