/**
 * Tests for /api/monitoring — the Sentry envelope tunnel.
 *
 * The point of this endpoint is the allow-list: any POST that doesn't carry a
 * DSN pointing at OUR Sentry project must be rejected before we forward it.
 * Without that, the same-origin tunnel becomes an open relay.  The bytes-cap
 * is a DoS guard.  Both are testable end-to-end through the exported POST
 * handler with a synthetic Request — no SvelteKit runtime needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../../src/routes/api/monitoring/+server';

const VALID_DSN = 'https://abc123@o135479.ingest.us.sentry.io/4511259307081728';

function makeRequest(body: string | Uint8Array): Request {
	// `Uint8Array` is technically a valid BodyInit but the lib types don't
	// always reflect that; pass a Blob to keep TS quiet across versions.
	const init: RequestInit = {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-sentry-envelope' },
		body:
			typeof body === 'string'
				? body
				: new Blob([body as unknown as BlobPart])
	};
	return new Request('http://localhost/api/monitoring', init);
}

async function call(req: Request, fetchMock: typeof fetch): Promise<Response> {
	// SvelteKit RequestEvent is structurally narrow; we only need `request`
	// and `fetch` for this handler. Cast to handler's expected type.
	return await POST({
		request: req,
		fetch: fetchMock
	} as unknown as Parameters<typeof POST>[0]);
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/monitoring — allow-list rejection paths', () => {
	it('rejects an envelope whose DSN host is not Sentry (closes the relay)', async () => {
		const upstream = vi.fn();
		const envelope = JSON.stringify({ dsn: 'https://k@evil.example.com/4511259307081728' });
		const res = await call(makeRequest(envelope), upstream as unknown as typeof fetch);
		expect(res.status).toBe(400);
		// The text body explains *why* — useful for debugging client misconfig.
		expect(await res.text()).toMatch(/Invalid DSN host/);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('rejects an envelope whose DSN looks-alikes the host (suffix attack)', async () => {
		// `o135479.ingest.us.sentry.io.evil.example` would match a substring
		// or `endsWith` check but URL.hostname does an exact comparison.
		const upstream = vi.fn();
		const envelope = JSON.stringify({
			dsn: 'https://k@o135479.ingest.us.sentry.io.evil.example/4511259307081728'
		});
		const res = await call(makeRequest(envelope), upstream as unknown as typeof fetch);
		expect(res.status).toBe(400);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('rejects an unknown project id (allow-list of one)', async () => {
		const upstream = vi.fn();
		const envelope = JSON.stringify({
			dsn: 'https://k@o135479.ingest.us.sentry.io/9999999'
		});
		const res = await call(makeRequest(envelope), upstream as unknown as typeof fetch);
		expect(res.status).toBe(400);
		expect(await res.text()).toMatch(/Invalid project id/);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('rejects an envelope with no DSN field', async () => {
		const upstream = vi.fn();
		const envelope = JSON.stringify({ event_id: 'abc' });
		const res = await call(makeRequest(envelope), upstream as unknown as typeof fetch);
		expect(res.status).toBe(400);
		expect(await res.text()).toMatch(/Missing DSN/);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('rejects a header line that is not valid JSON', async () => {
		const upstream = vi.fn();
		const res = await call(
			makeRequest('this is not json\n{}'),
			upstream as unknown as typeof fetch
		);
		expect(res.status).toBe(400);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('accepts an empty body as nothing-to-forward, not as malformed', async () => {
		// A browser flushing a Sentry envelope with keepalive/sendBeacon as the
		// page tears down can start the request and never deliver the body: the
		// client shows ~33 KB queued, the server reads 0 bytes. Classifying that
		// as `Malformed envelope` (400) makes the browser log
		// "Failed to load resource: 400", which the e2e console-error fixture
		// turns into a failure of whatever test happened to be running —
		// observed as a ~40% flake on tune-practice's follow-scroll spec.
		//
		// There is no envelope to validate and nothing to relay, so 200 is the
		// honest answer. This does NOT loosen the allow-list: every non-empty
		// body still goes through DSN host + project-id checks below.
		const upstream = vi.fn();
		const res = await call(makeRequest(''), upstream as unknown as typeof fetch);
		expect(res.status).toBe(200);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('treats a whitespace-only body the same way', async () => {
		const upstream = vi.fn();
		const res = await call(makeRequest('\n'), upstream as unknown as typeof fetch);
		expect(res.status).toBe(200);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('still rejects a non-empty body with no DSN (the empty-body path is narrow)', async () => {
		const upstream = vi.fn();
		const res = await call(makeRequest('{}'), upstream as unknown as typeof fetch);
		expect(res.status).toBe(400);
		expect(await res.text()).toMatch(/Missing DSN/);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('rejects a body larger than the 1 MB cap with 413', async () => {
		// Synthesize a 1.5 MB envelope; the streaming reader must abort
		// once the running total crosses 1_000_000 bytes.
		const big = new Uint8Array(1_500_000).fill(65); // 'A'
		const upstream = vi.fn();
		const res = await call(makeRequest(big), upstream as unknown as typeof fetch);
		expect(res.status).toBe(413);
		expect(upstream).not.toHaveBeenCalled();
	});
});

describe('POST /api/monitoring — e2e test mode', () => {
	it('sinks envelopes without forwarding when PLAYWRIGHT=1', async () => {
		// E2e runs must never reach real Sentry ingest: they pollute production
		// telemetry, and once ingest starts rejecting the flood, the resulting
		// 502s surface as console errors that fail unrelated e2e tests
		// (observed 2026-07-22: 12-15 webkit failures per run).
		vi.stubEnv('PLAYWRIGHT', '1');
		try {
			const upstream = vi.fn();
			const envelope = `${JSON.stringify({ dsn: VALID_DSN })}\n{"type":"event"}\n{}`;
			const res = await call(makeRequest(envelope), upstream as unknown as typeof fetch);
			expect(res.status).toBe(200);
			expect(upstream).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it('still validates the allow-list in test mode (no open 200 for junk)', async () => {
		vi.stubEnv('PLAYWRIGHT', '1');
		try {
			const upstream = vi.fn();
			const envelope = JSON.stringify({ dsn: 'https://k@evil.example.com/4511259307081728' });
			const res = await call(makeRequest(envelope), upstream as unknown as typeof fetch);
			expect(res.status).toBe(400);
			expect(upstream).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe('POST /api/monitoring — happy path forwarding', () => {
	it('forwards a valid envelope to Sentry and propagates the upstream status', async () => {
		const upstream = vi.fn(async () => new Response(null, { status: 200 }));
		const envelope = `${JSON.stringify({ dsn: VALID_DSN })}\n{"type":"event"}\n{}`;
		const res = await call(makeRequest(envelope), upstream as unknown as typeof fetch);

		expect(res.status).toBe(200);
		expect(upstream).toHaveBeenCalledTimes(1);

		const args = upstream.mock.calls[0] as unknown as [string | URL, RequestInit | undefined];
		const [url, init] = args;
		expect(String(url)).toContain('o135479.ingest.us.sentry.io');
		expect(String(url)).toContain('/api/4511259307081728/envelope/');
		// The full envelope body should be passed through, not just the header.
		expect(init?.body).toBe(envelope);
		expect(init?.method).toBe('POST');
	});

	it('returns 502 when Sentry returns a non-OK response', async () => {
		const upstream = vi.fn(async () => new Response(null, { status: 500 }));
		const envelope = JSON.stringify({ dsn: VALID_DSN });
		const res = await call(makeRequest(envelope), upstream as unknown as typeof fetch);
		expect(res.status).toBe(502);
	});

	it('returns 504 when the upstream fetch times out', async () => {
		const upstream = vi.fn(async () => {
			const err = new Error('aborted');
			err.name = 'TimeoutError';
			throw err;
		});
		const envelope = JSON.stringify({ dsn: VALID_DSN });
		const res = await call(makeRequest(envelope), upstream as unknown as typeof fetch);
		expect(res.status).toBe(504);
	});

	it('returns 502 when the upstream fetch throws a non-timeout error', async () => {
		const upstream = vi.fn(async () => {
			throw new Error('connection refused');
		});
		const envelope = JSON.stringify({ dsn: VALID_DSN });
		const res = await call(makeRequest(envelope), upstream as unknown as typeof fetch);
		expect(res.status).toBe(502);
	});
});
