/**
 * The lick detail page shows a lick the way Deep Practice plays it: placed
 * in its PRIMARY progression — the first "Practice over" pill it is tagged
 * with that it fits, else the first progression its category is at home in
 * — in the key the player selected, with that progression's chords above the
 * staff (2026-10-16). User licks are saved with `harmony: []` by both the
 * editor and record-a-lick, so before this the chart of a user lick carried
 * no chords at all, whatever its pills said.
 *
 * `placeLickInProgression` is the ONE builder for a lick over a progression:
 * the session's `buildPhraseFor` delegates to it, so the detail page cannot
 * drift from what the session then drills (pinned by the parity case at the
 * bottom, which runs the real session state module).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// localStorage stub — the parity case starts a real Deep Practice session,
// which reads the tag, progress and session-log stores.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
/** The mock store's entry count. */
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});

import {
	placeLickInProgression,
	lickBarsInProgression,
	melodyWindow
} from '$lib/state/lick-practice-phrase';
import { primaryProgressionForLick, chartModeForLick, lickLabelMode } from '$lib/state/lick-practice-picker';
import { fractionToFloat } from '$lib/music/intervals';
import { lickPractice, startSingleLickSession, getPhraseFor } from '$lib/state/lick-practice.svelte';
import { getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
import { getLickById } from '$lib/phrases/library-loader';
import type { HarmonicSegment, Note, Phrase, PhraseCategory } from '$lib/types/music';

/** One bar of ascending eighths from C4 — the shape the editor saves, `harmony: []`. */
const ONE_BAR: Note[] = [60, 64, 67, 71].map((pitch, i) => ({ pitch, duration: [1, 8], offset: [i, 8] }));

/** A user-entered lick with sensible defaults, overridden per test. */
function userLick(over: Partial<Phrase> & { category: PhraseCategory }): Phrase {
	return {
		id: 'user-line',
		name: 'User line',
		timeSignature: [4, 4],
		key: 'C',
		notes: ONE_BAR,
		harmony: [],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
		tags: [],
		source: 'user-entered',
		...over
	};
}

/** `root quality @ start × duration` per segment, bars as whole-note fractions. */
function chords(h: HarmonicSegment[]): string[] {
	return h.map(
		(s) => `${s.chord.root}${s.chord.quality}@${s.startOffset[0]}/${s.startOffset[1]}x${s.duration[0]}/${s.duration[1]}`
	);
}

/** The phrase's pitch classes in order (null for a rest). */
const pitchClasses = (p: Phrase) => p.notes.map((n) => (n.pitch === null ? null : n.pitch % 12));
/** The phrase's offsets in order. */
const offsets = (p: Phrase) => p.notes.map((n) => n.offset);

describe('placeLickInProgression — a lick as the session plays it', () => {
	it('puts a harmony-less major-chord lick on the I of the long ii-V-I in F, two bars in', () => {
		const lick = userLick({ category: 'major-chord' });
		const placed = placeLickInProgression(lick, 'F', 'ii-V-I-major-long');

		// The chord-quality lick is rooted on the slot chord (Fmaj7 at bar 2), not the key.
		expect(pitchClasses(placed)).toEqual([5, 9, 0, 4]);
		expect(offsets(placed)).toEqual([[2, 1], [17, 8], [9, 4], [19, 8]]);
		expect(chords(placed.harmony)).toEqual(['Gmin7@0/1x1/1', 'C7@1/1x1/1', 'Fmaj7@2/1x2/1']);
		expect(placed.key).toBe('F');
		expect(placed.mode).toBe('major');
		expect(lickBarsInProgression(lick, 'ii-V-I-major-long')).toBe(4);
	});

	it('reads a minor-chord lick over the minor vamp in the minor mode, rooted on the key', () => {
		const placed = placeLickInProgression(userLick({ category: 'minor-chord' }), 'D', 'minor-vamp');

		expect(pitchClasses(placed)).toEqual([2, 6, 9, 1]);
		expect(chords(placed.harmony)).toEqual(['Dmin7@0/1x2/1']);
		expect(placed.mode).toBe('minor');
	});

	it("replaces the lick's own stored chords with the progression's", () => {
		const lick = userLick({
			category: 'bebop-lines',
			harmony: [{ chord: { root: 'C', quality: '7' }, scaleId: 'blues.minor', startOffset: [0, 1], duration: [1, 1] }]
		});
		const placed = placeLickInProgression(lick, 'C', 'major-vamp');
		expect(chords(placed.harmony)).toEqual(['Cmaj7@0/1x2/1']);
	});

	it('sustains the resolution chord through a line longer than the cycle', () => {
		const threeBars: Note[] = Array.from({ length: 12 }, (_, i) => ({
			pitch: 60 + (i % 5),
			duration: [1, 4],
			offset: [i, 4]
		}));
		const lick = userLick({
			category: 'bebop-lines',
			notes: threeBars,
			difficulty: { level: 30, pitchComplexity: 30, rhythmComplexity: 20, lengthBars: 3 }
		});
		const placed = placeLickInProgression(lick, 'C', 'ii-V-I-major');
		expect(lickBarsInProgression(lick, 'ii-V-I-major')).toBe(3);
		expect(chords(placed.harmony)).toEqual(['Dmin7@0/1x1/2', 'G7@1/2x1/2', 'Cmaj7@1/1x2/1']);
	});

	it('lets a V-I lick with a one-bar pickup keep its downbeat on the I', () => {
		// Pickup on beat 4 of bar 0, the line proper from the bar-1 downbeat:
		// the category's bar-1 alignment is pulled back by the pickup bar.
		const lick = userLick({
			category: 'V-I-major',
			notes: [
				{ pitch: 62, duration: [1, 4], offset: [3, 4] },
				{ pitch: 60, duration: [1, 2], offset: [1, 1] },
				{ pitch: 64, duration: [1, 2], offset: [3, 2] }
			],
			difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 2 }
		});
		const placed = placeLickInProgression(lick, 'C', 'ii-V-I-major-long');
		expect(offsets(placed)).toEqual([[3, 4], [1, 1], [3, 2]]);
		expect(chords(placed.harmony)).toEqual(['Dmin7@0/1x1/1', 'G7@1/1x1/1', 'Cmaj7@2/1x2/1']);
	});
});

