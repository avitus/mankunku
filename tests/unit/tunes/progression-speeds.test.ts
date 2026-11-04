/**
 * The I-VI-ii-V and iii-VI-ii-V-I each come at two speeds, and a chart at one
 * speed must not borrow the other's identity (Andy, 2026-11-04: "the app
 * appears to have no concept of a short and long" one). Both used to be one
 * progression each: detection admitted either speed under one label, so a
 * 3-bar ii | V | I line was offered over Green Dolphin's half-bar ii-V, and
 * the turnaround table started that same line on the I chord.
 *
 * The bar numbers are the real charts': Fly Me's iii-VI-ii-V-I is the slow
 * form, where such a line fits exactly, and Green Dolphin's is the fast one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { Phrase, PhraseCategory } from '$lib/types/music';
import type { Tune } from '$lib/types/tune';
import {
	PROGRESSION_LICK_CATEGORIES,
	PROGRESSION_TEMPLATES,
	fittingProgressionsForLick,
	getLickAlignmentOffset,
	progressionFitsLick
} from '$lib/data/progressions';
import { ALL_CURATED_LICKS } from '$lib/data/licks';
import { MANKUNKU_BLUES } from '$lib/data/tunes/mankunku-blues';
import { progressionColor } from '$lib/music/progression-display';
import { flattenTune } from '$lib/tunes/flatten';
import { SHAPE_PRIORITY, detectProgressions } from '$lib/tunes/progression-detector';
import { suggestLicksForProgression, type LickMatcherDeps } from '$lib/tunes/lick-matcher';
import { seg, section, sheet } from '../../helpers/tune-fixtures';
import { makePhrase } from '../../helpers/lick-builders';

const SPEEDS = ['turnaround', 'turnaround-short', 'iii-VI-ii-V-I', 'iii-VI-ii-V-I-long'] as const;

function chart(name: string): Tune {
	const path = `tests/fixtures/leadsheets/pdf-vs-musescore/${name}.musescore-import.json`;
	return JSON.parse(readFileSync(path, 'utf8')) as Tune;
}

function detect(tune: Tune) {
	return detectProgressions(flattenTune(tune), tune);
}

/** [label, 0-based start bar] of every turnaround-family detection. */
function speedLabels(tune: Tune): [ChordProgressionType, number][] {
	return detect(tune)
		.filter((d) => (SPEEDS as readonly string[]).includes(d.type))
		.map((d) => [d.type, d.startBar]);
}

function editorLick(category: PhraseCategory, lengthBars: number): Phrase {
	return makePhrase({
		id: `editor-${category}-${lengthBars}`,
		category,
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars }
	});
}

function deps(licks: Phrase[]): LickMatcherDeps {
	return {
		licks,
		timeSignature: [4, 4],
		progress: {},
		getProgressionTags: () => [],
		getUnlockedKeyCount: () => 1,
		practiceLickIds: new Set()
	};
}

/** Chords as `root+quality@barsLong`, the template read off bar by bar. */
function spelled(type: ChordProgressionType): string[] {
	return PROGRESSION_TEMPLATES[type].harmony.map(
		(s) => `${s.chord.root}${s.chord.quality}@${s.duration[0] / s.duration[1]}`
	);
}

