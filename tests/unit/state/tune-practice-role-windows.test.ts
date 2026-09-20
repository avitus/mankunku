import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Phrase } from '$lib/types/music';
import type { Tune } from '$lib/types/tune';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import { flattenTune } from '$lib/tunes/flatten';
import { detectProgressions, selectNonOverlapping } from '$lib/tunes/progression-detector';
import { suggestLicksForProgression, type LickMatcherDeps } from '$lib/tunes/lick-matcher';
import {
	assignSuggestRotation,
	buildSessionPlan,
	type BuildPlanDeps,
	type InsertionPoint
} from '$lib/state/tune-practice-plan';
import { fractionToFloat } from '$lib/music/intervals';
import { makePhrase } from '../../helpers/lick-builders';
import { seg, section, sheet } from '../../helpers/tune-fixtures';

/**
 * 2026-09-17, Autumn Leaves (concert G / E minor; Andy plays it written a
 * whole step up on tenor). With no long ii-V-I lick ready, a single-chord
 * minor lick was named over every long ii-V-I: on the ii of the major one and
 * on the i of the minor one, two bars after the band and its label began.
 * Andy's rule: the longest progression with a READY lick wins; leftover bars
 * are filled shorter; a single-chord lick gets a window only where one chord
 * lasts at least the lick's length, drawn as its own band with name and key.
 */

const autumnLeaves = JSON.parse(
	readFileSync(
		resolve('tests/fixtures/leadsheets/pdf-vs-musescore/autumn-leaves.musescore-import.json'),
		'utf8'
	)
) as Tune;

const PPQ = 480;
const BAR = 4 * PPQ;

function minorChordLick(id: string, lengthBars: number): Phrase {
	return makePhrase({
		id,
		name: id,
		category: 'minor-chord',
		harmony: [
			{
				chord: { root: 'C', quality: 'min7' },
				scaleId: 'major.dorian',
				startOffset: [0, 1],
				duration: [lengthBars, 1]
			}
		],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars }
	});
}

function longMajorLick(id: string): Phrase {
	return makePhrase({
		id,
		name: id,
		category: 'ii-V-I-major',
		harmony: [
			{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 1] },
			{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 1], duration: [1, 1] },
			{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [2, 1], duration: [1, 1] }
		],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 3 }
	});
}

function shortMajorLick(id: string): Phrase {
	return makePhrase({
		id,
		name: id,
		category: 'short-ii-V-I-major',
		harmony: [
			{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 2] },
			{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 2], duration: [1, 2] },
			{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [1, 1], duration: [1, 1] }
		],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 2 }
	});
}

function longMinorLick(id: string): Phrase {
	return makePhrase({
		id,
		name: id,
		category: 'ii-V-I-minor',
		harmony: [
			{ chord: { root: 'D', quality: 'min7b5' }, scaleId: 'harmonic-minor.locrian-sharp6', startOffset: [0, 1], duration: [1, 1] },
			{ chord: { root: 'G', quality: '7b9' }, scaleId: 'harmonic-minor.phrygian-dominant', startOffset: [1, 1], duration: [1, 1] },
			{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.aeolian', startOffset: [2, 1], duration: [1, 1] }
		],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 3 }
	});
}

/** Real matcher over an injected book — nothing persisted, everything eligible. */
function matcherFor(
	licks: Phrase[],
	tune: Tune,
	progress: LickMatcherDeps['progress'] = {}
): BuildPlanDeps['match'] {
	const deps: LickMatcherDeps = {
		licks,
		timeSignature: tune.timeSignature,
		progress,
		getProgressionTags: () => [],
		getUnlockedKeyCount: () => 1,
		practiceLickIds: new Set()
	};
	return (det) => {
		const r = suggestLicksForProgression(det, deps);
		return { suggestions: r.suggestions, uncategorized: r.uncategorized };
	};
}

