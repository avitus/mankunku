/**
 * Regression tests for single-lick Deep Practice progression selection.
 *
 * Bug: a `major-chord` lick selected for Deep Practice was played over a MINOR
 * backing chord. `startSingleLickSession` stamped the plan item with
 * `config.progressionType`, which `pickInitialProgression` had selected for the
 * *most-neglected* lick (often a minor one). The fix derives the progression
 * from the chosen lick itself, so a Major lick can never resolve to a minor
 * backing chord.
 *
 * The invariant under test: the chord quality at the lick's alignment offset in
 * the resolved progression must be `maj7` for a `major-chord` lick, regardless
 * of what `config.progressionType` happens to be.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { lickPractice, startSingleLickSession } from '$lib/state/lick-practice.svelte';
import {
	togglePracticeTag,
	toggleProgressionTag
} from '$lib/persistence/lick-practice-store';
import {
	getProgressionsForCategory,
	resolveLickAlignmentOffset,
	getChordQualityAtOffset
} from '$lib/data/progressions';
import { getLickById } from '$lib/phrases/library-loader';

// ── localStorage stub shared by the tag / progress / session stores ──
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});

// Real curated lick: `category: 'major-chord'`, declares Cmaj7 harmony.
const MAJOR_LICK = 'major-chord-001';

/** Chord quality played under the lick once the progression is resolved. */
function chordQualityUnderLick(): string | null {
	const item = lickPractice.plan[0];
	if (!item) return null;
	const offset = resolveLickAlignmentOffset(item.progressionType, item.category, false);
	return getChordQualityAtOffset(item.progressionType, offset);
}

beforeEach(() => {
	store.clear();
	lickPractice.progress = {};
	lickPractice.plan = [];
	lickPractice.config.practiceMode = 'continuous';
	lickPractice.config.enableSubstitutions = false;
	lickPractice.config.singleLickId = undefined;
	// The bug's precondition: a minor progression is pinned in config (as
	// `pickInitialProgression` would seed for a neglected minor lick).
	lickPractice.config.progressionType = 'ii-V-I-minor';
});

describe('startSingleLickSession progression selection', () => {
	it('never plays a major-chord lick over a minor backing chord (no prog tags)', () => {
		// Untagged library lick: resolution must fall back to a category-compatible
		// progression rather than inheriting the minor `config.progressionType`.
		const ok = startSingleLickSession(MAJOR_LICK);
		expect(ok).toBe(true);

		const progressionType = lickPractice.plan[0].progressionType;
		expect(getProgressionsForCategory('major-chord')).toContain(progressionType);
		expect(progressionType).not.toBe('ii-V-I-minor');
		// The chord actually sounding under the lick is major.
		expect(chordQualityUnderLick()).toBe('maj7');
	});

	it("honours the lick's own prog:* tag over config.progressionType", () => {
		togglePracticeTag(MAJOR_LICK);
		toggleProgressionTag(MAJOR_LICK, 'turnaround');

		startSingleLickSession(MAJOR_LICK);

		expect(lickPractice.plan[0].progressionType).toBe('turnaround');
		expect(chordQualityUnderLick()).toBe('maj7');
	});

	it('picks a major progression even when config is a minor vamp', () => {
		lickPractice.config.progressionType = 'minor-vamp';

		startSingleLickSession(getLickById(MAJOR_LICK)!);

		expect(getProgressionsForCategory('major-chord')).toContain(
			lickPractice.plan[0].progressionType
		);
		expect(chordQualityUnderLick()).toBe('maj7');
	});
});
