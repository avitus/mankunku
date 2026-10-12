import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type {
	SystemRecognitionInput,
	SystemRecognitionResult
} from '$lib/tunes/import/pdf-recognition';
import { reviewPrintedAccidentals } from '$lib/server/pdf-import/anthropic-accidentals';
vi.mock('$lib/server/anthropic', () => ({ ANTHROPIC_TUNE_MODEL: 'test' }));
const input: SystemRecognitionInput = {
	image: 'cG5n',
	barCount: 1,
	timeSignature: [4, 4],
	readAccidentals: true,
	barEvidence: [{ count: 1, letters: ['A4'] }]
};
const melody: SystemRecognitionResult = {
	keySignature: { fifths: 0 },
	clef: 'treble',
	timeSignature: [4, 4],
	bars: [
		{ startRepeat: false, endRepeat: false, ending: null, pickup: false, melody: [[0, 4, 'A4']] }
	],
	warnings: []
};
const good = () => ({
	content: [{ type: 'text', text: JSON.stringify({ bars: [{ notes: 1, signs: [[1, 'sharp']] }] }) }]
});
function client(work: () => Promise<unknown>) {
	return { messages: { stream: () => ({ finalMessage: work }) } } as unknown as Anthropic;
}
describe('printed accidental adapter', () => {
	it('preserves melody when either observation fails and makes at most two calls', async () => {
		let calls = 0;
		const result = await reviewPrintedAccidentals(
			client(async () => {
				if (calls++ === 0) return good();
				throw new Error('unavailable');
			}),
			input,
			melody,
			new AbortController().signal
		);
		expect(calls).toBe(2);
		expect(result.bars).toEqual(melody.bars);
		expect(result.warnings.join(' ')).toContain('incomplete');
	});
	it.each([
		{ readAccidentals: false },
		{ harmonyOnly: true },
		{ barEvidence: [] },
		{ barEvidence: [{ count: 1, letters: [] }] }
	])('skips an ineligible request: %j', async (overrides) => {
		const work = vi.fn(async () => good());
		expect(
			await reviewPrintedAccidentals(
				client(work),
				{ ...input, ...overrides },
				melody,
				new AbortController().signal
			)
		).toBe(melody);
		expect(work).not.toHaveBeenCalled();
	});
	it('does not use treble pixel evidence for another clef', async () => {
		const work = vi.fn(async () => good());
		await reviewPrintedAccidentals(
			client(work),
			input,
			{ ...melody, clef: 'bass' },
			new AbortController().signal
		);
		expect(work).not.toHaveBeenCalled();
	});
	it('propagates caller cancellation', async () => {
		const controller = new AbortController();
		await expect(
			reviewPrintedAccidentals(
				client(async () => {
					controller.abort(new Error('cancelled'));
					return good();
				}),
				input,
				melody,
				controller.signal
			)
		).rejects.toThrow('cancelled');
	});
});