function planFor(
	tune: Tune,
	licks: Phrase[],
	extra: Partial<BuildPlanDeps> = {},
	progress: LickMatcherDeps['progress'] = {}
): InsertionPoint[] {
	const flat = flattenTune(tune);
	return buildSessionPlan({
		flat,
		notationFlat: flat,
		timeSignature: tune.timeSignature,
		ppq: PPQ,
		detect: (f) => detectProgressions(f, tune),
		match: matcherFor(licks, tune, progress),
		...extra
	});
}

type Sig = [ChordProgressionType, number, number, string[]];
/** (band type, start bar, end, named licks) — whole-note offsets, so ½-bar ends read as .5. */
function signature(plan: InsertionPoint[]): Sig[] {
	return plan.map((ip) => [
		ip.progressionType,
		fractionToFloat(ip.startOffset),
		fractionToFloat(ip.startOffset) + fractionToFloat(ip.duration),
		ip.suggestions.map((s) => s.lickId)
	]);
}

describe('role windows — Autumn Leaves with only a single-chord minor lick', () => {
	const cry = minorChordLick('cry-me-a-river', 2);

	it('gives the 2-bar lick its own Minor window on each 2-bar minor chord, never the 1-bar ii', () => {
		const plan = planFor(autumnLeaves, [cry]);
		expect(signature(plan)).toEqual([
			['ii-V-I-major-long', 1, 4, []], // no lick fits: the band names the progression, as before
			['minor-vamp', 7, 9, ['cry-me-a-river']], // the i of the first minor ii-V-i
			['minor-vamp', 10, 12, ['cry-me-a-river']], // the second ending's E-
			['minor-vamp', 14, 16, ['cry-me-a-river']],
			['ii-V-I-major-long', 16, 20, []],
			['ii-V-I-minor-long', 20, 22.5, []], // its i lasts half a bar: the lick does not fit
			['minor-vamp', 26, 28, ['cry-me-a-river']]
		]);
	});

	it('names the window by the chord it sits on and remembers the progression it came from', () => {
		const plan = planFor(autumnLeaves, [cry]);
		const first = plan[1];
		expect(first.progressionType).toBe('minor-vamp');
		expect(first.detectedType).toBe('ii-V-I-minor-long');
		expect(first.keyCenter).toBe('E');
		expect(first.suggestions[0].targetKey).toBe('E');
		// The window IS the lick's slot: no alignment shift left for the scorer.
		expect(first.suggestions[0].insertionOffset).toEqual(first.startOffset);
		expect(first.playbackBarRange).toEqual({ start: 7, endExclusive: 9 });
		expect(first.notationBarRange).toEqual({ start: 7, endExclusive: 9 });
		expect(first.notationTimeRange).toEqual({ start: 7, end: 9 });
		expect(first.openTick).toBe(BAR + 7 * BAR);
		expect(first.closeTick).toBe(BAR + 9 * BAR + PPQ);
		// A bare window keeps the progression's own key.
		expect(plan[0].keyCenter).toBe('G');
		expect(plan[0].detectedType).toBe('ii-V-I-major-long');
	});

	it('a 1-bar minor lick also takes the lone ii bar of the major cadence', () => {
		const plan = planFor(autumnLeaves, [minorChordLick('one-bar', 1)]);
		expect(signature(plan)).toEqual([
			['minor-vamp', 1, 2, ['one-bar']], // A-7, the ii of the opening ii-V-I
			['minor-vamp', 7, 9, ['one-bar']],
			['minor-vamp', 10, 12, ['one-bar']],
			['minor-vamp', 14, 16, ['one-bar']],
			['minor-vamp', 16, 17, ['one-bar']],
			['major-vamp', 18, 20, []], // uncovered once the cadence lost its band
			['ii-V-I-minor-long', 20, 22.5, []], // E-7 lasts half a bar: still too short
			['minor-vamp', 26, 28, ['one-bar']]
		]);
		expect(plan[0].keyCenter).toBe('A');
	});
});

