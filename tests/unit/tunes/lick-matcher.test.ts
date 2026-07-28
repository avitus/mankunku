import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChordProgressionType, LickPracticeProgress } from '$lib/types/lick-practice';
import type { Phrase } from '$lib/types/music';
import { flattenTune } from '$lib/tunes/flatten';
import { detectProgressions, type DetectedProgression } from '$lib/tunes/progression-detector';
import {
	buildLickMatcherDeps,
	classifyMasteryTier,
	suggestLicksForProgression,
	suggestLicksForTune,
	type LickMatcherDeps
} from '$lib/tunes/lick-matcher';
import { baseLickId, getAllLicks } from '$lib/phrases/library-loader';
import {
	saveLickPracticeProgress,
	saveUserLickTags,
	bumpUnlockedKeyCount
} from '$lib/persistence/lick-practice-store';
import { MANKUNKU_BLUES } from '$lib/data/tunes/mankunku-blues';
import { simpleSheet } from '../../helpers/tune-fixtures';
import { makePhrase } from '../../helpers/lick-builders';

// Mock localStorage (same pattern as tests/unit/lick-practice/persistence.test.ts)
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

function makeDeps(args: {
	licks: Phrase[];
	progTags?: Record<string, ChordProgressionType[]>;
	unlockCounts?: Record<string, number>;
	progress?: LickPracticeProgress;
	practiceLickIds?: Set<string>;
	timeSignature?: [number, number];
}): LickMatcherDeps {
	const progTags = args.progTags ?? {};
	const unlockCounts = args.unlockCounts ?? {};
	return {
		licks: args.licks,
		timeSignature: args.timeSignature ?? [4, 4],
		progress: args.progress ?? {},
		getProgressionTags: (id) => progTags[id] ?? [],
		getUnlockedKeyCount: (_progress, id) => unlockCounts[id] ?? 1,
		practiceLickIds: args.practiceLickIds ?? new Set()
	};
}

function detectShortInC(): DetectedProgression {
	const tune = simpleSheet();
	const dets = detectProgressions(flattenTune(tune), tune);
	const short = dets.find((d) => d.type === 'ii-V-I-major');
	if (!short) throw new Error('fixture should contain a short ii-V-I');
	return short;
}

function mankunkuDetections(): DetectedProgression[] {
	return detectProgressions(flattenTune(MANKUNKU_BLUES), MANKUNKU_BLUES);
}

describe('classifyMasteryTier', () => {
	const keyProgress = (passCount: number) => ({
		currentTempo: 100,
		lastPracticedAt: 1000,
		passCount
	});

	it('is known when the target key has at least one pass', () => {
		const progress: LickPracticeProgress = { l1: { G: keyProgress(1) } };
		expect(
			classifyMasteryTier({ progress, lickId: 'l1', entryKey: 'C', targetKey: 'G', unlockedCount: 2 })
		).toBe('known');
	});

	it('is learning when the target key was attempted but never passed', () => {
		const progress: LickPracticeProgress = { l1: { G: keyProgress(0) } };
		expect(
			classifyMasteryTier({ progress, lickId: 'l1', entryKey: 'C', targetKey: 'G', unlockedCount: 2 })
		).toBe('learning');
	});

	it('is learning for an untouched key inside the unlock ramp of a started lick', () => {
		// planUnlockedKeys(C, 3) = [C, G, F]
		const progress: LickPracticeProgress = { l1: { C: keyProgress(2) } };
		expect(
			classifyMasteryTier({ progress, lickId: 'l1', entryKey: 'C', targetKey: 'F', unlockedCount: 3 })
		).toBe('learning');
	});

	it('is unknown for a key outside the unlock ramp even when the lick was started', () => {
		const progress: LickPracticeProgress = { l1: { C: keyProgress(2) } };
		expect(
			classifyMasteryTier({ progress, lickId: 'l1', entryKey: 'C', targetKey: 'D', unlockedCount: 3 })
		).toBe('unknown');
	});

	it('is unknown for a never-practiced lick, even at its own entry key', () => {
		expect(
			classifyMasteryTier({ progress: {}, lickId: 'l1', entryKey: 'C', targetKey: 'C', unlockedCount: 1 })
		).toBe('unknown');
	});

	it('grandfathered 12-key licks read learning where unpassed and known where passed', () => {
		const allKeys: LickPracticeProgress['x'] = {};
		for (const key of ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const) {
			allKeys[key] = keyProgress(key === 'Eb' ? 3 : 0);
		}
		const progress: LickPracticeProgress = { l1: allKeys };
		expect(
			classifyMasteryTier({ progress, lickId: 'l1', entryKey: 'C', targetKey: 'B', unlockedCount: 12 })
		).toBe('learning');
		expect(
			classifyMasteryTier({ progress, lickId: 'l1', entryKey: 'C', targetKey: 'Eb', unlockedCount: 12 })
		).toBe('known');
	});
});