describe('melodyWindow — what Listen plays', () => {
	it('starts at the first sounding bar and keeps only the chords under the line', () => {
		// A major-chord lick two bars into the long ii-V-I: Listen must not
		// sit silent through Gm7 and C7, nor run on through a 4-bar harmony.
		const placed = placeLickInProgression(userLick({ category: 'major-chord' }), 'F', 'ii-V-I-major-long');
		const window = melodyWindow(placed);
		expect(offsets(window)).toEqual([[0, 1], [1, 8], [1, 4], [3, 8]]);
		expect(chords(window.harmony)).toEqual(['Fmaj7@0/1x1/1']);
	});

	it('returns a line that opens the cycle and fills it as itself', () => {
		const twoBars: Note[] = Array.from({ length: 8 }, (_, i) => ({ pitch: 60 + (i % 5), duration: [1, 4], offset: [i, 4] }));
		const lick = userLick({
			category: 'bebop-lines',
			notes: twoBars,
			difficulty: { level: 30, pitchComplexity: 30, rhythmComplexity: 20, lengthBars: 2 }
		});
		const placed = placeLickInProgression(lick, 'C', 'major-vamp');
		expect(melodyWindow(placed)).toBe(placed);
	});

	it('cuts a two-bar vamp down to the one bar the line fills', () => {
		const placed = placeLickInProgression(userLick({ category: 'major-chord' }), 'C', 'major-vamp');
		expect(chords(melodyWindow(placed).harmony)).toEqual(['Cmaj7@0/1x1/1']);
	});

	it('drops a trailing rest past the window, which would otherwise pad the preview with silence (CodeRabbit, PR #280)', () => {
		const lick = userLick({
			category: 'major-chord',
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: null, duration: [1, 4], offset: [1, 1] }
			]
		});
		const window = melodyWindow(placeLickInProgression(lick, 'C', 'major-vamp'));
		expect(window.notes.map((n) => [n.pitch === null ? 'rest' : 'note', fractionToFloat(n.offset)])).toEqual([
			['note', 0]
		]);
	});
});