describe('role windows — longer licks win, bare bands fill what is left', () => {
	it('a ready long ii-V-I lick takes the whole cadence and the chord windows inside it drop', () => {
		const plan = planFor(autumnLeaves, [longMajorLick('long-251'), minorChordLick('cry', 1)]);
		expect(signature(plan).slice(0, 2)).toEqual([
			['ii-V-I-major-long', 1, 4, ['long-251']],
			['minor-vamp', 7, 9, ['cry']]
		]);
		expect(signature(plan).find((s) => s[1] === 16)).toEqual([
			'ii-V-I-major-long',
			16,
			20,
			['long-251']
		]);
	});

	it('a lick the player HAS in that key beats a longer one they have never touched', () => {
		// Points mode lets the whole catalog in, so a long cadence always has
		// SOME lick. "Ready" means the player has it in that key — passed there
		// or unlocked there — and a known 2-bar minor lick must not lose its
		// window to unknown cadence material; with nothing ready anywhere, the
		// longest window with any lick stands, as new material to try.
		const known = { cry: { E: { passCount: 1, currentTempo: 120, lastPracticedAt: 0 } } };
		const plan = planFor(
			autumnLeaves,
			[longMinorLick('new-minor-251'), minorChordLick('cry', 2)],
			{},
			known
		);
		expect(signature(plan).filter((s) => s[1] >= 5 && s[1] < 12)).toEqual([
			['minor-vamp', 7, 9, ['cry']],
			['minor-vamp', 10, 12, ['cry']]
		]);
		// The same book with nothing known: the cadence wins on length.
		const fresh = planFor(autumnLeaves, [longMinorLick('new-minor-251'), minorChordLick('cry', 2)]);
		expect(signature(fresh).filter((s) => s[1] >= 5 && s[1] < 12)).toEqual([
			['ii-V-I-minor-long', 5, 9, ['new-minor-251']],
			['minor-vamp', 10, 12, ['cry']]
		]);
	});

	it('with no licks at all the plan is the longest-first selection, as before', () => {
		const flat = flattenTune(autumnLeaves);
		const plan = planFor(autumnLeaves, []);
		expect(signature(plan)).toEqual([
			['ii-V-I-major-long', 1, 4, []],
			['ii-V-I-minor-long', 5, 9, []],
			['minor-vamp', 10, 12, []],
			['ii-V-I-minor-long', 12, 16, []],
			['ii-V-I-major-long', 16, 20, []],
			['ii-V-I-minor-long', 20, 22.5, []],
			['ii-V-I-minor-long', 24, 28, []]
		]);
		// Idempotent over an already-selected set.
		const preselected = buildSessionPlan({
			flat,
			notationFlat: flat,
			timeSignature: autumnLeaves.timeSignature,
			ppq: PPQ,
			detect: (f) => selectNonOverlapping(detectProgressions(f, autumnLeaves)),
			match: () => ({ suggestions: [], uncategorized: [] })
		});
		expect(preselected).toEqual(plan);
	});
});

describe('role windows — the unresolved ii-V at bar 22', () => {
	it('a 2-bar short lick stretches its window over the bar the resolution falls in', () => {
		const plan = planFor(autumnLeaves, [shortMajorLick('short-251'), minorChordLick('cry', 2)]);
		const short = plan.find((ip) => ip.progressionType === 'ii-V-I-major');
		expect(short).toBeDefined();
		expect(fractionToFloat(short!.startOffset)).toBe(22);
		expect(fractionToFloat(short!.duration)).toBe(2);
		expect(short!.notationBarRange).toEqual({ start: 22, endExclusive: 24 });
		expect(short!.suggestions.map((s) => [s.lickId, s.targetKey])).toEqual([['short-251', 'D']]);
		// The half-bar i of the preceding minor cadence is inside the stretched
		// window, so that bare band gives way to the lick.
		expect(signature(plan).map((s) => [s[0], s[1]])).toEqual([
			['ii-V-I-major-long', 1],
			['minor-vamp', 7],
			['minor-vamp', 10],
			['minor-vamp', 14],
			['ii-V-I-major-long', 16],
			['ii-V-I-major', 22],
			['minor-vamp', 26]
		]);
	});

	it('two adjacent unresolved ii-Vs: the first takes the pair, the second loses the overlap', () => {
		const tune = sheet({
			key: 'C',
			sections: [
				section({
					bars: 3,
					harmony: [
						seg('E', 'min7', [0, 1], [1, 2]),
						seg('A', '7', [1, 2], [1, 2]),
						seg('D', 'min7', [1, 1], [1, 2]),
						seg('G', '7', [3, 2], [1, 2]),
						seg('F#', 'min7b5', [2, 1], [1, 1])
					]
				})
			]
		});
		const plan = planFor(tune, [shortMajorLick('short-251')]);
		expect(signature(plan)).toEqual([['ii-V-I-major', 0, 2, ['short-251']]]);
		expect(plan[0].notationSegmentIndices).toEqual([0, 1, 2, 3]);
		expect(plan[0].keyCenter).toBe('D');
	});
});

