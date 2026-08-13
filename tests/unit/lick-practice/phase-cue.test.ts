/**
 * Listen/play phase signalling. The continuous deep-practice flow switches
 * between "the app is playing, listen" and "your turn, play" without ever
 * stopping the band, and the demo is skipped once the head key is proficient
 * — so the cue has to be derived from the ACTUAL recording windows, never
 * from a fixed pattern.
 *
 * `buildPhaseTimeline` folds the scheduled window plan into contiguous
 * listen/play segments; `phaseCueAt` reads the current phase plus the beats
 * remaining until the next one, which is what gives the user warning BEFORE
 * the switch rather than a label after it.
 */

import { describe, it, expect } from 'vitest';
import { planCycleWindows, type CycleWindowPlan } from '$lib/state/lick-practice-rotation';
import {
	buildPhaseTimeline,
	phaseCueAt,
	phaseTabView,
	PHASE_LEAD_BEATS,
	type PhaseCue
} from '$lib/state/lick-practice-phase';

const PPQ = 192;
const TICKS_PER_BAR = 4 * PPQ;

/** Continuous mode: a `demoBars` demo block, then `keyCount` keys of 4 bars. */
function continuousWindows(
	demoBars: number,
	keyCount: number = 3,
	audioStartTick: number = 0
): CycleWindowPlan {
	return planCycleWindows({
		audioStartTick,
		demoBars,
		keyBars: 4,
		ticksPerBar: TICKS_PER_BAR,
		keyCount,
		userBarsOffsetTicks: 0
	});
}

describe('buildPhaseTimeline', () => {
	it('opens with a listen block for the demo, then ONE merged play block', () => {
		const timeline = buildPhaseTimeline({
			audioStartTick: 0,
			windows: continuousWindows(4),
			ticksPerBar: TICKS_PER_BAR
		});

		expect(timeline).toEqual([
			{ phase: 'listen', startTick: 0, endTick: 4 * TICKS_PER_BAR },
			{ phase: 'play', startTick: 4 * TICKS_PER_BAR, endTick: 16 * TICKS_PER_BAR }
		]);
	});

	it('omits the listen block entirely when the demo is skipped', () => {
		const timeline = buildPhaseTimeline({
			audioStartTick: 0,
			windows: continuousWindows(0),
			ticksPerBar: TICKS_PER_BAR
		});

		expect(timeline).toEqual([
			{ phase: 'play', startTick: 0, endTick: 12 * TICKS_PER_BAR }
		]);
	});

	it('alternates listen/play per key in call-response mode', () => {
		const windows = planCycleWindows({
			audioStartTick: 0,
			demoBars: 0,
			keyBars: 8,
			ticksPerBar: TICKS_PER_BAR,
			keyCount: 2,
			userBarsOffsetTicks: 4 * TICKS_PER_BAR
		});

		const timeline = buildPhaseTimeline({
			audioStartTick: 0,
			windows,
			ticksPerBar: TICKS_PER_BAR
		});

		expect(timeline.map((s) => s.phase)).toEqual(['listen', 'play', 'listen', 'play']);
		expect(timeline[1]).toEqual({
			phase: 'play',
			startTick: 4 * TICKS_PER_BAR,
			endTick: 8 * TICKS_PER_BAR
		});
	});

	it('prepends the count-in bar and appends the trailing transition bar', () => {
		const timeline = buildPhaseTimeline({
			audioStartTick: TICKS_PER_BAR,
			windows: planCycleWindows({
				audioStartTick: TICKS_PER_BAR,
				demoBars: 4,
				keyBars: 4,
				ticksPerBar: TICKS_PER_BAR,
				keyCount: 1,
				userBarsOffsetTicks: 0
			}),
			ticksPerBar: TICKS_PER_BAR,
			countInBars: 1,
			trailingBars: 1
		});

		expect(timeline.map((s) => s.phase)).toEqual([
			'count-in',
			'listen',
			'play',
			'transition'
		]);
		expect(timeline[0].startTick).toBe(0);
		expect(timeline[3].endTick).toBe(10 * TICKS_PER_BAR);
	});
});

