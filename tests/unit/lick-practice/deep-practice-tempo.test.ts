/**
 * Deep Practice owns its tempo, and only for the duration of the session.
 *
 * Two rules, and one prohibition that is the point of the whole file:
 *
 * 1. A session OPENS below the lick's stored tempo
 *    (`deepPracticeStartTempo`). Deep Practice is usually entered from the
 *    report's recommendation, on the lick that just graded worst — dropping
 *    straight back in at the tempo it failed at repeats the failure.
 * 2. It ramps back by a PERCENTAGE per cleared rotation (`nextCycleTempo`),
 *    rounded up, so the rule reads the same at 60 BPM and at 200 and can
 *    never round to a no-op bump.
 * 3. **None of that is persisted.** Deep Practice is one lick with a demo
 *    and a worst-first rotation; Daily Practice is a dozen licks cold. If
 *    the drill's ramp set the stored tempo, the next daily session would run
 *    the lick far above the tempo its grades were actually earned at — the
 *    reported bug. Two paths used to write it (`recordKeyAttempt` on every
 *    attempt, `advanceSingleLickRound` on every full clear) plus a
 *    progress-history sample; all three are covered below.
 *
 * The trick branch of `advanceSingleLickRound` deliberately still persists —
 * clearing the rotation IS the trick unlock. That is asserted in
 * `tests/unit/state/trick-session.test.ts`, not here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	startSingleLickSession,
	recordKeyAttempt,
	advanceSingleLickRound,
	resetSession
} from '$lib/state/lick-practice.svelte';
import {
	bumpUnlockedKeyCount,
	getLickTempo,
	loadLickProgressHistory,
	saveLickPracticeProgress,
	updateKeyProgress,
	NEW_LICK_DEFAULT_TEMPO
} from '$lib/persistence/lick-practice-store';
import {
	deepPracticeStartTempo,
	nextCycleTempo,
	DEFAULT_TEMPO_BUMP_PERCENT
} from '$lib/state/lick-practice-rotation';
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

/** Seed a lick's stored tempo on the given keys, as a prior session would have. */
function seedTempo(phraseId: string, tempos: Partial<Record<PitchClass, number>>): void {
	for (const [key, bpm] of Object.entries(tempos)) {
		lickPractice.progress = updateKeyProgress(
			lickPractice.progress,
			phraseId,
			key as PitchClass,
			{ currentTempo: bpm as number }
		);
	}
	saveLickPracticeProgress(lickPractice.progress);
}

/** `bumpUnlockedKeyCount` is the only public write path for the unlock count. */
function setUnlockedCount(phraseId: string, target: number): void {
	for (let n = 1; n < target; n++) {
		bumpUnlockedKeyCount(lickPractice.progress, phraseId);
	}
}

/** Clear the whole current rotation, driving one full cycle boundary. */
function clearRotation(): void {
	lickPractice.masteredThisRound = [...lickPractice.plan[0].keys];
	advanceSingleLickRound();
}

/** Score every key in the rotation once, as a full cycle would. */
function playEveryKeyInRotation(): void {
	for (let i = 0; i < lickPractice.plan[0].keys.length; i++) {
		lickPractice.currentKeyIndex = i;
		recordKeyAttempt(makeScore(0.8));
	}
}

beforeEach(() => {
	store.clear();
	resetSession();
	lickPractice.progress = {};
});

describe('deepPracticeStartTempo', () => {
	it('opens 2% below the stored tempo, rounded', () => {
		expect(deepPracticeStartTempo(120)).toBe(118); // 117.6 → 118
		expect(deepPracticeStartTempo(200)).toBe(196);
		expect(deepPracticeStartTempo(100)).toBe(98);
	});

	it('always steps down by at least 1 BPM, even where 2% rounds back to the input', () => {
		// 60 * 0.98 = 58.8 → 59 on its own; the guard matters lower down,
		// where rounding alone would return the input and silently disable
		// the ease-in.
		expect(deepPracticeStartTempo(60)).toBe(59);
		for (const bpm of [51, 55, 60, 74]) {
			expect(deepPracticeStartTempo(bpm)).toBeLessThan(bpm);
		}
	});

	it('clamps at MIN_TEMPO rather than stepping below it', () => {
		expect(deepPracticeStartTempo(50)).toBe(50);
	});
});

describe('nextCycleTempo', () => {
	it('adds the percentage, rounded UP to a whole BPM', () => {
		expect(nextCycleTempo(120, 1)).toBe(122); // 1.2 → 2
		expect(nextCycleTempo(100, 1)).toBe(101); // exactly 1
		expect(nextCycleTempo(200, 1)).toBe(202);
	});

	it('never rounds down to a no-op bump below 100 BPM', () => {
		for (let bpm = 50; bpm < 100; bpm++) {
			expect(nextCycleTempo(bpm, DEFAULT_TEMPO_BUMP_PERCENT)).toBe(bpm + 1);
		}
	});

	it('honours a non-default percent from the setup knob', () => {
		expect(nextCycleTempo(120, 5)).toBe(126);
		expect(nextCycleTempo(120, 0.5)).toBe(121); // 0.6 → 1
	});

	it('clamps at MAX_TEMPO', () => {
		expect(nextCycleTempo(300, 1)).toBe(300);
		expect(nextCycleTempo(299, 1)).toBe(300);
	});
});

