import { describe, expect, it } from 'vitest';
import { createMelodyReplay } from '../../../scripts/pdf-melody-replay.mjs';

const input = (model: string, image = 'scan') => ({
	model,
	system: 'You are a music COPYIST. Read this system.',
	messages: [{ content: [{ type: 'image', source: { data: image } }] }]
});

describe('recorded melody replay', () => {
	it('replays the failed primary call and successful fallback separately', () => {
		const failed = { input: input('primary'), error: 'Request was aborted.' };
		const fallback = { input: input('fallback'), response: { content: [] } };
		const replay = createMelodyReplay([failed, fallback]);
		expect(replay(input('primary'))).toBe(failed);
		expect(replay(input('fallback'))).toBe(fallback);
	});
	it('consumes successive attempts once, preserving the saved order', () => {
		const first = { input: input('primary'), response: { content: ['first'] } };
		const second = { input: input('primary'), response: { content: ['retry'] } };
		const replay = createMelodyReplay([first, second]);
		expect(replay(input('primary'))).toBe(first);
		expect(replay(input('primary'))).toBe(second);
		expect(() => replay(input('primary'))).toThrow(/no recorded melody/i);
	});
	it('never silently makes a fresh melody request for an unknown image or model', () => {
		const replay = createMelodyReplay([{ input: input('primary'), response: {} }]);
		expect(() => replay(input('primary', 'other scan'))).toThrow(/no recorded melody/i);
		expect(() => replay(input('other model'))).toThrow(/no recorded melody/i);
	});
	it('leaves independent review requests live', () => {
		const replay = createMelodyReplay([]);
		expect(replay({ ...input('primary'), system: 'Read this ONE measure' })).toBeNull();
	});
});
