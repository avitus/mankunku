import { version } from '$app/env';
import { speakerMetrics } from '$lib/diagnostics/speaker-metrics';
import type { RequestHandler } from './$types';

const maxBytes = 2048;
// One PM2 process serves this endpoint. Bound log growth even for anonymous senders.
let windowStart = 0;
let written = 0;
const senderCounts = new Map<string, number>();

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	if (request.headers.get('origin') !== url.origin) return new Response(null, {status: 403});
	if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return new Response(null, {status: 415});
	if (Number(request.headers.get('content-length')) > maxBytes) return new Response(null, {status: 413});
	const reader = request.body?.getReader();
	if (!reader) return new Response(null, {status: 400});
	const bytes = new Uint8Array(maxBytes);
	let size = 0;
	try {
		for (;;) {
			const {value, done} = await reader.read();
			if (done) break;
			if (value.length > maxBytes - size) {
				await reader.cancel();
				return new Response(null, {status: 413});
			}
			bytes.set(value, size);
			size += value.length;
		}
		const metrics = speakerMetrics(JSON.parse(new TextDecoder().decode(bytes.subarray(0, size))));
		if (!metrics) return new Response(null, {status: 400});
		const now = Date.now();
		if (now - windowStart >= 60_000) {
			windowStart = now;
			written = 0;
			senderCounts.clear();
		}
		// Production nginx overwrites X-Real-IP. Keep it in memory for this minute only.
		const sender = request.headers.get('x-real-ip') || getClientAddress();
		const count = senderCounts.get(sender) ?? 0;
		if (count >= 60 || written >= 300) return new Response(null, {status: 429});
		senderCounts.set(sender, count + 1);
		written++;
		console.info(JSON.stringify({event: 'speaker-check', at: new Date(now).toISOString(), version, ...metrics}));
		return new Response(null, {status: 204});
	} catch {
		return new Response(null, {status: 400});
	} finally { reader.releaseLock(); }
};
