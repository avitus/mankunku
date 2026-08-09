/**
 * Listen-vs-play phase signalling — pure, Node-testable.
 *
 * Deep-practice cycles are continuous: the band never stops, there is no
 * per-round card, and the demo (the app playing the lick back at you) is
 * skipped entirely once the head key is proficient. So "when do I listen and
 * when do I play?" cannot be answered from a fixed pattern — it has to be
 * derived from the SAME window plan the recorder is scheduled against, or the
 * cue and the microphone would disagree.
 *
 * `buildPhaseTimeline` folds a `CycleWindowPlan` into contiguous segments:
 * every open recording window is a `play` block, every gap inside the cycle
 * (the demo block in continuous mode, the app's half of each key in
 * call-response) is a `listen` block, with the optional count-in bar in front
 * and the turnaround / inter-lick rest behind.
 *
 * `phaseCueAt` then answers two questions per animation frame: what phase am I
 * in, and how many beats until it changes. The second one is the point —
 * anticipation beats notification. A musician who is told "play in 2" keeps
 * the flow; one who is told "play" on the downbeat has already missed it.
 */

import type { CycleWindowPlan } from './lick-practice-rotation';

export type PracticePhase = 'count-in' | 'listen' | 'play' | 'transition' | 'idle';

export interface PhaseSegment {
	phase: Exclude<PracticePhase, 'idle'>;
	startTick: number;
	/** Exclusive — a tick landing exactly here belongs to the next segment. */
	endTick: number;
}

export interface PhaseCue {
	phase: PracticePhase;
	/** The phase that follows, or null when nothing is scheduled after this one. */
	next: PracticePhase | null;
	/** Whole beats until `next` starts; null when there is no next phase. */
	beatsUntilNext: number | null;
	/**
	 * Countdown numeral for the lead-in to the next phase (`PHASE_LEAD_BEATS`
	 * down to 1), or 0 when the switch is still too far off to warn about.
	 */
	countdown: number;
}

/** One bar of 4 — the lead-in a player expects before an entrance. */
export const PHASE_LEAD_BEATS = 4;

const IDLE_CUE: PhaseCue = { phase: 'idle', next: null, beatsUntilNext: null, countdown: 0 };

/**
 * Build the listen/play timeline for one cycle from its scheduled recording
 * windows. Adjacent segments of the same phase are merged, so continuous mode
 * (where every key's window butts against the next) yields ONE long play block
 * rather than a countdown flashing at every key boundary.
 */
export function buildPhaseTimeline(args: {
	/** Transport tick where the cycle's audio begins (after any count-in). */
	audioStartTick: number;
	windows: CycleWindowPlan;
	ticksPerBar: number;
	/** Count-in bars preceding `audioStartTick` (first lick of a session only). */
	countInBars?: number;
	/** Turnaround / inter-lick rest bars following the cycle. */
	trailingBars?: number;
}): PhaseSegment[] {
	const { audioStartTick, windows, ticksPerBar, countInBars = 0, trailingBars = 0 } = args;
	const segments: PhaseSegment[] = [];

	if (countInBars > 0) {
		push(segments, {
			phase: 'count-in',
			startTick: audioStartTick - countInBars * ticksPerBar,
			endTick: audioStartTick
		});
	}

	// Walk the windows in order; anything between the cursor and the next
	// window open is the app playing (demo block, or the call half of a
	// call-response key).
	let cursor = audioStartTick;
	for (let i = 0; i < windows.opens.length; i++) {
		const open = windows.opens[i];
		const close = windows.closes[i];
		if (open > cursor) {
			push(segments, { phase: 'listen', startTick: cursor, endTick: open });
		}
		if (close > open) {
			push(segments, { phase: 'play', startTick: open, endTick: close });
		}
		cursor = Math.max(cursor, close);
	}

	if (trailingBars > 0) {
		push(segments, {
			phase: 'transition',
			startTick: cursor,
			endTick: cursor + trailingBars * ticksPerBar
		});
	}

	return segments;
}

/** Append, merging into the previous segment when the phase is unchanged. */
function push(segments: PhaseSegment[], segment: PhaseSegment): void {
	const prev = segments[segments.length - 1];
	if (prev && prev.phase === segment.phase && prev.endTick === segment.startTick) {
		prev.endTick = segment.endTick;
		return;
	}
	segments.push(segment);
}

/**
 * The cue for a transport position. Ticks before the timeline starts read as
 * `transition` counting into the first segment — that is the turnaround bar,
 * since a cycle boundary installs the next cycle's timeline a bar ahead of its
 * downbeat. Ticks past the end read as `idle`.
 */
export function phaseCueAt(
	tick: number,
	timeline: readonly PhaseSegment[],
	ticksPerBeat: number,
	leadBeats: number = PHASE_LEAD_BEATS
): PhaseCue {
	if (timeline.length === 0 || ticksPerBeat <= 0) return IDLE_CUE;

	const first = timeline[0];
	if (tick < first.startTick) {
		return cue('transition', first.phase, first.startTick - tick, ticksPerBeat, leadBeats);
	}

	for (let i = 0; i < timeline.length; i++) {
		const segment = timeline[i];
		if (tick >= segment.endTick) continue;
		const next = timeline[i + 1]?.phase ?? null;
		if (next === null) {
			return { phase: segment.phase, next: null, beatsUntilNext: null, countdown: 0 };
		}
		return cue(segment.phase, next, segment.endTick - tick, ticksPerBeat, leadBeats);
	}

	return IDLE_CUE;
}

function cue(
	phase: PracticePhase,
	next: PracticePhase,
	ticksRemaining: number,
	ticksPerBeat: number,
	leadBeats: number
): PhaseCue {
	const beatsUntilNext = Math.ceil(ticksRemaining / ticksPerBeat);
	return {
		phase,
		next,
		beatsUntilNext,
		countdown: beatsUntilNext > 0 && beatsUntilNext <= leadBeats ? beatsUntilNext : 0
	};
}