describe('suggestLicksForProgression — eligibility', () => {
	const licks = [
		makePhrase({ id: 'l-251', name: 'Major 251', category: 'ii-V-I-major' }),
		makePhrase({ id: 'l-short', name: 'Short 251', category: 'short-ii-V-I-major' }),
		makePhrase({ id: 'l-maj', name: 'Major Chord Lick', category: 'major-chord' }),
		makePhrase({ id: 'l-vi', name: 'V-I Lick', category: 'V-I-major' }),
		makePhrase({ id: 'l-blues', name: 'Blues Lick', category: 'blues' }),
		makePhrase({ id: 'l-ballad', name: 'Ballad Lick', category: 'ballad' }),
		makePhrase({ id: 'l-user-untagged', name: 'My Untagged', category: 'user' }),
		makePhrase({ id: 'l-user-tagged', name: 'User Tagged', category: 'user' }),
		makePhrase({ id: 'l-minor', name: 'Minor Chord Lick', category: 'minor-chord' })
	];
	const progTags: Record<string, ChordProgressionType[]> = {
		'l-ballad': ['ii-V-I-major'],
		'l-user-tagged': ['ii-V-I-major']
	};

	it('collects compatible categories and prog-tagged licks; flags uncategorized user licks', () => {
		const result = suggestLicksForProgression(detectShortInC(), makeDeps({ licks, progTags }));
		expect(result.suggestions.map((s) => s.lickId).sort()).toEqual(
			['l-251', 'l-ballad', 'l-maj', 'l-short', 'l-user-tagged'].sort()
		);
		expect(result.uncategorized.map((l) => l.id)).toEqual(['l-user-untagged']);
	});

	it('ranks explicit prog tags ahead of category matches, then by category specificity', () => {
		const result = suggestLicksForProgression(detectShortInC(), makeDeps({ licks, progTags }));
		expect(result.suggestions.map((s) => s.lickId)).toEqual([
			'l-ballad',
			'l-user-tagged',
			'l-251',
			'l-short',
			'l-maj'
		]);
	});

	it('a prog tag on an unrelated-category lick plays from the progression start in the local key', () => {
		const result = suggestLicksForProgression(detectShortInC(), makeDeps({ licks, progTags }));
		const ballad = result.suggestions.find((s) => s.lickId === 'l-ballad')!;
		expect(ballad.matchSources).toEqual(['prog-tag']);
		expect(ballad.templateAlignmentOffset).toEqual([0, 1]);
		expect(ballad.insertionOffset).toEqual([0, 1]);
		expect(ballad.insertionBar).toBe(0);
		expect(ballad.targetKey).toBe('C');
		expect(ballad.substitution).toBeNull();
	});

	it('aligns a chord-quality lick to its slot inside the progression', () => {
		const result = suggestLicksForProgression(detectShortInC(), makeDeps({ licks, progTags }));
		const maj = result.suggestions.find((s) => s.lickId === 'l-maj')!;
		expect(maj.matchSources).toEqual(['category']);
		expect(maj.templateAlignmentOffset).toEqual([1, 1]);
		expect(maj.insertionOffset).toEqual([1, 1]);
		expect(maj.insertionBar).toBe(1);
		expect(maj.targetKey).toBe('C');
	});

	it('includes substitution candidates only when substitutions are enabled', () => {
		const off = suggestLicksForProgression(detectShortInC(), makeDeps({ licks, progTags }));
		expect(off.suggestions.some((s) => s.lickId === 'l-minor')).toBe(false);

		const on = suggestLicksForProgression(detectShortInC(), makeDeps({ licks, progTags }), {
			enableSubstitutions: true
		});
		const minor = on.suggestions.find((s) => s.lickId === 'l-minor')!;
		expect(minor.matchSources).toEqual(['substitution']);
		expect(minor.substitution?.id).toBe('minor-over-dominant');
		expect(minor.templateAlignmentOffset).toEqual([1, 2]);
		expect(minor.insertionOffset).toEqual([1, 2]);
		expect(minor.insertionBar).toBe(0);
		expect(minor.targetKey).toBe('Ab');
	});
});

