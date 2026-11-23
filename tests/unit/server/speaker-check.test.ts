import { describe, expect, it, vi } from 'vitest';
import { POST } from '../../../src/routes/api/speaker-check/+server';

const url = new URL('https://example.com/api/speaker-check');
const metrics = { session: '5a671f31-2f06-49ac-8ab1-39de99de31d2', stage: 'listen', surface: 'ear-training', result: 'active', reduction: 5.2 };
function post(data: unknown, origin = url.origin, address = '127.0.0.1', forwarded = '') {
	const request = new Request(url, {method: 'POST', headers: {origin, 'x-real-ip': forwarded, 'content-type': 'application/json'}, body: JSON.stringify(data)});
	return POST({url, request, getClientAddress: () => address} as Parameters<typeof POST>[0]);
}

describe('speaker monitoring', () => {
	it('writes a numeric event, dropping user content and waveforms', async () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		try {
			expect((await post({...metrics, phraseId: 'private-phrase', mic: 'private-audio'})).status).toBe(204);
			const line = JSON.parse(log.mock.calls[0][0]);
			expect(line).toMatchObject({...metrics, event: 'speaker-check'});
			expect(line).not.toHaveProperty('phraseId');
			expect(line).not.toHaveProperty('mic');
		} finally { log.mockRestore(); }
	});
	it('leaves capacity for another sender when a sender exceeds its minute allowance', async () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		try {
			for (let i = 0; i < 60; i++) expect((await post(metrics, url.origin, 'sender-a')).status).toBe(204);
			expect((await post(metrics, url.origin, 'sender-a', 'different')).status).toBe(429);
			expect((await post(metrics, url.origin, 'sender-b')).status).toBe(204);
		} finally { log.mockRestore(); }
	});
	it('rejects oversized, cross-origin, and unrecognized events', async () => {
		expect((await post(metrics, 'https://elsewhere.example')).status).toBe(403);
		expect((await post({...metrics, result: 'unexpected text'})).status).toBe(400);
		expect((await post({...metrics, mic: 'a'.repeat(3000)})).status).toBe(413);
	});
});
