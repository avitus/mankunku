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
	getDemoBars,
	getKeyPauses,
	getKeyPasses,
	getHandoffPreviewKey,
	getDeepCycleEntry,
	buildLickSuperPhrase,
	getPlannedKeysForLick,
	getFocusProjectionRows,
	isFocusTake,
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
import { planCycleWindows, cyclePositionAt } from '$lib/state/lick-practice-rotation';
import { buildPhaseTimeline, phaseCueAt } from '$lib/state/lick-practice-phase';
import { addFractions } from '$lib/music/intervals';
import { circleOfFourthsFrom } from '$lib/music/key-ordering';
import type { PitchClass, Phrase } from '$lib/types/music';
import type { Score } from '$lib/types/scoring';
import type { TrickParameters } from '$lib/types/tricks';
import { settings } from '$lib/state/settings.svelte';
import { render } from 'svelte/server';
import UpcomingKeysDisplay from '$lib/components/lick-practice/UpcomingKeysDisplay.svelte';
import { INSTRUMENTS } from '$lib/types/instruments';

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
 * next-worst (0.5), E after that (0.8) and every other key comfortably
 * proficient (0.9) — so both the worst-first admission order AND the
 * worst-first sort of the live rotation are deterministic with clear margins
 * (D's EWMA climbs past 0.96 over ten clears; A's stays well under E's).
 */
function seedTwelveKeyLick(): Phrase {
	const lick = makeLick('C', LICK_ID);
	setUnlockedCount(LICK_ID, 12);
	const entries: Partial<Record<PitchClass, { tempo?: number; rolling?: number }>> = {};
	for (const key of FULL_CIRCLE) entries[key] = { tempo: SAVED_TEMPO, rolling: 0.9 };
	entries.D = { tempo: SAVED_TEMPO, rolling: 0.4 };
	entries.A = { tempo: SAVED_TEMPO, rolling: 0.5 };
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

/** The live rotation in its actual (worst-first) order — never sorted here. */
function rotation(): PitchClass[] {
	return [...lickPractice.plan[0].keys];
}

beforeEach(() => {
	// These fixtures spell the unlock ramp in concert pitch (C, G, F, …);
	// the ramp counts accidentals in WRITTEN pitch, so pin a C instrument.
	settings.instrumentId = 'concert';
	store.clear();
	resetSession();
	lickPractice.progress = {};
	lickPractice.config.tempoBumpPercent = undefined;
	lickPractice.config.practiceMode = 'continuous';
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
	it('gives sheet graduation into a same-key handoff a full unscored preparation bar', () => {
		const lick = makeLick('C', LICK_ID);
		setUnlockedCount(LICK_ID, 2);
		seedKeys(LICK_ID, { C: { tempo: 50, rolling: 0.9 }, G: { tempo: 50, rolling: 0.7 } });
		startSingleLickSession(lick, { focusKey: 'G' });
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);
		clearRotation();
		expect(lickPractice.ramp?.phase).toBe('handoff');
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
		expect(rotation()).toEqual(['G']);
		expect(getHandoffPreviewKey(0)?.key).toBe('C');
		expect(getDeepCycleEntry(0)).toMatchObject({ repeat: true, fromMemory: true, prepareBars: 1 });
		expect(getKeyPauses(0)).toEqual([1]);
		const ticksPerBar = 4 * 192;
		const windows = planCycleWindows({
			audioStartTick: 0, demoBars: getDemoBars(0), keyBars: 2, ticksPerBar,
			keyCount: 1, passes: getKeyPasses(0), pauses: getKeyPauses(0), userBarsOffsetTicks: 0
		});
		expect(windows.opens).toEqual([ticksPerBar]);
		expect(windows.closes).toEqual([3 * ticksPerBar]);
		const timeline = buildPhaseTimeline({ audioStartTick: 0, windows, ticksPerBar });
		for (let beat = 0; beat < 4; beat++) {
			expect(phaseCueAt(beat * 192, timeline, 192)).toMatchObject({ phase: 'read', countdown: 4 - beat });
			expect(cyclePositionAt(beat * 192, {
				audioStartTick: 0, demoBars: 0, keyBars: 2, ticksPerBar,
				ticksPerBeat: 192, loopBeats: 8, windows
			}).beat).toBe(-1);
		}
		expect(phaseCueAt(ticksPerBar, timeline, 192).phase).toBe('play');
		// The promised key follows that repeat without another surprise repeat.
		clearRotation();
		expect(rotation()[0]).toBe('C');
		expect(getKeyPauses(0)[0]).toBe(0);
	});

	it('uses the call as preparation in call and response, without adding a silent bar', () => {
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		lickPractice.config.practiceMode = 'call-response';
		clearRotation();
		expect(getKeyPauses(0)).toEqual([0]);
		expect(getKeyPasses(0)).toEqual([1]);
	});

	it('joins a held, stepped-up or stepped-down focus take on the downbeat, but still prepares a post-ramp refill', () => {
		// Andy, 2026-10-24: the staircase no longer stops for a bar between
		// takes — the stack already shows the takes to come and their tempos.
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		for (const score of [0.85, 0.97, 0.6]) {
			play('D', score);
			advanceSingleLickRound();
			expect(isFocusTake()).toBe(true);
			expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
			expect(getKeyPauses(0)).toEqual([0]);
			expect(getDemoBars(0)).toBe(0);
		}
		lickPractice.ramp!.phase = 'complete';
		clearRotation();
		expect(rotation()).toHaveLength(12);
		expect(getKeyPauses(0)[0]).toBeGreaterThanOrEqual(1);
	});

	it('stops a focus take for one bar only when the sheet comes or goes', () => {
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		/** Score the focus take, close its cycle, and read the next take's sheet and bars. */
		const step = (score: number) => {
			play('D', score);
			advanceSingleLickRound();
			return { sheet: getPlannedKeysForLick(0)[0].reveal, pauses: getKeyPauses(0) };
		};
		// Below gold, but no rescue yet: chords, no bar.
		expect(step(0.85)).toEqual({ sheet: false, pauses: [0] });
		expect(step(0.85)).toEqual({ sheet: false, pauses: [0] });
		// The third below-gold take brings the sheet back: a bar to switch to reading.
		expect(step(0.85)).toEqual({ sheet: true, pauses: [1] });
		expect(getKeyPasses(0)).toEqual([3]);
		// Even a missed triple commits to memory, with a bar to prepare.
		expect(step(0.85)).toEqual({ sheet: false, pauses: [1] });
		// A successful memory turn keeps playing without a new preparation bar.
		expect(step(0.97)).toEqual({ sheet: false, pauses: [0] });
		expect(lickPractice.ramp?.phase).toBe('focus');
	});

	it('keeps call and response unchanged: no projected takes and no tempo tags', () => {
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		lickPractice.config.practiceMode = 'call-response';
		clearRotation();
		expect(isFocusTake()).toBe(false);
		expect(getFocusProjectionRows(0)).toEqual([]);
		expect(getPlannedKeysForLick(0)[0].tempo).toBeUndefined();
	});

	it('at 83 BPM, previews an earned admission for a full extra loop and honors it after a bad repeat', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });
		lickPractice.ramp!.targetTempo = 83;
		lickPractice.currentTempo = 82;

		clearRotation();
		expect(rotation()).toEqual(['D']);
		expect(lickPractice.currentTempo).toBe(83);
		expect(lickPractice.ramp?.phase).toBe('focus');
		expect(lickPractice.ramp?.upToSpeedRound).toBeNull();

		clearRotation();
		expect(lickPractice.ramp?.phase).toBe('handoff');
		expect(rotation()).toEqual(['D']);
		expect(lickPractice.ramp?.queue[0]).toBe('A');
		expect(lickPractice.ramp?.admitted).toEqual(['D']);
		expect(getDemoBars(0)).toBe(0);
		expect(getKeyPauses(0)).toEqual([1]);

		// This low score makes D weaker than A again. It must neither revoke
		// the promised admission nor sort D ahead of the chart already shown.
		play('D', 0);
		advanceSingleLickRound();
		expect(rotation()).toEqual(['A', 'D']);
		expect(lickPractice.ramp?.phase).toBe('rebuild');
		expect(lickPractice.currentTempo).toBe(83);
		expect(lickPractice.allAttempts.at(-1)?.[0].score).toBe(0);
		expect(getLickTempo(lickPractice.progress, LICK_ID)).toBe(SAVED_TEMPO);
	});

	it('does not cancel a promised admission when the repeat has no score', () => {
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		lickPractice.currentTempo = SAVED_TEMPO;
		clearRotation();
		expect(lickPractice.ramp?.phase).toBe('handoff');
		advanceSingleLickRound();
		expect(rotation()[0]).toBe('A');
		expect(lickPractice.ramp?.admitted).toEqual(['D', 'A']);
	});

	it('a handoff announces one extra play with one preparation bar, confined to Deep', () => {
		const lick = makeLick('C', LICK_ID);
		setUnlockedCount(LICK_ID, 2);
		seedKeys(LICK_ID, { C: { tempo: 50, rolling: 0.9 }, G: { tempo: 50, rolling: 0.1 } });
		startSingleLickSession(lick, { focusKey: 'G' });
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);
		clearRotation();
		expect(lickPractice.ramp?.phase).toBe('handoff');
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
		expect(getKeyPasses(0)).toEqual([1]);
		expect(getKeyPauses(0)).toEqual([1]);
		expect(getHandoffPreviewKey(0)?.key).toBe('C');
		lickPractice.mode = 'standard';
		lickPractice.plan[0].keys = [...lickPractice.plan[0].keys];
		expect(getKeyPasses(0)).toEqual([3]);
		expect(getHandoffPreviewKey(0)).toBeNull();
	});

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

	it('a target clear previews the next key for one loop before admitting it', () => {
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		for (let round = 1; round <= 11; round++) clearRotation();
		expect(lickPractice.currentTempo).toBe(SAVED_TEMPO);
		expect(lickPractice.ramp?.phase).toBe('handoff');
		expect(lickPractice.ramp?.upToSpeedRound).toBe(11);
		expect(getHandoffPreviewKey(0)?.key).toBe('A');
		expect(getHandoffPreviewKey(0)?.reveal).toBe(false);
		expect(getPlannedKeysForLick(0).map(row => row.key)).toEqual(['D']);
		expect(getKeyPasses(0)).toEqual([1]);
		expect(getKeyPauses(0)).toEqual([1]);
		// The preview has no play window: a one-bar vamp precedes only D.
		const audio = buildLickSuperPhrase(0)!;
		expect(audio.harmony.filter(segment => segment.startOffset[0] / segment.startOffset[1] >= 1)).toEqual(
			getPlannedKeysForLick(0)[0].harmony.map(segment => ({ ...segment, startOffset: addFractions(segment.startOffset, [1, 1]) }))
		);
		clearRotation();
		expect(lickPractice.ramp?.phase).toBe('rebuild');
		expect(lickPractice.ramp?.admitted).toEqual(['D', 'A']);
		expect(rotation()).toEqual(['A', 'D']);
		expect(getHandoffPreviewKey(0)).toBeNull();
		expect(lickPractice.demoNextCycle).toBe(false);
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

describe('focus takes on the stack', () => {
	it.each([0, 0.6, 0.85, 0.95, 0.99, undefined])('commits to the previewed memory turn after a sheet triple scoring %s', (score) => {
		const lick = makeLick('C', LICK_ID);
		seedKeys(LICK_ID, { C: { tempo: SAVED_TEMPO, rolling: 0.5 } });
		startSingleLickSession(lick, { focusKey: 'C' });
		expect(getPlannedKeysForLick(0)[0]).toMatchObject({ key: 'C', reveal: true, passes: 3 });
		const preview = getFocusProjectionRows(0)[0];
		expect(preview).toMatchObject({ key: 'C', reveal: false, passes: 1 });
		if (score !== undefined) play('C', score);
		// Scoring cannot change the current sheet or the promised memory row.
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);
		expect(getFocusProjectionRows(0)[0]).toEqual(preview);
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0)[0]).toMatchObject({
			key: preview.key, reveal: preview.reveal, passes: preview.passes, cycle: preview.cycle
		});
		expect(getKeyPasses(0)).toEqual([1]);
		expect(getKeyPauses(0)).toEqual([1]);
		expect(getDemoBars(0)).toBe(0);
		expect(getDeepCycleEntry(0)).toMatchObject({ fromMemory: true, prepareBars: 1 });
		const ticksPerBar = 4 * 192;
		const windows = planCycleWindows({
			audioStartTick: 0, demoBars: getDemoBars(0), keyBars: 2, ticksPerBar,
			keyCount: 1, passes: getKeyPasses(0), pauses: getKeyPauses(0), userBarsOffsetTicks: 0
		});
		expect(windows.opens).toEqual([ticksPerBar]);
		expect(windows.closes).toEqual([3 * ticksPerBar]);
	});

	/** The current take's tempo tag, then the tags of the takes drawn under it. */
	function stack(): { current: number | undefined; below: (number | undefined)[] } {
		return {
			current: getPlannedKeysForLick(0)[0]?.tempo,
			below: getFocusProjectionRows(0).map((row) => row.tempo)
		};
	}
	/** The whole numbers from `from` to `to`, inclusive. */
	const range = (from: number, to: number): number[] =>
		Array.from({ length: to - from + 1 }, (_, i) => from + i);

	it('draws one row per take still needed, each tagged with its tempo, under the current take', () => {
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		expect(stack()).toEqual({ current: 90, below: range(91, 100) });
		const rows = getFocusProjectionRows(0);
		expect(rows.every((row) => row.key === 'D' && row.reveal === false && row.passes === 1)).toBe(true);
		expect(rows.map((row) => row.keyIndex)).toEqual(range(1, 10));
		// Display only: the cycle still schedules one take.
		expect(getKeyPasses(0)).toEqual([1]);
		expect(getKeyPauses(0)).toEqual([0]);
	});

	it('a clear moves up a row, a hold adds one at its own tempo, a step down adds the climb back', () => {
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		play('D', 0.97);
		advanceSingleLickRound();
		expect(stack()).toEqual({ current: 91, below: range(92, 100) });

		play('D', 0.85);
		advanceSingleLickRound();
		expect(stack()).toEqual({ current: 91, below: range(92, 100) });

		play('D', 0.6);
		advanceSingleLickRound();
		expect(stack()).toEqual({ current: 88, below: range(89, 100) });
	});

	it('the target take has its next take under it; its clear keeps the once-more handoff, tagged, with the next key untagged', () => {
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		for (let round = 1; round <= 10; round++) clearRotation();
		// Whatever the target take scores, the focus key comes again at the
		// target: the once-more after a clear, another try after a miss.
		expect(stack()).toEqual({ current: SAVED_TEMPO, below: [SAVED_TEMPO] });

		clearRotation();
		expect(lickPractice.ramp?.phase).toBe('handoff');
		expect(isFocusTake()).toBe(false);
		expect(stack()).toEqual({ current: SAVED_TEMPO, below: [] });
		expect(getHandoffPreviewKey(0)?.tempo).toBeUndefined();
		expect(getKeyPauses(0)).toEqual([1]);

		clearRotation();
		expect(lickPractice.ramp?.phase).toBe('rebuild');
		expect(getPlannedKeysForLick(0).map((row) => row.tempo)).toEqual([undefined, undefined]);
		expect(getFocusProjectionRows(0)).toEqual([]);
	});

	it('a missed sheet triple at the target honors its memory preview before rescue can return', () => {
		// Andy's recommended drill: twice the stack emptied after a three-pass
		// sheet take and the next take appeared on the downbeat it had to be
		// played on. The take at the target had nothing drawn under it — the
		// projection listed only the takes still needed if every one cleared.
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		for (let round = 1; round <= 10; round++) clearRotation();
		expect(lickPractice.currentTempo).toBe(SAVED_TEMPO);
		// Three takes under gold at the target bring the sheet back, with its bar.
		for (const score of [0.85, 0.85, 0.85]) {
			play('D', score);
			advanceSingleLickRound();
		}
		expect(getPlannedKeysForLick(0)[0]).toMatchObject({ reveal: true, passes: 3, tempo: SAVED_TEMPO });
		expect(getKeyPauses(0)).toEqual([1]);

		// The triple commits to memory; only a subsequent memory miss may
		// restore the sheet, with preparation for both display changes.
		for (const [score, nextTempo, reveal, passes] of [[0.85, SAVED_TEMPO, false, 1], [0.6, 97, true, 3]] as const) {
			expect(getFocusProjectionRows(0)[0]).toMatchObject({ key: 'D', reveal: false, passes: 1 });
			play('D', score);
			advanceSingleLickRound();
			expect(isFocusTake()).toBe(true);
			expect(lickPractice.currentTempo).toBe(nextTempo);
			expect(getPlannedKeysForLick(0)[0]).toMatchObject({ reveal, passes });
			expect(getKeyPauses(0)).toEqual([1]);
		}
	});

	it('2026-10-25: the stack under a take at the target holds its next take, through the cycle end too', () => {
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		for (let round = 1; round <= 10; round++) clearRotation();
		// A missed take at the target: the next one is the target again.
		play('D', 0.85);
		advanceSingleLickRound();
		for (const scrollFraction of [0, 0.5, 1]) {
			const { body } = render(UpcomingKeysDisplay, { props: {
				deep: true, currentBeat: 0, isPlaying: true, isRecording: true, scrollFraction,
				instrument: INSTRUMENTS['tenor-sax'],
				cue: { phase: 'play' as const, next: null, beatsUntilNext: null, countdown: 0 },
				plannedKeys: getPlannedKeysForLick(0),
				projectedRows: getFocusProjectionRows(0)
			} });
			const drawn = body.split('<div class="row ').slice(1);
			expect(drawn.map((row) => row.match(/data-key="([^"]+)"/)?.[1])).toEqual(['D', 'D']);
			expect(drawn.map((row) => row.match(/data-testid="row-tempo">(\d+) BPM/)?.[1])).toEqual(
				[String(SAVED_TEMPO), String(SAVED_TEMPO)]
			);
			expect(drawn.map((row) => /^[^"]*\bcurrent\b/.test(row))).toEqual([true, false]);
		}
	});

	it('never joins a focus take on the downbeat unless it was drawn under the take before it', () => {
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		// Clears up to the target, a hold and a step down there, the climb
		// back, three misses that bring the sheet, a held and a sub-floor sheet
		// take — every boundary the staircase has short of the target clear.
		const scores = [
			...Array.from({ length: 10 }, () => 0.97), 0.85, 0.6, 0.97, 0.97, 0.97,
			0.85, 0.85, 0.85, 0.85, 0.6
		];
		let joinsAtTarget = 0;
		for (const score of scores) {
			const atTarget = lickPractice.currentTempo === SAVED_TEMPO;
			const drawn = getFocusProjectionRows(0).some((row) => row.key === 'D');
			play('D', score);
			advanceSingleLickRound();
			expect(isFocusTake()).toBe(true);
			if (getKeyPauses(0)[0] === 0) {
				expect(drawn, `the take after ${score} at ${atTarget ? 'the target' : 'a step'}`).toBe(true);
				if (atTarget) joinsAtTarget++;
			}
		}
		expect(joinsAtTarget).toBeGreaterThanOrEqual(3);
	});

	it('a sheet triple projects memory turns for the rest of the successful climb', () => {
		const lick = makeLick('C', LICK_ID);
		seedKeys(LICK_ID, { C: { tempo: SAVED_TEMPO, rolling: 0.7 } });
		startSingleLickSession(lick, { focusKey: 'C' });
		expect(getPlannedKeysForLick(0)[0]).toMatchObject({ reveal: true, passes: 3 });
		const rows = getFocusProjectionRows(0);
		expect(rows).toHaveLength(10);
		expect(rows.every((row) => !row.reveal && row.passes === 1)).toBe(true);
	});

	it('stamps each row with its round, so a score lands on its own take', () => {
		startSingleLickSession(seedTwelveKeyLick(), { focusKey: 'D' });
		const round = lickPractice.roundNumber;
		expect(getPlannedKeysForLick(0)[0].cycle).toBe(round);
		expect(getFocusProjectionRows(0).slice(0, 2).map((row) => row.cycle)).toEqual([round + 1, round + 2]);
		clearRotation();
		expect(getPlannedKeysForLick(0)[0].cycle).toBe(round + 1);
	});

	it('plain deep practice draws no projected takes and no tempo tags', () => {
		startSingleLickSession(seedTwelveKeyLick());
		expect(isFocusTake()).toBe(false);
		expect(getFocusProjectionRows(0)).toEqual([]);
		expect(getPlannedKeysForLick(0).every((row) => row.tempo === undefined)).toBe(true);
	});
});

describe('rebuild phase', () => {
	/** Reach the first admitted key through the staircase and its committed repeat. */
	function rampToRebuild(): Phrase {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });
		for (let round = 1; round <= 12; round++) clearRotation();
		expect(lickPractice.ramp?.phase).toBe('rebuild');
		return lick;
	}

	it('each full clear previews one more key, then starts it first with the tempo held', () => {
		rampToRebuild();

		clearRotation();
		expect(lickPractice.ramp?.phase).toBe('handoff');
		expect(getHandoffPreviewKey(0)?.key).toBe('E');
		clearRotation();
		expect(lickPractice.ramp?.admitted).toEqual(['D', 'A', 'E']);
		// A ≈ 0.69 after one clear, E enters at 0.8, D ≈ 0.97.
		expect(rotation()).toEqual(['E', 'A', 'D']);
		expect(lickPractice.currentTempo).toBe(SAVED_TEMPO);

		clearRotation();
		expect(getHandoffPreviewKey(0)?.key).toBe('C');
		clearRotation();
		expect(lickPractice.ramp?.admitted).toEqual(['D', 'A', 'E', 'C']);
		// A ≈ 0.80, E ≈ 0.87, C enters at 0.9, D ≈ 0.97.
		expect(rotation()).toEqual(['C', 'A', 'E', 'D']);
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

		// Clearing the survivor earns a repeat with advance notice of the next key.
		clearRotation();
		expect(lickPractice.ramp?.phase).toBe('handoff');
		expect(getHandoffPreviewKey(0)?.key).toBe('E');
		clearRotation();
		expect(lickPractice.ramp?.admitted).toEqual(['D', 'A', 'E']);
		// A ≈ 0.71 after the 0.6 and the clear, E enters at 0.8, D ≈ 0.97.
		expect(rotation()).toEqual(['E', 'A', 'D']);
	});

	it('admitting the last key completes the ramp; the next clear bumps and refills like plain deep practice', () => {
		rampToRebuild();

		// Ten remaining admissions, each with a clear and a committed repeat.
		for (let n = 1; n <= 20; n++) {
			clearRotation();
			expect(lickPractice.currentTempo).toBe(SAVED_TEMPO);
		}
		expect(lickPractice.ramp?.phase).toBe('complete');
		expect(lickPractice.ramp?.rebuiltRound).toBe(32);
		expect(lickPractice.plan[0].keys).toHaveLength(12);

		clearRotation();
		expect(lickPractice.currentTempo).toBe(SAVED_TEMPO + 1);
		expect(lickPractice.plan[0].keys).toHaveLength(12);
		expect(lickPractice.ramp?.phase).toBe('complete');
	});

	it('still writes no lick tempo through the whole rebuild', () => {
		rampToRebuild();
		for (let n = 1; n <= 21; n++) clearRotation();
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
		for (let round = 1; round <= 11; round++) clearRotation();

		const ramp = getSessionReport().ramp;
		expect(ramp?.upToSpeedRound).toBe(11);
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

describe('the demo on the staircase and the rebuild', () => {
	it('graduates from the sheet with preparation and no new demo; a small mistake after it plays straight on', () => {
		const lick = makeLick('C', LICK_ID);
		seedKeys(LICK_ID, { C: { tempo: SAVED_TEMPO, rolling: 0.7 } });
		startSingleLickSession(lick, { focusKey: 'C' });
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(true);

		clearRotation();
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
		expect(getDemoBars(0)).toBe(0);
		expect(getKeyPauses(0)).toEqual([1]);

		play('C', 0.85);
		advanceSingleLickRound();
		expect(getPlannedKeysForLick(0)[0].reveal).toBe(false);
		expect(getDemoBars(0)).toBe(0);
		expect(getKeyPauses(0)).toEqual([0]);
	});

	it('skips the demo after the focus key clears — a step up is a refill of the one-key rotation', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });
		expect(lickPractice.demoNextCycle).toBe(true); // the session-start reminder

		clearRotation();

		// D's EWMA is 0.4 → 0.63 after one clear, far under proficient; the
		// old rule replayed the line at every step up regardless.
		expect(rotation()).toEqual(['D']);
		expect(lickPractice.currentTempo).toBeGreaterThan(focusStartTempo(SAVED_TEMPO));
		expect(lickPractice.demoNextCycle).toBe(false);
	});

	it('keeps playing after a miss in the focused drill', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });

		play('D', 0.6);
		advanceSingleLickRound();

		expect(rotation()).toEqual(['D']);
		expect(lickPractice.demoNextCycle).toBe(false);
		expect(getDemoBars(0)).toBe(0);
	});

	it('skips the demo on the clear that re-admits a key during the rebuild', () => {
		const lick = seedTwelveKeyLick();
		startSingleLickSession(lick, { focusKey: 'D' });
		for (let round = 1; round <= 14; round++) clearRotation();

		expect(lickPractice.ramp?.phase).toBe('rebuild');
		expect(rotation()).toHaveLength(3);
		expect(lickPractice.demoNextCycle).toBe(false);
	});
});
