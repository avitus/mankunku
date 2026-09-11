import { describe, it, expect, vi, afterEach } from 'vitest';
import { serverReachable } from '$lib/util/server-reachable';

afterEach(() => {
	vi.unstubAllGlobals();
});

function fetchRecorder(result: () => Promise<Response>) {
	const calls: { href: string; init: RequestInit | undefined }[] = [];
	const fn = (async (href: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ href: String(href), init });
		return result();
	}) as typeof fetch;
	return { fn, calls };
}

describe('serverReachable', () => {
	it('treats any HTTP response — even an error status — as reachable', async () => {
		const { fn } = fetchRecorder(async () => new Response(null, { status: 503 }));
		await expect(serverReachable('http://localhost/x', fn)).resolves.toBe(true);
	});

	it('reports unreachable when the probe rejects', async () => {
		const { fn } = fetchRecorder(async () => {
			throw new TypeError('Failed to fetch');
		});
		await expect(serverReachable('http://localhost/x', fn)).resolves.toBe(false);
	});

	it('reports unreachable without probing when the browser says it is offline', async () => {
		// navigator.onLine === false is a definite answer: no fetch, no
		// timeout wait, and the recovery stays in the local-first app.
		vi.stubGlobal('navigator', { onLine: false });
		const { fn, calls } = fetchRecorder(async () => new Response(null, { status: 200 }));
		await expect(serverReachable('http://localhost/x', fn)).resolves.toBe(false);
		expect(calls).toHaveLength(0);
	});

	it('bounds the probe with an abort signal so a stalled server cannot hang recovery', async () => {
		// handleError awaits this probe; a HEAD fetch with no timeout would
		// hang the hook forever against a server that accepts but never
		// answers (the deploy restart gap this code exists for).
		const { fn, calls } = fetchRecorder(async () => new Response(null, { status: 200 }));
		await serverReachable('http://localhost/x', fn);
		expect(calls).toHaveLength(1);
		expect(calls[0].init?.method).toBe('HEAD');
		expect(calls[0].init?.cache).toBe('no-store');
		expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
	});
});