describe('suggestLicksForProgression — transposition targets on Mankunku detections', () => {
	const lick251 = makePhrase({ id: 'l-251', name: 'Major 251', category: 'ii-V-I-major' });
	const lickMaj = makePhrase({ id: 'l-maj', name: 'Major Chord Lick', category: 'major-chord' });
	const lickMin = makePhrase({ id: 'l-min', name: 'Minor Chord Lick', category: 'minor-chord' });
	const lickDom = makePhrase({ id: 'l-dom', name: 'Dominant Chord Lick', category: 'dominant-chord' });

	it('targets the local key of a secondary ii-V-I, landing chord-quality licks on real tune roots', () => {
		const flat = flattenTune(MANKUNKU_BLUES);
		const dets = mankunkuDetections();
		const bbShort = dets.find((d) => d.type === 'ii-V-I-major' && d.localKey === 'Bb')!;

		const result = suggestLicksForProgression(bbShort, makeDeps({ licks: [lick251, lickMaj] }));
		const s251 = result.suggestions.find((s) => s.lickId === 'l-251')!;
		expect(s251.targetKey).toBe('Bb');
		expect(s251.insertionOffset).toEqual([7, 1]);
		expect(s251.insertionBar).toBe(7);

		const sMaj = result.suggestions.find((s) => s.lickId === 'l-maj')!;
		expect(sMaj.targetKey).toBe('Bb');
		expect(sMaj.insertionOffset).toEqual([8, 1]);
		expect(sMaj.insertionBar).toBe(8);
		// The chord-quality target equals the actual tune chord root at that slot.
		expect(flat.harmony[9].chord.root).toBe(sMaj.targetKey);
	});

	it('lands each chord-quality role of the long ii-V-I on the matching tune chord', () => {
		const flat = flattenTune(MANKUNKU_BLUES);
		const longF = mankunkuDetections().find((d) => d.type === 'ii-V-I-major-long')!;
		const result = suggestLicksForProgression(longF, makeDeps({ licks: [lickMin, lickDom, lickMaj] }));

		const byId = Object.fromEntries(result.suggestions.map((s) => [s.lickId, s]));
		expect(byId['l-min'].targetKey).toBe('G');
		expect(byId['l-min'].insertionOffset).toEqual([12, 1]);
		expect(byId['l-dom'].targetKey).toBe('C');
		expect(byId['l-dom'].insertionOffset).toEqual([13, 1]);
		expect(byId['l-maj'].targetKey).toBe('F');
		expect(byId['l-maj'].insertionOffset).toEqual([14, 1]);

		expect(flat.harmony[13].chord.root).toBe(byId['l-min'].targetKey);
		expect(flat.harmony[14].chord.root).toBe(byId['l-dom'].targetKey);
		expect(flat.harmony[15].chord.root).toBe(byId['l-maj'].targetKey);
	});

	it('applies minor-over-dominant a semitone above a blues bar when substitutions are on', () => {
		const blues = mankunkuDetections().find((d) => d.type === 'blues')!;
		const result = suggestLicksForProgression(blues, makeDeps({ licks: [lickMin] }), {
			enableSubstitutions: true
		});
		const sMin = result.suggestions.find((s) => s.lickId === 'l-min')!;
		expect(sMin.matchSources).toEqual(['substitution']);
		expect(sMin.targetKey).toBe('F#');
	});

	it('native alignment beats substitution: a minor lick on the long ii-V-I stays on the ii', () => {
		const longF = mankunkuDetections().find((d) => d.type === 'ii-V-I-major-long')!;
		const result = suggestLicksForProgression(longF, makeDeps({ licks: [lickMin] }), {
			enableSubstitutions: true
		});
		const sMin = result.suggestions.find((s) => s.lickId === 'l-min')!;
		expect(sMin.targetKey).toBe('G');
		expect(sMin.templateAlignmentOffset).toEqual([0, 1]);
		expect(sMin.substitution).toBeNull();
	});

	it('maps slot alignment through compressed harmonic rhythm (half-bar first-ending turnaround)', () => {
		const turn2 = mankunkuDetections().filter((d) => d.type === 'turnaround')[1];
		expect(turn2.startBar).toBe(14);
		const result = suggestLicksForProgression(turn2, makeDeps({ licks: [lickDom] }));
		const sDom = result.suggestions.find((s) => s.lickId === 'l-dom')!;
		expect(sDom.insertionOffset).toEqual([29, 2]);
		expect(sDom.insertionBar).toBe(14);
	});
});

