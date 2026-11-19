import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tuneKeyCenters } from '$lib/tunes/key-centers';
import { INSTRUMENTS } from '$lib/types/instruments';
import { PITCH_CLASSES } from '$lib/types/music';
import { flattenTune } from '$lib/tunes/flatten';
import { transposeTune } from '$lib/tunes/book-loader';
import { analyzeHarmony } from '$lib/tunes/harmonic-analysis';
import { harmonicSegmentFromSymbol } from '$lib/tunes/segment-from-symbol';
import { section, sheet } from '../../helpers/tune-fixtures';

const allThings = sheet(JSON.parse(readFileSync('tests/fixtures/leadsheets/pdf-vs-musescore/all-the-things-you-are.musescore-import.json', 'utf8')));
function chart(symbols: string[]) {
	return sheet({ key: 'C', sections: [section({ bars: symbols.length, harmony: symbols.map((symbol, i) =>
		harmonicSegmentFromSymbol(symbol, [i, 1], [1, 1])!) })] });
}
const analyze = (tune: typeof allThings) => analyzeHarmony(flattenTune(tune), tune, { cyclic: false });
const opening = ['Dm7', 'G7', 'Cmaj7', 'Fmaj7'];
const closing = ['Dm7', 'G7', 'Cmaj7'];

describe('phrase continuity', () => {
	it.each([2, 4])('carries A-flat through the descending return with a 1/%i-bar final ii chord', denominator => {
		const tune = structuredClone(allThings);
		const ending = tune.sections.at(-1)!.harmony;
		// Production has a beat-one iiø at chorus bar 36, the import has a half-bar iiø.
		ending.at(-2)!.duration = [1, denominator];
		ending.at(-1)!.startOffset = [35 * denominator + 1, denominator];
		ending.at(-1)!.duration = [denominator - 1, denominator];
		const display = tuneKeyCenters(tune, INSTRUMENTS.concert);
		expect(display.markers.filter(m => m.timeRange!.start < 29).map(m => m.keyCenter?.label)).toEqual(expect.arrayContaining(['C major', 'Eb major', 'G major', 'E major']));

		expect(display.markers.find(m => m.keyCenter?.label === 'Ab major' && m.timeRange?.start === 29)?.timeRange?.end).toBe(40 + 1 / denominator);
	});
	it.each(PITCH_CLASSES)('recognizes both functions in %s away from the signature', key => {
		const tune = { ...transposeTune(chart([...opening, 'Fm7', 'Em7', 'Ebdim7', ...closing]), key), key: 'B' as const };
		const analysis = analyze(tune);
		expect(analysis.majorContinuations).toEqual([{ key, segmentIndices: [4, 5, 6],
			exceptions: [{ index: 4, role: 'borrowed iv' }, { index: 6, role: 'passing diminished seventh' }] }]);
		expect([...analysis.majorRegions, ...analysis.compatibleMajorRegions].filter(r => r.key === key)
			.every(r => !r.segmentIndices.includes(4) && !r.segmentIndices.includes(6))).toBe(true);
	});
	it.each([
		[...opening, 'Fm7', 'Em7', 'Abdim7', ...closing],
		[...opening, 'Fm7', 'Em7', 'Ebm7b5', ...closing],
		[...opening, 'Fm7', 'Fm7', 'Em7', ...closing],
		[...opening, 'Fm7', 'Em7', 'Ebdim7', 'Dm7', 'Fmaj7'],
		[...opening, 'Fm7', 'Em7', 'F#m7', 'B7', 'Emaj7']
	])('requires a brief explained passage and a confirming cadence (%j)', (...symbols) => {
		expect(analyze(chart(symbols)).majorContinuations).toEqual([]);
	});
	it('keeps gaps, section boundaries and unresolved symbols visible', () => {
		for (const boundary of ['gap', 'section', 'unknown']) {
			const tune = chart([...opening, 'Fm7', 'Em7', 'Ebdim7', ...closing]);
			const part = tune.sections[0];
			if (boundary === 'gap') part.harmony[5].duration = [1, 2];
			if (boundary === 'unknown') part.harmony[4].symbol = '???';
			if (boundary === 'section') {
				const tail = part.harmony.splice(6);
				part.bars = 6;
				tune.sections.push(section({ bars: tail.length, harmony: tail.map((s, i) => ({ ...s, startOffset: [i, 1] })) }));
			}
			expect(analyze(tune).majorContinuations).toEqual([]);
		}
	});
});
