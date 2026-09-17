/**
 * `src/instrumentation.server.ts` is loaded by SvelteKit's dev middleware through
 * `vite.ssrLoadModule` on every request, so whenever Vite invalidates the SSR
 * module graph the file is evaluated AGAIN in the same long-lived Node process.
 * Sentry's `init` is not idempotent: every call stacks another set of default
 * integrations on the global carrier — another `child_process` diagnostics-channel
 * subscriber, another `uncaughtException` / `unhandledRejection` / `beforeExit`
 * handler, another `sw_vers` spawn on macOS — until Node's
 * MaxListenersExceededWarning fires ("11 error listeners added to [ChildProcess]",
 * seen on a 13-hour-old `vite dev`, 2026-09-10). The init must run once per process.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sentry = vi.hoisted(() => {
	const state = { initialized: false };
	return {
		state,
		init: vi.fn(() => {
			state.initialized = true;
		}),
		isInitialized: vi.fn(() => state.initialized)
	};
});

vi.mock('@sentry/sveltekit', () => ({
	init: sentry.init,
	isInitialized: sentry.isInitialized
}));

beforeEach(() => {
	vi.resetModules();
	sentry.state.initialized = false;
	sentry.init.mockClear();
	sentry.isInitialized.mockClear();
});

interface SentOptions {
	environment: string;
	beforeSend(event: Record<string, unknown>, hint: unknown): Record<string, unknown> | null;
	beforeSendTransaction(event: Record<string, unknown>): Record<string, unknown> | null;
}

async function initOptions(): Promise<SentOptions> {
	await import('../../../src/instrumentation.server');
	return (sentry.init.mock.calls as unknown as [SentOptions][])[0][0];
}

describe('instrumentation.server', () => {
	it('initialises Sentry on the first evaluation', async () => {
		await import('../../../src/instrumentation.server');
		expect(sentry.init).toHaveBeenCalledTimes(1);
	});

	it('does not initialise again when the module is re-evaluated in a process that already has a client', async () => {
		await import('../../../src/instrumentation.server');
		// What Vite's SSR runner does when the dev server invalidates the module graph:
		// the module is dropped from the registry and evaluated afresh on the next request.
		vi.resetModules();
		await import('../../../src/instrumentation.server');
		expect(sentry.init).toHaveBeenCalledTimes(1);
	});

	// MANKUNKU-1V: `vite preview` (and Playwright's web server, which runs it) is
	// NODE_ENV=production, so a PDF import on this Mac filed its errors, and its
	// traces, under the production environment. The browser side already reads
	// its hostname for the same reason.
	it('files an error from a request to a local server under development', async () => {
		const { beforeSend } = await initOptions();
		const event = {
			environment: 'production',
			request: { url: 'http://localhost:4174/api/tune-parse' },
			exception: { values: [{ type: 'Error', value: 'boom' }] }
		};
		expect(beforeSend(event, {})).toMatchObject({ environment: 'development' });
	});

	it('leaves an error from the public site in its environment', async () => {
		const { beforeSend } = await initOptions();
		const event = {
			environment: 'production',
			request: { url: 'https://mankunkujazz.com/api/tune-parse' },
			exception: { values: [{ type: 'Error', value: 'boom' }] }
		};
		expect(beforeSend(event, {})).toMatchObject({ environment: 'production' });
	});

	it('files a trace from a request to a local server under development', async () => {
		const { beforeSendTransaction } = await initOptions();
		const event = { environment: 'production', request: { url: 'http://127.0.0.1:4173/' } };
		expect(beforeSendTransaction(event)).toMatchObject({ environment: 'development' });
	});

	// Fable's output filter blocks some well-known tunes; /api/tune-parse falls
	// back to the baseline model and /api/chat reports it to the reader, but the
	// Anthropic integration captures the stream error as unhandled first.
	it('drops the content-filter block both Anthropic routes already handle', async () => {
		const { beforeSend } = await initOptions();
		const event = {
			exception: {
				values: [
					{
						type: 'Error',
						value:
							'{"type":"error","error":{"details":null,"type":"invalid_request_error","message":"Output blocked by content filtering policy"}}',
						mechanism: { type: 'auto.ai.anthropic.stream_error', handled: false }
					}
				]
			}
		};
		expect(beforeSend(event, {})).toBeNull();
	});
});
