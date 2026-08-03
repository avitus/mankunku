import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServerClient } from '@supabase/ssr';
import { nodeRealtimeFallback } from '$lib/supabase/node-websocket-fallback';

/**
 * Regression coverage for Sentry MANKUNKU-1E: supabase-js 2.111 resolves the
 * realtime WebSocket constructor at CLIENT CONSTRUCTION, so on Node < 22
 * (no native WebSocket global) every createServerClient call threw and every
 * SSR request 500'd. The fallback must keep construction working there and
 * stay inert on runtimes that have the native global.
 */
describe('nodeRealtimeFallback', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns {} when the native WebSocket global exists', () => {
		// Node 22+ (and every browser) — the shim must not shadow the native one.
		if (typeof WebSocket === 'undefined') {
			vi.stubGlobal('WebSocket', class {});
		}
		expect(nodeRealtimeFallback()).toEqual({});
	});

	it('supplies a transport when WebSocket is missing (Node < 22)', () => {
		vi.stubGlobal('WebSocket', undefined);
		const fallback = nodeRealtimeFallback();
		expect(fallback.realtime?.transport).toBeTypeOf('function');
	});

	it('keeps createServerClient constructible without a WebSocket global', () => {
		vi.stubGlobal('WebSocket', undefined);
		const client = createServerClient('https://example.supabase.co', 'anon-key', {
			...nodeRealtimeFallback(),
			cookies: { getAll: () => [], setAll: () => {} }
		});
		expect(client).toBeDefined();
	});

	it('the stub transport throws only if realtime is actually used', () => {
		vi.stubGlobal('WebSocket', undefined);
		const Transport = nodeRealtimeFallback().realtime!.transport as new (
			...args: unknown[]
		) => unknown;
		expect(() => new Transport('wss://unused')).toThrow(/realtime is not supported/i);
	});
});
