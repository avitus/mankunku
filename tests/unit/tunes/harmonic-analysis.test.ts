import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PITCH_CLASSES, type HarmonicSegment } from '$lib/types/music';
import { INSTRUMENTS } from '$lib/types/instruments';
import type { Tune } from '$lib/types/tune';
import { fractionToFloat } from '$lib/music/intervals';
import { concertKeyToWritten } from '$lib/music/transposition';
import { analyzeHarmony } from '$lib/tunes/harmonic-analysis';
import { flattenTune } from '$lib/tunes/flatten';
import { transposeTune } from '$lib/tunes/book-loader';
import { detectProgressions } from '$lib/tunes/progression-detector';
import { harmonicSegmentFromSymbol } from '$lib/tunes/segment-from-symbol';
import { section, sheet, seg, simpleSheet } from '../../helpers/tune-fixtures';

const autumn = sheet(JSON.parse(readFileSync('tests/fixtures/leadsheets/autumn-in-new-york.json', 'utf8')));

function analyze(tune: Tune) {
	return analyzeHarmony(flattenTune(tune), tune, { cyclic: false });
}

function chords(symbols: string[], key: Tune['key'] = 'C'): Tune {
	return sheet({ key, sections: [section({ bars: symbols.length,
		harmony: symbols.map((symbol, i) => harmonicSegmentFromSymbol(symbol, [i, 1], [1, 1])!) })] });
}

