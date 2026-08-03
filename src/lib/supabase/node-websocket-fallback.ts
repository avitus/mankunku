/**
 * Node < 22 fallback for @supabase/realtime-js.
 *
 * supabase-js 2.111 constructs a RealtimeClient inside every client it
 * creates — this app never opens a realtime channel, but realtime-js now
 * resolves its WebSocket constructor eagerly, and on a Node runtime without
 * the native `WebSocket` global (added in Node 22) that resolution THROWS
 * from inside `createServerClient`. Because the hooks.server.ts middleware
 * creates a client per request, every SSR request 500s (Sentry MANKUNKU-1E,
 * 2026-08-03, prod droplet on Node 18.19.1).
 *
 * package.json declares `engines.node >= 22.12.0`, so this shim only exists
 * for a deployment host that lags that contract. On Node 22+ (and in every
 * browser) it returns `{}` and the native implementation is used; once no
 * host runs Node < 22 this module can be deleted.
 *
 * The stub is safe because it can only ever be *constructed* by opening a
 * realtime channel, which no code path does — RealtimeClient merely stores
 * the constructor at setup time.
 */

import type { SupabaseClientOptions } from '@supabase/supabase-js';

type RealtimeOptions = NonNullable<SupabaseClientOptions<'public'>['realtime']>;

/** Minimal WebSocket-shaped stub; constructing it means realtime was used. */
class UnsupportedWebSocket {
	constructor() {
		throw new Error(
			'Supabase realtime is not supported on this Node runtime (needs Node 22+ native WebSocket).'
		);
	}
}

/**
 * Client options fragment that keeps supabase-js constructible on Node < 22.
 * Spread into the options of every SERVER-side client creation call.
 *
 * The cast is sound: the transport is only ever *stored* by RealtimeClient;
 * it would have to be constructed (i.e. a channel opened) before its shape
 * could matter, and the constructor throws first.
 */
export function nodeRealtimeFallback(): { realtime?: RealtimeOptions } {
	return typeof WebSocket === 'undefined'
		? {
				realtime: {
					transport: UnsupportedWebSocket as unknown as RealtimeOptions['transport']
				}
			}
		: {};
}
