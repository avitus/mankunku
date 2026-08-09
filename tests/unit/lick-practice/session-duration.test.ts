/**
 * Session-duration cost model.
 *
 * A standard / Daily Practice session plays its plan exactly once and stops —
 * `startInterLickTransition` advances until the plan is exhausted, it never
 * loops. So "how long will this session take" is a pure function of the plan,
 * and the number the setup screen shows must be that function, not the
 * duration knob (which is only a budget the plan may never fill).
 *
 * The bar layout the scheduler actually plays, per lick, in a continuous
 * standard/daily session (routes/lick-practice/session/+page.svelte):
 *
 *   count-in       1 bar   (playPhrase offsets the first lick by one bar)
 *   lick 0 audio   demoBars + keys × keyBars     ← buildLickSuperPhrase
 *   score hold     1 bar   (SCORE_HOLD_BARS, display freeze)
 *   rest bar 2     1 bar   (INTER_LICK_REST_BARS − SCORE_HOLD_BARS, new tempo)
 *   lick 1 audio   …
 *   …
 *   lick n-1 audio …
 *   score hold     1 bar   → finishSession
 *
 * Since INTER_LICK_REST_BARS (2) === count-in (1) + score hold (1), every lick
 * costs exactly `audioBars + 2` bars at its own tempo, and the sum over the
 * plan is the session length to the bar.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── localStorage stub shared by tag store, progress store, session log ──

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

import {
	INTER_LICK_REST_BARS,
	SESSION_COUNT_IN_BARS,
	SCORE_HOLD_BARS,
	barsToSeconds,
	lickAudioBars,
	lickSlotBars,
	estimateLickSeconds,
	estimateSessionSeconds
} from '$lib/state/lick-practice-duration';
import {
	lickPractice,
	buildDailyPracticePlan,
	buildSessionPlan,
	buildLickSuperPhrase,
	estimatePlanSeconds,
	previewSessionSeconds,
	startDailyPracticeSession,
	startSingleLickSession,
	getLickBars,
	resolveLickTempo
} from '$lib/state/lick-practice.svelte';
import {
	togglePracticeTag,
	toggleProgressionTag,
	bumpUnlockedKeyCount
} from '$lib/persistence/lick-practice-store';
import { getAllLicks } from '$lib/phrases/library-loader';

beforeEach(() => {
	store.clear();
	lickPractice.progress = {};
	lickPractice.plan = [];
	lickPractice.mode = 'standard';
	lickPractice.config.sessionType = 'daily';
	lickPractice.config.progressionType = 'ii-V-I-major';
	lickPractice.config.practiceMode = 'continuous';
	lickPractice.config.enableSubstitutions = false;
	lickPractice.config.singleLickId = undefined;
	lickPractice.config.durationMinutes = 15;
});

describe('lick-practice-duration (pure cost model)', () => {
	it('charges each lick its audio bars plus the lead-in and score-hold bars', () => {
		// A brand-new lick: one unlocked key on a 2-bar progression, continuous
		// mode (demo cycle + one key window) = 4 audio bars, 6 bars of transport.
		const audioBars = lickAudioBars({ keyCount: 1, lickBars: 2, mode: 'continuous' });
		expect(audioBars).toBe(4);
		expect(lickSlotBars(audioBars)).toBe(6);
		// 6 bars of 4/4 at 60 BPM = 24 beats = 24 s.
		expect(estimateLickSeconds({ audioBars, beatsPerBar: 4, tempo: 60 })).toBeCloseTo(24, 6);
	});

	it('keeps the per-lick slot summing to the real session bar count', () => {
		// The identity that makes "audioBars + INTER_LICK_REST_BARS" exact: the
		// session's own count-in bar plus its trailing score-hold bar are worth
		// precisely one inter-lick rest, so charging every lick a lead-in and a
		// hold reproduces 1 + 2×(n−1) + 1 bars of non-audio transport.
		expect(SESSION_COUNT_IN_BARS + SCORE_HOLD_BARS).toBe(INTER_LICK_REST_BARS);
	});

	it('doubles the per-key window in call-response mode and drops the demo', () => {
		expect(lickAudioBars({ keyCount: 3, lickBars: 2, mode: 'call-response' })).toBe(12);
		expect(lickAudioBars({ keyCount: 3, lickBars: 2, mode: 'continuous' })).toBe(8);
	});

	it('reads beats-per-bar from the phrase rather than assuming 4/4', () => {
		expect(barsToSeconds(4, 3, 120)).toBeCloseTo(6, 6);
		expect(barsToSeconds(4, 4, 120)).toBeCloseTo(8, 6);
	});

	it('sums a mixed-tempo plan at each lick’s own tempo', () => {
		const seconds = estimateSessionSeconds([
			{ audioBars: 4, beatsPerBar: 4, tempo: 60 }, // 6 bars → 24 s
			{ audioBars: 8, beatsPerBar: 4, tempo: 120 } // 10 bars → 20 s
		]);
		expect(seconds).toBeCloseTo(44, 6);
	});
});

describe('estimatePlanSeconds', () => {
	it('matches the bar layout the scheduler actually plays', () => {
		// Independent recomputation from buildLickSuperPhrase — the phrase the
		// transport is handed — so the estimate can never drift from the audio.
		togglePracticeTag('bc-041');
		toggleProgressionTag('bc-041', 'blues');
		togglePracticeTag('ii-V-I-min-001');
		toggleProgressionTag('ii-V-I-min-001', 'ii-V-I-minor');
		buildDailyPracticePlan();
		expect(lickPractice.plan.length).toBe(2);

		let expected = 0;
		for (let i = 0; i < lickPractice.plan.length; i++) {
			const superPhrase = buildLickSuperPhrase(i);
			expect(superPhrase).not.toBeNull();
			const audioBars = superPhrase!.difficulty.lengthBars;
			const tempo = resolveLickTempo(lickPractice.progress, lickPractice.plan[i].phraseId);
			expected +=
				((audioBars + INTER_LICK_REST_BARS) * superPhrase!.timeSignature[0] * 60) / tempo;
		}

		expect(estimatePlanSeconds(lickPractice.plan)).toBeCloseTo(expected, 6);
	});
});

/**
 * Candidate book of brand-new licks whose cycle is exactly the progression's
 * 2 bars, so every lick costs the same 6 bars at the 60 BPM new-lick tempo
 * (24 s). Deterministic: derived from the real library, not hand-listed.
 */
