import { expect, it } from 'vitest';
import {
	precisionRecall,
	measurePdfAccuracy,
	pdfAccuracyGate
} from '$lib/tunes/import/pdf-accuracy';
import type { Tune } from '$lib/types/tune';
it('penalizes extra, missing, and duplicated notes separately', () => {
	expect(precisionRecall(['a', 'b'], ['a', 'a', 'b', 'c'])).toMatchObject({
		precision: 0.5,
		recall: 1
	});
	expect(precisionRecall(['a', 'b'], ['a'])).toMatchObject({ precision: 1, recall: 0.5 });
});
it('does not forgive a shifted bar, wrong tie, or misplaced chord', () => {
	const tune: Tune = {
		id: '',
		title: '',
		key: 'D',
		timeSignature: [4, 4],
		tags: [],
		source: 'test',
		sections: [
			{
				label: '',
				bars: 2,
				notes: [{ pitch: 66, offset: [0, 1], duration: [1, 1], tied: true }],
				harmony: []
			}
		]
	};
	const shifted = structuredClone(tune);
	shifted.sections[0].notes[0].offset = [1, 1];
	expect(measurePdfAccuracy(tune, shifted).pitches.recall).toBe(0);
	const untied = structuredClone(tune);
	untied.sections[0].notes[0].tied = false;
	expect(measurePdfAccuracy(tune, untied).notes.recall).toBe(0);
	expect(pdfAccuracyGate(measurePdfAccuracy(tune, tune), false)).toEqual([
		'reference requires independent review'
	]);
	expect(pdfAccuracyGate(measurePdfAccuracy(tune, tune), true)).toEqual([]);
});
