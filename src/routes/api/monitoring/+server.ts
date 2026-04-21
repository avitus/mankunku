import type { RequestHandler } from './$types';

/**
 * Sentry envelope tunnel — proxies client-side error/replay envelopes through
 * a same-origin endpoint so ad blockers and tracker-protection features
 * (Firefox ETP, uBlock, Brave Shields) don't cancel the requests before they
 * reach Sentry. Without this, we silently lose a meaningful fraction of
 * real-user telemetry.
 *
 * The SDK is configured with `tunnel: '/api/monitoring'` in hooks.client.ts,
 * which makes it POST serialized envelopes here instead of directly to the
 * ingest endpoint.
 *
 * Security: the DSN and project id inside the envelope header are attacker-
 * controllable (anyone can POST here), so we validate them against hardcoded
 * allow-lists. Mismatched envelopes are rejected — this tunnel only forwards
 * events to our own Sentry project, it is not an open relay.
 *
 * Reference: https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option
 */

const SENTRY_HOST = 'o135479.ingest.us.sentry.io';
const ALLOWED_PROJECT_IDS = new Set(['4511259307081728']);
/** Upper bound on envelope size. Real Sentry envelopes are well under this;
 *  the cap stops an attacker from streaming arbitrary bytes into our process. */
const MAX_ENVELOPE_SIZE_BYTES = 1_000_000;

async function readEnvelope(request: Request): Promise<string | Response> {
	const body = request.body;
	if (!body) return '';

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > MAX_ENVELOPE_SIZE_BYTES) {
				await reader.cancel();
				return new Response('Envelope too large', { status: 413 });
			}
			chunks.push(value);
		}
	} catch {
		return new Response('Malformed envelope', { status: 400 });
	}

	const buffer = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		buffer.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(buffer);
}

export const POST: RequestHandler = async ({ request, fetch }) => {
	const read = await readEnvelope(request);
	if (read instanceof Response) return read;
	const envelope = read;
	const headerLine = envelope.split('\n', 1)[0];

	let projectId: string;
	try {
		const header = JSON.parse(headerLine) as { dsn?: string };
		if (typeof header.dsn !== 'string') {
			return new Response('Missing DSN', { status: 400 });
		}
		const dsn = new URL(header.dsn);
		if (dsn.hostname !== SENTRY_HOST) {
			return new Response('Invalid DSN host', { status: 400 });
		}
		projectId = dsn.pathname.replace(/^\//, '');
		if (!ALLOWED_PROJECT_IDS.has(projectId)) {
			return new Response('Invalid project id', { status: 400 });
		}
	} catch {
		return new Response('Malformed envelope', { status: 400 });
	}

	try {
		const upstream = await fetch(`https://${SENTRY_HOST}/api/${projectId}/envelope/`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-sentry-envelope' },
			body: envelope,
			signal: AbortSignal.timeout(5000)
		});
		return new Response(null, { status: upstream.ok ? 200 : 502 });
	} catch (err) {
		const isTimeout = err instanceof Error && err.name === 'TimeoutError';
		return new Response(null, { status: isTimeout ? 504 : 502 });
	}
};
