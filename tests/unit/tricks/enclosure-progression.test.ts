import { describe, expect, it } from 'vitest';
import {
	normalizeTrickPracticeParameters, resolveTrickPracticeBed,
	trickContextFor, transposeTrickContext
} from '$lib/tricks';
import { ENCLOSURE_PRACTICE_BEDS } from '$lib/tricks/enclosure-practice';
import {
	buildEnclosureFigure, buildEnclosurePreview, enclosuresTrick, resolveEnclosureTarget
} from '$lib/tricks/devices/enclosures';
import { triadPairsTrick } from '$lib/tricks/devices/triad-pairs';
import { scoreConformanceAgainstSpec } from '$lib/tricks/conformance';
import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
import { fractionToFloat } from '$lib/music/intervals';
import { phraseToAbc } from '$lib/music/notation';
import { PITCH_CLASSES, type ChordQuality } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { TrickParameters, TrickSlotSpec } from '$lib/types/tricks';
import type { DetectedNote } from '$lib/types/audio';

const parameters: TrickParameters = {
	type: 'major', noteCount: '2', shape: 'above-below', targetTone: 'third', beatPlacement: 'downbeat'
};
const beds: ChordProgressionType[] = ['ii-V-I-major-long', 'ii-V-I-minor-long'];
/** Make an exactly timed 120 BPM detection, optionally substituting its pitch class. */
const detected = (slot: TrickSlotSpec, pc = slot.exactPcs[0]): DetectedNote => ({
	midi: 60 + pc, cents: 0, onsetTime: fractionToFloat(slot.offset) * 2, duration: 0.25, clarity: 1
});

describe('enclosure practice context', () => {
	it('uses only catalog beds and rejects unrelated progressions', () => {
		expect(ENCLOSURE_PRACTICE_BEDS.map((bed) => bed.type)).toEqual([
			'major-vamp', 'minor-vamp', 'dominant-vamp', ...beds
		]);
		for (const bed of ENCLOSURE_PRACTICE_BEDS) expect(bed).toBe(PROGRESSION_TEMPLATES[bed.type]);
		expect(resolveTrickPracticeBed(enclosuresTrick, { type: 'minor' }, 'turnaround')).toBe('minor-vamp');
		expect(resolveTrickPracticeBed(triadPairsTrick, { pair: 'major-whole' }, 'ii-V-I-minor-long')).toBe('major-vamp');
	});

	it('canonicalizes progression family without mutating the selected shape', () => {
		expect(normalizeTrickPracticeParameters(enclosuresTrick, parameters, beds[1])).toEqual({ ...parameters, type: 'minor' });
		expect(parameters.type).toBe('major');
		expect(normalizeTrickPracticeParameters(enclosuresTrick, parameters, 'dominant-vamp').type).toBe('dominant');
	});

	it.each(beds)('keeps %s chord roots distinct from the tonic and transposes the entire cycle', (bed) => {
		const context = trickContextFor(enclosuresTrick, parameters, 'C', 120, bed);
		expect(context.chordRoot).toBe('D');
		expect(context.key).toBe('C');
		expect(context.harmony!.map((s) => fractionToFloat(s.startOffset))).toEqual([0, 1, 2]);
		expect(context.harmony!.map((s) => fractionToFloat(s.duration))).toEqual([1, 1, 2]);
		const moved = transposeTrickContext(context, 'Eb');
		expect(moved.chordRoot).toBe('F');
		expect(moved.harmony!.map((s) => s.chord.root)).toEqual(['F', 'Bb', 'Eb']);
		expect(moved.harmony!.map((s) => s.symbol)).toEqual(bed === beds[0] ? ['F-7', 'Bb7', 'EbΔ7'] : ['F-7b5', 'Bb7b9', 'Eb-7']);
		expect(context.harmony!.map((s) => s.chord.root)).toEqual(['D', 'G', 'C']);
	});
});

