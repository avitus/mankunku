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
	startSession,
	startSingleLickSession,
	getLickBars,
	resolveLickTempo,
	getDemoBars,
	getKeyPasses,
	getKeyPauses,
	markSessionTransportStart,
	updateElapsedTime
} from '$lib/state/lick-practice.svelte';
import {
	togglePracticeTag,
	toggleProgressionTag,
	bumpUnlockedKeyCount,
	updateKeyProgress
} from '$lib/persistence/lick-practice-store';
import { getAllLicks } from '$lib/phrases/library-loader';
import {
	LEAD_SHEET_PAUSE_BARS,
	planCycleWindows,
	newestUnlockedKey
} from '$lib/state/lick-practice-rotation';
import type { PitchClass } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';

beforeEach(() => {
	store.clear();
	lickPractice.progress = {};
	lickPractice.plan = [];
	lickPractice.phase = 'setup';
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

	it('charges extra lead-sheet passes as whole key windows', () => {
		// A revealed key runs three windows instead of one: two extra slots.
		expect(
			lickAudioBars({ keyCount: 3, lickBars: 2, mode: 'continuous', extraWindows: 2 })
		).toBe(12);
	});

	it('charges the reading pause before a revealed key as plain bars', () => {
		expect(
			lickAudioBars({ keyCount: 3, lickBars: 2, mode: 'continuous', extraWindows: 2, pauseBars: 2 })
		).toBe(14);
		expect(lickAudioBars({ keyCount: 3, lickBars: 2, mode: 'continuous', pauseBars: 0 })).toBe(8);
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
		toggleProgressionTag('ii-V-I-min-001', 'ii-V-I-minor-long');
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

	it('charges the lead-sheet passes of a revealed newest key', () => {
		// bc-041 with two keys unlocked (C, G); G under the floor reveals and
		// runs three windows — the estimate must follow the super phrase.
		togglePracticeTag('bc-041');
		toggleProgressionTag('bc-041', 'blues');
		bumpUnlockedKeyCount(lickPractice.progress, 'bc-041');
		lickPractice.progress = updateKeyProgress(lickPractice.progress, 'bc-041', 'G', {
			lastPracticedAt: 1,
			rollingScore: 0.5
		});
		buildDailyPracticePlan();
		expect(lickPractice.plan.length).toBe(1);
		const superPhrase = buildLickSuperPhrase(0)!;
		const plain = lickAudioBars({
			keyCount: 2,
			lickBars: getLickBars(getAllLicks().find((l) => l.id === 'bc-041')!, 'blues', false),
			mode: 'continuous'
		});
		// Two extra windows of one cycle each, plus the reading pause before G —
		// G follows C's window, so the switch to reading is heralded.
		expect(superPhrase.difficulty.lengthBars).toBe(
			plain +
				2 * getLickBars(getAllLicks().find((l) => l.id === 'bc-041')!, 'blues', false) +
				LEAD_SHEET_PAUSE_BARS
		);
		const tempo = resolveLickTempo(lickPractice.progress, 'bc-041');
		const expected =
			((superPhrase.difficulty.lengthBars + INTER_LICK_REST_BARS) * superPhrase.timeSignature[0] * 60) /
			tempo;
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

	it('prices a Focused session from the single-progression plan', () => {
		tagUniformNewLicks(12);
		lickPractice.config.sessionType = 'focused';
		lickPractice.config.progressionType = 'blues';
		lickPractice.config.durationMinutes = 20;

		expect(previewSessionSeconds()).toEqual({ lickCount: 12, seconds: 288 });
		// A progression none of the tagged licks fit prices to nothing.
		lickPractice.config.progressionType = 'ii-V-I-major-long';
		expect(previewSessionSeconds()).toEqual({ lickCount: 0, seconds: 0 });
		expect(lickPractice.plan).toEqual([]);
	});
});

describe('startSession (Focused)', () => {
	it('is a no-op on an empty plan — the session never leaves setup', () => {
		lickPractice.config.sessionType = 'focused';
		lickPractice.config.progressionType = 'blues';

		startSession();

		expect(lickPractice.plan).toEqual([]);
		expect(lickPractice.phase).toBe('setup');
	});

	it('installs the plan, opens the count-in at the first lick\'s own tempo and clears deep-practice state', () => {
		const ids = tagUniformNewLicks(3);
		lickPractice.config.sessionType = 'focused';
		lickPractice.config.progressionType = 'blues';
		lickPractice.progress = updateKeyProgress(lickPractice.progress, ids[0], 'C', {
			currentTempo: 84,
			lastPracticedAt: 1
		});
		// Left over from a deep-practice configuration; a focused start must drop it.
		lickPractice.config.singleLickId = ids[1];
		lickPractice.roundNumber = 4;

		startSession();

		expect(lickPractice.phase).toBe('count-in');
		expect(lickPractice.mode).toBe('standard');
		expect(lickPractice.plan.map((item) => item.phraseId).sort()).toEqual([...ids].sort());
		// Least-recently-practiced first: the two never-practiced licks lead,
		// so the first lick opens at the 60 BPM new-lick tempo, not ids[0]'s 84.
		expect(lickPractice.plan[0].phraseId).not.toBe(ids[0]);
		expect(lickPractice.currentTempo).toBe(
			resolveLickTempo(lickPractice.progress, lickPractice.plan[0].phraseId)
		);
		expect(lickPractice.currentTempo).toBe(60);
		expect(lickPractice.plannedSeconds).toBeCloseTo(estimatePlanSeconds(lickPractice.plan), 6);
		expect(lickPractice.config.singleLickId).toBeUndefined();
		expect(lickPractice.roundNumber).toBe(0);
		expect(lickPractice.currentLickIndex).toBe(0);
		expect(lickPractice.currentKeyIndex).toBe(0);
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

/**
 * The lead-sheet reveal is the newest cost in the model: a revealed key plays
 * `LEAD_SHEET_PASSES` windows behind `LEAD_SHEET_PAUSE_BARS` of reading pause
 * instead of one bare window. The single-lick case above pins it against the
 * super phrase; this pins a whole multi-lick Daily plan against
 * `planCycleWindows` — the very layout the session page schedules its
 * recording windows from — so the estimate is checked against the scheduler
 * rather than against a second copy of the same arithmetic.
 */
describe('lead-sheet passes across a multi-lick Daily plan', () => {
	/** Tag `count` licks from distinct progressions and give each a revealing newest key. */
	function tagRevealingLicks(): { id: string; entryKey: PitchClass }[] {
		const picks: { id: string; progression: ChordProgressionType }[] = [];
		const wanted: [string, ChordProgressionType][] = [
			['blues', 'blues'],
			['ii-V-I-major', 'ii-V-I-major-long'],
			['ii-V-I-minor', 'ii-V-I-minor-long']
		];
		for (const [category, progression] of wanted) {
			const lick = getAllLicks().find((l) => l.category === category);
			expect(lick, `no library lick in category ${category}`).toBeDefined();
			togglePracticeTag(lick!.id);
			toggleProgressionTag(lick!.id, progression);
			picks.push({ id: lick!.id, progression });
		}
		// Two unlocked keys each, with a sub-floor rolling score on the newest
		// (the key being learned) so its row reveals and runs three passes.
		return picks.map(({ id }) => {
			const lick = getAllLicks().find((l) => l.id === id)!;
			bumpUnlockedKeyCount(lickPractice.progress, id);
			const newest = newestUnlockedKey(lick.key, 2)!;
			lickPractice.progress = updateKeyProgress(lickPractice.progress, id, newest, {
				lastPracticedAt: 1,
				rollingScore: 0.5
			});
			return { id, entryKey: lick.key };
		});
	}

	it('charges exactly the bars planCycleWindows lays out, per lick', () => {
		tagRevealingLicks();
		lickPractice.config.durationMinutes = 30;
		buildDailyPracticePlan();
		expect(lickPractice.plan.length).toBe(3);

		const PPQ = 192;
		let revealed = 0;
		let expectedSeconds = 0;

		for (let i = 0; i < lickPractice.plan.length; i++) {
			const item = lickPractice.plan[i];
			const lick = getAllLicks().find((l) => l.id === item.phraseId)!;
			const lickBars = getLickBars(lick, item.progressionType, false);
			const beatsPerBar = lick.timeSignature[0];
			const ticksPerBar = beatsPerBar * PPQ;
			const passes = getKeyPasses(i);
			const pauses = getKeyPauses(i);
			if (passes.includes(3)) revealed++;

			// The scheduler's own layout, from the same three sources the
			// session page passes it (getDemoBars / getKeyPasses / getKeyPauses).
			const windows = planCycleWindows({
				audioStartTick: ticksPerBar,
				demoBars: getDemoBars(i),
				keyBars: lickBars,
				ticksPerBar,
				keyCount: item.keys.length,
				passes,
				pauses,
				userBarsOffsetTicks: 0
			});
			const scheduledAudioBars = (windows.cycleEndTick - ticksPerBar) / ticksPerBar;

			// …and the phrase the transport is handed must span the same bars.
			expect(buildLickSuperPhrase(i)!.difficulty.lengthBars).toBe(scheduledAudioBars);
			// One window per pass: two keys, three passes on the revealed one.
			expect(windows.opens.length).toBe(passes.reduce((a, b) => a + b, 0));

			const tempo = resolveLickTempo(lickPractice.progress, item.phraseId);
			expectedSeconds +=
				((scheduledAudioBars + INTER_LICK_REST_BARS) * beatsPerBar * 60) / tempo;
		}

		// Guard: a vacuous pass (nothing revealed) would prove nothing.
		expect(revealed).toBe(3);
		expect(estimatePlanSeconds(lickPractice.plan)).toBeCloseTo(expectedSeconds, 6);
		// The setup screen quotes a plan it builds itself — same number.
		expect(previewSessionSeconds().seconds).toBeCloseTo(expectedSeconds, 6);
	});

	it('quotes the same session the Start button installs', () => {
		tagRevealingLicks();
		lickPractice.config.durationMinutes = 30;
		const quoted = previewSessionSeconds();
		startDailyPracticeSession();
		expect(lickPractice.plan.length).toBe(quoted.lickCount);
		expect(lickPractice.plannedSeconds).toBeCloseTo(quoted.seconds, 6);
	});
});

/**
 * The estimate is transport time by construction — bars and beats, with the
 * instrument load and the mic prompt deliberately excluded (they are not on
 * the transport clock). The in-session countdown subtracts `elapsedSeconds`
 * from it, so that clock has to measure the same thing: it must start at the
 * first count-in bar, not at the Start press, which is a page navigation, a
 * mic prompt and 307 sample decodes earlier. Otherwise the load is silently
 * charged to the session — the countdown runs fast, and `startInterLickTransition`'s
 * time-up check can end a budget-filling plan a lick early.
 */
describe('the session clock measures transport time, not loading time', () => {
	it('starts counting at the transport, not at the Start press', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-09-11T10:00:00Z'));
			tagUniformNewLicks(2);
			startDailyPracticeSession();
			expect(lickPractice.plan.length).toBe(2);

			// Route load + mic prompt + instrument: 30 s before the count-in.
			vi.setSystemTime(new Date('2026-09-11T10:00:30Z'));
			markSessionTransportStart();
			updateElapsedTime();
			expect(lickPractice.elapsedSeconds).toBe(0);

			// From there it tracks real playing time against the plan estimate.
			vi.setSystemTime(new Date('2026-09-11T10:00:40Z'));
			updateElapsedTime();
			expect(lickPractice.elapsedSeconds).toBe(10);
		} finally {
			vi.useRealTimers();
		}
	});
});
