import { describe, expect, it, vi } from 'vitest';
import { POST } from '../../../src/routes/api/speaker-check/+server';

import { summarizeSpeakerCheck } from '../../../src/lib/diagnostics/speaker-metrics';

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
			expect((await post({...metrics, method: 'calibrated-gain', phraseId: 'private-phrase', mic: 'private-audio'})).status).toBe(204);
			const line = JSON.parse(log.mock.calls[0][0]);
			expect(line).toMatchObject({...metrics, method: 'calibrated-gain', event: 'speaker-check'});
			expect(line).not.toHaveProperty('phraseId');
			expect(line).not.toHaveProperty('mic');
		} finally { log.mockRestore(); }
	});
	it('keeps first-Listen context and the closing retry rejection in the production log', async () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {});
		try {
			const event = summarizeSpeakerCheck({
				at: new Date().toISOString(), stage: 'listen', result: 'attacks', rate: 44100, cueNumber: 1,
				graphLeadSeconds: 0.18, learnedCuesAtStart: 0,
				check: { accepted: false, failure: 'attacks', offset: 2, broadbandOffset: 2, gain: 1,
					validationGain: 0.9, reduction: 3.2, transientReduction: -1, micRms: 0.02, predictedRms: 0.015,
					closingStartSeconds: 1.2, retryStage: 'opening', retryOffsetDeltaSamples: 3,
					retryWindow: {failure: 'level', validationGain: 1.5, reduction: 4, transientReduction: 2} }
			}, metrics.session, metrics.surface, '85510782');
			expect((await post(event)).status).toBe(204);
			expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
				cueNumber: 1, graphLeadSeconds: 0.18, learnedCuesAtStart: 0, result: 'attacks', reduction: 3.2,
				retryStage: 'opening', retryFailure: 'level', retryOffsetDeltaSamples: 3,
				retryReduction: 4, retryTransientReduction: 2, retryValidationGain: 1.5
			});
			await post({...event, retryFailure: 'private string', retryStage: 'private string'});
			const row = JSON.parse(log.mock.calls[1][0]);
			expect(row).not.toHaveProperty('retryFailure');
			expect(row).not.toHaveProperty('retryStage');
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
