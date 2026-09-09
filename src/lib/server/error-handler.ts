/**
 * Server-side `handleError` policy for hooks.server.ts.
 *
 * SvelteKit calls `handleError` for unexpected errors AND for requests that
 * match no route. Sentry's `handleErrorWithSentry` wrapper refuses to capture
 * 4xx (it checks `status`, and a route-less "Not found:" stack), but it still
 * hands every error to the app's handler — and when the app supplies none, its
 * fallback is `console.error(error.stack)`. So every scanner probe for
 * `/+CSCOE+/logon.html`, `/wp-login.php` and the rest printed a fifteen-line
 * stack trace to PM2's error log: 2.9 million lines, 320 MB, found on
 * 2026-09-09 while chasing a full disk on the production droplet.
 *
 * Policy: a 4xx is the client's mistake and is already in nginx's access log,
 * so it logs nothing here. Anything else logs ONE entry carrying the status,
 * the request line and the stack, which is what you want when reading
 * `pm2 logs mankunku` during an incident. The logger is injected so the
 * policy is unit-testable in plain Node.
 */
import type { HandleServerError } from '@sveltejs/kit';

export type ErrorLogger = (...args: unknown[]) => void;

export function createServerErrorHandler(log: ErrorLogger = console.error): HandleServerError {
	return ({ error, event, status }) => {
		if (status >= 400 && status < 500) return;

		const detail = error instanceof Error && error.stack ? error.stack : String(error);
		const requestLine = `${event.request.method} ${event.url.pathname}${event.url.search}`;
		log(`[server error] ${status} ${requestLine}\n${detail}`);
	};
}
