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
	it('joins chorus bars 14–20 of All the Things, up to the next modulation', () => {
		const display = tuneKeyCenters(allThings, INSTRUMENTS.concert);
		expect(display.markers.filter(m => m.keyCenter?.label === 'G major').map(m => m.timeRange))
			.toEqual([{ start: 18, end: 25 }]);
		expect(display.markers.some(m => m.keyCenter?.label === 'G minor' && m.timeRange!.start === 18)).toBe(false);
		expect(display.readings.some(r => r.mode === 'minor' && r.start === 18 && r.contextKey === 'G')).toBe(true);
		expect(display.markers.find(m => m.keyCenter?.label === 'E major')?.timeRange?.start).toBe(25);
	});
	it.each(PITCH_CLASSES)('follows a borrowed iiø and a resolved augmented dominant in %s', key => {
		const tune = { ...transposeTune(chart(['Dm7b5', 'G7', 'Cmaj7', 'A7#5', ...closing]), key), key: 'B' as const };
		const analysis = analyze(tune);
		expect(analysis.borrowedMajorApproaches).toEqual([{ key, segmentIndices: [0, 1] }]);
		expect(analysis.majorContinuations).toEqual([{ key, segmentIndices: [3], exceptions: [{ index: 3, role: 'applied augmented dominant' }] }]);
		expect(tuneKeyCenters(tune, INSTRUMENTS.concert).markers.find(m =>
			m.timeRange?.start === 0 && m.timeRange.end === 7)).toBeDefined();
		expect(analysis.compatibleMajorRegions.filter(r => r.key === key)
			.every(r => !r.segmentIndices.includes(0) && !r.segmentIndices.includes(3))).toBe(true);
	});
	it.each(['Cm7', 'C7sus4', 'Abmaj7', 'C7'])('leaves the borrowed major approach unclaimed on arrival at %s', target => {
		const tune = chart(['Dm7b5', 'G7', target]);
		expect(tuneKeyCenters(tune, INSTRUMENTS.concert).markers.some(m =>
			m.keyCenter?.label === 'C major' && m.timeRange!.start === 0)).toBe(false);
	});
	it('preserves the minor cornerstone when the short iiø–V resolves to minor or remains open', () => {
		for (const tonic of ['Cm7', undefined]) {
			const tune = sheet({ key: 'C', sections: [section({ bars: tonic ? 2 : 1, harmony: [
				harmonicSegmentFromSymbol('Dm7b5', [0, 1], [1, 2])!,
				harmonicSegmentFromSymbol('G7', [1, 2], [1, 2])!,
				...(tonic ? [harmonicSegmentFromSymbol(tonic, [1, 1], [1, 1])!] : [])
			] })] });
			expect(analyze(tune).borrowedMajorApproaches).toEqual([]);
			const display = tuneKeyCenters(tune, INSTRUMENTS.concert);
			expect(display.markers.find(m => m.keyCenter?.label === 'C minor')?.timeRange).toEqual({ start: 0, end: tonic ? 2 : 1 });
		}
	});
	it('respects a gap or section boundary between iiø and V', () => {
		const tune = chart(['Dm7b5', 'G7', 'Cmaj7']);
		tune.sections[0].harmony[0].duration = [1, 2];
		expect(analyze(tune).borrowedMajorApproaches).toEqual([]);
		tune.sections = [...chart(['Dm7b5']).sections, ...chart(['G7', 'Cmaj7']).sections];
		expect(analyze(tune).borrowedMajorApproaches).toEqual([]);
	});
	it.each(['A7alt', 'Ab7#5', 'Aaug', 'A7b9'])('requires the resolved augmented seventh for the bridge (%s)', chord => {
		expect(analyze(chart([...closing, chord, ...closing])).majorContinuations).toEqual([]);
	});
	const outgoing = ['F#m7', 'B7', 'Emaj7'];
	const incoming = ['Fm7', 'Bbm7', 'Eb7', 'Abmaj7'];
	it.each(PITCH_CLASSES)('assigns the augmented dominant to the next cadenced major key, transposed to %s', key => {
		const tune = transposeTune({ ...chart([...outgoing, 'C7#5', ...incoming]), key: 'Ab' }, key);
		const result = analyze(tune);
		expect(result.majorKeyTransitions).toMatchObject([{ to: key, leadInIndices: [3],
			dominant: { resolutionIndex: 4, targetDegree: 'vi' } }]);
		expect([...result.compatibleMajorRegions, ...result.majorRegions].filter(r => r.key === key)
			.every(r => !r.segmentIndices.includes(3))).toBe(true);
	});
	it.each([
		{ key: 'Eb', degree: 'ii', tail: ['Fm7', 'Bb7', 'Ebmaj7'] },
		{ key: 'Db', degree: 'iii', tail: ['Fm7', 'Ebm7', 'Ab7', 'Dbmaj7'] }
	])('reads C7♯5 as V/$degree when the cadence establishes $key', ({ key, degree, tail }) => {
		expect(analyze(chart([...outgoing, 'C7#5', ...tail])).majorKeyTransitions)
			.toMatchObject([{ from: 'E', to: key, dominant: { targetDegree: degree } }]);
	});
	it('treats two contiguous half-bars as one dominant and stops at a gap or a section boundary', () => {
		const tune = chart([...outgoing, 'C7#5', ...incoming]);
		const changes = tune.sections[0].harmony;
		changes.splice(3, 1, harmonicSegmentFromSymbol('C7#5', [3, 1], [1, 2])!,
			harmonicSegmentFromSymbol('C7#5', [7, 2], [1, 2])!);
		expect(analyze(tune).majorKeyTransitions).toMatchObject([{ leadInIndices: [3, 4] }]);
		changes[4].duration = [1, 4];
		expect(analyze(tune).majorKeyTransitions).toEqual([]);
		tune.sections = [...chart([...outgoing, 'C7#5']).sections, ...chart(incoming).sections];
		expect(analyze(tune).majorKeyTransitions).toEqual([]);
	});
	it('keeps the minor arrival when the following cadence establishes F minor', () => {
		const tune = chart([...outgoing, 'C7#5', 'Fm7', 'Gm7b5', 'C7', 'Fm7']);
		expect(analyze(tune).majorKeyTransitions).toEqual([]);
		expect(tuneKeyCenters(tune, INSTRUMENTS.concert).markers.some(m =>
			m.keyCenter?.label === 'F minor' && m.timeRange!.end === 8)).toBe(true);
	});
	it.each([
		[...outgoing, 'C7alt', ...incoming],
		[...outgoing, 'B7#5', ...incoming],
		[...outgoing, 'C7#5', 'C7#5', ...incoming],
		[...outgoing, 'C7#5', 'Fm7', ...incoming],
		[...outgoing, 'C7#5', 'Fm7', 'Bbm7', 'Abmaj7'],
		['Emaj7', 'C7#5', ...incoming]
	])('requires the written resolution and nearby cadences on both sides (%j)', (...symbols) => {
		expect(analyze(chart(symbols)).majorKeyTransitions).toEqual([]);
	});
	it.each([2, 4])('carries A-flat through the descending return with a 1/%i-bar final ii chord', denominator => {
		const tune = structuredClone(allThings);
		const ending = tune.sections.at(-1)!.harmony;
		// Production has a beat-one iiø at chorus bar 36, the import has a half-bar iiø.
		ending.at(-2)!.duration = [1, denominator];
		ending.at(-1)!.startOffset = [35 * denominator + 1, denominator];
		ending.at(-1)!.duration = [denominator - 1, denominator];
		const display = tuneKeyCenters(tune, INSTRUMENTS.concert);
		expect(display.markers.find(m => m.keyCenter?.label === 'E major')?.timeRange?.end).toBe(28);
		expect(display.markers.filter(m => m.timeRange!.start < 29).map(m => m.keyCenter?.label)).toEqual(expect.arrayContaining(['C major', 'Eb major', 'G major', 'E major']));

		expect(display.markers.find(m => m.keyCenter?.label === 'Ab major' && m.timeRange?.start === 28)?.timeRange?.end).toBe(41);
		expect(analyzeHarmony(flattenTune(tune), tune).majorTurnarounds).toMatchObject([{ key: 'Ab', resolutionIndices: [] }]);
	});
	// The vi at the top also lets the cyclic analysis hear a real resolution.
	function turnaround(dominant = 'E7b9', tail: string[] = []) {
		const tune = chart(['Am7', ...closing]);
		const part = tune.sections[0];
		part.harmony.push(harmonicSegmentFromSymbol('Bm7b5', [4, 1], [1, 4])!,
			harmonicSegmentFromSymbol(dominant, [17, 4], [3, 4])!,
			...tail.map((symbol, n) => harmonicSegmentFromSymbol(symbol, [5 + n, 1], [1, 1])!));
		part.bars = 5 + tail.length;
		return tune;
	}
	it.each(PITCH_CLASSES)('carries the cadenced center in %s through the terminal iiø–V/vi', key => {
		const tune = { ...transposeTune(turnaround(), key), key: 'B' as const };
		const analysis = analyze(tune);
		expect(analysis.majorTurnarounds).toEqual([{ key, segmentIndices: [4, 5], resolutionIndices: [] }]);
		expect(analyzeHarmony(flattenTune(tune), tune).majorTurnarounds)
			.toEqual([{ key, segmentIndices: [4, 5], resolutionIndices: [0] }]);
		expect([...analysis.majorRegions, ...analysis.compatibleMajorRegions].filter(r => r.key === key)
			.every(r => !r.segmentIndices.includes(5))).toBe(true);
	});
	it('accepts a played vi returning to the parent cadence and declines an established minor destination', () => {
		expect(analyze(turnaround('E7', ['Am7', ...closing])).majorTurnarounds)
			.toMatchObject([{ key: 'C', resolutionIndices: [6] }]);
		expect(analyze(turnaround('E7b9', ['Am7', 'Bm7b5', 'E7', 'Am7'])).majorTurnarounds).toEqual([]);
	});
	it('preserves both visits of a repeated chorus and the short cornerstone reservation', () => {
		const tune = turnaround();
		const part = tune.sections[0];
		part.repeatStart = part.repeatEnd = true;
		part.harmony[4].duration = [1, 2];
		part.harmony[5].startOffset = [9, 2];
		part.harmony[5].duration = [1, 2];
		const result = analyzeHarmony(flattenTune(tune, { expandRepeats: true }), tune, { cyclic: false });
		expect(result.majorTurnarounds.map(t => t.resolutionIndices)).toEqual([[6], []]);
		expect(result.reservedSegmentIndices).toEqual(expect.arrayContaining([4, 5, 10, 11]));
		const display = tuneKeyCenters(tune, INSTRUMENTS.concert);
		expect(display.markers.filter(m => m.keyCenter?.label === 'C major').map(m => m.timeRange))
			.toEqual([{ start: 0, end: 5 }]);
		expect(display.markers.some(m => m.keyCenter?.label === 'A minor')).toBe(false);
		expect(display.readings.some(r => r.mode === 'minor' && r.contextKey === 'C')).toBe(true);
	});
	it('requires a complete written approach, a recent home cadence and contiguous beats', () => {
		for (const defect of ['unknown', 'gap', 'no cadence', 'trailing silence', 'wrong root']) {
			const tune = turnaround(defect === 'unknown' ? 'E7alt' : defect === 'wrong root' ? 'Eb7' : 'E7b9');
			const part = tune.sections[0];
			if (defect === 'gap') part.harmony[4].duration = [1, 8];
			if (defect === 'no cadence') part.harmony.splice(2, 1);
			if (defect === 'trailing silence') part.bars++;
			expect(analyze(tune).majorTurnarounds).toEqual([]);
		}
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
