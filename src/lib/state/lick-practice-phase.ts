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

/**
 * Sentinel close tick for a window with no scheduled end. A `play` segment
 * ending here is effectively open — `phaseCueAt` reports it with no `next`
 * and no countdown for as long as the transport runs.
 */
export const OPEN_ENDED_TICK = Number.MAX_SAFE_INTEGER;

/**
 * Timeline for the simplest capture shape: a count-in straight into one
 * open-ended play window (record-a-lick — recording runs until the user
 * stops, so there is nothing to count down INTO after the entrance). Built
 * through `buildPhaseTimeline` so there is exactly one segment-construction
 * path.
 */
export function buildOpenEndedTimeline(args: {
	/** Transport tick of the entrance (end of the count-in). */
	audioStartTick: number;
	ticksPerBar: number;
	countInBars: number;
}): PhaseSegment[] {
	const { audioStartTick, ticksPerBar, countInBars } = args;
	return buildPhaseTimeline({
		audioStartTick,
		windows: { opens: [audioStartTick], closes: [OPEN_ENDED_TICK], cycleEndTick: OPEN_ENDED_TICK },
		ticksPerBar,
		countInBars
	});
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

/** What the on-chart phase tab renders for one cue. */
export interface PhaseTabView {
	kind: 'listen' | 'listen-in' | 'play-in' | 'play' | 'rest' | 'hidden';
	/** Smallcaps label; the countdown numeral renders separately from `count`. */
	text: string;
	/** Countdown numeral (leadBeats..1), or 0 when none shows. */
	count: number;
}

/**
 * Map a cue to the row tab pinned on the active chart.
 *
 * The one rule that must never regress: a countdown into `play` from a
 * `transition` or `count-in` announces itself as "Straight in" with the entry
 * key. That is the skipped-demo turnaround — the cycle where nothing sounds
 * before the user's entrance — and it is exactly the moment the timeline
 * cannot express as a `listen` block, so the tab is its only warning.
 *
 * `keyLabel` is the written-pitch name of the active row's key. The active
 * row is always the row about to be played: continuous mode demos and then
 * answers in the head key, call-response answers in the current key, and the
 * turnaround has already swapped the stack to the next rotation.
 *
 * An open play window always reads `play` — a countdown into the app's next
 * half (call-response: `play` → `listen`) must NOT flip the tab early, or it
 * tells the user their turn is over a bar before the mic closes. Countdowns
 * exist to warn the user to START, never to stop.
 */
export function phaseTabView(cue: PhaseCue, keyLabel: string): PhaseTabView {
	if (cue.phase === 'idle') return { kind: 'hidden', text: '', count: 0 };
	if (cue.countdown > 0 && cue.next === 'play') {
		const straightIn = cue.phase === 'transition' || cue.phase === 'count-in';
		return {
			kind: 'play-in',
			count: cue.countdown,
			text: straightIn ? `Straight in — ${keyLabel}` : `Play ${keyLabel} in`
		};
	}
	if (cue.phase === 'play') return { kind: 'play', text: 'Play', count: 0 };
	if (cue.countdown > 0 && cue.next === 'listen') {
		return { kind: 'listen-in', count: cue.countdown, text: 'Listen in' };
	}
	if (cue.phase === 'listen' || cue.phase === 'count-in') {
		return { kind: 'listen', text: 'Listen', count: 0 };
	}
	return { kind: 'rest', text: 'Rest', count: 0 };
}
