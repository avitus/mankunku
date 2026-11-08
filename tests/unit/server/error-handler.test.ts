/**
 * Unit tests for the server-side handleError policy.
 *
 * Before this handler existed, `hooks.server.ts` exported
 * `Sentry.handleErrorWithSentry()` with no handler of its own, so Sentry's
 * default ran: `console.error(error.stack)` for EVERY error SvelteKit reports —
 * including the route-less 404s that Sentry itself refuses to capture. Every
 * scanner probe for `/+CSCOE+/logon.html` and friends therefore wrote a
 * fifteen-line stack trace to PM2's error log, which reached 320 MB and
 * 2.9 million lines by 2026-09-09 (found while chasing a full disk on the
 * production droplet). nginx's access log already records those requests.
 *
 * The logger is injected so the policy runs in plain Node.
 */
import { describe, it, expect, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { createServerErrorHandler } from '../../../src/lib/server/error-handler';

/** The slice of a RequestEvent the handler reads: method, URL and route id. */
function makeEvent(method: string, path: string, routeId: string | null = null): RequestEvent {
	return {
		request: { method } as Request,
		url: new URL(`https://mankunkujazz.com${path}`),
		route: { id: routeId }
	} as unknown as RequestEvent;
}

describe('createServerErrorHandler', () => {
	it('logs nothing for a route-less 404 — scanner noise belongs to the access log', async () => {
		const log = vi.fn();
		const handleError = createServerErrorHandler(log);

		const result = await handleError({
			kind: 'framework',
			error: { status: 404, message: 'Not Found' },
			event: makeEvent('GET', '/+CSCOE+/logon.html')
		});

		expect(log).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it('logs nothing for any other 4xx either — a client mistake is not a server fault', async () => {
		const log = vi.fn();
		const handleError = createServerErrorHandler(log);

		await handleError({
			kind: 'app',
			error: {status: 400, message: 'Bad Request'},
			event: makeEvent('POST', '/api/chat', '/api/chat')
		});

		expect(log).not.toHaveBeenCalled();
	});

	it('ignores validation failures but logs structured application failures', async () => {
		const log = vi.fn();
		const handler = createServerErrorHandler(log);
		const event = makeEvent('POST', '/api/chat', '/api/chat');
		await handler({kind: 'validation', error: {status: 422, message: 'Invalid input'}, issues: [], event});
		expect(log).not.toHaveBeenCalled();
		await handler({kind: 'app', error: {status: 503, message: 'Service unavailable'}, event});
		expect(log).toHaveBeenCalledExactlyOnceWith('[server error] 503 POST /api/chat\nService unavailable');
	});

	it('logs a 5xx once, with the request line and the stack', async () => {
		const log = vi.fn();
		const handleError = createServerErrorHandler(log);
		const error = new Error('boom');

		await handleError({
			kind: 'unknown',
			error,
			event: makeEvent('GET', '/tunes/abc/practice', '/tunes/[id]/practice')
		});

		expect(log).toHaveBeenCalledTimes(1);
		const line = log.mock.calls[0].join(' ');
		expect(line).toContain('500');
		expect(line).toContain('GET /tunes/abc/practice');
		expect(line).toContain(error.stack);
	});

	it('logs the path but never the query string — a callback code or token in the URL must not reach the PM2 log', async () => {
		const log = vi.fn();
		const handleError = createServerErrorHandler(log);

		await handleError({
			kind: 'unknown',
			error: new Error('exchange failed'),
			event: makeEvent('GET', '/auth/callback?code=s3cret-authorization-code&next=%2Fprogress', '/auth/callback')
		});

		expect(log).toHaveBeenCalledTimes(1);
		const line = log.mock.calls[0].join(' ');
		expect(line).toContain('GET /auth/callback');
		expect(line).not.toContain('s3cret');
		expect(line).not.toContain('code=');
	});

	it('logs a thrown non-Error value by its string form when there is no stack', async () => {
		const log = vi.fn();
		const handleError = createServerErrorHandler(log);

		await handleError({
			kind: 'unknown',
			error: 'a string was thrown',
			event: makeEvent('GET', '/progress', '/progress')
		});

		expect(log).toHaveBeenCalledTimes(1);
		expect(log.mock.calls[0].join(' ')).toContain('a string was thrown');
	});
});
