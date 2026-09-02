/**
 * In-session sheet-music reveal, wired into session state: every planned
 * row of the key stack is stamped `reveal` (and `passes`) when it is built
 * (lick or cycle start). Only the key being LEARNED — the most recently
 * unlocked one — can reveal, and only while its persisted rolling score is
 * defined and below the floor (`shouldRevealNotation`); a revealed row runs
 * `LEAD_SHEET_PASSES` windows in a row. Decided once per stack, never
 * re-derived mid-cycle (a row's height must not change while the stack
 * scrolls); the same rule in both directions, so the sheet withdraws once
 * the EWMA recovers; a never attempted key never reveals (first pass by
 * ear); earlier keys never; nothing at twelve of twelve; trick rows never.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	startSingleLickSession,
	startTrickSession,
	recordKeyAttempt,
	advanceSingleLickRound,
	getCurrentKey,
	getPlannedKey,
	getPlannedKeysForLick,
	getKeyPasses,
	resetSession
} from '$lib/state/lick-practice.svelte';
import { LEAD_SHEET_PASSES } from '$lib/state/lick-practice-rotation';
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

	it('keeps a row\'s reveal decision fixed within a cycle even after a score lands', () => {
		// A score write updates the rolling score before the key advances, so
		// the getters must not recompute from live progress mid-cycle — a row
		// changing height while the stack is up would jump the layout. The
		// decision is taken when the rotation is built and refreshed only at
		// the cycle boundary.
		setUnlockedCount('lick-f', 2);
		seedRolling('lick-f', { G: 0.5 });
		startSingleLickSession(makeLick('C', 'lick-f'));
		// C has never been attempted, so it sorts first; G (newest, under the
		// floor) is the revealed row.
		expect(getPlannedKeysForLick(0).map((pk) => [pk.key, pk.reveal])).toEqual([
			['C', false],
			['G', true]
		]);
		// Two clean passes in G (0.5 → 0.66 → 0.756) lift its rolling score
		// over the floor — but the row may not change until the boundary.
		// (Under the 0.95 mastery bar, so G stays in the rotation.)
		lickPractice.currentKeyIndex = 1;
		recordKeyAttempt(makeScore(0.9));
		recordKeyAttempt(makeScore(0.9));
		expect(getPlannedKeysForLick(0).map((pk) => pk.reveal)).toEqual([false, true]);
		expect(getPlannedKey(0)?.reveal).toBe(true);
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0).map((pk) => pk.reveal)).toEqual([false, false]);
	});

	it('treats the floor itself as recovered', () => {
		seedRolling('fresh-lick', { C: 0.75 });
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
		// Decisions are per rotation: re-seed, then rebuild the rotation.
		seedRolling('fresh-lick', { C: 0.749 });
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);
	});

	it('stamps each planned row with its reveal flag when the stack is built', () => {
		// Three keys from C: C, G, F — F is the one being learned.
		setUnlockedCount('lick-f', 3);
		seedRolling('lick-f', { G: 0.9, F: 0.5 });
		startSingleLickSession(makeLick('C', 'lick-f'));
		const rows = getPlannedKeysForLick(0);
		expect(rows.map((pk) => pk.key)).toEqual(['C', 'F', 'G']);
		expect(rows.map((pk) => pk.reveal)).toEqual([false, true, false]);
	});

	it('reveals only the newest unlocked key — earlier keys stay by memory however they score', () => {
		setUnlockedCount('lick-f', 3);
		seedRolling('lick-f', { C: 0.2, G: 0.3, F: 0.9 });
		startSingleLickSession(makeLick('C', 'lick-f'));
		expect(getPlannedKeysForLick(0).map((pk) => [pk.key, pk.reveal])).toEqual([
			['C', false],
			['G', false],
			['F', false]
		]);
	});

	it('never reveals once all twelve keys are unlocked', () => {
		setUnlockedCount('lick-f', 12);
		seedRolling('lick-f', { C: 0.2, 'F#': 0.2 });
		startSingleLickSession(makeLick('C', 'lick-f'));
		const rows = getPlannedKeysForLick(0);
		expect(rows).toHaveLength(12);
		expect(rows.every((pk) => pk.reveal === false)).toBe(true);
	});

	it('runs the revealed row for three passes and every other row for one', () => {
		setUnlockedCount('lick-f', 3);
		seedRolling('lick-f', { G: 0.9, F: 0.5 });
		startSingleLickSession(makeLick('C', 'lick-f'));
		const rows = getPlannedKeysForLick(0);
		expect(rows.map((pk) => [pk.key, pk.passes])).toEqual([
			['C', 1],
			['F', LEAD_SHEET_PASSES],
			['G', 1]
		]);
		expect(getPlannedKey(1)?.passes).toBe(LEAD_SHEET_PASSES);
	});

	it('exposes the pass counts per rotation slot for the scheduler', () => {
		setUnlockedCount('lick-f', 3);
		seedRolling('lick-f', { G: 0.9, F: 0.5 });
		startSingleLickSession(makeLick('C', 'lick-f'));
		expect(getKeyPasses(0)).toEqual([1, LEAD_SHEET_PASSES, 1]);
		expect(getKeyPasses(0)).toHaveLength(lickPractice.plan[0].keys.length);
		expect(getKeyPasses(99)).toEqual([]);
	});

	it('keeps one pass per key in call-response mode — the app already plays each half', () => {
		setUnlockedCount('lick-f', 3);
		seedRolling('lick-f', { G: 0.9, F: 0.5 });
		lickPractice.config.practiceMode = 'call-response';
		startSingleLickSession(makeLick('C', 'lick-f'));
		const rows = getPlannedKeysForLick(0);
		expect(rows.map((pk) => pk.reveal)).toEqual([false, true, false]);
		expect(rows.map((pk) => pk.passes)).toEqual([1, 1, 1]);
		expect(getKeyPasses(0)).toEqual([1, 1, 1]);
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