describe('the four forms', () => {
	it('spells each form, and the existing ids keep the chords their saved tags were made for', () => {
		expect(spelled('turnaround')).toEqual(['Cmaj7@1', 'A7@1', 'Dmin7@1', 'G7@1']);
		expect(spelled('turnaround-short')).toEqual(['Cmaj7@0.5', 'A7@0.5', 'Dmin7@0.5', 'G7@0.5']);
		expect(spelled('iii-VI-ii-V-I')).toEqual(['Emin7@0.5', 'A7@0.5', 'Dmin7@0.5', 'G7@0.5', 'Cmaj7@2']);
		expect(spelled('iii-VI-ii-V-I-long')).toEqual(['Emin7@1', 'A7@1', 'Dmin7@1', 'G7@1', 'Cmaj7@2']);
	});

	it('sizes each form to its chords', () => {
		expect(PROGRESSION_TEMPLATES['turnaround'].bars).toBe(4);
		expect(PROGRESSION_TEMPLATES['turnaround-short'].bars).toBe(2);
		expect(PROGRESSION_TEMPLATES['iii-VI-ii-V-I'].bars).toBe(4);
		expect(PROGRESSION_TEMPLATES['iii-VI-ii-V-I-long'].bars).toBe(6);
	});

	it('names the speed on every form', () => {
		expect(PROGRESSION_TEMPLATES['turnaround'].name).toBe('Long Turnaround');
		expect(PROGRESSION_TEMPLATES['turnaround-short'].name).toBe('Short Turnaround');
		expect(PROGRESSION_TEMPLATES['iii-VI-ii-V-I'].name).toBe('Short iii-VI-ii-V-I');
		expect(PROGRESSION_TEMPLATES['iii-VI-ii-V-I-long'].name).toBe('Long iii-VI-ii-V-I');
	});

	it('gives each form its own identity colour, defined in app.css for both themes', () => {
		const css = readFileSync('src/app.css', 'utf8');
		const colors = SPEEDS.map(progressionColor);
		expect(new Set(colors).size).toBe(SPEEDS.length);
		for (const type of SPEEDS) {
			const defined = css.match(new RegExp(`--prog-${type}:`, 'g')) ?? [];
			expect(defined, type).toHaveLength(2);
		}
	});

	it('ranks both new forms as specifically as the forms they split from', () => {
		expect(SHAPE_PRIORITY['turnaround-short']).toBe(SHAPE_PRIORITY['turnaround']);
		expect(SHAPE_PRIORITY['iii-VI-ii-V-I-long']).toBe(SHAPE_PRIORITY['iii-VI-ii-V-I']);
	});
});

describe('detection labels each passage with its one speed', () => {
	it('Fly Me: a slow turnaround and the slow iii-VI-ii-V-I', () => {
		expect(speedLabels(chart('fly-me-to-the-moon'))).toEqual([
			['turnaround', 10],
			['iii-VI-ii-V-I-long', 26]
		]);
	});

	it("Green Dolphin: the fast iii-VI-ii-V-I", () => {
		expect(speedLabels(chart('on-green-dolphin-street'))).toEqual([['iii-VI-ii-V-I', 20]]);
	});

	it('Mankunku Blues: one of each turnaround', () => {
		expect(speedLabels(MANKUNKU_BLUES)).toEqual([
			['turnaround', 10],
			['turnaround-short', 14]
		]);
	});

	it('a mixed-speed passage goes by its ii-V, the part a ii-V-I line lands on', () => {
		const slowIiV = sheet({
			key: 'C',
			sections: [
				section({
					bars: 5,
					harmony: [
						seg('E', 'min7', [0, 1], [1, 2]),
						seg('A', '7', [1, 2], [1, 2]),
						seg('D', 'min7', [1, 1], [1, 1]),
						seg('G', '7', [2, 1], [1, 1]),
						seg('C', 'maj7', [3, 1], [2, 1])
					]
				})
			]
		});
		expect(speedLabels(slowIiV).map(([type]) => type)).toEqual(['iii-VI-ii-V-I-long']);
		const fastTurnaround = sheet({
			key: 'C',
			sections: [
				section({
					bars: 3,
					harmony: [
						seg('C', 'maj7', [0, 1], [1, 1]),
						seg('A', '7', [1, 1], [1, 1]),
						seg('D', 'min7', [2, 1], [1, 2]),
						seg('G', '7', [5, 2], [1, 2])
					]
				})
			]
		});
		expect(speedLabels(fastTurnaround).map(([type]) => type)).toEqual(['turnaround-short']);
	});
});

