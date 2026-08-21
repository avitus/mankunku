/**
 * Deep Practice focus ramp — the session-level behaviour behind the report's
 * "Drill <key>" recommendation.
 *
 * `startSingleLickSession(lick, { focusKey })` opens on that key ALONE, 10%
 * under the lick's saved tempo, and runs a staircase on it (clear → up,
 * sub-floor → down, in between → hold) until the session tempo is back at
 * the saved tempo. Then the other unlocked keys come back one per cleared
 * rotation, worst first, at a held tempo, until the full set is in — after
 * which the ordinary deep-practice rule (clear → bump → refill) resumes.
 *
 * Everything is session-local: the lick's stored tempo and progress history
 * are untouched, exactly as `deep-practice-tempo.test.ts` pins for the plain
 * drill. The pure transition matrix lives in `rotation.test.ts`; this file
 * drives the real rune through `recordKeyAttempt` / `advanceSingleLickRound`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	startSingleLickSession,
	startTrickSession,
	recordKeyAttempt,
	advanceSingleLickRound,
	getSessionReport,
	resetSession
} from '$lib/state/lick-practice.svelte';
import {
	bumpUnlockedKeyCount,
	getLickTempo,
	loadLickProgressHistory,
	saveLickPracticeProgress,
	updateKeyProgress
} from '$lib/persistence/lick-practice-store';
import {
	deepPracticeStartTempo,
	focusStartTempo,
	DEFAULT_TEMPO_BUMP_PERCENT
} from '$lib/state/lick-practice-rotation';
import { circleOfFourthsFrom } from '$lib/music/key-ordering';
import type { PitchClass, Phrase } from '$lib/types/music';
import type { Score } from '$lib/types/scoring';
import type { TrickParameters } from '$lib/types/tricks';

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

const LICK_ID = 'lick-c';
const SAVED_TEMPO = 100;
const FULL_CIRCLE = circleOfFourthsFrom('C');

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

/** `bumpUnlockedKeyCount` is the only public write path for the unlock count. */
function setUnlockedCount(phraseId: string, target: number): void {
	for (let n = 1; n < target; n++) {
		bumpUnlockedKeyCount(lickPractice.progress, phraseId);
	}
}

function seedKeys(
	phraseId: string,
	entries: Partial<Record<PitchClass, { tempo?: number; rolling?: number }>>
): void {
	for (const [key, e] of Object.entries(entries)) {
		lickPractice.progress = updateKeyProgress(lickPractice.progress, phraseId, key as PitchClass, {
			...(e?.tempo !== undefined ? { currentTempo: e.tempo } : {}),
			...(e?.rolling !== undefined ? { rollingScore: e.rolling } : {})
		});
	}
	saveLickPracticeProgress(lickPractice.progress);
}

/**
 * A fully-unlocked lick saved at 100 BPM whose D is the wreck (0.4), A the
 * next-worst (0.7), E after that (0.8) and every other key comfortably
 * proficient (0.9) — so the worst-first admission order is deterministic.
 */
function seedTwelveKeyLick(): Phrase {
	const lick = makeLick('C', LICK_ID);
	setUnlockedCount(LICK_ID, 12);
	const entries: Partial<Record<PitchClass, { tempo?: number; rolling?: number }>> = {};
	for (const key of FULL_CIRCLE) entries[key] = { tempo: SAVED_TEMPO, rolling: 0.9 };
	entries.D = { tempo: SAVED_TEMPO, rolling: 0.4 };
	entries.A = { tempo: SAVED_TEMPO, rolling: 0.7 };
	entries.E = { tempo: SAVED_TEMPO, rolling: 0.8 };
	seedKeys(LICK_ID, entries);
	return lick;
}

/** Score the key at the given rotation index, as the close of its window would. */
function play(key: PitchClass, overall: number): void {
	const idx = lickPractice.plan[0].keys.indexOf(key);
	if (idx < 0) throw new Error(`${key} is not in the rotation ${lickPractice.plan[0].keys}`);
	lickPractice.currentKeyIndex = idx;
	recordKeyAttempt(makeScore(overall));
}

/** One round: every key in the rotation cleared at 0.97, then the boundary. */
function clearRotation(): void {
	for (const key of [...lickPractice.plan[0].keys]) play(key, 0.97);
	advanceSingleLickRound();
}

function rotation(): PitchClass[] {
	return [...lickPractice.plan[0].keys].sort();
}

beforeEach(() => {
	store.clear();
	resetSession();
	lickPractice.progress = {};
	lickPractice.config.tempoBumpPercent = undefined;
});

