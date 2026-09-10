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
});