describe("a 3-bar ii | V | I line entered in the editor (Wail's shape)", () => {
	const wail = editorLick('ii-V-I-major', 3);

	it('fits the long ii-V-I and the long iii-VI-ii-V-I, and nothing else', () => {
		expect(fittingProgressionsForLick(wail)).toEqual(['ii-V-I-major-long', 'iii-VI-ii-V-I-long']);
	});

	it('is refused on the short iii-VI-ii-V-I for its length, though the form has room for it', () => {
		expect(progressionFitsLick(wail, 'iii-VI-ii-V-I')).toEqual({ fits: false, reason: 'length' });
	});

	it('is refused on both turnarounds, which never held a ii-V-I start', () => {
		expect(progressionFitsLick(wail, 'turnaround')).toEqual({ fits: false, reason: 'shape' });
		expect(progressionFitsLick(wail, 'turnaround-short')).toEqual({ fits: false, reason: 'shape' });
	});

	it('starts on the long form\'s Dm7, a whole bar of it', () => {
		const at = getLickAlignmentOffset('iii-VI-ii-V-I-long', 'ii-V-I-major');
		expect(at).toEqual([2, 1]);
		const ii = PROGRESSION_TEMPLATES['iii-VI-ii-V-I-long'].harmony.find(
			(s) => s.startOffset[0] === 2 && s.startOffset[1] === 1
		);
		expect(ii?.chord).toEqual({ root: 'D', quality: 'min7' });
		expect(ii?.duration).toEqual([1, 1]);
	});

	it("is offered on Fly Me's slow iii-VI-ii-V-I at the Dm7, bar 29", () => {
		const slow = detect(chart('fly-me-to-the-moon')).find((d) => d.type === 'iii-VI-ii-V-I-long')!;
		const offer = suggestLicksForProgression(slow, deps([wail])).suggestions[0];
		expect(offer?.lickId).toBe(wail.id);
		expect(offer?.insertionBar).toBe(28);
	});

	it("is not offered on Green Dolphin's fast iii-VI-ii-V-I", () => {
		const fast = detect(chart('on-green-dolphin-street')).find((d) => d.type === 'iii-VI-ii-V-I')!;
		expect(suggestLicksForProgression(fast, deps([wail])).suggestions).toEqual([]);
	});

	it('is not offered on either of Mankunku Blues\' turnarounds', () => {
		const turnarounds = detect(MANKUNKU_BLUES).filter((d) => d.type.startsWith('turnaround'));
		expect(turnarounds).toHaveLength(2);
		for (const d of turnarounds) {
			expect(suggestLicksForProgression(d, deps([wail])).suggestions, d.type).toEqual([]);
		}
	});

	it("is still offered on the ii-V-I inside Fly Me's slow turnaround and iii-VI-ii-V-I", () => {
		const longIiVs = detect(chart('fly-me-to-the-moon')).filter((d) => d.type === 'ii-V-I-major-long');
		const offered = longIiVs.filter(
			(d) => suggestLicksForProgression(d, deps([wail])).suggestions.length > 0
		);
		expect(offered.map((d) => d.startBar)).toEqual(expect.arrayContaining([12, 28]));
	});
});

describe('a shorter line and the curated catalog', () => {
	it('a 2-bar editor ii-V-I still fits the short iii-VI-ii-V-I, at its Dm7', () => {
		const two = editorLick('ii-V-I-major', 2);
		expect(progressionFitsLick(two, 'iii-VI-ii-V-I')).toEqual({ fits: true });
		expect(getLickAlignmentOffset('iii-VI-ii-V-I', 'ii-V-I-major')).toEqual([1, 1]);
	});

	it('a curated line with its own chords goes where those chords go', () => {
		const full = ALL_CURATED_LICKS.find((l) => l.id === 'ii-V-I-maj-001')!;
		expect(fittingProgressionsForLick(full)).toEqual(['ii-V-I-major-long', 'iii-VI-ii-V-I-long']);
		const half = ALL_CURATED_LICKS.find(
			(l) =>
				l.category === 'ii-V-I-major' &&
				l.harmony.length === 3 &&
				l.harmony[0].duration[0] / l.harmony[0].duration[1] === 0.5
		)!;
		expect(fittingProgressionsForLick(half)).toEqual(['ii-V-I-major', 'iii-VI-ii-V-I']);
	});

	it('a short turnaround offers only whole-form lines: none of its chords lasts a bar', () => {
		expect(PROGRESSION_LICK_CATEGORIES['turnaround-short'].map((e) => e.category)).toEqual([
			'rhythm-changes'
		]);
	});

	it('the long iii-VI-ii-V-I places one-chord licks on their own bars', () => {
		expect(getLickAlignmentOffset('iii-VI-ii-V-I-long', 'minor-chord')).toEqual([0, 1]);
		expect(getLickAlignmentOffset('iii-VI-ii-V-I-long', 'dominant-chord')).toEqual([1, 1]);
		expect(getLickAlignmentOffset('iii-VI-ii-V-I-long', 'major-chord')).toEqual([4, 1]);
	});
});