describe('startSingleLickSession with a focus key', () => {
	it('opens on the focus key alone, 10% under the saved tempo, with the full circle as the ring anchor', () => {
		const lick = seedTwelveKeyLick();
		expect(startSingleLickSession(lick, { focusKey: 'D' })).toBe(true);

		expect(lickPractice.plan[0].keys).toEqual(['D']);
		expect(lickPractice.currentTempo).toBe(focusStartTempo(SAVED_TEMPO)); // 90
		expect(lickPractice.currentTempo).toBe(90);
		expect([...lickPractice.sessionKeys].sort()).toEqual([...FULL_CIRCLE].sort());
		expect(lickPractice.ramp).toEqual({
			focusKey: 'D',
			targetTempo: SAVED_TEMPO,
			phase: 'focus',
			admitted: ['D'],
			queue: expect.any(Array),
			upToSpeedRound: null,
			rebuiltRound: null
		});
		// Worst-first queue: A, E, then the 0.9 keys in circle order.
		expect(lickPractice.ramp?.queue.slice(0, 2)).toEqual(['A', 'E']);
		expect(lickPractice.ramp?.queue).toHaveLength(11);
		expect(lickPractice.demoNextCycle).toBe(true);
	});

	it('falls back to the ordinary full-rotation start when the focus key is not unlocked', () => {
		// A brand-new lick has one unlocked key (its home key); A is not it.
		const lick = makeLick('C', 'fresh-lick');
		expect(startSingleLickSession(lick, { focusKey: 'A' })).toBe(true);

		expect(lickPractice.ramp).toBeNull();
		expect(lickPractice.plan[0].keys).toEqual(['C']);
		expect(lickPractice.currentTempo).toBe(deepPracticeStartTempo(60));
	});

	it('without a focus key behaves exactly as before: worst-first full circle, 2% under', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { tempoBumpPercent: 2 });

		expect(lickPractice.ramp).toBeNull();
		expect(lickPractice.plan[0].keys).toHaveLength(12);
		expect(lickPractice.plan[0].keys[0]).toBe('D');
		expect(lickPractice.currentTempo).toBe(deepPracticeStartTempo(SAVED_TEMPO));
		expect(lickPractice.config.tempoBumpPercent).toBe(2);
	});

	it('an omitted tempoBumpPercent keeps the configured knob instead of resetting it to the default', () => {
		// The report CTA never passed the knob, so it silently reset a 3% knob
		// to 1% — pre-existing; the options object fixes it.
		const lick = seedTwelveKeyLick();
		lickPractice.config.tempoBumpPercent = 3;
		startSingleLickSession(lick, { focusKey: 'D' });
		expect(lickPractice.config.tempoBumpPercent).toBe(3);

		resetSession();
		lickPractice.config.tempoBumpPercent = undefined;
		startSingleLickSession(lick);
		expect(lickPractice.config.tempoBumpPercent).toBe(DEFAULT_TEMPO_BUMP_PERCENT);
	});
});

describe('focus phase staircase', () => {
	it('a sub-floor attempt steps the tempo down and keeps the focus key alone', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });

		play('D', 0.6);
		advanceSingleLickRound();

		expect(lickPractice.currentTempo).toBe(87);
		expect(lickPractice.plan[0].keys).toEqual(['D']);
		expect(lickPractice.ramp?.phase).toBe('focus');
	});

	it('an attempt in the 75–94% band holds the tempo', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });

		play('D', 0.8);
		advanceSingleLickRound();

		expect(lickPractice.currentTempo).toBe(90);
		expect(lickPractice.plan[0].keys).toEqual(['D']);
	});

	it('clears step the tempo up one bump at a time and the key stays alone until it is up to speed', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });

		for (let round = 1; round <= 9; round++) {
			clearRotation();
			expect(lickPractice.currentTempo).toBe(90 + round);
			expect(lickPractice.plan[0].keys).toEqual(['D']);
			expect(lickPractice.ramp?.phase).toBe('focus');
		}
	});

	it('the clear that reaches the saved tempo admits the next-worst key and stamps the round', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });

		for (let round = 1; round <= 10; round++) clearRotation();

		expect(lickPractice.currentTempo).toBe(SAVED_TEMPO);
		expect(lickPractice.ramp?.phase).toBe('rebuild');
		expect(lickPractice.ramp?.upToSpeedRound).toBe(10);
		expect(lickPractice.ramp?.admitted).toEqual(['D', 'A']);
		expect(rotation()).toEqual(['A', 'D']);
	});

	it('never writes the lick tempo or a progress-history sample while ramping', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });

		play('D', 0.6);
		advanceSingleLickRound();
		for (let round = 1; round <= 4; round++) clearRotation();

		expect(lickPractice.currentTempo).not.toBe(SAVED_TEMPO);
		expect(getLickTempo(lickPractice.progress, LICK_ID)).toBe(SAVED_TEMPO);
		expect(lickPractice.progress[LICK_ID]?.D?.currentTempo).toBe(SAVED_TEMPO);
		expect(loadLickProgressHistory()[LICK_ID] ?? []).toEqual([]);
	});
});

