import { describe, it, expect } from 'vitest';
import type { LeadSheet } from '$lib/types/lead-sheet';
import { leadSheetToPhrase } from '$lib/leadsheets/to-phrase';

function sheet(): LeadSheet {
	return {
		id: 'ls-x',
		title: 'X Tune',
		key: 'F',
		timeSignature: [4, 4],
		tags: ['blues'],
		sections: [
			{
				label: 'A',
				bars: 2,
				repeatStart: true,
				repeatEnd: true,
				notes: [{ pitch: 65, duration: [1, 4], offset: [0, 1] }],
				harmony: [{
					chord: { root: 'F', quality: '7' },
					scaleId: 'blues.major',
					startOffset: [0, 1],
					duration: [2, 1]
				}]
			}
		],
		source: 'curated'
	};
}

describe('leadSheetToPhrase', () => {
	it('produces a playable Phrase carrying the flattened melody and harmony', () => {
		const phrase = leadSheetToPhrase(sheet());
		expect(phrase.id).toBe('ls-x');
		expect(phrase.name).toBe('X Tune');
		expect(phrase.key).toBe('F');
		expect(phrase.notes).toHaveLength(1);
		expect(phrase.harmony).toHaveLength(1);
		expect(phrase.difficulty.lengthBars).toBe(2);
		expect(phrase.source).toBe('lead-sheet');
	});

	it('expands repeats for playback when asked', () => {
		const phrase = leadSheetToPhrase(sheet(), { expandRepeats: true });
		expect(phrase.notes).toHaveLength(2);
		expect(phrase.notes[1].offset).toEqual([2, 1]);
		expect(phrase.difficulty.lengthBars).toBe(4);
	});

	it('prefers the sheet difficulty when present but keeps the flattened bar count', () => {
		const s = sheet();
		s.difficulty = { level: 42, pitchComplexity: 40, rhythmComplexity: 40, lengthBars: 99 };
		const phrase = leadSheetToPhrase(s);
		expect(phrase.difficulty.level).toBe(42);
		expect(phrase.difficulty.lengthBars).toBe(2);
	});
});
