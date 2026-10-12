import { expect, it, vi } from 'vitest';
import { reviewRecognizedBar } from '$lib/tunes/import/pdf-bar-review';
import type { RecognizedBar } from '$lib/tunes/import/pdf-recognition';

it('does not introduce an impossible tie when preserving a disputed accidental', async () => {
	const original: RecognizedBar = {
		startRepeat: false,
		endRepeat: false,
		ending: null,
		pickup: false,
		melody: [
			[0, 2, 'C5'],
			[2, 2, 'C#5']
		]
	};
	const reread: RecognizedBar = {
		...original,
		melody: [
			[0, 2, 'C5', true],
			[2, 2, 'C5']
		]
	};
	const result = await reviewRecognizedBar(
		{
			original,
			evidence: { count: 2, letters: ['C5', 'C5'] },
			clef: 'treble',
			beats: 4,
			index: 0,
			notation: true
		},
		vi.fn(async () => structuredClone(reread)),
		new AbortController().signal
	);
	expect(result.bar.melody).toEqual(original.melody);
	expect(result.confirmedAccidentals).toBe(false);
	expect(result.warnings.join(' ')).toMatch(/accidental/);
});
