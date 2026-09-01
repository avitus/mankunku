/**
 * In-session sheet-music reveal, wired into session state: every planned
 * row of the key stack is stamped `reveal` when it is built (lick or cycle
 * start) from the key's persisted rolling score — defined and below the
 * floor (`shouldRevealNotation`) — so a struggling key's row engraves as a
 * lead sheet. Decided once per stack, never re-derived mid-cycle (a row's
 * height must not change while the stack scrolls); the same rule in both
 * directions, so the sheet withdraws once the EWMA recovers; a never
 * attempted key never reveals (first pass by ear); trick rows never.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	startSingleLickSession,
	startTrickSession,
	recordKeyAttempt,
	advanceSingleLickRound,
	getCurrentKey,
	getPlannedKeysForLick,
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

describe('planned rows carry the reveal decision', () => {
	it('does not reveal a never-attempted key — the first pass is by ear', () => {
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		expect(getPlannedKeysForLick(0).map((pk) => pk.reveal)).toEqual([false]);
	});

	it('reveals the head key on the next cycle after a sub-floor attempt, and withdraws once it recovers', () => {
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		recordKeyAttempt(makeScore(0.6));
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);
		expect(lickPractice.demoNextCycle).toBe(true);
		// One clean pass lifts 0.6 to 0.74 — still shown; a second clears it.
		recordKeyAttempt(makeScore(0.95));
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);
		recordKeyAttempt(makeScore(0.95));
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
	});

	it('treats the floor itself as recovered', () => {
		seedRolling('fresh-lick', { C: 0.75 });
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
		seedRolling('fresh-lick', { C: 0.749 });
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);
	});

	it('stamps each planned row with its reveal flag when the stack is built', () => {
		setUnlockedCount('lick-f', 3);
		seedRolling('lick-f', { G: 0.5, F: 0.9 });
		startSingleLickSession(makeLick('C', 'lick-f'));
		const rows = getPlannedKeysForLick(0);
		expect(rows.map((pk) => pk.key)).toEqual(['C', 'G', 'F']);
		expect(rows.map((pk) => pk.reveal)).toEqual([false, true, false]);
	});

	it('never stamps a reveal on a trick round\'s rows', () => {
		lickPractice.config.trickId = 'enclosures';
		lickPractice.config.trickParameters = { ...E1_PARAMS };
		settings.instrumentId = 'tenor-sax';
		expect(startTrickSession()).toBe(true);
		const rows = getPlannedKeysForLick(0);
		expect(rows.length).toBeGreaterThan(0);
		seedRolling(trickVariantKey('enclosures', E1_PARAMS), { [rows[0].key]: 0.2 });
		expect(getPlannedKeysForLick(0).every((pk) => pk.reveal === false)).toBe(true);
	});
});