function tagUniformNewLicks(count: number): string[] {
	const ids: string[] = [];
	for (const lick of getAllLicks()) {
		if (ids.length >= count) break;
		if (lick.category !== 'blues') continue;
		if (getLickBars(lick, 'blues', false) !== 2) continue;
		if (lick.timeSignature[0] !== 4) continue;
		togglePracticeTag(lick.id);
		toggleProgressionTag(lick.id, 'blues');
		ids.push(lick.id);
	}
	expect(ids.length).toBe(count);
	return ids;
}

describe('plan fill honours the real cost', () => {
	it('never plans a Daily session longer than the duration budget', () => {
		// 12 uniform new licks at 24 s each = 288 s of real transport. A 4-minute
		// budget (240 s) fits exactly 10. The old cost model charged 21 s a lick
		// (4 audio bars + a flat 5 s) and admitted 11 — a 264 s session sold as
		// 240 s.
		tagUniformNewLicks(12);
		lickPractice.config.durationMinutes = 4;

		buildDailyPracticePlan();

		expect(estimatePlanSeconds(lickPractice.plan)).toBeLessThanOrEqual(240);
		expect(lickPractice.plan.length).toBe(10);
	});

	it('never plans a Focused session longer than the duration budget', () => {
		tagUniformNewLicks(12);
		lickPractice.config.sessionType = 'focused';
		lickPractice.config.progressionType = 'blues';
		lickPractice.config.durationMinutes = 4;

		buildSessionPlan();

		expect(estimatePlanSeconds(lickPractice.plan)).toBeLessThanOrEqual(240);
		expect(lickPractice.plan.length).toBe(10);
	});

	it('still plans one lick when the cheapest candidate exceeds the whole budget', () => {
		// A fully-unlocked lick on a 4-bar progression at the 60 BPM new-lick
		// tempo costs 54 bars = 216 s, more than the 180 s minimum budget.
		// Costing it honestly must not produce an empty plan — an empty plan
		// makes the Start button a no-op.
		const lick = getAllLicks().find((l) => l.category === 'ii-V-I-major');
		expect(lick).toBeDefined();
		togglePracticeTag(lick!.id);
		toggleProgressionTag(lick!.id, 'ii-V-I-major-long');
		for (let i = 1; i < 12; i++) bumpUnlockedKeyCount({}, lick!.id);
		lickPractice.config.durationMinutes = 3;

		buildDailyPracticePlan();

		expect(lickPractice.plan.length).toBe(1);
		expect(estimatePlanSeconds(lickPractice.plan)).toBeGreaterThan(180);
	});
});

describe('previewSessionSeconds (the number the setup screen shows)', () => {
	it('reports the plan’s real length, not the duration budget', () => {
		// The bug as reported: a small book can never fill the budget, because a
		// standard session plays its plan once and stops. Twelve uniform new
		// licks are 288 s of transport however high the knob goes.
		tagUniformNewLicks(12);
		lickPractice.config.durationMinutes = 20;

		const preview = previewSessionSeconds();

		expect(preview.lickCount).toBe(12);
		expect(preview.seconds).toBeCloseTo(288, 6);
		expect(preview.seconds).toBeLessThan(lickPractice.config.durationMinutes * 60);
	});

	it('tracks the budget when the budget is what binds', () => {
		tagUniformNewLicks(12);
		lickPractice.config.durationMinutes = 4;

		const preview = previewSessionSeconds();

		expect(preview.lickCount).toBe(10);
		expect(preview.seconds).toBeCloseTo(240, 6);
	});

	it('leaves session state untouched', () => {
		tagUniformNewLicks(12);
		lickPractice.config.durationMinutes = 20;

		previewSessionSeconds();

		expect(lickPractice.plan).toEqual([]);
		expect(lickPractice.phase).toBe('setup');
	});

	it('returns zero for the endless session types', () => {
		tagUniformNewLicks(12);
		lickPractice.config.sessionType = 'deep';
		expect(previewSessionSeconds()).toEqual({ lickCount: 0, seconds: 0 });
		lickPractice.config.sessionType = 'trick';
		expect(previewSessionSeconds()).toEqual({ lickCount: 0, seconds: 0 });
	});
});

describe('plannedSeconds (the in-session countdown total)', () => {
	it('is the plan’s length when a Daily session starts', () => {
		tagUniformNewLicks(12);
		lickPractice.config.durationMinutes = 20;

		startDailyPracticeSession();

		expect(lickPractice.plan.length).toBe(12);
		expect(lickPractice.plannedSeconds).toBeCloseTo(288, 6);
	});

	it('is zero for deep practice, which has no end', () => {
		const ids = tagUniformNewLicks(1);

		expect(startSingleLickSession(ids[0])).toBe(true);
		expect(lickPractice.plannedSeconds).toBe(0);
	});
});