describe('harmonic analysis — cornerstone priority', () => {
	it('Autumn in New York 2026-11-07: reserves bar 4 before extending the opening major region', () => {
		const result = analyze(autumn);
		const opening = result.majorRegions.find((region) => fractionToFloat(region.startOffset) === 0)!;
		expect(opening).toMatchObject({ key: 'F', segmentIndices: [0, 1, 2, 3, 4, 5],
			evidence: { tonicSegmentIndices: [4], cadences: [[3, 4]], matchesTuneKey: true } });
		expect(fractionToFloat(opening.duration)).toBe(3);
		const overlapping = result.compatibleMajorRegions.find(region => region.key === 'F' && fractionToFloat(region.startOffset) === 0)!;
		expect(fractionToFloat(overlapping.duration)).toBe(3.5);
		expect(overlapping.segmentIndices).toContain(6); // Bm7 written: G-major iii AND the next minor ii.
		expect(opening.segmentIndices).not.toContain(6);
		expect(concertKeyToWritten(opening.key, INSTRUMENTS['tenor-sax'])).toBe('G');
		expect(result.cornerstones).toContainEqual(expect.objectContaining({
			kind: 'minor-arrival', localKey: 'G', segmentIndices: [6, 7, 8], wrapsAround: false
		}));
		expect(result.reservedSegmentIndices).toEqual(expect.arrayContaining([6, 7, 8]));
		for (const region of result.majorRegions) {
			expect(region.segmentIndices.some((index) => result.reservedSegmentIndices.includes(index))).toBe(false);
		}
	});

	it('keeps cyclic identity but scopes finite session reservations to this form', () => {
		const flat = flattenTune(autumn);
		const cyclic = analyzeHarmony(flat, autumn);
		const finite = analyzeHarmony(flat, autumn, { reservationScope: 'form' });
		expect(cyclic.reservedSegmentIndices).toContain(0);
		expect(finite.reservedSegmentIndices).not.toContain(0);
		expect(finite.progressions).toEqual(cyclic.progressions);
		expect(finite.cornerstones).toEqual(cyclic.cornerstones);
		expect(finite.majorRegions.find(r => fractionToFloat(r.startOffset) === 0)?.segmentIndices)
			.toEqual([0, 1, 2, 3, 4, 5]);
		expect(finite.reservedSegmentIndices).toEqual(expect.arrayContaining([6, 7, 8, flat.harmony.length - 2, flat.harmony.length - 1]));
	});

	it.each(PITCH_CLASSES)('preserves the Autumn boundary when transposed to %s', (key) => {
		const result = analyze(transposeTune(autumn, key));
		const opening = result.majorRegions.find((region) => fractionToFloat(region.startOffset) === 0)!;
		expect(opening.key).toBe(key);
		expect(fractionToFloat(opening.duration)).toBe(3);
		expect(opening.segmentIndices).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('keeps familiar major and minor cadences reserved with no player/book dependency', () => {
		for (const tune of [simpleSheet(), chords(['Dm7b5', 'G7b9', 'Cm7'])]) {
			const result = analyze(tune);
			expect(result.reservedSegmentIndices).toEqual([0, 1, 2]);
			expect(result.majorRegions).toEqual([]);
		}
	});

	it('retains nested cornerstone candidates and reserves their union', () => {
		const result = analyze(chords(['Em7', 'A7', 'Dm7', 'G7', 'Cmaj7']));
		expect(result.cornerstones.length).toBeGreaterThan(1);
		expect(result.reservedSegmentIndices).toEqual([0, 1, 2, 3, 4]);
		expect(result.majorRegions).toEqual([]);
	});

	it('reserves a minor arrival across the form boundary only when cyclic', () => {
		const tune = chords(['Am7', 'Bm7', 'E7']);
		const flat = flattenTune(tune);
		const loop = analyzeHarmony(flat, tune);
		expect(loop.cornerstones).toContainEqual(expect.objectContaining({
			kind: 'minor-arrival', localKey: 'A', wrapsAround: true, segmentIndices: [1, 2, 0]
		}));
		expect(loop.reservedSegmentIndices).toEqual([0, 1, 2]);
		expect(analyzeHarmony(flat, tune, { cyclic: false }).cornerstones
			.some((cornerstone) => cornerstone.kind === 'minor-arrival')).toBe(false);
	});

	it('coalesces a repeated ii but does not infer a cadence across a gap', () => {
		const tune = sheet({ sections: [section({ bars: 3, harmony: [
			seg('B', 'min7', [0, 1], [1, 2]), seg('B', 'min7', [1, 2], [1, 2]),
			seg('E', '7', [1, 1], [1, 1]), seg('A', 'min7', [2, 1], [1, 1])
		] })] });
		expect(analyze(tune).cornerstones).toContainEqual(expect.objectContaining({
			kind: 'minor-arrival', segmentIndices: [0, 1, 2, 3]
		}));
		tune.sections[0].harmony[2].duration = [1, 2];
		expect(analyze(tune).cornerstones.some((c) => c.kind === 'minor-arrival')).toBe(false);
	});
});

describe('major-region candidates', () => {
	it('finds a local center outside the song key without a known progression', () => {
		const result = analyze(chords(['Gm7', 'Am7', 'Bbmaj7', 'C7', 'Fmaj7'], 'B'));
		expect(result.majorRegions).toHaveLength(1);
		expect(result.majorRegions[0]).toMatchObject({ key: 'F', segmentIndices: [0, 1, 2, 3, 4],
			evidence: { matchesTuneKey: false, cadences: [[3, 4]] } });
	});

	it('keeps ambiguous tonic-supported collections instead of forcing the song key', () => {
		const regions = analyze(chords(['C', 'F'])).majorRegions;
		expect(regions.map((region) => region.key)).toEqual(['C', 'F']);
		expect(regions.every((region) => region.evidence.cadences.length === 0)).toBe(true);
	});

	it('does not invent a major tonic from a stationary chord or a tonic-free passage', () => {
		expect(analyze(chords(['Cmaj7', 'Cmaj7'])).majorRegions).toEqual([]);
		expect(analyze(chords(['Dm7', 'Em7'])).majorRegions).toEqual([]);
	});

	it('ignores per-chord default scales and preserves input and existing detections', () => {
		const tune = structuredClone(autumn);
		const before = structuredClone(tune);
		const flat = flattenTune(tune);
		expect(analyzeHarmony(flat, tune).progressions).toEqual(detectProgressions(flat, tune));
		const original = analyze(tune);
		expect(tune).toEqual(before);
		for (const part of tune.sections) for (const chord of part.harmony) chord.scaleId = 'minor.altered';
		expect(analyze(tune)).toEqual(original);
	});

	it.each(['Cmaj7#11', 'Cmaj7/Db', 'C???', 'C7alt'])('breaks C-major compatibility at %s', (symbol) => {
		const tune = chords(['Cmaj7', 'Em7', 'Cmaj7', 'Am7']);
		tune.sections[0].harmony[2].symbol = symbol;
		const regions = analyze(tune).majorRegions.filter((region) => region.key === 'C');
		expect(regions).toHaveLength(1);
		expect(regions[0].segmentIndices).toEqual([0, 1]);
	});

	it('stops at a non-diatonic chord even if the song key stays C', () => {
		const result = analyze(chords(['Cmaj7', 'Em7', 'Abmaj7']));
		expect(result.majorRegions.find((r) => r.key === 'C')?.segmentIndices).toEqual([0, 1]);
	});

	it('keeps gaps and section boundaries as separate regions', () => {
		const tune = sheet({ sections: [
			section({ bars: 3, harmony: [seg('C', 'maj7', [0, 1], [1, 1]), seg('E', 'min7', [1, 1], [1, 1])] }),
			section({ bars: 2, harmony: [seg('C', 'maj7', [0, 1], [1, 1]), seg('E', 'min7', [1, 1], [1, 1])] })
		] });
		expect(analyze(tune).majorRegions.filter((r) => r.key === 'C').map((r) => r.segmentIndices))
			.toEqual([[0, 1], [2, 3]]);
		tune.sections[0].bars = 2;
		expect(analyze(tune).majorRegions.filter((r) => r.key === 'C').map((r) => r.segmentIndices))
			.toEqual([[0, 1], [2, 3]]);
	});

	it('retains partial-bar boundaries and a one-bar minimum in the declared meter', () => {
		const tune = sheet({ timeSignature: [3, 4], sections: [section({ bars: 2, harmony: [
			seg('C', 'maj7', [1, 4], [1, 2]), seg('E', 'min7', [3, 4], [1, 4])
		] })] });
		const region = analyze(tune).majorRegions.find((r) => r.key === 'C')!;
		expect(region.startOffset).toEqual([1, 4]);
		expect(fractionToFloat(region.duration)).toBe(0.75);
		tune.sections[0].harmony[1].duration = [1, 8];
		expect(analyze(tune).majorRegions).toEqual([]);
	});

	it('keeps original segment indices for unsorted harmony', () => {
		const tune = chords(['Cmaj7', 'Em7']);
		tune.sections[0].harmony.reverse();
		expect(analyze(tune).majorRegions.find((r) => r.key === 'C')?.segmentIndices).toEqual([1, 0]);
	});

	it('analyzes repeated occurrences separately with usable notation provenance', () => {
		const tune = chords(['Cmaj7', 'Em7']);
		tune.sections[0].repeatStart = true;
		tune.sections[0].repeatEnd = true;
		const flat = flattenTune(tune, { expandRepeats: true });
		const regions = analyzeHarmony(flat, tune).majorRegions.filter((r) => r.key === 'C');
		expect(regions.map((r) => r.segmentIndices)).toEqual([[0, 1], [2, 3]]);
		expect(regions.map((r) => r.segmentIndices.map((i) => flat.segmentSourceIndices[i])))
			.toEqual([[0, 1], [0, 1]]);
	});

	it.each<Partial<HarmonicSegment>>([
		{ startOffset: [1, 2] }, { duration: [0, 1] }, { duration: [1, 0] }, { duration: [99, 1] }
	])('declines invalid or overlapping timelines: %j', (change) => {
		const tune = chords(['Cmaj7', 'Em7']);
		Object.assign(tune.sections[0].harmony[1], change);
		const result = analyze(tune);
		expect(result.issues).toEqual(['invalid-timeline']);
		expect(result.majorRegions).toEqual([]);
	});
});
