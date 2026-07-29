import { describe, it, expect } from 'vitest';
import { serverReachable } from '$lib/util/server-reachable';

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
