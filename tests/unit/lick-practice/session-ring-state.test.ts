/**
 * Session-scoped ring state for continuous deep practice: with the
 * between-round pause gone, the KeyProgressRing needs per-key results that
 * SURVIVE round boundaries (`latestKeyResults`) and a STABLE key set to
 * render dots against (`sessionKeys`) — `plan[0].keys` shrinks as keys
 * master out and reorders worst-first every cycle, which would make the
 * ring's dots jump and vanish mid-session.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	startSingleLickSession,
	advanceSingleLickRound,
	recordKeyAttempt,
	resetSession
} from '$lib/state/lick-practice.svelte';
import {
	bumpUnlockedKeyCount,
	updateKeyProgress
} from '$lib/persistence/lick-practice-store';
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
		grade: 'A',
		noteResults: [],
		notesHit: 0,
		notesTotal: 0,
		timing: { bias: 0, spread: 0, offsets: [] }
	} as unknown as Score;
}

function setUnlockedCount(phraseId: string, target: number): void {
	for (let n = 1; n < target; n++) {
		bumpUnlockedKeyCount(lickPractice.progress, phraseId);
	}
}

beforeEach(() => {
	store.clear();
	resetSession();
	lickPractice.progress = {};
	lickPractice.config.practiceMode = 'continuous';
});

describe('latestKeyResults', () => {
	it('records the latest result per key, overwriting older attempts', () => {
		startSingleLickSession(makeLick('C', 'lick-c'));
		recordKeyAttempt(makeScore(0.6));
		expect(lickPractice.latestKeyResults.C?.score).toBe(0.6);

		lickPractice.currentKeyIndex = 0; // same key again next cycle
		recordKeyAttempt(makeScore(0.92));
		expect(lickPractice.latestKeyResults.C?.score).toBe(0.92);
		expect(lickPractice.latestKeyResults.C?.passed).toBe(true);
	});

	it('survives the round boundary that clears keyResults', () => {
		setUnlockedCount('lick-c', 2);
		startSingleLickSession(makeLick('C', 'lick-c'));
		recordKeyAttempt(makeScore(0.8));

		advanceSingleLickRound();

		expect(lickPractice.keyResults).toEqual([]);
		expect(lickPractice.latestKeyResults.C?.score).toBe(0.8);
	});

	it('clears on a new session start', () => {
		startSingleLickSession(makeLick('C', 'lick-c'));
		recordKeyAttempt(makeScore(0.8));
		startSingleLickSession(makeLick('C', 'lick-c'));
		expect(lickPractice.latestKeyResults).toEqual({});
	});
});

describe('sessionKeys', () => {
	it('holds the full unlocked circle in stable circle order even when the rotation is sorted', () => {
		setUnlockedCount('lick-f', 3); // circle from F → {F, Bb, C}
		for (const [key, rollingScore] of [
			['F', 0.95],
			['Bb', 0.6],
			['C', 0.8]
		] as Array<[PitchClass, number]>) {
			lickPractice.progress = updateKeyProgress(lickPractice.progress, 'lick-f', key, {
				lastPracticedAt: 1,
				rollingScore
			});
		}
		startSingleLickSession(makeLick('F', 'lick-f'));

		expect(lickPractice.plan[0].keys).toEqual(['Bb', 'C', 'F']); // sorted worst-first
		expect(lickPractice.sessionKeys).toEqual(['F', 'Bb', 'C']); // stable circle order
	});

	it('is unaffected by keys mastering out of the rotation', () => {
		setUnlockedCount('lick-f', 3);
		startSingleLickSession(makeLick('F', 'lick-f'));
		lickPractice.masteredThisRound = ['F'];

		advanceSingleLickRound();

		expect(lickPractice.plan[0].keys).not.toContain('F');
		expect(lickPractice.sessionKeys).toEqual(['F', 'Bb', 'C']);
	});

	it('grows when a refill picks up a newly unlocked key', () => {
		setUnlockedCount('lick-c', 2); // {C, G}
		startSingleLickSession(makeLick('C', 'lick-c'));
		expect(lickPractice.sessionKeys).toEqual(['C', 'G']);

		bumpUnlockedKeyCount(lickPractice.progress, 'lick-c'); // another tab unlocks F
		lickPractice.masteredThisRound = [...lickPractice.plan[0].keys];
		advanceSingleLickRound();

		expect(lickPractice.sessionKeys).toContain('F');
	});
});