describe('phaseCueAt', () => {
	const timeline = buildPhaseTimeline({
		audioStartTick: 0,
		windows: continuousWindows(4),
		ticksPerBar: TICKS_PER_BAR,
		trailingBars: 1
	});

	it('reports the listen phase with play queued next', () => {
		const cue = phaseCueAt(0, timeline, PPQ);
		expect(cue.phase).toBe('listen');
		expect(cue.next).toBe('play');
	});

	it('counts DOWN whole beats through the last bar of the demo', () => {
		// The demo runs 4 bars (16 beats); play opens at beat 16.
		expect(phaseCueAt(12 * PPQ, timeline, PPQ).countdown).toBe(PHASE_LEAD_BEATS);
		expect(phaseCueAt(13 * PPQ, timeline, PPQ).countdown).toBe(3);
		// Mid-beat still shows the beat the user is currently inside.
		expect(phaseCueAt(13.5 * PPQ, timeline, PPQ).countdown).toBe(3);
		expect(phaseCueAt(15.9 * PPQ, timeline, PPQ).countdown).toBe(1);
	});

	it('stays silent (countdown 0) while the switch is still far off', () => {
		expect(phaseCueAt(0, timeline, PPQ).countdown).toBe(0);
		expect(phaseCueAt(11 * PPQ, timeline, PPQ).countdown).toBe(0);
	});

	it('flips to play on the downbeat the recording window opens', () => {
		const cue = phaseCueAt(4 * TICKS_PER_BAR, timeline, PPQ);
		expect(cue.phase).toBe('play');
		expect(cue.next).toBe('transition');
	});

	it('counts down into the next cycle from inside the turnaround', () => {
		const nextCycle = buildPhaseTimeline({
			audioStartTick: 20 * TICKS_PER_BAR,
			windows: continuousWindows(0, 1, 20 * TICKS_PER_BAR),
			ticksPerBar: TICKS_PER_BAR
		});
		// A cycle boundary swaps the timeline a bar early, so "before the
		// timeline" is the turnaround bar — and it must count down, not read
		// as dead air.
		const cue = phaseCueAt(20 * TICKS_PER_BAR - 2 * PPQ, nextCycle, PPQ);
		expect(cue.phase).toBe('transition');
		expect(cue.next).toBe('play');
		expect(cue.countdown).toBe(2);
	});

	it('goes idle past the end of the timeline and on an empty one', () => {
		const past = phaseCueAt(999 * TICKS_PER_BAR, timeline, PPQ);
		expect(past).toEqual({ phase: 'idle', next: null, beatsUntilNext: null, countdown: 0 });
		expect(phaseCueAt(0, [], PPQ).phase).toBe('idle');
	});

	it('never counts down when nothing follows the current segment', () => {
		const noTail = buildPhaseTimeline({
			audioStartTick: 0,
			windows: continuousWindows(0, 1),
			ticksPerBar: TICKS_PER_BAR
		});
		const cue = phaseCueAt(4 * TICKS_PER_BAR - PPQ, noTail, PPQ);
		expect(cue.next).toBeNull();
		expect(cue.beatsUntilNext).toBeNull();
		expect(cue.countdown).toBe(0);
	});
});

describe('phaseTabView', () => {
	const at = (partial: Partial<PhaseCue>): PhaseCue => ({
		phase: 'play',
		next: null,
		beatsUntilNext: null,
		countdown: 0,
		...partial
	});

	it('reads LISTEN through a demo and steady PLAY through the merged block', () => {
		expect(phaseTabView(at({ phase: 'listen', next: 'play', beatsUntilNext: 8 }), 'F')).toEqual({
			kind: 'listen',
			text: 'Listen',
			count: 0
		});
		expect(phaseTabView(at({ phase: 'play', next: 'transition' }), 'F')).toEqual({
			kind: 'play',
			text: 'Play',
			count: 0
		});
	});

	it('counts into the entrance with the key named, from the demo last bar', () => {
		const view = phaseTabView(
			at({ phase: 'listen', next: 'play', beatsUntilNext: 3, countdown: 3 }),
			'Eb'
		);
		expect(view).toEqual({ kind: 'play-in', text: 'Play Eb in', count: 3 });
	});

	it('announces "Straight in" through a turnaround that opens with no demo', () => {
		// The skipped-demo cycle: the timeline has NO listen segment, so this
		// tab is the only warning the user gets before their entrance. The
		// straight-in wording (vs a plain countdown) must never regress.
		const view = phaseTabView(
			at({ phase: 'transition', next: 'play', beatsUntilNext: 4, countdown: 4 }),
			'F'
		);
		expect(view).toEqual({ kind: 'play-in', text: 'Straight in — F', count: 4 });
	});

	it('holds PLAY through an open window even while counting into the app half', () => {
		// Call-response: every user window except the last is followed by a
		// listen segment, so its final bar carries a countdown into `listen`.
		// The tab must NOT flip early — the mic is still open, and flipping
		// tells the user their turn is over a bar before it is.
		const view = phaseTabView(
			at({ phase: 'play', next: 'listen', beatsUntilNext: 3, countdown: 3 }),
			'F'
		);
		expect(view).toEqual({ kind: 'play', text: 'Play', count: 0 });
	});

	it('counts into a demo cycle as LISTEN IN, from turnaround or count-in alike', () => {
		const fromTurnaround = phaseTabView(
			at({ phase: 'transition', next: 'listen', beatsUntilNext: 2, countdown: 2 }),
			'F'
		);
		expect(fromTurnaround).toEqual({ kind: 'listen-in', text: 'Listen in', count: 2 });

		const fromCountIn = phaseTabView(
			at({ phase: 'count-in', next: 'listen', beatsUntilNext: 4, countdown: 4 }),
			'F'
		);
		expect(fromCountIn).toEqual({ kind: 'listen-in', text: 'Listen in', count: 4 });
	});

	it('rests quietly in a long transition and hides when idle', () => {
		// Standard mode's 2-bar inter-lick rest: the first bar is beyond the
		// countdown lead, so the tab shows a calm Rest rather than a number.
		expect(
			phaseTabView(at({ phase: 'transition', next: 'listen', beatsUntilNext: 8 }), 'F')
		).toEqual({ kind: 'rest', text: 'Rest', count: 0 });
		expect(phaseTabView(at({ phase: 'idle' }), 'F')).toEqual({
			kind: 'hidden',
			text: '',
			count: 0
		});
	});
});
