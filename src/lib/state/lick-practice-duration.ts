/**
 * Session-duration cost model — pure, Node-testable, and the single source
 * both the planner and the setup screen read.
 *
 * A standard / Daily Practice session plays its plan exactly once and stops:
 * `startInterLickTransition` advances `currentLickIndex` until the plan is
 * exhausted, and there is no round loop. So the session's length is a pure
 * function of the plan, and it is usually SHORTER than the duration knob —
 * the knob is a budget the plan fills only if the user has enough licks
 * tagged. Showing the knob's value as the session estimate overstates a
 * typical book by a wide margin, which is why the estimate lives here now.
 *
 * The bar layout the scheduler plays (routes/lick-practice/session/+page.svelte,
 * `startLick` / `scheduleLickWindows` / `handleLickComplete`):
 *
 *   count-in        1 bar   playPhrase offsets the first lick by one bar
 *   lick 0 audio    demoBars + keys × keyBars   (buildLickSuperPhrase)
 *   score hold      1 bar   display freeze on the final key's score
 *   rest bar 2      1 bar   ii-V cue, already at the NEXT lick's tempo
 *   lick 1 audio    …
 *   …
 *   lick n-1 audio  …
 *   score hold      1 bar   → finishSession
 *
 * Because `INTER_LICK_REST_BARS` equals `SESSION_COUNT_IN_BARS +
 * SCORE_HOLD_BARS`, charging every lick one lead-in bar and one score-hold
 * bar reproduces that layout exactly — 1 + 2×(n−1) + 1 bars of non-audio
 * transport — while staying a per-lick figure the greedy budget fill can add
 * up one lick at a time. Each lick's bars are costed at that lick's own
 * tempo, which is also where the tempo lands in the real timeline (the
 * lead-in bar of lick i is the rest bar `startLick` has already re-BPM'd).
 *
 * Everything here is bars-and-beats arithmetic. Human overhead (loading the
 * instrument and opening the mic before the first count-in, the report screen
 * afterwards) is deliberately EXCLUDED: it is not on the transport clock, and
 * the in-session timer this feeds counts transport time.
 */

import type { LickPracticeMode } from '$lib/types/lick-practice';

/**
 * Bars of backing-only rest between two consecutive licks in a standard /
 * Daily session. Read by the session scheduler (which splits it into a
 * score-hold bar and a ii-V cue bar) and by the cost model below.
 * Deep practice does not use it — its cycles join over one turnaround bar.
 */
export const INTER_LICK_REST_BARS = 2;

/**
 * Bars of the inter-lick rest during which the finished lick stays on screen
 * so its last key's score dot is actually seen. The display flips to the next
 * lick for the remaining rest bars.
 */
export const SCORE_HOLD_BARS = 1;

/** Metronome count-in `playPhrase` prepends before the first lick's audio. */
export const SESSION_COUNT_IN_BARS = 1;

/** One lick's contribution to a session's timeline. */
export interface LickTimingSpec {
	/** Bars of audio the super phrase spans: demo cycle + one window per key. */
	audioBars: number;
	/** Beats per bar, from the lick's own time signature. */
	beatsPerBar: number;
	/** BPM this lick plays at (per-lick, not per-session). */
	tempo: number;
}

/** Seconds `bars` of `beatsPerBar` time occupy at `tempo` BPM. */
export function barsToSeconds(bars: number, beatsPerBar: number, tempo: number): number {
	if (tempo <= 0) return 0;
	return (bars * beatsPerBar * 60) / tempo;
}

/**
 * Bars of audio one lick contributes — the same layout
 * `buildLickSuperPhrase` builds and `scheduleLickWindows` schedules windows
 * over. Continuous mode opens with a `lickBars` demo cycle and gives each key
 * one `lickBars` window; call-response has no upfront demo but doubles every
 * key window (app half, then user half). `extraWindows` are the additional
 * whole key windows the lead-sheet passes add (a revealed key plays three
 * times, not once), and `pauseBars` the band-only bars of reading pause laid
 * before a revealed key that does not open the cycle.
 */
export function lickAudioBars(args: {
	keyCount: number;
	lickBars: number;
	mode: LickPracticeMode;
	/** Extra key windows beyond one per key (lead-sheet passes). Default 0. */
	extraWindows?: number;
	/** Bars of reading pause before revealed keys (`LEAD_SHEET_PAUSE_BARS` each). Default 0. */
	pauseBars?: number;
}): number {
	const keyBars = args.mode === 'call-response' ? args.lickBars * 2 : args.lickBars;
	const demoBars = args.mode === 'continuous' ? args.lickBars : 0;
	return (args.keyCount + (args.extraWindows ?? 0)) * keyBars + demoBars + (args.pauseBars ?? 0);
}

/**
 * Total bars a lick's slot occupies on the transport: its audio, the bar of
 * backing that precedes its downbeat (the count-in for the first lick, the
 * second inter-lick rest bar for every later one), and the score-hold bar
 * that follows its last key.
 */
export function lickSlotBars(audioBars: number): number {
	return SESSION_COUNT_IN_BARS + audioBars + SCORE_HOLD_BARS;
}

/** Seconds one lick's slot occupies, at that lick's own tempo. */
export function estimateLickSeconds(spec: LickTimingSpec): number {
	return barsToSeconds(lickSlotBars(spec.audioBars), spec.beatsPerBar, spec.tempo);
}

/** Seconds a whole plan occupies — the session's transport length. */
export function estimateSessionSeconds(specs: readonly LickTimingSpec[]): number {
	return specs.reduce((total, spec) => total + estimateLickSeconds(spec), 0);
}
