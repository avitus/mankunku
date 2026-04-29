/**
 * Integration test for the /api/lick-match endpoint.
 * Hits the real handler; exercises the real index built from quotes.json
 * (WJazzD index is a stub until the build script is run with the raw DB).
 */
import { describe, it, expect } from 'vitest';
import { POST } from '../../src/routes/api/lick-match/+server';
import type { RequestEvent } from '@sveltejs/kit';

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