describe('role windows — rotation and the per-window cap', () => {
	it('every Minor window shares one rotation pool whatever progression it came from', () => {
		const plan = planFor(autumnLeaves, [minorChordLick('cry', 2), minorChordLick('blue', 2)]);
		const picks = assignSuggestRotation(plan);
		const minors = plan.filter((ip) => ip.progressionType === 'minor-vamp');
		expect(minors).toHaveLength(4);
		// Three of the four come from a minor ii-V-i, one from a bare E- vamp;
		// the pool still alternates across all four (rank order: blue, cry).
		const [first, second] = minors[0].suggestions.map((s) => s.lickId);
		expect(minors.map((ip) => ip.detectedType)).toEqual([
			'ii-V-I-minor-long',
			'minor-vamp',
			'ii-V-I-minor-long',
			'ii-V-I-minor-long'
		]);
		expect(minors.map((ip) => ip.suggestions[picks[ip.id]].lickId)).toEqual([
			first,
			second,
			first,
			second
		]);
	});

	it('caps each window at the suggestion limit', () => {
		const plan = planFor(
			autumnLeaves,
			[minorChordLick('a', 2), minorChordLick('b', 2), minorChordLick('c', 2)],
			{ suggestionLimit: 2 }
		);
		for (const ip of plan.filter((p) => p.suggestions.length > 0)) {
			expect(ip.suggestions).toHaveLength(2);
		}
	});
});

describe('role windows — what the band is called', () => {
	it('a diminished-chord role keeps the cadence colour but is named for its chord', () => {
		// No diminished vamp exists, so the window is typed as its parent; its
		// band must still say what it is for — a 1-bar "Long ii-V-I (Min)"
		// on the iiø7 alone misnames the window.
		const dimLick = makePhrase({
			id: 'dim',
			name: 'dim',
			category: 'diminished-chord',
			harmony: [
				{ chord: { root: 'C', quality: 'min7b5' }, scaleId: 'harmonic-minor.locrian-sharp6', startOffset: [0, 1], duration: [1, 1] }
			]
		});
		const plan = planFor(autumnLeaves, [dimLick]);
		const dim = plan.find((ip) => ip.suggestions.some((s) => s.lickId === 'dim'))!;
		expect(dim).toBeDefined();
		expect(fractionToFloat(dim.startOffset)).toBe(5);
		expect(fractionToFloat(dim.duration)).toBe(1);
		expect(dim.progressionType).toBe('ii-V-I-minor-long');
		expect(dim.detectedType).toBe('ii-V-I-minor-long');
		expect(dim.bandName).toBe('Diminished');
		expect(dim.keyCenter).toBe('F#');
	});

	it('every other window is named after its band type', () => {
		const plan = planFor(autumnLeaves, [minorChordLick('cry', 2)]);
		expect(plan.map((ip) => ip.bandName)).toEqual([
			'Long ii-V-I (Maj)',
			'Minor',
			'Minor',
			'Minor',
			'Long ii-V-I (Maj)',
			'Long ii-V-I (Min)',
			'Minor'
		]);
	});
});
