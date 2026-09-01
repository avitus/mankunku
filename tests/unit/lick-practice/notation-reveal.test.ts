/**
 * In-session sheet-music reveal, wired into session state:
 *
 * `getNotationReveal()` names the CURRENT key while its persisted rolling
 * score is defined and below the floor (`KEY_FLOOR_THRESHOLD`), and returns
 * null otherwise. The rule is the same in both directions — the sheet
 * appears after a sub-floor attempt and withdraws on its own once the
 * EWMA recovers — and a never-attempted key never reveals, so the first
 * pass in any key is by ear. Trick rounds never reveal: a regenerated
 * device figure is drilled for fluency, not learned from the page.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	startSingleLickSession,
	startTrickSession,
	recordKeyAttempt,
	advanceSingleLickRound,
	getCurrentKey,
	getNotationReveal,
	resetSession
} from '$lib/state/lick-practice.svelte';
import { bumpUnlockedKeyCount, updateKeyProgress } from '$lib/persistence/lick-practice-store';
import { trickVariantKey, type TrickParameters } from '$lib/types/tricks';
import { settings } from '$lib/state/settings.svelte';
import type { PitchClass, Phrase } from '$lib/types/music';
import type { Score } from '$lib/types/scoring';

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

function makeLick(key: PitchClass, id = `test-lick-${key}`): Phrase {
	return {
		id,
		name: `Test lick in ${key}`,
		timeSignature: [4, 4],
		key,
		notes: [],
		harmony: [],
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
		category: 'short-ii-V-I-major',
		tags: [],
		source: 'curated'
	};
}

function makeScore(overall: number): Score {
	return {
		pitchAccuracy: overall,
		rhythmAccuracy: overall,
		overall,
		grade: 'good',
		noteResults: [],
		notesHit: 0,
		notesTotal: 0,
		timing: {
			meanOffsetMs: 0,
			medianOffsetMs: 0,
			stdDevMs: 0,
			latencyCorrectionMs: 0,
			perNoteOffsetMs: []
		}
	};
}

function setUnlockedCount(phraseId: string, target: number): void {
	for (let n = 1; n < target; n++) {
		bumpUnlockedKeyCount(lickPractice.progress, phraseId);
	}
}

function seedRolling(phraseId: string, scores: Partial<Record<PitchClass, number>>): void {
	for (const [key, rollingScore] of Object.entries(scores)) {
		lickPractice.progress = updateKeyProgress(lickPractice.progress, phraseId, key as PitchClass, {
			lastPracticedAt: 1,
			rollingScore
		});
	}
}

// First rung of the enclosures major chain — always unlocked.
const E1_PARAMS: TrickParameters = {
	noteCount: '1',
	shape: 'chromatic-below',
	targetTone: 'root',
	beatPlacement: 'downbeat',
	type: 'major'
};

beforeEach(() => {
	store.clear();
	resetSession();
	lickPractice.progress = {};
});

describe('getNotationReveal', () => {
	it('is null for a key that has never been attempted — the first pass is by ear', () => {
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		expect(getNotationReveal()).toBeNull();
	});

	it('names the current key once a sub-floor attempt lands', () => {
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		recordKeyAttempt(makeScore(0.6));
		expect(getNotationReveal()).toEqual({ key: 'C', rolling: 0.6 });
	});

	it('withdraws only when the rolling score recovers over the floor — same rule both ways', () => {
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		recordKeyAttempt(makeScore(0.6));
		// One clean pass lifts 0.6 to 0.74 — still under the floor, still shown.
		recordKeyAttempt(makeScore(0.95));
		expect(getNotationReveal()?.rolling).toBeCloseTo(0.74, 5);
		// A second one clears it (0.824) and the sheet goes away.
		recordKeyAttempt(makeScore(0.95));
		expect(getNotationReveal()).toBeNull();
	});

	it('treats the floor itself as recovered', () => {
		seedRolling('fresh-lick', { C: 0.75 });
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		expect(getNotationReveal()).toBeNull();

		seedRolling('fresh-lick', { C: 0.749 });
		expect(getNotationReveal()?.key).toBe('C');
	});

	it('follows the current key of the rotation', () => {
		setUnlockedCount('lick-f', 3);
		// Unknown C sorts first, then G (0.5), then F (0.9).
		seedRolling('lick-f', { G: 0.5, F: 0.9 });
		startSingleLickSession(makeLick('C', 'lick-f'));
		expect(lickPractice.plan[0].keys).toEqual(['C', 'G', 'F']);

		expect(getNotationReveal()).toBeNull();
		lickPractice.currentKeyIndex = 1;
		expect(getNotationReveal()).toEqual({ key: 'G', rolling: 0.5 });
		lickPractice.currentKeyIndex = 2;
		expect(getNotationReveal()).toBeNull();
	});

	it('is up for the next cycle demo after a failed head key', () => {
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		recordKeyAttempt(makeScore(0.3));
		advanceSingleLickRound();
		expect(getNotationReveal()).toEqual({ key: 'C', rolling: 0.3 });
		expect(lickPractice.demoNextCycle).toBe(true);
	});

	it('never reveals in a trick round, even with a sub-floor score under the variant key', () => {
		lickPractice.config.trickId = 'enclosures';
		lickPractice.config.trickParameters = { ...E1_PARAMS };
		settings.instrumentId = 'tenor-sax';
		expect(startTrickSession()).toBe(true);
		const key = getCurrentKey();
		expect(key).not.toBeNull();
		// Contrived: the lick store never holds trick scores, but the guard must
		// be structural, not an accident of where progress happens to be written.
		seedRolling(trickVariantKey('enclosures', E1_PARAMS), { [key as PitchClass]: 0.2 });
		expect(getNotationReveal()).toBeNull();
	});
});
