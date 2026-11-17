import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PITCH_CLASSES } from '$lib/types/music';
import { analyzeHarmony } from '$lib/tunes/harmonic-analysis';
import { flattenTune } from '$lib/tunes/flatten';
import { transposeTune } from '$lib/tunes/book-loader';
import { harmonicSegmentFromSymbol } from '$lib/tunes/segment-from-symbol';
import { fractionToFloat } from '$lib/music/intervals';
import { sheet, section } from '../../helpers/tune-fixtures';

const autumn = sheet(JSON.parse(readFileSync('tests/fixtures/leadsheets/autumn-in-new-york.json', 'utf8')));
const analyze = (tune = autumn) => analyzeHarmony(flattenTune(tune), tune, { cyclic: false });
/** Half-bar chords allow a brief secondary dominant followed by varied returning harmony. */
function passage(tail: string[], dominant = 'A7') {
	const symbols = ['Dm7', 'Em7', 'Fmaj7', 'G7', 'Cmaj7', 'Em7', dominant, ...tail];
	return sheet({ key: 'F#', sections: [section({ bars: Math.ceil(symbols.length / 2),
		harmony: symbols.map((symbol, i) => harmonicSegmentFromSymbol(symbol, [i, 2], [1, 2])!) })] });
}

describe('governing major centers and brief tonicizations', () => {
	it.each(PITCH_CLASSES)('preserves the opening six bars in %s, independently of the signature', key => {
		const tune = { ...transposeTune(autumn, key), key: 'B' as const };
		const result = analyze(tune);
		const opening = result.contextualMajorRegions.find(r => fractionToFloat(r.startOffset) === 0)!;
		expect(opening).toMatchObject({ key, duration: [6, 1], segmentIndices: Array.from({ length: 12 }, (_, i) => i),
			secondaryDominant: { segmentIndices: [7], resolutionIndex: 8, targetDegree: 'ii' } });
		// Neither strict collection boundaries nor cornerstone reservations are widened.
		expect(result.compatibleMajorRegions.find(r => r.key === key && fractionToFloat(r.startOffset) === 0)?.duration).toEqual([7, 2]);
		expect(result.majorRegions[0].duration).toEqual([3, 1]);
		expect(result.majorRegions.every(r => !r.segmentIndices.includes(7))).toBe(true);
		expect(result.reservedSegmentIndices).toEqual(expect.arrayContaining([6, 7, 8]));
	});
	it('recognizes an applied dominant outside the signature, without requiring a named cadence', () => {
		const result = analyze(passage(['Dm7', 'Fmaj7', 'G7']));
		expect(result.contextualMajorRegions[0]).toMatchObject({ key: 'C', duration: [5, 1],
			secondaryDominant: { targetKey: 'D', targetDegree: 'ii' } });
	});
	it('times the return at the chord entrance, independently of notation splits', () => {
		const held = passage(['Dm7', 'Fmaj7', 'G7']);
		held.sections[0].harmony.at(-1)!.duration = [2, 1];
		held.sections[0].bars = 7;
		const split = passage(['Dm7', 'Fmaj7', 'G7', 'G7', 'G7', 'G7']);
		const a = analyze(held).contextualMajorRegions[0];
		const b = analyze(split).contextualMajorRegions[0];
		expect(a).toMatchObject({ key: 'C', duration: [13, 2] });
		expect(b).toMatchObject({ key: a.key, duration: a.duration });
	});
	it.each([
		['B7', 'Em7', 'iii'], ['C7', 'Fmaj7', 'IV'], ['D7', 'G7', 'V'], ['E7', 'Am7', 'vi']
	])('explains %s resolving to %s as V/%s', (dominant, target, degree) => {
		const tail = target === 'Fmaj7' || target === 'G7' ? [target, 'Em7', 'Fmaj7', 'G7'] : [target, 'Fmaj7', 'G7'];
		expect(analyze(passage(tail, dominant)).contextualMajorRegions.find(r => r.key === 'C')?.secondaryDominant.targetDegree).toBe(degree);
	});
	it.each([
		['Em7', 'Fmaj7', 'G7'], // Does not resolve by fifth.
		['Dm7', 'Dm7', 'Dm7'], // Sustained destination, no return.
		['Dm7', 'Gm7', 'A7', 'Dm7'], // Genuine new minor context.
		['Dmaj7', 'Em7', 'A7'], // Genuine new major context.
		['Dm7', 'Abmaj7', 'G7'], // Unexplained chromatic interruption.
		['Dm7'], // Insufficient following evidence.
	])('does not smooth away an unsupported return: %j', (...tail) => {
		expect(analyze(passage(tail)).contextualMajorRegions).toEqual([]);
	});
	it.each(['A7alt', 'A7b9', 'Amaj7', 'A7/Ab'])('does not simplify unsupported chord evidence: %s', dominant => {
		expect(analyze(passage(['Dm7', 'Fmaj7', 'G7'], dominant)).contextualMajorRegions).toEqual([]);
	});
	it('requires established cadence evidence, not merely the song signature', () => {
		const tune = passage(['Dm7', 'Fmaj7', 'G7']);
		tune.key = 'C';
		tune.sections[0].harmony[3] = harmonicSegmentFromSymbol('Fmaj7', [3, 2], [1, 2])!;
		expect(analyze(tune).contextualMajorRegions).toEqual([]);
	});
	it('does not bridge a gap or a section boundary', () => {
		const tune = passage(['Dm7', 'Fmaj7', 'G7']);
		tune.sections[0].harmony[6].duration = [1, 4];
		expect(analyze(tune).contextualMajorRegions).toEqual([]);
		const split = passage(['Dm7', 'Fmaj7', 'G7']);
		const tail = split.sections[0].harmony.splice(6);
		split.sections[0].bars = 3;
		split.sections.push(section({ bars: 2, harmony: tail.map((s, i) => ({ ...s, startOffset: [i, 2] })) }));
		expect(analyze(split).contextualMajorRegions).toEqual([]);
	});
	it('does not classify a prolonged dominant as a brief event', () => {
		const tune = passage(['Dm7', 'Fmaj7', 'G7']);
		tune.sections[0].bars += 1;
		tune.sections[0].harmony[6].duration = [3, 2];
		for (const s of tune.sections[0].harmony.slice(7)) s.startOffset = [s.startOffset[0] + 2, 2];
		expect(analyze(tune).contextualMajorRegions).toEqual([]);
	});
	it('coalesces split dominant notation and preserves original indices', () => {
		const tune = passage(['Dm7', 'Fmaj7', 'G7']);
		const harmony = tune.sections[0].harmony;
		harmony[6].duration = [1, 4];
		harmony.splice(7, 0, harmonicSegmentFromSymbol('A7', [13, 4], [1, 4])!);
		harmony.reverse();
		expect(analyze(tune).contextualMajorRegions[0].secondaryDominant.segmentIndices).toEqual([4, 3]);
	});
	it('uses the declared meter for brevity and return timing', () => {
		const tune = passage(['Dm7', 'Fmaj7', 'G7']);
		tune.timeSignature = [3, 4];
		for (const s of tune.sections[0].harmony) {
			s.startOffset = [s.startOffset[0] * 3, s.startOffset[1] * 4];
			s.duration = [3, 8];
		}
		expect(fractionToFloat(analyze(tune).contextualMajorRegions[0].duration)).toBe(3.75);
	});
});
