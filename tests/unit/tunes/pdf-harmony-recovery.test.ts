import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { readHarmony } from '$lib/server/pdf-import/anthropic-harmony';
vi.mock('$lib/server/anthropic', () => ({ ANTHROPIC_MODEL: 'test' }));

const reply = (bars: unknown) => ({ content: [{ type: 'text', text: JSON.stringify({ bars }) }] });
function clientFor(work: () => Promise<unknown>) {
	return { messages: { stream: () => ({ finalMessage: work }) } } as unknown as Anthropic;
}

describe('isolated harmony recovery', () => {
	it('bounds recovery to eight measures and two simultaneous calls', async () => {
		let calls = 0,
			active = 0,
			peak = 0;
		const client = clientFor(async () => {
			if (calls++ === 0) return reply([]);
			active++;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			active--;
			return reply([[[0, 'C7']]]);
		});
		const result = await readHarmony(
			client,
			{
				image: 'full',
				barCount: 12,
				timeSignature: [4, 4],
				harmonyImages: Array(12).fill('data:image/png;base64,cG5n')
			},
			'full',
			new AbortController().signal
		);
		expect(calls).toBe(9);
		expect(peak).toBe(2);
		expect(result.bars.slice(0, 8)).toEqual(Array(8).fill([[0, 'C7']]));
		expect(result.bars.slice(8)).toEqual([[], [], [], []]);
		expect(result.warnings).toHaveLength(4);
		expect(result.warnings[0]).toMatch(/^bar 9:/);
	});
	it('keeps validated bars while recovering only the malformed measure', async () => {
		let calls = 0;
		const result = await readHarmony(
			clientFor(async () =>
				calls++ === 0 ? reply([[[0, 'G7']], [[0, 'invalid']]]) : reply([[[0, 'Am7']]])
			),
			{
				image: 'full',
				barCount: 2,
				timeSignature: [4, 4],
				harmonyImages: ['data:image/png;base64,QQ==', 'data:image/png;base64,Qg==']
			},
			'full',
			new AbortController().signal
		);
		expect(calls).toBe(2);
		expect(result.bars).toEqual([[[0, 'G7']], [[0, 'Am7']]]);
		expect(result.warnings).toEqual([]);
	});
	it('preserves valid partial harmony and its warning if recovery fails', async () => {
		let calls = 0;
		const result = await readHarmony(
			clientFor(async () => {
				if (calls++ === 0)
					return reply([
						[
							[0, 'G7'],
							[2, 'invalid']
						]
					]);
				throw new Error('provider unavailable');
			}),
			{
				image: 'full',
				barCount: 1,
				timeSignature: [4, 4],
				harmonyImages: ['data:image/png;base64,QQ==']
			},
			'full',
			new AbortController().signal
		);
		expect(result.bars).toEqual([[[0, 'G7']]]);
		expect(result.warnings).toEqual(['bar 1: a chord could not be read reliably']);
	});
	it('does not reread legitimate blank harmony or invent missing source images', async () => {
		let calls = 0;
		const result = await readHarmony(
			clientFor(async () => {
				calls++;
				return reply([[], [[0, 'invalid']]]);
			}),
			{
				image: 'full',
				barCount: 2,
				timeSignature: [4, 4],
				harmonyImages: ['data:image/png;base64,QQ==', '']
			},
			'full',
			new AbortController().signal
		);
		expect(calls).toBe(1);
		expect(result.bars).toEqual([[], []]);
		expect(result.warnings).toHaveLength(1);
	});
	it('propagates cancellation without consuming the remaining recovery budget', async () => {
		const controller = new AbortController();
		let calls = 0;
		const work = readHarmony(
			clientFor(async () => {
				if (calls++ === 0) return reply([]);
				controller.abort(new Error('cancelled'));
				throw controller.signal.reason;
			}),
			{
				image: 'full',
				barCount: 8,
				timeSignature: [4, 4],
				harmonyImages: Array(8).fill('data:image/png;base64,QQ==')
			},
			'full',
			controller.signal
		);
		await expect(work).rejects.toThrow('cancelled');
		expect(calls).toBe(2);
	});
});
