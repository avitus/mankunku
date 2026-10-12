import { describe, expect, it } from 'vitest';
import { evidenceIssues, inheritContext } from '$lib/tunes/import/pdf-recognition-quality';
import { selectOmrSystems } from '$lib/tunes/import/omr-quality';
import type { OmrNormalized } from '$lib/tunes/import/omr-transcription';

const bar = {
	startRepeat: false,
	endRepeat: false,
	ending: null,
	pickup: false,
	melody: [[0, 4, 'B4']] as [number, number, string][]
};
const doc = (count: number): OmrNormalized => ({
	title: null,
	composer: null,
	key_signature: 'D',
	time_signature: [4, 4],
	measures: Array.from({ length: count }, (_, i) => ({
		number: i + 1,
		notes: [{ spelled_pitch: 'F#4', onset: [0, 1], duration: [1, 1] }]
	}))
});

describe('recognition quality gates', () => {
	it('catches Black Orpheus whole F#4 misread as B4 despite matching note counts', () => {
		expect(evidenceIssues(bar, { count: 1, letters: ['F4'] }, 0)).toEqual([
			expect.stringMatching(/bar 1:.*F4.*B4/)
		]);
		expect(
			evidenceIssues({ ...bar, melody: [[0, 4, 'F#4']] }, { count: 1, letters: ['F4'] }, 0)
		).toEqual([]);
	});
	it('inherits missing key and clef, but honors an explicit natural key change', () => {
		const previous = {
			fifths: 2,
			clef: 'treble' as const,
			timeSignature: [4, 4] as [number, number]
		};
		expect(inheritContext(previous, { fifths: null, clef: null, timeSignature: null })).toEqual(
			previous
		);
		expect(inheritContext(previous, { fifths: 0, clef: 'bass', timeSignature: [3, 4] })).toEqual({
			fifths: 0,
			clef: 'bass',
			timeSignature: [3, 4]
		});
	});
	it('does not align a surplus or a missing OMR measure by slicing the prefix', () => {
		for (const count of [3, 5, 151])
			expect(selectOmrSystems(doc(count), [2, 2], [4, 4]).responses).toEqual([null, null]);
	});
	it('rejects unreadable and empty OMR systems while retaining independently aligned clean lines', () => {
		const d = doc(4);
		d.measures[0].raw_unparsed = ['s'];
		expect(selectOmrSystems(d, [2, 2], [4, 4]).responses.map(Boolean)).toEqual([false, true]);
		d.measures[0].raw_unparsed = [];
		d.measures[0].notes = [];
		expect(selectOmrSystems(d, [2, 2], [4, 4]).responses.map(Boolean)).toEqual([false, true]);
	});
	it('rejects broken rhythm rather than letting it bypass the reader', () => {
		const d = doc(4);
		d.measures[1].notes[0].duration = [1, 2];
		expect(selectOmrSystems(d, [2, 2], [4, 4]).responses.map(Boolean)).toEqual([false, true]);
	});
});

import { runContextualTranscriptions } from '$lib/tunes/import/pdf-context-run';
import { systemCropBounds, layoutIssues } from '$lib/tunes/import/pdf-layout';
import { assembleClaudeDoc } from '$lib/tunes/import/pdf-system-assemble';
import type { SystemGeometry } from '$lib/tunes/import/pdf-geometry';
const geometry: SystemGeometry = {
	band: { top: 469, bottom: 548, lines: [469, 489, 509, 528, 548] },
	interline: 19.75,
	firstBarLeft: 426,
	barlines: [557, 1021, 1470, 1794, 2210],
	repeatDots: []
};

