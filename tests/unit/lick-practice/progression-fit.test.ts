/**
 * A lick is offered, seeded, picked and served only over progressions whose
 * chord SHAPE fits its own — the fix for "my ii-V-i lick is served over
 * nonsensical progressions" (2026-08-22): a 3-bar minor ii-V-i was admitted
 * to the SHORT template, where ii and V are half-bars and the cadence is over
 * by beat 4 while the lick is still on its ii. The rule is category-aware:
 * cadence licks match segment-by-segment against the template at their
 * alignment offset, harmony-less cadence licks need a native entry that is
 * long enough, chord-quality licks need the right chord family in their
 * slot, and everything else honours the user's explicit tag (unless an
 * EXPLICIT mode contradicts the slot).
 */
import { describe, it, expect } from 'vitest';
import {
	PROGRESSION_TEMPLATES,
	PROGRESSION_LICK_CATEGORIES,
	CADENCE_CATEGORIES,
	progressionFitsLick,
	fittingProgressionsForLick,
	getProgressionsForLick,
	fitReasonLabel,
	isChordQualityCategory
} from '$lib/data/progressions';
import { ALL_CURATED_LICKS } from '$lib/data/licks';
import { fractionToFloat } from '$lib/music/intervals';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { Phrase, PhraseCategory } from '$lib/types/music';

const ALL_TYPES = Object.keys(PROGRESSION_TEMPLATES) as ChordProgressionType[];

function userLick(category: PhraseCategory, over: Partial<Phrase> = {}): Phrase {
	return {
		id: `u-${category}`,
		name: 'user lick',
		timeSignature: [4, 4],
		key: 'C',
		notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }],
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category,
		tags: [],
		source: 'user-entered',
		...over
	};
}

/** Shape class of a curated cadence lick from its own harmony. */
function shapeOf(lick: Phrase): string {
	const durs = lick.harmony.map((s) => fractionToFloat(s.duration));
	if (lick.category.startsWith('short-')) return 'short';
	if (lick.category.startsWith('V-I')) return 'V-I';
	if (durs.length === 3 && durs[0] === 1 && durs[1] === 1) return 'full';
	if (durs.length === 3 && durs[0] === 0.5 && durs[1] === 0.5) return 'half';
	return 'other';
}

const EXPECTED: Record<string, ChordProgressionType[]> = {
	'ii-V-I-minor/full': ['ii-V-I-minor-long'],
	'ii-V-I-minor/half': ['ii-V-I-minor'],
	'short-ii-V-I-minor/short': ['ii-V-I-minor'],
	'V-I-minor/V-I': ['ii-V-I-minor-long'],
	'ii-V-I-major/full': ['ii-V-I-major-long'],
	'ii-V-I-major/half': ['ii-V-I-major', 'iii-VI-ii-V-I'],
	'short-ii-V-I-major/short': ['ii-V-I-major'],
	'V-I-major/V-I': ['ii-V-I-major-long']
};

describe('cadence licks (curated, table-driven over every template)', () => {
	const cadenceLicks = ALL_CURATED_LICKS.filter(
		(l) => CADENCE_CATEGORIES.has(l.category) && l.source === 'curated'
	);

	it('covers every shape class', () => {
		const seen = new Set(cadenceLicks.map((l) => `${l.category}/${shapeOf(l)}`));
		for (const k of Object.keys(EXPECTED)) expect(seen.has(k), k).toBe(true);
		for (const k of seen) expect(EXPECTED[k], `unclassified shape ${k}`).toBeDefined();
	});

	it('fits exactly the templates whose chord geometry matches the lick', () => {
		for (const lick of cadenceLicks) {
			const key = `${lick.category}/${shapeOf(lick)}`;
			expect(fittingProgressionsForLick(lick), `${lick.id} (${key})`).toEqual(EXPECTED[key]);
		}
	});

	it('names the mismatch: the short template is the wrong SHAPE for a 3-bar ii-V-i, a vamp too', () => {
		const full = ALL_CURATED_LICKS.find((l) => l.id === 'ii-V-I-min-001')!;
		expect(progressionFitsLick(full, 'ii-V-I-minor-long')).toEqual({ fits: true });
		expect(progressionFitsLick(full, 'ii-V-I-minor')).toEqual({ fits: false, reason: 'shape' });
		expect(progressionFitsLick(full, 'minor-vamp').fits).toBe(false);
		expect(progressionFitsLick(full, 'blues').fits).toBe(false);
		const half = ALL_CURATED_LICKS.find((l) => l.id === 'ii-V-I-min-006')!;
		expect(fittingProgressionsForLick(half)).toEqual(['ii-V-I-minor']);
	});

	it('getProgressionsForLick is the category set filtered by fit (the seeding set)', () => {
		const full = ALL_CURATED_LICKS.find((l) => l.id === 'ii-V-I-min-001')!;
		expect(getProgressionsForLick(full)).toEqual(['ii-V-I-minor-long']);
		const half = ALL_CURATED_LICKS.find((l) => l.id === 'ii-V-I-min-006')!;
		expect(getProgressionsForLick(half)).toEqual(['ii-V-I-minor']);
		const maj = ALL_CURATED_LICKS.find((l) => l.id === 'ii-V-I-maj-001')!;
		expect(getProgressionsForLick(maj)).toEqual(['ii-V-I-major-long']);
	});
});

