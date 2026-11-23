import { describe, expect, it, vi } from 'vitest';
import { POST } from '../../../src/routes/api/speaker-check/+server';

const url = new URL('https://example.com/api/speaker-check');
const metrics = { session: '5a671f31-2f06-49ac-8ab1-39de99de31d2', stage: 'listen', surface: 'ear-training', result: 'active', reduction: 5.2 };
function post(data: unknown, origin = url.origin) {
	const request = new Request(url, {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify(data)});
	return POST({url, request} as Parameters<typeof POST>[0]);
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
	it('rejects oversized, cross-origin, and unrecognized events', async () => {
		expect((await post(metrics, 'https://elsewhere.example')).status).toBe(403);
		expect((await post({...metrics, result: 'unexpected text'})).status).toBe(400);
		expect((await post({...metrics, mic: 'a'.repeat(3000)})).status).toBe(413);
	});
});
