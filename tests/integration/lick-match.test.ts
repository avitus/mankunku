/**
 * Integration test for the /api/lick-match endpoint.
 * Hits the real handler; exercises the real index built from quotes.json
 * (WJazzD index is a stub until the build script is run with the raw DB).
 */
import { describe, it, expect } from 'vitest';
import { POST } from '../../src/routes/api/lick-match/+server';
import type { RequestEvent } from '@sveltejs/kit';
import wjazzdData from '../../src/lib/matching/data/wjazzd-index.json';
import type { IndexPhrase, SourceEntry } from '../../src/lib/matching/index-format';

function postRequest(body: unknown): RequestEvent {
	const request = new Request('http://localhost/api/lick-match', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	return { request } as unknown as RequestEvent;
}

async function invoke(body: unknown) {
	const response = await POST(postRequest(body) as Parameters<typeof POST>[0]);
	const json = await response.json();
	return { status: response.status, body: json };
}

describe('POST /api/lick-match', () => {
	it('returns a quote match for the chromatic-descent seed pattern', async () => {
		// Matches quotes.json "quote:chromatic-descent": 5 descending half steps.
		const { status, body } = await invoke({
			intervals: [-1, -1, -1, -1, -1],
			iois: [2, 2, 2, 2, 2]
		});
		expect(status).toBe(200);
		expect(body.matches).toBeInstanceOf(Array);
		expect(body.matches.length).toBeGreaterThanOrEqual(1);
		const top = body.matches[0];
		expect(top.sourceId).toBe('quote:chromatic-descent');
		expect(top.kind).toBe('quote');
		expect(top.label).toContain('Chromatic descent');
		expect(top.license).toBe('curated');
		expect(top.confidence).toBe('quote');
		expect(top.score).toBeGreaterThan(0.9);
	});

	it('returns empty matches for an unrelated phrase', async () => {
		// Random scale that does not appear in seed data
		const { status, body } = await invoke({
			intervals: [7, -5, 6, -4, 8, -3],
			iois: [2, 2, 2, 2, 2, 2]
		});
		expect(status).toBe(200);
		expect(body.matches).toEqual([]);
	});

	it('returns empty matches for a query too short to n-gram', async () => {
		const { status, body } = await invoke({
			intervals: [-1, -1],
			iois: [2, 2]
		});
		expect(status).toBe(200);
		expect(body.matches).toEqual([]);
	});

	it('rejects an oversized request with 413 before parsing the body', async () => {
		// The adapter's BODY_SIZE_LIMIT is a global 16M (for /api/tune-parse);
		// this route's own gate must refuse big payloads up front.
		const request = new Request('http://localhost/api/lick-match', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': String(1_000_000)
			},
			body: JSON.stringify({ intervals: [-1, -1, -1], iois: [2, 2, 2] })
		});
		const response = await POST({ request } as Parameters<typeof POST>[0]);
		expect(response.status).toBe(413);
		const body = await response.json();
		expect(body.error).toContain('too large');
	});

	it('rejects an oversized body with 413 even when content-length is absent', async () => {
		// A constructed Request surfaces NO content-length header (chunked /
		// headerless clients look the same), so the declared-size fast path is
		// blind — only counting actual body bytes can enforce the route limit.
		const payload = JSON.stringify({
			intervals: [-1, -1, -1],
			iois: [2, 2, 2],
			pad: 'x'.repeat(100_000)
		});
		const request = new Request('http://localhost/api/lick-match', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: payload
		});
		expect(request.headers.get('content-length')).toBeNull();
		const response = await POST({ request } as Parameters<typeof POST>[0]);
		expect(response.status).toBe(413);
		const body = await response.json();
		expect(body.error).toContain('too large');
	});

	it('accepts a normal-sized body with an explicit content-length', async () => {
		const payload = JSON.stringify({
			intervals: [-1, -1, -1, -1, -1],
			iois: [2, 2, 2, 2, 2]
		});
		const request = new Request('http://localhost/api/lick-match', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': String(new TextEncoder().encode(payload).length)
			},
			body: payload
		});
		const response = await POST({ request } as Parameters<typeof POST>[0]);
		expect(response.status).toBe(200);
	});

	it('answers 400 when the body stream breaks mid-read, rather than throwing a 500', async () => {
		const request = new Request('http://localhost/api/lick-match', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: new ReadableStream<Uint8Array>({
				pull(controller) {
					controller.error(new Error('socket hang up'));
				}
			}),
			// Node's fetch requires this for a streaming request body.
			...({ duplex: 'half' } as Record<string, unknown>)
		});
		const response = await POST({ request } as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Malformed request body');
	});

	it('rejects malformed JSON with 400', async () => {
		const request = new Request('http://localhost/api/lick-match', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{ not json'
		});
		const response = await POST({ request } as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
	});

	it('rejects mismatched-length arrays with 400', async () => {
		const { status, body } = await invoke({
			intervals: [-1, -1, -1, -1, -1],
			iois: [2, 2, 2] // length mismatch
		});
		expect(status).toBe(400);
		expect(body.error).toContain('length');
	});

	it('rejects non-number entries with 400', async () => {
		const { status, body } = await invoke({
			intervals: [-1, -1, 'bad', -1, -1],
			iois: [2, 2, 2, 2, 2]
		});
		expect(status).toBe(400);
		expect(body.error).toContain('integer arrays');
	});

	it('rejects a JSON body that is not an object with 400', async () => {
		for (const body of [[1, 2, 3], null, 'a string', 7]) {
			const { status, body: res } = await invoke(body);
			expect(status, JSON.stringify(body)).toBe(400);
			expect(res.error).toMatch(/JSON object body|Invalid JSON/);
		}
	});

	it('rejects sequences longer than 512 intervals with 400', async () => {
		const intervals = Array.from({ length: 513 }, () => 1);
		const iois = Array.from({ length: 513 }, () => 2);
		const { status, body } = await invoke({ intervals, iois });
		expect(status).toBe(400);
		expect(body.error).toContain('too long');
		// The boundary itself is admitted (and simply finds nothing).
		const ok = await invoke({ intervals: intervals.slice(0, 512), iois: iois.slice(0, 512) });
		expect(ok.status).toBe(200);
	});

	it('validates minScore as a finite number inside [0, 1]', async () => {
		const base = { intervals: [-1, -1, -1, -1, -1], iois: [2, 2, 2, 2, 2] };
		for (const [minScore, message] of [
			['high', 'finite number'],
			[1.5, 'between 0 and 1'],
			[-0.1, 'between 0 and 1']
		] as const) {
			const { status, body } = await invoke({ ...base, minScore });
			expect(status, String(minScore)).toBe(400);
			expect(body.error).toContain(message);
		}
		// Both ends of the range are admitted.
		expect((await invoke({ ...base, minScore: 0 })).status).toBe(200);
		expect((await invoke({ ...base, minScore: 1 })).status).toBe(200);
	});

	it('validates topK as a positive integer no larger than 500', async () => {
		const base = { intervals: [-1, -1, -1, -1, -1], iois: [2, 2, 2, 2, 2] };
		for (const [topK, message] of [
			[1.5, 'finite integer'],
			['3', 'finite integer'],
			[0, 'positive integer'],
			[501, 'not exceed 500']
		] as const) {
			const { status, body } = await invoke({ ...base, topK });
			expect(status, String(topK)).toBe(400);
			expect(body.error).toContain(message);
		}
		expect((await invoke({ ...base, topK: 500 })).status).toBe(200);
	});

	it('labels a Weimar Jazz Database hit with performer, title, bar and year under the CC-BY-NC-SA license', async () => {
		// Query the corpus with the opening of one of its own phrases (each
		// indexed phrase is a whole solo, far past the 512-interval cap): an
		// exact self-match, so the response row for that source is
		// deterministic and the label and attribution formats can be pinned
		// literally against the source entry.
		const { phrases, sources } = wjazzdData as unknown as { phrases: IndexPhrase[]; sources: SourceEntry[] };
		const phrase = phrases.find((p) => p.intervals.length >= 12 && p.startBar)!;
		const source = sources.find((s) => s.id === phrase.sourceId)!;
		expect(source.kind).toBe('wjazzd');
		expect(source.year).toBeDefined();

		const { status, body } = await invoke({
			intervals: phrase.intervals.slice(0, 12),
			iois: phrase.iois.slice(0, 12),
			minScore: 0.9,
			topK: 500
		});
		expect(status).toBe(200);
		const hit = body.matches.find((m: { sourceId: string }) => m.sourceId === source.id);
		expect(hit).toBeDefined();
		expect(hit.kind).toBe('wjazzd');
		expect(hit.license).toBe('CC-BY-NC-SA');
		expect(hit.confidence).toBe('quote');
		expect(hit.score).toBeCloseTo(1, 5);
		expect(hit.label).toBe(`${source.performer} — ${source.title}, bar ${phrase.startBar}`);
		expect(hit.attribution).toBe(`Weimar Jazz Database: ${source.performer} — ${source.title}, ${source.year}`);
	});

	it('labels lower-confidence matches as "reminiscent"', async () => {
		// Perfect intervals, way-off rhythms → score 0.7 → reminiscent label.
		// Chromatic descents are common in real solos, so raise topK to make
		// sure the quote appears in the response.
		const { status, body } = await invoke({
			intervals: [-1, -1, -1, -1, -1],
			iois: [8, 8, 8, 8, 8],
			minScore: 0.5,
			topK: 200
		});
		expect(status).toBe(200);
		const match = body.matches.find(
			(m: { sourceId: string }) => m.sourceId === 'quote:chromatic-descent'
		);
		expect(match).toBeDefined();
		expect(match.confidence).toBe('reminiscent');
	});
});
