import { describe, expect, it } from 'vitest';
import { parseRecognitionJson } from '$lib/server/pdf-import/recognition-json';

describe('recognition response envelopes', () => {
	it('retains valid note observations when the reviewer adds prose around its JSON block', () => {
		expect(
			parseRecognitionJson(
				'Note 1 sits on the bottom line.\n```json\n{"notes":[[0,null],[1,null],[2,null],[3,null]]}\n```\nPlease verify.'
			)
		).toEqual({
			notes: [
				[0, null],
				[1, null],
				[2, null],
				[3, null]
			]
		});
	});
	it.each([
		'{"bars":[]}',
		'```json\n{"bars":[]}\n```',
		'```\n{"bars":[]}\n```',
		'```json {"bars":[]} ```'
	])('accepts an ordinary envelope %s', (text) => {
		expect(parseRecognitionJson(text)).toEqual({ bars: [] });
	});
	it.each([
		'```json\n{"bars":[]}\n```\nAlternatively:\n```json\n{"bars":[1]}\n```',
		'```json\n{"bars":[]\n```',
		'Here is an unfenced guess: {"bars":[]}',
		'```javascript\n({bars: []})\n```'
	])('declines ambiguous, malformed or executable content %s', (text) => {
		expect(() => parseRecognitionJson(text)).toThrow();
	});
});