describe('harmony-less cadence licks (editor licks) fall back to the native entry and length', () => {
	it('a 3-bar user ii-V-i fits only the long template; a 2-bar one fits both', () => {
		const three = userLick('ii-V-I-minor', { difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 3 } });
		expect(fittingProgressionsForLick(three)).toEqual(['ii-V-I-minor-long']);
		expect(progressionFitsLick(three, 'ii-V-I-minor')).toEqual({ fits: false, reason: 'length' });
		const two = userLick('ii-V-I-minor', { difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 2 } });
		expect(fittingProgressionsForLick(two)).toEqual(['ii-V-I-minor', 'ii-V-I-minor-long']);
	});

	it('a user short ii-V fits the short template only', () => {
		expect(fittingProgressionsForLick(userLick('short-ii-V-I-minor'))).toEqual(['ii-V-I-minor']);
		expect(progressionFitsLick(userLick('short-ii-V-I-minor'), 'blues')).toEqual({ fits: false, reason: 'shape' });
	});
});

describe('chord-quality licks need the right chord family in their slot', () => {
	it('every native entry in the category table passes', () => {
		for (const [type, entries] of Object.entries(PROGRESSION_LICK_CATEGORIES) as [ChordProgressionType, { category: PhraseCategory }[]][]) {
			for (const e of entries) {
				if (!isChordQualityCategory(e.category)) continue;
				expect(progressionFitsLick(userLick(e.category), type), `${e.category} on ${type}`).toEqual({ fits: true });
			}
		}
	});

	it('rejects a wrong-family slot with chord-role', () => {
		expect(progressionFitsLick(userLick('major-chord'), 'minor-vamp')).toEqual({ fits: false, reason: 'chord-role' });
		expect(progressionFitsLick(userLick('minor-chord'), 'blues')).toEqual({ fits: false, reason: 'chord-role' });
		expect(progressionFitsLick(userLick('diminished-chord'), 'major-vamp')).toEqual({ fits: false, reason: 'chord-role' });
	});
});

describe('everything else honours explicit intent', () => {
	it('non-cadence categories fit wherever they are tagged', () => {
		for (const type of ALL_TYPES) {
			expect(progressionFitsLick(userLick('pentatonic'), type).fits, type).toBe(true);
			expect(progressionFitsLick(userLick('rhythm-changes'), type).fits, type).toBe(true);
			expect(progressionFitsLick(userLick('user'), type).fits, type).toBe(true);
		}
	});

	it('an EXPLICIT mode can still veto a wrong-mode slot', () => {
		expect(progressionFitsLick(userLick('pentatonic'), 'major-vamp', { mode: 'minor' })).toEqual({ fits: false, reason: 'mode' });
		expect(progressionFitsLick(userLick('pentatonic'), 'minor-vamp', { mode: 'major' })).toEqual({ fits: false, reason: 'mode' });
		// Dominant slots accept both.
		expect(progressionFitsLick(userLick('pentatonic'), 'dominant-vamp', { mode: 'minor' }).fits).toBe(true);
		expect(progressionFitsLick(userLick('pentatonic'), 'major-vamp', { mode: null }).fits).toBe(true);
	});
});

describe('fitReasonLabel', () => {
	it('has copy for every reason', () => {
		for (const r of ['shape', 'length', 'chord-role', 'mode'] as const) {
			expect(fitReasonLabel(r).length).toBeGreaterThan(5);
		}
	});
});