describe('suggestLicksForProgression — ranking, dedupe, limit', () => {
	it('orders by mastery tier before anything else', () => {
		const licks = [
			makePhrase({ id: 'u-lick', name: 'A Unknown', category: 'ii-V-I-major' }),
			makePhrase({ id: 'k-lick', name: 'B Known', category: 'ii-V-I-major' }),
			makePhrase({ id: 'learn-lick', name: 'C Learning', category: 'ii-V-I-major' })
		];
		const progress: LickPracticeProgress = {
			'k-lick': { C: { currentTempo: 100, lastPracticedAt: 1, passCount: 2 } },
			'learn-lick': { C: { currentTempo: 100, lastPracticedAt: 1, passCount: 0 } }
		};
		const result = suggestLicksForProgression(detectShortInC(), makeDeps({ licks, progress }));
		expect(result.suggestions.map((s) => s.lickId)).toEqual(['k-lick', 'learn-lick', 'u-lick']);
		expect(result.suggestions.map((s) => s.masteryTier)).toEqual(['known', 'learning', 'unknown']);
	});

	it('prefers practice-set members within the same tier and source', () => {
		const licks = [
			makePhrase({ id: 'out-lick', name: 'A Out', category: 'ii-V-I-major' }),
			makePhrase({ id: 'in-lick', name: 'B In', category: 'ii-V-I-major' })
		];
		const result = suggestLicksForProgression(
			detectShortInC(),
			makeDeps({ licks, practiceLickIds: new Set(['in-lick']) })
		);
		expect(result.suggestions.map((s) => s.lickId)).toEqual(['in-lick', 'out-lick']);
		expect(result.suggestions[0].inPracticeSet).toBe(true);
	});

	it('is deterministic regardless of lick-pool order', () => {
		const licks = [
			makePhrase({ id: 'l-251', name: 'Major 251', category: 'ii-V-I-major' }),
			makePhrase({ id: 'l-short', name: 'Short 251', category: 'short-ii-V-I-major' }),
			makePhrase({ id: 'l-maj', name: 'Major Chord Lick', category: 'major-chord' })
		];
		const forward = suggestLicksForProgression(detectShortInC(), makeDeps({ licks }));
		const reversed = suggestLicksForProgression(
			detectShortInC(),
			makeDeps({ licks: [...licks].reverse() })
		);
		expect(reversed.suggestions).toEqual(forward.suggestions);
	});

	it('dedupes transposed variants down to the base lick', () => {
		expect(baseLickId('my-lick_F')).toBe('my-lick');
		expect(baseLickId('my-lick')).toBe('my-lick');
		expect(baseLickId('my_lick_with_underscores')).toBe('my_lick_with_underscores');

		const licks = [
			makePhrase({ id: 'dup', name: 'Dup Lick', category: 'ii-V-I-major' }),
			makePhrase({ id: 'dup_F', name: 'Dup Lick', category: 'ii-V-I-major' })
		];
		const result = suggestLicksForProgression(detectShortInC(), makeDeps({ licks }));
		expect(result.suggestions.map((s) => s.lickId)).toEqual(['dup']);
	});

	it('applies the limit after ranking', () => {
		const licks = [
			makePhrase({ id: 'l-251', name: 'Major 251', category: 'ii-V-I-major' }),
			makePhrase({ id: 'l-short', name: 'Short 251', category: 'short-ii-V-I-major' }),
			makePhrase({ id: 'l-maj', name: 'Major Chord Lick', category: 'major-chord' })
		];
		const result = suggestLicksForProgression(detectShortInC(), makeDeps({ licks }), { limit: 2 });
		expect(result.suggestions.map((s) => s.lickId)).toEqual(['l-251', 'l-short']);
	});
});

describe('suggestLicksForTune', () => {
	it('pairs each detection with its ranked result', () => {
		const licks = [makePhrase({ id: 'l-251', name: 'Major 251', category: 'ii-V-I-major' })];
		const short = detectShortInC();
		const paired = suggestLicksForTune([short], makeDeps({ licks }));
		expect(paired).toHaveLength(1);
		expect(paired[0].detection).toBe(short);
		expect(paired[0].result.suggestions.map((s) => s.lickId)).toEqual(['l-251']);
	});
});

describe('buildLickMatcherDeps — live store assembly, strictly read-only', () => {
	it('surfaces seeded mastery from the real stores and never writes during suggestion', () => {
		const anchor = getAllLicks().find((l) => l.category === 'ii-V-I-major');
		expect(anchor).toBeDefined();
		const lickId = anchor!.id;

		// Seed: a pass at C, an unlock bump, and practice + prog tags — via the
		// store's own writers, before the read-only window under test.
		saveLickPracticeProgress({
			[lickId]: { C: { currentTempo: 120, lastPracticedAt: 1000, passCount: 2 } }
		});
		bumpUnlockedKeyCount(
			{ [lickId]: { C: { currentTempo: 120, lastPracticedAt: 1000, passCount: 2 } } },
			lickId
		);
		saveUserLickTags({ [lickId]: ['practice', 'prog:ii-V-I-major'] });

		vi.clearAllMocks();

		const deps = buildLickMatcherDeps({ timeSignature: [4, 4] });
		const result = suggestLicksForProgression(detectShortInC(), deps, { limit: 5 });

		const seeded = result.suggestions.find((s) => baseLickId(s.lickId) === lickId);
		expect(seeded).toBeDefined();
		expect(seeded!.masteryTier).toBe('known');
		expect(seeded!.inPracticeSet).toBe(true);
		expect(seeded!.matchSources[0]).toBe('prog-tag');
		expect(result.suggestions[0].lickId).toBe(lickId);

		expect(localStorageMock.setItem).not.toHaveBeenCalled();
	});
});