describe('rebuild phase', () => {
	function rampToRebuild(): Phrase {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });
		for (let round = 1; round <= 10; round++) clearRotation();
		expect(lickPractice.ramp?.phase).toBe('rebuild');
		return lick;
	}

	it('each full clear admits one more key, worst first, with the tempo held', () => {
		rampToRebuild();

		clearRotation();
		expect(lickPractice.ramp?.admitted).toEqual(['D', 'A', 'E']);
		expect(rotation()).toEqual(['A', 'D', 'E']);
		expect(lickPractice.currentTempo).toBe(SAVED_TEMPO);

		clearRotation();
		expect(lickPractice.ramp?.admitted).toHaveLength(4);
		expect(lickPractice.plan[0].keys).toHaveLength(4);
		expect(lickPractice.currentTempo).toBe(SAVED_TEMPO);
	});

	it('a partial round keeps only the survivors, holds the tempo, and admits nobody', () => {
		rampToRebuild();

		play('D', 0.97);
		play('A', 0.6);
		advanceSingleLickRound();

		expect(lickPractice.plan[0].keys).toEqual(['A']);
		expect(lickPractice.currentTempo).toBe(SAVED_TEMPO);
		expect(lickPractice.ramp?.admitted).toEqual(['D', 'A']);

		// Clearing the survivor completes the round and admits the next key.
		clearRotation();
		expect(lickPractice.ramp?.admitted).toEqual(['D', 'A', 'E']);
		expect(rotation()).toEqual(['A', 'D', 'E']);
	});

	it('admitting the last key completes the ramp; the next clear bumps and refills like plain deep practice', () => {
		rampToRebuild();

		// 10 more keys to admit (12 − D − A): the tenth admission completes it.
		for (let n = 1; n <= 10; n++) {
			clearRotation();
			expect(lickPractice.currentTempo).toBe(SAVED_TEMPO);
		}
		expect(lickPractice.ramp?.phase).toBe('complete');
		expect(lickPractice.ramp?.rebuiltRound).toBe(20);
		expect(lickPractice.plan[0].keys).toHaveLength(12);

		clearRotation();
		expect(lickPractice.currentTempo).toBe(SAVED_TEMPO + 1);
		expect(lickPractice.plan[0].keys).toHaveLength(12);
		expect(lickPractice.ramp?.phase).toBe('complete');
	});

	it('still writes no lick tempo through the whole rebuild', () => {
		rampToRebuild();
		for (let n = 1; n <= 11; n++) clearRotation();
		expect(lickPractice.currentTempo).toBe(SAVED_TEMPO + 1);
		expect(getLickTempo(lickPractice.progress, LICK_ID)).toBe(SAVED_TEMPO);
		expect(loadLickProgressHistory()[LICK_ID] ?? []).toEqual([]);
	});
});

describe('ramp state lifecycle', () => {
	it('resetSession clears the ramp', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });
		expect(lickPractice.ramp).not.toBeNull();
		resetSession();
		expect(lickPractice.ramp).toBeNull();
	});

	it('startTrickSession clears the ramp too', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });
		expect(lickPractice.ramp).not.toBeNull();

		const e1: TrickParameters = {
			noteCount: '1',
			shape: 'chromatic-below',
			targetTone: 'root',
			beatPlacement: 'downbeat',
			type: 'major'
		};
		lickPractice.config.trickId = 'enclosures';
		lickPractice.config.trickParameters = e1;
		expect(startTrickSession()).toBe(true);
		expect(lickPractice.ramp).toBeNull();
	});
});

describe('session report', () => {
	it('carries the ramp summary with the lowest tempo reached', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });
		play('D', 0.6);
		advanceSingleLickRound();

		expect(getSessionReport().ramp).toEqual({
			focusKey: 'D',
			targetTempo: SAVED_TEMPO,
			lowestTempo: 87,
			upToSpeedRound: null,
			rebuiltRound: null
		});
	});

	it('stamps the milestones once they happen', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });
		for (let round = 1; round <= 10; round++) clearRotation();

		const ramp = getSessionReport().ramp;
		expect(ramp?.upToSpeedRound).toBe(10);
		expect(ramp?.rebuiltRound).toBeNull();
		expect(ramp?.lowestTempo).toBe(90);
	});

	it('is absent for a plain deep-practice session', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick);
		clearRotation();
		expect(getSessionReport().ramp).toBeUndefined();
	});
});