it('retains Black Orpheus chord row without including the next line', () => {
	const next = { ...geometry, band: { top: 745, bottom: 824, lines: [745, 764, 784, 804, 824] } };
	const first = systemCropBounds([geometry, next], 0, 3168);
	const second = systemCropBounds([geometry, next], 1, 3168);
	expect(first[0]).toBeLessThan(320);
	expect(first[1]).toBeLessThan(630);
	expect(first[1]).toBeLessThanOrEqual(second[0]);
});
it('does not force Body and Soul into a skeleton with obscured boundaries', () => {
	expect(
		layoutIssues([{ ...geometry, firstBarLeft: 417, barlines: [418, 1827, 2275] }])
	).not.toEqual([]);
	expect(layoutIssues([geometry])).toEqual([]);
});
it('propagates explicit context changes in reading order and preserves failed slots', async () => {
	const seen: unknown[] = [];
	const run = await runContextualTranscriptions({
		count: 4,
		attempts: 1,
		initialContext: { fifths: 2, clef: 'treble', timeSignature: [4, 4] },
		async transcribe(i, context) {
			seen.push(context);
			if (i === 1) return null;
			return {
				keySignature: i === 0 ? { fifths: 0 } : null,
				clef: i === 0 ? 'bass' : null,
				timeSignature: null,
				bars: [],
				warnings: []
			};
		}
	});
	expect(run.failed).toEqual([1]);
	expect(seen.slice(1)).toEqual(Array(3).fill({ fifths: 0, clef: 'bass', timeSignature: [4, 4] }));
});
it('keeps the opening key and merges scan harmony without replacing text-layer chords', () => {
	const input = (fifths: number, chords: { x: number; text: string }[] = []) => ({
		geometry,
		texts: { chords, marks: [], endings: [], barNumber: null },
		model: { fifths, bars: Array(5).fill(bar) },
		harmony: [[[0, 'B-']] as [number, string][], [], [], [], []]
	});
	const result = assembleClaudeDoc([input(2), input(0), input(0, [{ x: 450, text: 'D7' }])], {
		title: 'Test',
		timeSignature: [4, 4]
	}) as { keySignature: { fifths: number }; systems: { bars: { chords: [number, string][] }[] }[] };
	expect(result.keySignature.fifths).toBe(2);
	expect(result.systems[0].bars[0].chords).toEqual([[0, 'B-']]);
	expect(result.systems[2].bars[0].chords).toEqual([[0, 'D7']]);
});

