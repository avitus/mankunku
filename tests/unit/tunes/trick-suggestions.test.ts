import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Fraction, Phrase, PitchClass } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { TrickPracticeProgress } from '$lib/types/tricks';
import type { DetectedProgression } from '$lib/tunes/progression-detector';
import { scaleDegreeOf } from '$lib/music/scale-degree';
import {
	getCompatibleLickCategories,
	getLickAlignmentOffset,
	resolveQualityRoleEntry
} from '$lib/data/progressions';
import { suggestLicksForProgression, type LickMatcherDeps } from '$lib/tunes/lick-matcher';
import { baseLickId } from '$lib/phrases/library-loader';
import { getTrickById } from '$lib/tricks';
import { getVariantsForTrick } from '$lib/tricks/mastery';
import { makePhrase } from '../../helpers/lick-builders';

// Mock localStorage (same pattern as lick-matcher.test.ts) — the matcher's
// pure core never touches it, but the imported store modules must not blow
// up in Node if a code path ever reaches for it.
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => {
		store[key] = value;
	}),
	removeItem: vi.fn((key: string) => {
		delete store[key];
	}),
	clear: vi.fn(() => {
		for (const key of Object.keys(store)) delete store[key];
	}),
	get length() {
		return Object.keys(store).length;
	},
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
});

// Pinned mastery-ladder positions (contract e1/e2 and the t-stage families).
const E1 = getVariantsForTrick('enclosures')[0];
const E2 = getVariantsForTrick('enclosures')[1];
const T1 = getVariantsForTrick('triad-pairs')[0]; // major-whole — broad (maj + dom)
const T2 = getVariantsForTrick('triad-pairs')[1]; // major-minor — major only
const T4 = getVariantsForTrick('triad-pairs')[3]; // major-tritone — natural-5 dominants
const T5 = getVariantsForTrick('triad-pairs')[4]; // minor-b9 — altered dominants
const T7 = getVariantsForTrick('triad-pairs')[6]; // aug-major — tonic minor

const TRICK_PREFIX = 'trick-suggestion:';

function trickSuggestions(result: ReturnType<typeof suggestLicksForProgression>) {
	return result.suggestions.filter((s) => s.lickId.startsWith(TRICK_PREFIX));
}

function makeDeps(
	args: {
		licks?: Phrase[];
		trickProgress?: TrickPracticeProgress;
		selectedTrickVariants?: ReadonlySet<string>;
		practiceLickIds?: Set<string>;
		getTrickUnlockedKeyCount?: (variantKey: string) => number;
	} = {}
): LickMatcherDeps {
	return {
		licks: args.licks ?? [],
		timeSignature: [4, 4],
		progress: {},
		getProgressionTags: () => [],
		getUnlockedKeyCount: () => 1,
		practiceLickIds: args.practiceLickIds ?? new Set(),
		trickProgress: args.trickProgress,
		selectedTrickVariants: args.selectedTrickVariants,
		getTrickUnlockedKeyCount: args.getTrickUnlockedKeyCount
	};
}

/** Minimal one-slot vamp detection at an absolute tune bar. */
function vampDetection(
	type: ChordProgressionType,
	localKey: PitchClass,
	startBar = 4
): DetectedProgression {
	const startOffset: Fraction = [startBar, 1];
	return {
		type,
		slots: [{ templateOffset: [0, 1], segmentIndices: [0], startOffset }],
		segmentIndices: [0],
		localKey,
		tuneKeyDegree: scaleDegreeOf(localKey, 'C'),
		startOffset,
		duration: [2, 1],
		startBar,
		endBarExclusive: startBar + 2,
		wrapsAround: false
	};
}

/** Short ii-V-I detection whose slots mirror the template offsets [0,1]/[1,2]/[1,1]. */
function shortIiVIDetection(localKey: PitchClass, startBar: number): DetectedProgression {
	return {
		type: 'ii-V-I-major',
		slots: [
			{ templateOffset: [0, 1], segmentIndices: [0], startOffset: [startBar, 1] },
			{ templateOffset: [1, 2], segmentIndices: [1], startOffset: [2 * startBar + 1, 2] },
			{ templateOffset: [1, 1], segmentIndices: [2], startOffset: [startBar + 1, 1] }
		],
		segmentIndices: [0, 1, 2],
		localKey,
		tuneKeyDegree: scaleDegreeOf(localKey, 'C'),
		startOffset: [startBar, 1],
		duration: [2, 1],
		startBar,
		endBarExclusive: startBar + 2,
		wrapsAround: false
	};
}

