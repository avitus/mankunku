/**
 * In-session sheet-music reveal, wired into session state: every planned
 * row of the key stack is stamped `reveal` (and `passes`) when it is built
 * (lick or cycle start). Initially only the key being LEARNED — the most recently
 * unlocked one — can reveal, and only while its persisted rolling score is
 * defined and below the floor (`shouldRevealNotation`); a revealed row runs
 * `LEAD_SHEET_PASSES` windows in a row. Decided once per stack, never
 * re-derived mid-cycle (a row's height must not change while the stack
 * scrolls); the same rule in both directions, so the sheet withdraws once
 * the EWMA recovers; a never attempted key never reveals (first pass by
 * ear). Deep practice also rescues any key after one first attempt below 50%
 * or two consecutive attempts averaging below 70%; trick rows never.
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
	getHandoffPreviewKey,
	getDeepCycleEntry,
	getKeyPasses,
	getKeyPauses,
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

describe('deep practice rescue for any unlocked key', () => {
	it.each([false, true])('graduates a successful sheet turn despite older low scores (recommended=%s)', (recommended) => {
		const lick = makeLick('Eb', 'graduate');
		seedRolling(lick.id, { Eb: 0.1 });
		startSingleLickSession(lick, recommended ? { focusKey: 'Eb' } : undefined);
		lickPractice.currentTempo = 50;
		expect(getKeyPasses(0)).toEqual([3]);
		recordKeyAttempt(makeScore(0.95));
		// Keep the sheet for this turn, including its final scored pass.
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);
		advanceSingleLickRound();
		expect(lickPractice.currentTempo).toBe(51);
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
		expect(getKeyPasses(0)).toEqual([1]);
		expect(getDeepCycleEntry(0)?.fromMemory).toBe(true);
		// Older poor scores must not immediately undo graduation on a minor lapse.
		recordKeyAttempt(makeScore(0.8));
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
		// Fresh repeated difficulty restores support.
		recordKeyAttempt(makeScore(0.4));
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);
	});

	it.each([2, 12])('reveals an older key with %i keys unlocked after a first poor attempt', (count) => {
		setUnlockedCount('rescue', count);
		seedRolling('rescue', { C: 0.9 });
		startSingleLickSession(makeLick('C', 'rescue'), { focusKey: 'C' });
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
		recordKeyAttempt(makeScore(0.35));
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);
		expect(getKeyPasses(0)).toEqual([LEAD_SHEET_PASSES]);
		expect(lickPractice.demoNextCycle).toBe(false);
	});

	it.each([
		[0.499, undefined, true],
		[0.5, undefined, false],
		[0.65, 0.74, true],
		[0.6, 0.8, false],
		[0.9, 0.49, true]
	])('uses strict thresholds for scores %s then %s', (first, second, reveal) => {
		setUnlockedCount('rescue', 12);
		startSingleLickSession(makeLick('C', 'rescue'), { focusKey: 'C' });
		recordKeyAttempt(makeScore(first));
		advanceSingleLickRound();
		if (second !== undefined) {
			recordKeyAttempt(makeScore(second));
			advanceSingleLickRound();
		}
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(reveal);
	});

	it('keeps attempt history separate for each key and leaves Daily unchanged', () => {
		setUnlockedCount('rescue', 12);
		startSingleLickSession(makeLick('C', 'rescue'));
		for (const [key, score] of [['C', 0.6], ['G', 0.9]] as const) {
			lickPractice.currentKeyIndex = lickPractice.plan[0].keys.indexOf(key);
			recordKeyAttempt(makeScore(score));
		}
		advanceSingleLickRound();
		lickPractice.currentKeyIndex = lickPractice.plan[0].keys.indexOf('C');
		recordKeyAttempt(makeScore(0.7));
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0).find((row) => row.key === 'C')?.reveal).toBe(true);
		expect(getPlannedKeysForLick(0).find((row) => row.key === 'G')?.reveal).toBe(false);
		lickPractice.mode = 'standard';
		lickPractice.plan[0].keys = [...lickPractice.plan[0].keys];
		expect(getPlannedKeysForLick(0).every((row) => !row.reveal)).toBe(true);
	});

	it('uses the latest two attempts and clears session history on restart', () => {
		setUnlockedCount('rescue', 12);
		startSingleLickSession(makeLick('C', 'rescue'), { focusKey: 'C' });
		for (const score of [0.35, 0.35, 0.9]) {
			recordKeyAttempt(makeScore(score));
			advanceSingleLickRound();
			expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);
		}
		recordKeyAttempt(makeScore(0.9));
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
		startSingleLickSession(makeLick('C', 'rescue'), { focusKey: 'C' });
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
	});
});

describe('planned rows carry the reveal decision', () => {
	it('prepares a later key graduating from sheet music, not just the cycle head', () => {
		const lick = makeLick('C');
		setUnlockedCount(lick.id, 2);
		seedRolling(lick.id, { C: 0.8, G: 0.7 });
		startSingleLickSession(lick);
		expect(getPlannedKeysForLick(0).find(row => row.key === 'G')?.reveal).toBe(true);
		lickPractice.currentKeyIndex = lickPractice.plan[0].keys.indexOf('G');
		recordKeyAttempt(makeScore(0.9));
		lickPractice.currentKeyIndex = lickPractice.plan[0].keys.indexOf('C');
		recordKeyAttempt(makeScore(0.5));
		advanceSingleLickRound();
		expect(lickPractice.plan[0].keys).toEqual(['C', 'G']);
		expect(getKeyPauses(0)).toEqual([0, 1]);
		expect(getPlannedKeysForLick(0)[1].cycleEntry).toMatchObject({ fromMemory: true, prepareBars: 1 });
	});

	it('remembers a graduated sheet when that key returns after sitting out a round', () => {
		const lick = makeLick('C');
		setUnlockedCount(lick.id, 2);
		seedRolling(lick.id, { C: 0.8, G: 0.7 });
		startSingleLickSession(lick);
		expect(getPlannedKeysForLick(0).find(row => row.key === 'G')?.reveal).toBe(true);
		lickPractice.currentKeyIndex = lickPractice.plan[0].keys.indexOf('G');
		recordKeyAttempt(makeScore(0.97));
		lickPractice.currentKeyIndex = lickPractice.plan[0].keys.indexOf('C');
		recordKeyAttempt(makeScore(0.6));
		advanceSingleLickRound();
		expect(lickPractice.plan[0].keys).toEqual(['C']);
		recordKeyAttempt(makeScore(0.97));
		advanceSingleLickRound();
		expect(getDeepCycleEntry(0, 'G')?.fromMemory).toBe(true);
	});

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
		// A successful final pass graduates immediately, even though EWMA is only 0.74.
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

	it('initially reveals only the newest unlocked key based on persisted scores', () => {
		setUnlockedCount('lick-f', 3);
		seedRolling('lick-f', { C: 0.2, G: 0.3, F: 0.9 });
		startSingleLickSession(makeLick('C', 'lick-f'));
		expect(getPlannedKeysForLick(0).map((pk) => [pk.key, pk.reveal])).toEqual([
			['C', false],
			['G', false],
			['F', false]
		]);
	});

	it('starts from memory once all twelve keys are unlocked', () => {
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

	it('joins an upcoming Deep sheet directly because its notation is already visible', () => {
		setUnlockedCount('lick-f', 3);
		seedRolling('lick-f', { G: 0.9, F: 0.5 });
		startSingleLickSession(makeLick('C', 'lick-f'));
		// Rotation [C, F, G]: F is read, and it follows C's window.
		expect(getKeyPauses(0)).toEqual([0, 0, 0]);
		expect(getKeyPauses(0)).toHaveLength(lickPractice.plan[0].keys.length);
		expect(getKeyPauses(99)).toEqual([]);
	});

	it('never pauses before a revealed key that opens the cycle — the demo is its herald', () => {
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		recordKeyAttempt(makeScore(0.6));
		advanceSingleLickRound();
		expect(lickPractice.demoNextCycle).toBe(true);
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);
		expect(getKeyPauses(0)).toEqual([0]);
	});

	it('uses the existing Deep turnaround when a successful sheet turn graduates on refill', () => {
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		recordKeyAttempt(makeScore(0.6)); // C: 0.6, under the floor → revealed
		advanceSingleLickRound();
		// C clears the whole (one-key) rotation, but its EWMA only reaches
		// 0.4 × 0.95 + 0.6 × 0.6 = 0.74: success still earns memory, with no demo.
		recordKeyAttempt(makeScore(0.95));
		advanceSingleLickRound();
		expect(lickPractice.demoNextCycle).toBe(false);
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
		expect(getKeyPauses(0)).toEqual([0]);
	});

	it('previews a promised sheet as notation and admits it without a reading pause', () => {
		const lick = makeLick('C', 'preview-sheet');
		setUnlockedCount(lick.id, 2);
		seedRolling(lick.id, { C: 0.9, G: 0.5 });
		startSingleLickSession(lick, { focusKey: 'C' });
		lickPractice.currentTempo = lickPractice.ramp!.targetTempo;
		recordKeyAttempt(makeScore(0.98));
		advanceSingleLickRound();
		expect(lickPractice.ramp?.phase).toBe('handoff');
		expect(getHandoffPreviewKey(0)).toMatchObject({ key: 'G', reveal: true });
		expect(getKeyPauses(0)).toEqual([1]);
		recordKeyAttempt(makeScore(0.6));
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0)[0]).toMatchObject({ key: 'G', reveal: true, passes: 3 });
		expect(getKeyPauses(0)[0]).toBe(0);
	});

	it('never pauses before an unrevealed key', () => {
		setUnlockedCount('lick-f', 3);
		seedRolling('lick-f', { C: 0.2, G: 0.3, F: 0.9 });
		startSingleLickSession(makeLick('C', 'lick-f'));
		expect(getKeyPauses(0)).toEqual([0, 0, 0]);
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
		// Each call-and-response window opens with the app's half, which is
		// already a pause with the sheet up — no extra bars.
		expect(getKeyPauses(0)).toEqual([0, 0, 0]);
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