it('resolves cheap headers first, then starts music reads concurrently with the right contexts', async () => {
	const seen: unknown[] = [];
	let active = 0,
		peak = 0;
	await runContextualTranscriptions({
		count: 3,
		concurrency: 3,
		attempts: 1,
		initialContext: { fifths: null, clef: null, timeSignature: [4, 4] },
		async readContext(i) {
			return {
				keySignature: i === 0 ? { fifths: 2 } : i === 1 ? { fifths: 0 } : null,
				clef: 'treble',
				timeSignature: null,
				bars: [],
				warnings: []
			};
		},
		async transcribe(i, context) {
			seen[i] = context.fifths;
			peak = Math.max(peak, ++active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			active--;
			return { keySignature: null, timeSignature: null, bars: [], warnings: [] };
		}
	});
	expect(seen).toEqual([2, 0, 0]);
	expect(peak).toBe(3);
});

import { omrNormalized } from '$lib/tunes/import/omr-transcription';
it('retains decoder truncation warnings at the file boundary even when counts happen to align', () => {
	const normalized = omrNormalized({
		normalized: doc(4),
		validation_warnings: [{ code: 'POSSIBLE_TRUNCATION' }]
	});
	expect(selectOmrSystems(normalized, [2, 2], [4, 4]).responses).toEqual([null, null]);
});
it('detects decoder loops spanning multiple systems', () => {
	expect(selectOmrSystems(doc(12), [4, 4, 4], [4, 4]).responses).toEqual([null, null, null]);
});

import { signatureIssues } from '$lib/tunes/import/pdf-recognition-quality';
it('asks to verify F natural under two sharps without rewriting a potentially printed natural', () => {
	const candidate = { ...bar, melody: [[0, 4, 'F4']] as [number, number, string][] };
	expect(signatureIssues(candidate, 2, 0)).toEqual([
		expect.stringContaining('verify the printed accidental')
	]);
	expect(candidate.melody[0][2]).toBe('F4');
});

it('flags a later printed meter change even when the melody response omits meter metadata', async () => {
	const result = await runContextualTranscriptions({
		count: 2,
		attempts: 1,
		initialContext: { fifths: 2, clef: 'treble', timeSignature: [4, 4] },
		async readContext(i) {
			return {
				keySignature: null,
				clef: null,
				timeSignature: i === 1 ? [3, 4] : [4, 4],
				bars: [],
				warnings: []
			};
		},
		async transcribe() {
			return { keySignature: null, timeSignature: null, bars: [], warnings: [] };
		}
	});
	expect(result.results[0]?.warnings).toEqual([]);
	expect(result.results[1]?.warnings.join(' ')).toContain('Printed meter 3/4');
});

it('uses an explicit volta bracket end without moving a later printed repeat backwards', () => {
	const g = {
		...geometry,
		barlines: [600, 1000, 1400, 1800],
		repeatDots: [
			{ left: false, right: false },
			{ left: false, right: false },
			{ left: false, right: false },
			{ left: true, right: false }
		]
	};
	const doc = assembleClaudeDoc(
		[
			{
				geometry: g,
				texts: { chords: [], marks: [], endings: [{ x: 450, n: 1, endX: 520 }], barNumber: null },
				model: {
					fifths: 2,
					bars: Array.from({ length: 4 }, (_, i) => ({ ...bar, endRepeat: i === 3 }))
				}
			}
		],
		{ title: 'Volta', timeSignature: [4, 4] }
	) as any;
	expect(doc.systems[0].bars.map((b: any) => b.ending)).toEqual([1, null, null, null]);
	expect(doc.systems[0].bars.map((b: any) => b.endRepeat)).toEqual([false, false, false, true]);
});

it('places an early chord change on beat two over a held whole note', () => {
	const g = { ...geometry, firstBarLeft: 100, barlines: [500], interline: 20 };
	const result = assembleClaudeDoc(
		[
			{
				geometry: g,
				texts: {
					chords: [
						{ x: 120, text: 'C6' },
						{ x: 220, text: 'Ebdim7' }
					],
					marks: [],
					endings: [],
					barNumber: null
				},
				model: { fifths: 0, bars: [bar] }
			}
		],
		{ title: 'Held note', timeSignature: [4, 4] }
	) as any;
	expect(result.systems[0].bars[0].chords).toEqual([
		[0, 'C6'],
		[1, 'Ebdim7']
	]);
});

it('keeps a leading chord on the downbeat when the melody starts with a rest', () => {
	const g = { ...geometry, firstBarLeft: 100, barlines: [500] };
	const result = assembleClaudeDoc(
		[
			{
				geometry: g,
				texts: { chords: [{ x: 125, text: 'C7' }], marks: [], endings: [], barNumber: null },
				noteEvents: [{ x: 125, anchorX: 125, position: 2, kind: 'stemmed' }],
				model: {
					fifths: 0,
					bars: [
						{
							...bar,
							melody: [
								[0, 0.5, 'rest'],
								[0.5, 3.5, 'G4']
							]
						}
					]
				}
			}
		],
		{ title: 'Rest', timeSignature: [4, 4] }
	) as any;
	expect(result.systems[0].bars[0].chords).toEqual([[0, 'C7']]);
});

import { pitchReviewAccidentalIssues } from '$lib/tunes/import/pdf-recognition-quality';
it('keeps an accidental disagreement visible even when the reread agrees with every notehead coordinate', () => {
	const original = {
		...bar,
		melody: [
			[0, 2, 'B4'],
			[2, 1, 'A#4'],
			[3, 1, 'C#5']
		] as [number, number, string][]
	};
	const candidate = {
		...original,
		melody: [
			[0, 2, 'B4'],
			[2, 1, 'A4'],
			[3, 1, 'C#5']
		] as [number, number, string][]
	};
	expect(evidenceIssues(candidate, { count: 3, letters: ['B4', 'A4', 'C5'] }, 2)).toEqual([]);
	expect(pitchReviewAccidentalIssues(original, candidate, 2)).toEqual([
		expect.stringMatching(/bar 3:.*A#4.*A4.*accidental/)
	]);
	expect(pitchReviewAccidentalIssues(original, original, 2)).toEqual([]);
});