/** Long ii-V-I detection whose slots mirror the template offsets [0,1]/[1,1]/[2,1]. */
function longIiVIDetection(
	type: 'ii-V-I-major-long' | 'ii-V-I-minor-long',
	localKey: PitchClass,
	startBar: number
): DetectedProgression {
	return {
		type,
		slots: [
			{ templateOffset: [0, 1], segmentIndices: [0], startOffset: [startBar, 1] },
			{ templateOffset: [1, 1], segmentIndices: [1], startOffset: [startBar + 1, 1] },
			{ templateOffset: [2, 1], segmentIndices: [2], startOffset: [startBar + 2, 1] }
		],
		segmentIndices: [0, 1, 2],
		localKey,
		tuneKeyDegree: scaleDegreeOf(localKey, 'C'),
		startOffset: [startBar, 1],
		duration: [4, 1],
		startBar,
		endBarExclusive: startBar + 4,
		wrapsAround: false
	};
}

describe('PROGRESSION_LICK_CATEGORIES trick registrations', () => {
	it('registers the pinned trick categories per progression', () => {
		// triad-pairs is registered on minor progressions too — the per-family
		// quality gate decides which families actually surface there.
		for (const type of [
			'major-vamp', 'minor-vamp', 'dominant-vamp',
			'ii-V-I-major', 'ii-V-I-minor', 'ii-V-I-major-long', 'ii-V-I-minor-long'
		] as const) {
			expect(getCompatibleLickCategories(type)).toContain('enclosures');
			expect(getCompatibleLickCategories(type)).toContain('triad-pairs');
		}
	});

	it('leaves unregistered progressions trick-free', () => {
		for (const type of ['turnaround', 'iii-VI-ii-V-I', 'blues'] as const) {
			expect(getCompatibleLickCategories(type)).not.toContain('enclosures');
			expect(getCompatibleLickCategories(type)).not.toContain('triad-pairs');
		}
	});

	it('mirrors the chord-quality offsets (tricks target the I bar of a ii-V-I)', () => {
		expect(getLickAlignmentOffset('major-vamp', 'enclosures')).toEqual([0, 1]);
		expect(getLickAlignmentOffset('minor-vamp', 'triad-pairs')).toEqual([0, 1]);
		expect(getLickAlignmentOffset('dominant-vamp', 'triad-pairs')).toEqual([0, 1]);
		expect(getLickAlignmentOffset('ii-V-I-major', 'enclosures')).toEqual([1, 1]);
		expect(getLickAlignmentOffset('ii-V-I-major', 'triad-pairs')).toEqual([1, 1]);
		expect(getLickAlignmentOffset('ii-V-I-minor', 'enclosures')).toEqual([1, 1]);
		expect(getLickAlignmentOffset('ii-V-I-minor', 'triad-pairs')).toEqual([1, 1]);
		expect(getLickAlignmentOffset('ii-V-I-major-long', 'enclosures')).toEqual([2, 1]);
		expect(getLickAlignmentOffset('ii-V-I-major-long', 'triad-pairs')).toEqual([2, 1]);
		expect(getLickAlignmentOffset('ii-V-I-minor-long', 'enclosures')).toEqual([2, 1]);
		expect(getLickAlignmentOffset('ii-V-I-minor-long', 'triad-pairs')).toEqual([2, 1]);
	});

	it('ranks trick categories after native categories (list-position specificity)', () => {
		const cats = getCompatibleLickCategories('major-vamp');
		expect(cats.indexOf('enclosures')).toBeGreaterThan(cats.indexOf('major-chord'));
		const longCats = getCompatibleLickCategories('ii-V-I-major-long');
		expect(longCats.indexOf('triad-pairs')).toBeGreaterThan(longCats.indexOf('major-chord'));
	});

	it('resolveQualityRoleEntry honours caller order and the full-bar guard', () => {
		// Caller's quality order wins: maj7-first takes the I bar of a long
		// ii-V-I, 7-first takes the V bar.
		expect(resolveQualityRoleEntry('ii-V-I-major-long', ['maj7', '7'])).toEqual({
			category: 'major-chord',
			offset: [2, 1]
		});
		expect(resolveQualityRoleEntry('ii-V-I-major-long', ['7', 'maj7'])).toEqual({
			category: 'dominant-chord',
			offset: [1, 1]
		});
		// No matching quality anywhere → null.
		expect(resolveQualityRoleEntry('major-vamp', ['min7'])).toBeNull();
		// iii-VI-ii-V-I's iii and VI7 span half a bar each — too short for a
		// one-bar device cell — while its full-bar maj7 I still resolves.
		expect(resolveQualityRoleEntry('iii-VI-ii-V-I', ['7'])).toBeNull();
		expect(resolveQualityRoleEntry('iii-VI-ii-V-I', ['min7'])).toBeNull();
		expect(resolveQualityRoleEntry('iii-VI-ii-V-I', ['maj7'])).toEqual({
			category: 'major-chord',
			offset: [2, 1]
		});
	});
});

