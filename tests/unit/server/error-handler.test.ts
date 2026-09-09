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
		const error = new Error('Not found: /+CSCOE+/logon.html');

		const result = await handleError({
			error,
			event: makeEvent('GET', '/+CSCOE+/logon.html'),
			status: 404,
			message: 'Not Found'
		});

		expect(log).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it('logs nothing for any other 4xx either — a client mistake is not a server fault', async () => {
		const log = vi.fn();
		const handleError = createServerErrorHandler(log);

		await handleError({
			error: new Error('Bad Request'),
			event: makeEvent('POST', '/api/chat', '/api/chat'),
			status: 400,
			message: 'Bad Request'
		});

		expect(log).not.toHaveBeenCalled();
	});

	it('logs a 5xx once, with the request line and the stack', async () => {
		const log = vi.fn();
		const handleError = createServerErrorHandler(log);
		const error = new Error('boom');

		await handleError({
			error,
			event: makeEvent('GET', '/tunes/abc/practice', '/tunes/[id]/practice'),
			status: 500,
			message: 'Internal Error'
		});

		expect(log).toHaveBeenCalledTimes(1);
		const line = log.mock.calls[0].join(' ');
		expect(line).toContain('500');
		expect(line).toContain('GET /tunes/abc/practice');
		expect(line).toContain(error.stack);
	});

	it('logs a thrown non-Error value by its string form when there is no stack', async () => {
		const log = vi.fn();
		const handleError = createServerErrorHandler(log);

		await handleError({
			error: 'a string was thrown',
			event: makeEvent('GET', '/progress', '/progress'),
			status: 500,
			message: 'Internal Error'
		});

		expect(log).toHaveBeenCalledTimes(1);
		expect(log.mock.calls[0].join(' ')).toContain('a string was thrown');
	});
});