describe('primaryProgressionForLick — the first pill the lick fits', () => {
	const major = userLick({ category: 'major-chord' });

	it('follows the pill order, not the order the tags were added', () => {
		expect(primaryProgressionForLick(major, ['ii-V-I-major', 'major-vamp'])).toBe('major-vamp');
		expect(primaryProgressionForLick(major, ['major-vamp', 'ii-V-I-major'])).toBe('major-vamp');
	});

	it('skips a stale tag the lick does not fit', () => {
		expect(primaryProgressionForLick(major, ['minor-vamp', 'turnaround'])).toBe('turnaround');
	});

	it("falls back to the first progression the lick's category is at home in", () => {
		expect(primaryProgressionForLick(major, [])).toBe('major-vamp');
		expect(primaryProgressionForLick(userLick({ category: 'dominant-chord' }), [])).toBe('dominant-vamp');
	});

	it('picks the template a cadence lick with chords actually fits', () => {
		const cadence = userLick({
			category: 'ii-V-I-major',
			harmony: [
				{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 1] },
				{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 1], duration: [1, 1] },
				{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [2, 1], duration: [2, 1] }
			],
			difficulty: { level: 30, pitchComplexity: 30, rhythmComplexity: 20, lengthBars: 4 }
		});
		expect(primaryProgressionForLick(cadence, [])).toBe('ii-V-I-major-long');
	});

	it('has none for an untagged lick whose category has no progression home', () => {
		expect(primaryProgressionForLick(userLick({ category: 'user' }), [])).toBeNull();
		expect(primaryProgressionForLick(userLick({ category: 'bebop-lines' }), [])).toBeNull();
	});
});

describe('parity with the session', () => {
	beforeEach(() => {
		store.clear();
		lickPractice.progress = {};
		lickPractice.plan = [];
		lickPractice.config.practiceMode = 'continuous';
		lickPractice.config.enableSubstitutions = false;
		lickPractice.config.singleLickId = undefined;
	});

	it('engraves on the detail page exactly the phrase Deep Practice builds for that key', () => {
		const lick = getLickById('major-chord-001')!;
		expect(startSingleLickSession(lick)).toBe(true);
		const item = lickPractice.plan[0];
		const key = item.keys[0];
		const instrument = getInstrument();

		const placed = placeLickInProgression(lick, key, item.progressionType, {
			rangeLow: instrument.concertRangeLow,
			rangeHigh: getEffectiveHighestNote(),
			transposition: instrument.transpositionSemitones
		});
		expect(placed).toEqual(getPhraseFor(0, 0));
	});
});

describe('detail-page modes (CodeRabbit on PR #280): the key selector labels the CHART, the progress labels the LICK', () => {
	const statedMajor = userLick({ category: 'dominant-chord', mode: 'major' });
	const statedMinor = userLick({ category: 'major-chord', mode: 'minor' });
	const unstated = userLick({ category: 'minor-chord', mode: undefined });

	it('the chart over a minor progression is minor whatever the lick states — "Play in D-" names what is drawn', () => {
		expect(chartModeForLick(statedMajor, 'minor-vamp')).toBe('minor');
		expect(chartModeForLick(statedMinor, 'major-vamp')).toBe('major');
	});

	it("without a progression the chart is the lick's own: its stated mode, else its chords' reading", () => {
		expect(chartModeForLick(statedMinor, null)).toBe('minor');
		expect(chartModeForLick(unstated, null)).toBe('major');
	});

	it("the progress labels keep the player's stated mode over the progression's, and borrow it only when unstated", () => {
		expect(lickLabelMode(statedMajor, 'minor-vamp')).toBe('major');
		expect(lickLabelMode(statedMinor, 'major-vamp')).toBe('minor');
		expect(lickLabelMode(unstated, 'minor-vamp')).toBe('minor');
		expect(lickLabelMode(unstated, null)).toBe('major');
	});
});