describe('chord roles rather than extension-array indexes', () => {
	it.each<ChordQuality>(['7b9', '7#9', '7#11', '7b13'])('keeps the 3rd, 5th and 7th of G%s correct', (quality) => {
		expect(['third', 'fifth', 'seventh'].map((role) => resolveEnclosureTarget(role, 'G', quality)?.pc)).toEqual([11, 2, 5]);
	});
	it('identifies half-diminished fifth and minor-major seventh', () => {
		expect(resolveEnclosureTarget('fifth', 'D', 'min7b5')).toEqual({ pc: 8, interval: 6, label: 'diminished 5th' });
		expect(resolveEnclosureTarget('seventh', 'C', 'minMaj7')).toEqual({ pc: 11, interval: 11, label: 'major 7th' });
	});
	it('does not relabel the sixth of a sixth chord as a seventh', () => {
		expect(resolveEnclosureTarget('seventh', 'C', 'min6')).toBeNull();
		expect(resolveEnclosureTarget('seventh', 'C', 'maj6')).toBeNull();
	});
});

describe('progression enclosure figure', () => {
	it.each(beds)('%s encloses chord changes, with a looping tonic pickup and two bars of final harmony', (bed) => {
		const context = trickContextFor(enclosuresTrick, parameters, 'C', 120, bed);
		const figure = buildEnclosureFigure(parameters, context);
		const targets = figure.slots.filter((slot) => slot.role === 'target');
		expect(figure.pickupBars).toBe(1);
		expect(targets.map((slot) => fractionToFloat(slot.offset))).toEqual([1, 2, 3]);
		expect(targets.at(-1)!.duration).toEqual([1, 2]);
		expect(figure.harmony!.map((s) => [s.chord.root, fractionToFloat(s.startOffset), fractionToFloat(s.duration)])).toEqual([
			['C', 0, 1], ['D', 1, 1], ['G', 2, 1], ['C', 3, 2]
		]);
		const phrase = enclosuresTrick.generateExample(parameters, context)!;
		expect(phrase).not.toBeNull();
		expect(phrase.harmony).toEqual(figure.harmony);
		expect(phrase.difficulty.lengthBars).toBe(5);
		expect(phrase.notes.at(-1)).toEqual({ pitch: null, offset: [7, 2], duration: [3, 2] });
		expect(phraseToAbc(phrase).split('\n').at(-1)).toMatch(/z4\s*\|\s*z8\s*\|\]$/);
		expect(phrase.notes.filter((note) => note.pitch !== null).map((note) => note.pitch! % 12)).toEqual(figure.slots.map((slot) => slot.exactPcs[0]));
	});

	it('shifts offbeat arrivals without adding a fourth tonic gesture', () => {
		const params = { ...parameters, beatPlacement: 'offbeat' };
		const context = trickContextFor(enclosuresTrick, params, 'C', 120, beds[0]);
		const figure = buildEnclosureFigure(params, context);
		const targets = figure.slots.filter((slot) => slot.role === 'target');
		expect(targets.map((slot) => fractionToFloat(slot.offset))).toEqual([1.125, 2.125, 3.125]);
		expect(targets.at(-1)!.duration).toEqual([1, 2]);
		const offbeatPhrase = enclosuresTrick.generateExample(params, context)!;
		expect(offbeatPhrase.difficulty.lengthBars).toBe(5);
		expect(offbeatPhrase.notes.filter((note) => note.pitch !== null).every((note) => fractionToFloat(note.duration) <= 1)).toBe(true);
		expect(phraseToAbc(offbeatPhrase).split('\n').at(-1)).not.toMatch(/[A-Ga-g][,']*(?:15|16)/);
		const single = { ...params, noteCount: '1', shape: 'chromatic-below' };
		const rebased = buildEnclosureFigure(single, context);
		expect(rebased.pickupBars).toBe(0);
		expect(rebased.slots[0].offset).toEqual([0, 1]);
		expect(rebased.harmony!.map((s) => fractionToFloat(s.startOffset))).toEqual([0, 1, 2]);
		expect(enclosuresTrick.generateExample(single, context)!.difficulty.lengthBars).toBe(4);
	});

	it('retains the original vamp and compact layouts', () => {
		const context = trickContextFor(enclosuresTrick, parameters, 'C', 120);
		expect(context.harmony).toBeUndefined();
		expect(buildEnclosureFigure(parameters, context).slots.filter((slot) => slot.role === 'target')).toHaveLength(4);
		const compact = buildEnclosureFigure(parameters, { ...context, figure: 'compact' });
		expect(compact.slots).toHaveLength(7);
		expect(compact.harmony).toBeUndefined();
	});

	it('keeps generation and judging in agreement in all twelve keys', () => {
		for (const bed of beds) for (const key of PITCH_CLASSES) {
			const context = trickContextFor(enclosuresTrick, parameters, key, 120, bed);
			const figure = buildEnclosureFigure(parameters, context);
			const played = figure.slots.map((slot) => detected(slot));
			const score = enclosuresTrick.scoreConformance(played, parameters, context);
			expect(score.patternScore).toBe(1);
			expect(score.slots.filter((slot) => slot.role === 'target').map((slot) => slot.playedDegree)).toEqual(
				bed === beds[0] ? ['b3', '3', '3'] : ['b3', '3', 'b3']
			);
			expect(enclosuresTrick.generateExample(parameters, context)).not.toBeNull();
		}
	});

	it('uses the arrival scale for partial credit even when approaches precede that chord', () => {
		const context = trickContextFor(enclosuresTrick, parameters, 'C', 120, beds[1]);
		const slot = buildEnclosureFigure(parameters, context).slots[6];
		expect(slot.harmonicContext!.scaleId).toBe('major.aeolian');
		expect(scoreConformanceAgainstSpec([detected(slot, 10)], [slot], context).slots[0].tier).toBe('in-scale');
		expect(scoreConformanceAgainstSpec([detected(slot, 11)], [slot], context).slots[0].tier).toBe('out-of-scale');
	});

	it.each(beds)('generates every count, shape, target and beat combination on %s', (bed) => {
		const shapes = {
			'1': ['chromatic-below', 'scale-above'],
			'2': ['above-below', 'below-above', 'double-chromatic'],
			'3': ['above-below', 'below-above', 'double-chromatic']
		};
		const targets: Record<string, number[]> = {
			root: [2, 7, 0], third: [5, 11, bed === beds[0] ? 4 : 3],
			fifth: [bed === beds[0] ? 9 : 8, 2, 7], seventh: [0, 5, bed === beds[0] ? 11 : 10]
		};
		for (const [noteCount, choices] of Object.entries(shapes)) for (const shape of choices) {
			for (const [targetTone, expected] of Object.entries(targets)) for (const beatPlacement of ['downbeat', 'offbeat']) {
				const params = { ...parameters, noteCount, shape, targetTone, beatPlacement };
				const context = trickContextFor(enclosuresTrick, params, 'C', 120, bed);
				const figure = buildEnclosureFigure(params, context);
				expect(figure.slots.filter((slot) => slot.role === 'target').map((slot) => slot.exactPcs[0])).toEqual(expected);
				const phrase = enclosuresTrick.generateExample(params, context);
				expect(phrase).not.toBeNull();
				expect(phrase!.notes.filter((note) => note.pitch !== null)).toHaveLength(3 * (Number(noteCount) + 1));
				for (let n = 1; n < figure.slots.length; n++) {
					const previous = figure.slots[n - 1];
					expect(fractionToFloat(previous.offset) + fractionToFloat(previous.duration)).toBeLessThanOrEqual(fractionToFloat(figure.slots[n].offset));
				}
			}
		}
	});

	it('preserves the signed approach contour across every bed, key, target, count and beat', () => {
		const shapes = {
			'1': ['chromatic-below', 'scale-above'],
			'2': ['above-below', 'below-above', 'double-chromatic'],
			'3': ['above-below', 'below-above', 'double-chromatic']
		};
		for (const bed of ENCLOSURE_PRACTICE_BEDS) for (const key of PITCH_CLASSES) {
			for (const [noteCount, choices] of Object.entries(shapes)) for (const shape of choices) {
				for (const targetTone of ['root', 'third', 'fifth', 'seventh']) for (const beatPlacement of ['downbeat', 'offbeat']) {
					const params = normalizeTrickPracticeParameters(enclosuresTrick, { ...parameters, noteCount, shape, targetTone, beatPlacement }, bed.type);
					const context = trickContextFor(enclosuresTrick, params, key, 120, bed.type);
					const phrase = enclosuresTrick.generateExample(params, context);
					const caseLabel = `${bed.type}/${key}/${noteCount}/${shape}/${targetTone}/${beatPlacement}`;
					expect(phrase, caseLabel).not.toBeNull();
					const pitches = phrase!.notes.flatMap((note) => note.pitch === null ? [] : [note.pitch]);
					const slots = buildEnclosureFigure(params, context).slots;
					expect(pitches.every((pitch) => pitch >= 44 && pitch <= 75), caseLabel).toBe(true);
					let start = 0;
					for (let index = 0; index < slots.length; index++) {
						if (slots[index].role !== 'target') continue;
						const targetPc = slots[index].exactPcs[0];
						for (let approach = start; approach < index; approach++) {
							const pc = slots[approach].exactPcs[0];
							const distance = slots[approach].role === 'approach-above'
								? (pc - targetPc + 12) % 12 : -((targetPc - pc + 12) % 12);
							expect(pitches[approach] - pitches[index], caseLabel).toBe(distance);
						}
						start = index + 1;
					}
				}
			}
		}
	});

	it('keeps the final chromatic approach below the tonic third at a register boundary', () => {
		const params = { ...parameters, noteCount: '1', shape: 'chromatic-below' };
		const context = trickContextFor(enclosuresTrick, params, 'C', 120, beds[0]);
		const notes = enclosuresTrick.generateExample(params, context)!.notes.filter((note) => note.pitch !== null);
		expect(notes.slice(-2).map((note) => note.pitch)).toEqual([63, 64]);
	});

	it('leaves generated spelling to the transposed key, scale and chord policy', () => {
		const params = { ...parameters, type: 'minor', targetTone: 'seventh' };
		const context = trickContextFor(enclosuresTrick, params, 'C', 120, beds[1]);
		expect(enclosuresTrick.generateExample(params, context)!.notes.every((note) => note.spelling === undefined)).toBe(true);
	});
});

describe('selected enclosure preview', () => {
	it('uses the selected arrival register, normalized beat marker and audition harmony', () => {
		const context = trickContextFor(enclosuresTrick, parameters, 'C', 120, beds[0]);
		const preview = buildEnclosurePreview(parameters, context, 1)!;
		expect(preview.target.pc).toBe(11);
		expect(preview.chordContext.chordRoot).toBe('G');
		expect(preview.harmony).toHaveLength(3);
		expect(preview.arrivalOffset).toEqual([1, 1]);
		expect(preview.notes.map((note) => fractionToFloat(note.offset))).toEqual([0.75, 0.875, 1]);
		expect(preview.phrase.harmony.map((s) => s.chord.root)).toEqual(['D', 'G']);
		expect(preview.notes.map((note) => note.midi)).toEqual(enclosuresTrick.generateExample(parameters, context)!.notes.filter((note) => note.pitch !== null).slice(3, 6).map((note) => note.pitch));
		expect(preview.notes[1].spelling).toBeUndefined(); // Spelling follows the written arrival context.
	});
	it('clamps stale chord indexes and handles an offbeat arrival without pickup', () => {
		const params = { ...parameters, noteCount: '1', shape: 'chromatic-below', beatPlacement: 'offbeat' };
		const context = trickContextFor(enclosuresTrick, params, 'C', 120, beds[1]);
		const preview = buildEnclosurePreview(params, context, 99)!;
		expect(preview.chordContext.chordRoot).toBe('C');
		expect(preview.arrivalOffset).toEqual([0, 1]);
		expect(preview.notes.map((note) => fractionToFloat(note.offset))).toEqual([0, 0.125]);
		expect(preview.phrase.difficulty.pickupBars).toBe(0);
		expect(preview.phrase.harmony).toHaveLength(1);
	});
});