describe('deep practice never writes the lick tempo', () => {
	it('opens 2% below the stored tempo and ramps 1% per cleared rotation', () => {
		seedTempo('lick-c', { C: 120 });
		startSingleLickSession(makeLick('C', 'lick-c'));

		expect(lickPractice.currentTempo).toBe(118);
		clearRotation();
		expect(lickPractice.currentTempo).toBe(120);
		clearRotation();
		expect(lickPractice.currentTempo).toBe(122);
	});

	it('leaves the stored tempo untouched after a session that ramped past it', () => {
		// THE reported bug: return to Daily Practice and the lick is suddenly
		// far faster than the tempo its grades were earned at.
		seedTempo('lick-c', { C: 120 });
		startSingleLickSession(makeLick('C', 'lick-c'));

		recordKeyAttempt(makeScore(0.97));
		clearRotation();
		recordKeyAttempt(makeScore(0.97));
		clearRotation();

		expect(lickPractice.currentTempo).toBe(122); // the session did ramp…
		expect(getLickTempo(lickPractice.progress, 'lick-c')).toBe(120); // …storage did not
		expect(lickPractice.progress['lick-c']?.C?.currentTempo).toBe(120);
	});

	it('does not drag a fast key down to the lick baseline either', () => {
		// The baseline is the MINIMUM across keys, so a naive "write the
		// baseline everywhere" would quietly slow C from 130 to 110. Both keys
		// must be IN the rotation for this to bite: the unlocked circle from C
		// at count 2 is [C, G], so seed those two and not F.
		seedTempo('two-key-lick', { C: 130, G: 110 });
		setUnlockedCount('two-key-lick', 2);
		startSingleLickSession(makeLick('C', 'two-key-lick'));
		expect(lickPractice.plan[0].keys.slice().sort()).toEqual(['C', 'G']);
		expect(lickPractice.currentTempo).toBe(deepPracticeStartTempo(110)); // 108

		playEveryKeyInRotation();

		// Pre-change both of these were 108 — the session tempo.
		expect(lickPractice.progress['two-key-lick']?.C?.currentTempo).toBe(130);
		expect(lickPractice.progress['two-key-lick']?.G?.currentTempo).toBe(110);
	});

	it('seeds a key with no prior entry from the lick baseline, not the session tempo', () => {
		// The `?? resolveLickTempo` arm of the guard: C has history, G does not,
		// and G is in the rotation. Its first-ever entry must take the lick's
		// baseline (130) rather than the eased-in 127 the session is running at.
		seedTempo('partial-lick', { C: 130 });
		setUnlockedCount('partial-lick', 2);
		startSingleLickSession(makeLick('C', 'partial-lick'));
		expect(lickPractice.plan[0].keys.slice().sort()).toEqual(['C', 'G']);
		expect(lickPractice.currentTempo).toBe(127); // min(129, round(127.4))

		playEveryKeyInRotation();

		expect(lickPractice.progress['partial-lick']?.G?.currentTempo).toBe(130);
		expect(lickPractice.progress['partial-lick']?.G?.currentTempo).not.toBe(
			lickPractice.currentTempo
		);
		expect(lickPractice.progress['partial-lick']?.C?.currentTempo).toBe(130);
	});

	it('records no progress-history sample when the rotation clears', () => {
		seedTempo('lick-c', { C: 120 });
		startSingleLickSession(makeLick('C', 'lick-c'));

		recordKeyAttempt(makeScore(0.97));
		clearRotation();
		clearRotation();

		expect(loadLickProgressHistory()['lick-c'] ?? []).toEqual([]);
	});

	it('still seeds a brand-new lick at 60, not the eased-in tempo and not the 100-BPM store default', () => {
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		expect(lickPractice.currentTempo).toBe(59);

		recordKeyAttempt(makeScore(0.6));

		expect(lickPractice.progress['fresh-lick']?.C?.currentTempo).toBe(NEW_LICK_DEFAULT_TEMPO);
	});

	it('still records the rolling score and practice recency — only tempo is withheld', () => {
		seedTempo('lick-c', { C: 120 });
		startSingleLickSession(makeLick('C', 'lick-c'));

		recordKeyAttempt(makeScore(0.62));

		const entry = lickPractice.progress['lick-c']?.C;
		expect(entry!.rollingScore).toBeCloseTo(0.62, 10);
		expect(entry!.lastPracticedAt).toBeGreaterThan(0);
		expect(entry!.currentTempo).toBe(120);
	});
});