describe('suggestLicksForProgression — trick suggestions', () => {
	it('produces zero trick suggestions when no variants are selected, licks unchanged', () => {
		const lick = makePhrase({ id: 'l-maj', name: 'Major Chord Lick', category: 'major-chord' });
		const noDeps = makeDeps({ licks: [lick] });
		const emptyDeps = makeDeps({ licks: [lick], selectedTrickVariants: new Set() });
		for (const deps of [noDeps, emptyDeps]) {
			const result = suggestLicksForProgression(vampDetection('major-vamp', 'F'), deps);
			expect(trickSuggestions(result)).toHaveLength(0);
			expect(result.suggestions.map((s) => s.lickId)).toEqual(['l-maj']);
			expect(result.suggestions[0].targetKey).toBe('F');
		}
	});

	it('yields one full suggestion for a selected enclosures variant over a major vamp', () => {
		const result = suggestLicksForProgression(
			vampDetection('major-vamp', 'F'),
			makeDeps({ selectedTrickVariants: new Set([E1.key]) })
		);
		expect(result.suggestions).toHaveLength(1);
		const s = result.suggestions[0];
		expect(s.lickId).toBe(`${TRICK_PREFIX}${E1.key}`);
		expect(s.lickName).toBe(`${getTrickById('enclosures')!.name} · ${E1.label}`);
		expect(s.category).toBe('enclosures');
		expect(s.targetKey).toBe('F'); // non-chord-quality category → localKey
		expect(s.insertionOffset).toEqual([4, 1]);
		expect(s.insertionBar).toBe(4);
		expect(s.templateAlignmentOffset).toEqual([0, 1]);
		expect(s.masteryTier).toBe('unknown');
		expect(s.matchSources).toEqual(['category']);
		expect(s.substitution).toBeNull();
		expect(s.inPracticeSet).toBe(true);

		// Trick payload + generated example, already in the target key.
		expect(s.trick).toEqual({
			trickId: 'enclosures',
			parameters: E1.params,
			context: {
				chordRoot: 'F',
				chordQuality: 'maj7',
				scaleId: 'major.ionian',
				key: 'F',
				timeSignature: [4, 4],
				level: 50,
				tempo: 120,
				swing: 0.5
			}
		});
		expect(s.phrase).toBeDefined();
		expect(s.phrase!.key).toBe('F');
		expect(s.phrase!.harmony[0].chord.root).toBe('F');
		expect(s.phrase!.notes.some((n) => n.pitch !== null)).toBe(true);
		expect(s.difficultyLevel).toBe(s.phrase!.difficulty.level);
	});

	it('aligns to the I chord of a short ii-V-I through the matching slot', () => {
		const result = suggestLicksForProgression(
			shortIiVIDetection('Bb', 8),
			makeDeps({ selectedTrickVariants: new Set([E1.key]) })
		);
		expect(result.suggestions).toHaveLength(1);
		const s = result.suggestions[0];
		expect(s.templateAlignmentOffset).toEqual([1, 1]);
		expect(s.insertionOffset).toEqual([9, 1]);
		expect(s.insertionBar).toBe(9);
		expect(s.targetKey).toBe('Bb');
		expect(s.trick!.context.chordRoot).toBe('Bb');
		expect(s.trick!.context.chordQuality).toBe('maj7');
		expect(s.trick!.context.scaleId).toBe('major.ionian');
	});

	it('skips variants the progression does not admit (registration or quality gate)', () => {
		// blues registers no trick categories at all.
		const blues = suggestLicksForProgression(
			vampDetection('blues', 'C', 0),
			makeDeps({ selectedTrickVariants: new Set([E1.key, T1.key]) })
		);
		expect(trickSuggestions(blues)).toHaveLength(0);
		// minor-vamp registers triad-pairs, but the major-whole family's
		// qualities (maj7/maj6/7) have no match on a min7 vamp → quality gate.
		const minor = suggestLicksForProgression(
			vampDetection('minor-vamp', 'D'),
			makeDeps({ selectedTrickVariants: new Set([E1.key, T1.key]) })
		);
		const ids = trickSuggestions(minor).map((s) => s.lickId);
		expect(ids).toEqual([`${TRICK_PREFIX}${E1.key}`]);
	});

	it('derives masteryTier from trick progress: known / learning / unknown', () => {
		const detect = () => vampDetection('major-vamp', 'F');
		const tier = (
			trickProgress?: TrickPracticeProgress,
			getTrickUnlockedKeyCount?: (variantKey: string) => number
		) =>
			suggestLicksForProgression(
				detect(),
				makeDeps({ selectedTrickVariants: new Set([E1.key]), trickProgress, getTrickUnlockedKeyCount })
			).suggestions[0].masteryTier;

		expect(tier(undefined)).toBe('unknown');
		expect(tier({})).toBe('unknown');
		// Progress in another key is only learning when the unlock ramp from the
		// pinned 'C' entry key reaches the target (the classifyMasteryTier rule);
		// with the default unlock count of 1 the ramp is just [C] → unknown in F.
		expect(tier({ [E1.key]: { C: { currentTempo: 80, lastPracticedAt: 1, passCount: 2 } } })).toBe(
			'unknown'
		);
		// Ramp covers F (C, G, F at 3 unlocks) → learning.
		expect(
			tier({ [E1.key]: { C: { currentTempo: 80, lastPracticedAt: 1, passCount: 2 } } }, () => 3)
		).toBe('learning');
		// Attempted at the target key without a pass is learning regardless of ramp.
		expect(tier({ [E1.key]: { F: { currentTempo: 80, lastPracticedAt: 1, passCount: 0 } } })).toBe(
			'learning'
		);
		// A pass at the target key reads known.
		expect(tier({ [E1.key]: { F: { currentTempo: 80, lastPracticedAt: 1, passCount: 1 } } })).toBe(
			'known'
		);
	});

	it('a variant practiced only in C is unknown in Db until the unlock ramp reaches it', () => {
		const progress: TrickPracticeProgress = {
			[E1.key]: { C: { currentTempo: 80, lastPracticedAt: 1, passCount: 2 } }
		};
		const tierInDb = (unlocked: number) =>
			suggestLicksForProgression(
				vampDetection('major-vamp', 'Db'),
				makeDeps({
					selectedTrickVariants: new Set([E1.key]),
					trickProgress: progress,
					getTrickUnlockedKeyCount: () => unlocked
				})
			).suggestions[0].masteryTier;

		// Db is the 11th key on the alternating circle-of-fifths ramp from C.
		expect(tierInDb(1)).toBe('unknown');
		expect(tierInDb(10)).toBe('unknown');
		expect(tierInDb(11)).toBe('learning');

		// unknown tier → playableKeysOnly filters it out entirely.
		const filtered = suggestLicksForProgression(
			vampDetection('major-vamp', 'Db'),
			makeDeps({
				selectedTrickVariants: new Set([E1.key]),
				trickProgress: progress,
				getTrickUnlockedKeyCount: () => 1
			}),
			{ playableKeysOnly: true }
		);
		expect(filtered.suggestions).toHaveLength(0);
	});

	it('applies playableKeysOnly to trick suggestions (unknown tier drops)', () => {
		const unknown = suggestLicksForProgression(
			vampDetection('major-vamp', 'F'),
			makeDeps({ selectedTrickVariants: new Set([E1.key]) }),
			{ playableKeysOnly: true }
		);
		expect(unknown.suggestions).toHaveLength(0);

		const learning = suggestLicksForProgression(
			vampDetection('major-vamp', 'F'),
			makeDeps({
				selectedTrickVariants: new Set([E1.key]),
				trickProgress: { [E1.key]: { C: { currentTempo: 80, lastPracticedAt: 1, passCount: 1 } } },
				// Ramp must reach F for cross-key progress to count as learning.
				getTrickUnlockedKeyCount: () => 3
			}),
			{ playableKeysOnly: true }
		);
		expect(learning.suggestions).toHaveLength(1);
	});

	it('filters on sessionTempo against the trick tempo capability', () => {
		const run = (trickProgress?: TrickPracticeProgress) =>
			suggestLicksForProgression(
				vampDetection('major-vamp', 'F'),
				makeDeps({ selectedTrickVariants: new Set([E1.key]), trickProgress }),
				{ sessionTempo: 100 }
			);

		// No progress → default trick tempo 60 < 100 → dropped.
		expect(run(undefined).suggestions).toHaveLength(0);
		// At-key tempo clears the bar → kept, and the context carries the session tempo.
		const atKey = run({ [E1.key]: { F: { currentTempo: 120, lastPracticedAt: 1, passCount: 1 } } });
		expect(atKey.suggestions).toHaveLength(1);
		expect(atKey.suggestions[0].trick!.context.tempo).toBe(100);
		// Target key untouched → falls back to the variant-wide minimum.
		const fallback = run({
			[E1.key]: { C: { currentTempo: 120, lastPracticedAt: 1, passCount: 1 } }
		});
		expect(fallback.suggestions).toHaveLength(1);
		// A slow at-key entry drops it even though another key is fast.
		const slowAtKey = run({
			[E1.key]: {
				F: { currentTempo: 90, lastPracticedAt: 1, passCount: 1 },
				C: { currentTempo: 140, lastPracticedAt: 1, passCount: 1 }
			}
		});
		expect(slowAtKey.suggestions).toHaveLength(0);
	});

	it('keeps distinct variants of the same trick through dedupe', () => {
		expect(baseLickId(`${TRICK_PREFIX}${E1.key}`)).toBe(`${TRICK_PREFIX}${E1.key}`);
		expect(baseLickId(`${TRICK_PREFIX}${E2.key}`)).toBe(`${TRICK_PREFIX}${E2.key}`);

		const result = suggestLicksForProgression(
			vampDetection('major-vamp', 'F'),
			makeDeps({ selectedTrickVariants: new Set([E1.key, E2.key]) })
		);
		const ids = trickSuggestions(result).map((s) => s.lickId);
		expect(ids).toHaveLength(2);
		expect(new Set(ids)).toEqual(
			new Set([`${TRICK_PREFIX}${E1.key}`, `${TRICK_PREFIX}${E2.key}`])
		);
	});

	it('ranks trick suggestions after a same-tier native-category lick', () => {
		// Tricks always report inPracticeSet, so the lick joins the practice set
		// too — leaving category specificity (native first) as the deciding key.
		const lick = makePhrase({ id: 'l-maj', name: 'ZZ Major Lick', category: 'major-chord' });
		const result = suggestLicksForProgression(
			vampDetection('major-vamp', 'F'),
			makeDeps({
				licks: [lick],
				selectedTrickVariants: new Set([E1.key]),
				practiceLickIds: new Set(['l-maj'])
			})
		);
		expect(result.suggestions.map((s) => s.lickId)).toEqual([
			'l-maj',
			`${TRICK_PREFIX}${E1.key}`
		]);
	});
});

