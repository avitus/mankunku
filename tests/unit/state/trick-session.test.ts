/**
 * Tests for the trick-drill integration in `state/lick-practice.svelte.ts`.
 *
 * A trick session reuses the single-lick round loop, but its plan item is a
 * `kind: 'trick'` item whose `phraseId` is the composite variant key and
 * whose progress writes must go to the TRICK store — never to
 * `lickPractice.progress` (the lick store). The invariants under test:
 *
 *   1. `startTrickSession` builds a one-item, C-rooted, major-vamp plan from
 *      `config.trickId`/`trickParameters` and fails cleanly on bad config.
 *   2. `recordKeyAttempt` on a trick item writes passes to the trick store
 *      and leaves the lick store untouched.
 *   3. `advanceSingleLickRound` refill path bumps the trick unlock count
 *      FIRST (clearing the rotation IS the trick unlock path), refills the
 *      circle from C, persists the bumped tempo per key to the trick store,
 *      and appends a progress-history point.
 *   4. Both round paths regenerate the disposable example phrase.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	startTrickSession,
	recordKeyAttempt,
	advanceSingleLickRound,
	resetSession
} from '$lib/state/lick-practice.svelte';
import { trickVariantKey, type TrickParameters } from '$lib/types/tricks';
import { getTrickById } from '$lib/tricks';
import {
	loadTrickPracticeProgress,
	saveTrickPracticeProgress,
	updateTrickKeyProgress,
	getTrickUnlockedKeyCount,
	getTrickProgressHistory,
	TRICK_DEFAULT_TEMPO
} from '$lib/persistence/trick-practice-store';
import { clampTempo } from '$lib/persistence/lick-practice-store';
import type { Score } from '$lib/types/scoring';

// ── localStorage stub shared by the trick / lick / outbox stores ──
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

// First rung of the enclosures ladder — always unlocked.
const E1_PARAMS: TrickParameters = {
	noteCount: '1',
	shape: 'chromatic-below',
	targetTone: 'root',
	beatPlacement: 'downbeat'
};
const E1_KEY = trickVariantKey('enclosures', E1_PARAMS);

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

beforeEach(() => {
	store.clear();
	resetSession();
	lickPractice.progress = {};
	lickPractice.config.trickId = 'enclosures';
	lickPractice.config.trickParameters = { ...E1_PARAMS };
	lickPractice.config.tempoBumpBpm = undefined;
});

describe('startTrickSession', () => {
	it('returns false when trick config is missing or unknown', () => {
		lickPractice.config.trickId = undefined;
		expect(startTrickSession()).toBe(false);

		lickPractice.config.trickId = 'no-such-trick';
		expect(startTrickSession()).toBe(false);
		expect(lickPractice.plan).toHaveLength(0);
	});

	it('builds a one-item C-rooted trick plan over the major vamp', () => {
		expect(startTrickSession()).toBe(true);

		expect(lickPractice.plan).toHaveLength(1);
		const item = lickPractice.plan[0];
		expect(item.kind).toBe('trick');
		// For trick items the composite variant key IS the phraseId.
		expect(item.phraseId).toBe(E1_KEY);
		expect(item.phraseName).toContain(getTrickById('enclosures')!.name);
		expect(item.progressionType).toBe('major-vamp');
		// Fresh store → one unlocked key, the C entry key.
		expect(item.keys).toEqual(['C']);
		expect(item.trickId).toBe('enclosures');
		expect(item.trickParameters).toEqual(E1_PARAMS);
		expect(item.trickContext).toMatchObject({
			chordRoot: 'C',
			chordQuality: 'maj7',
			scaleId: 'major.ionian',
			key: 'C',
			timeSignature: [4, 4]
		});
		// The example realizes in the C context so the existing per-key
		// transposition path works unchanged.
		expect(item.phrase).toBeDefined();
		expect(item.phrase!.key).toBe('C');

		expect(lickPractice.mode).toBe('single-lick');
		expect(lickPractice.roundNumber).toBe(1);
		expect(lickPractice.phase).toBe('count-in');
		expect(lickPractice.currentTempo).toBe(TRICK_DEFAULT_TEMPO);
	});

	it('clamps a corrupt stored tempo — mirrors resolveLickTempo', () => {
		// A bad cloud merge or hand-edited localStorage could leave an absurd
		// tempo in the trick store; the session must start within clamp bounds.
		saveTrickPracticeProgress(updateTrickKeyProgress({}, E1_KEY, 'C', { currentTempo: 1000 }));

		expect(startTrickSession()).toBe(true);

		// Read the actual ceiling from the store module rather than a literal.
		const ceiling = clampTempo(Number.POSITIVE_INFINITY);
		expect(ceiling).toBeLessThan(1000);
		expect(lickPractice.currentTempo).toBe(ceiling);
	});
});

describe('recordKeyAttempt on a trick item', () => {
	it('writes passes to the trick store, never the lick store', () => {
		expect(startTrickSession()).toBe(true);

		recordKeyAttempt(makeScore(0.92));

		// Lick-practice progress stays untouched by trick items.
		expect(lickPractice.progress).toEqual({});

		const trickProgress = loadTrickPracticeProgress();
		expect(trickProgress[E1_KEY]?.C?.passCount).toBe(1);
		expect(trickProgress[E1_KEY]?.C?.currentTempo).toBe(TRICK_DEFAULT_TEMPO);

		expect(lickPractice.keyResults).toHaveLength(1);
		expect(lickPractice.keyResults[0].passed).toBe(true);
		// 0.92 passes but doesn't clear the 0.95 mastery bar.
		expect(lickPractice.masteredThisRound).toEqual([]);
	});

	it('does not write a failed attempt to the trick store', () => {
		expect(startTrickSession()).toBe(true);

		recordKeyAttempt(makeScore(0.5));

		expect(loadTrickPracticeProgress()[E1_KEY]).toBeUndefined();
		expect(lickPractice.keyResults[0].passed).toBe(false);
	});
});

describe('advanceSingleLickRound on a trick item', () => {
	it('refill path: bumps unlock count first, refills from C, persists tempo to the trick store', () => {
		expect(startTrickSession()).toBe(true);
		const phraseIdBefore = lickPractice.plan[0].phrase!.id;

		// Master the only unlocked key so the rotation clears.
		recordKeyAttempt(makeScore(0.96));
		expect(lickPractice.masteredThisRound).toEqual(['C']);

		advanceSingleLickRound();

		const item = lickPractice.plan[0];
		// Clearing the rotation IS the trick unlock path: count bumps to 2 and
		// the refilled circle includes the newly earned key (G, the first
		// sharp-side neighbour of C).
		expect(getTrickUnlockedKeyCount(E1_KEY)).toBe(2);
		expect(item.keys).toEqual(['C', 'G']);

		// Default 5 BPM bump, persisted per refilled key to the TRICK store.
		expect(lickPractice.currentTempo).toBe(TRICK_DEFAULT_TEMPO + 5);
		const trickProgress = loadTrickPracticeProgress();
		expect(trickProgress[E1_KEY]?.C?.currentTempo).toBe(TRICK_DEFAULT_TEMPO + 5);
		expect(trickProgress[E1_KEY]?.G?.currentTempo).toBe(TRICK_DEFAULT_TEMPO + 5);
		// The lick store never sees the variant key.
		expect(lickPractice.progress).toEqual({});

		const history = getTrickProgressHistory(E1_KEY);
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({ bpm: TRICK_DEFAULT_TEMPO + 5, keys: 2 });

		// The disposable example is regenerated each round.
		expect(item.phrase).toBeDefined();
		expect(item.phrase!.id).not.toBe(phraseIdBefore);

		expect(lickPractice.roundNumber).toBe(2);
		expect(lickPractice.phase).toBe('inter-lick-rest');
	});

	it('survivor path: keeps unmastered keys, no unlock/tempo change, still regenerates the example', () => {
		expect(startTrickSession()).toBe(true);
		const phraseIdBefore = lickPractice.plan[0].phrase!.id;

		// Passing but below the 0.95 mastery bar → C survives the round.
		recordKeyAttempt(makeScore(0.9));
		advanceSingleLickRound();

		const item = lickPractice.plan[0];
		expect(item.keys).toEqual(['C']);
		expect(getTrickUnlockedKeyCount(E1_KEY)).toBe(1);
		expect(lickPractice.currentTempo).toBe(TRICK_DEFAULT_TEMPO);
		expect(getTrickProgressHistory(E1_KEY)).toHaveLength(0);

		expect(item.phrase).toBeDefined();
		expect(item.phrase!.id).not.toBe(phraseIdBefore);
	});
});
