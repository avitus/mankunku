/**
 * Which app chunks a test's browser context loaded — the raw input of the
 * circleci-coverage fixture. Plain module, so Node tests can drive it.
 *
 * Read from the context's requests, not page.coverage: Playwright's
 * startJSCoverage always starts V8's precise block coverage, which deoptimises
 * the page's JavaScript. On 2026-10-21 that ran the PDF-import tests 2–2.5×
 * slower and timed them out on CI's 2-vCPU analysis box. The analysis only
 * needs what LOADED, and a fresh context fetches every chunk it loads at least
 * once, so the requests carry the same answer at no cost to the page — and
 * cover every page the context opens, not only the first.
 */

/** The app chunk a script URL names, as a path under the client output (null for anything else). */
export function appChunk(scriptUrl: string): string | null {
	if (!URL.canParse(scriptUrl)) return null;
	const { pathname } = new URL(scriptUrl);
	return pathname.startsWith('/_app/') && pathname.endsWith('.js') ? pathname : null;
}

/** The slice of a BrowserContext the recorder uses. */
export interface RequestSource {
	on(event: 'request', listener: (request: { url(): string }) => void): unknown;
	off(event: 'request', listener: (request: { url(): string }) => void): unknown;
}

/** Starts recording the app chunks `context` requests; `stop()` returns them in first-request order. */
export function recordAppChunks(context: RequestSource): { stop(): string[] } {
	const chunks = new Set<string>();
	/** Adds the request's app chunk, if it names one. */
	const listener = (request: { url(): string }): void => {
		const chunk = appChunk(request.url());
		if (chunk) chunks.add(chunk);
	};
	context.on('request', listener);
	return {
		/** Stops listening and returns the chunks seen so far. */
		stop(): string[] {
			context.off('request', listener);
			return [...chunks];
		}
	};
}