describe('per-family quality gating (triad pairs)', () => {
	it('the broad family rides a dominant vamp; the major-only family does not', () => {
		const result = suggestLicksForProgression(
			vampDetection('dominant-vamp', 'Bb'),
			makeDeps({ selectedTrickVariants: new Set([T1.key, T2.key]) })
		);
		const ids = trickSuggestions(result).map((s) => s.lickId);
		expect(ids).toEqual([`${TRICK_PREFIX}${T1.key}`]);
		const s = result.suggestions[0];
		expect(s.targetKey).toBe('Bb');
		expect(s.templateAlignmentOffset).toEqual([0, 1]);
		expect(s.trick!.context.chordQuality).toBe('7');
		expect(s.trick!.context.scaleId).toBe('major.mixolydian');
	});

	it('the altered family surfaces on a dominant vamp but never on a major one', () => {
		const dom = suggestLicksForProgression(
			vampDetection('dominant-vamp', 'F'),
			makeDeps({ selectedTrickVariants: new Set([T5.key]) })
		);
		expect(trickSuggestions(dom).map((s) => s.lickId)).toEqual([`${TRICK_PREFIX}${T5.key}`]);

		const maj = suggestLicksForProgression(
			vampDetection('major-vamp', 'F'),
			makeDeps({ selectedTrickVariants: new Set([T5.key]) })
		);
		expect(trickSuggestions(maj)).toHaveLength(0);
	});

	it('dominant families re-root on the V bar of a long major ii-V-I; major families take the I', () => {
		const result = suggestLicksForProgression(
			longIiVIDetection('ii-V-I-major-long', 'C', 8),
			makeDeps({ selectedTrickVariants: new Set([T2.key, T4.key]) })
		);
		const byId = new Map(trickSuggestions(result).map((s) => [s.lickId, s]));
		const tritone = byId.get(`${TRICK_PREFIX}${T4.key}`)!;
		expect(tritone.templateAlignmentOffset).toEqual([1, 1]);
		expect(tritone.insertionOffset).toEqual([9, 1]);
		expect(tritone.targetKey).toBe('G');
		expect(tritone.trick!.context.chordRoot).toBe('G');
		expect(tritone.trick!.context.chordQuality).toBe('7');
		expect(tritone.phrase!.key).toBe('G');
		const diatonic = byId.get(`${TRICK_PREFIX}${T2.key}`)!;
		expect(diatonic.templateAlignmentOffset).toEqual([2, 1]);
		expect(diatonic.insertionOffset).toEqual([10, 1]);
		expect(diatonic.targetKey).toBe('C');
		expect(diatonic.trick!.context.chordQuality).toBe('maj7');
	});

	it('the minor-long V (7alt) admits the altered family but not the tritone pair', () => {
		const result = suggestLicksForProgression(
			longIiVIDetection('ii-V-I-minor-long', 'C', 4),
			makeDeps({ selectedTrickVariants: new Set([T4.key, T5.key, T7.key]) })
		);
		const byId = new Map(trickSuggestions(result).map((s) => [s.lickId, s]));
		// major-tritone keeps its natural 5 — no place on an altered V.
		expect(byId.has(`${TRICK_PREFIX}${T4.key}`)).toBe(false);
		const altered = byId.get(`${TRICK_PREFIX}${T5.key}`)!;
		expect(altered.templateAlignmentOffset).toEqual([1, 1]);
		expect(altered.targetKey).toBe('G');
		expect(altered.trick!.context.chordQuality).toBe('7alt');
		expect(altered.trick!.context.scaleId).toBe('melodic-minor.altered');
		// The tonic-minor family lands on the min7 I bar.
		const tonic = byId.get(`${TRICK_PREFIX}${T7.key}`)!;
		expect(tonic.templateAlignmentOffset).toEqual([2, 1]);
		expect(tonic.targetKey).toBe('C');
		expect(tonic.trick!.context.chordQuality).toBe('min7');
	});

	it('the tonic-minor family surfaces on a minor vamp', () => {
		const result = suggestLicksForProgression(
			vampDetection('minor-vamp', 'D'),
			makeDeps({ selectedTrickVariants: new Set([T7.key]) })
		);
		const ids = trickSuggestions(result).map((s) => s.lickId);
		expect(ids).toEqual([`${TRICK_PREFIX}${T7.key}`]);
		expect(result.suggestions[0].targetKey).toBe('D');
		expect(result.suggestions[0].trick!.context.chordQuality).toBe('min7');
	});
});
