/**
 * TEMPORARY design-preview support — synthetic deep-practice scenarios for
 * the phase-cue compare page. Delete with the cue-preview folder once a
 * design is chosen.
 *
 * The stages are driven through the SAME pure modules the session uses
 * (`planCycleWindows`, `buildPhaseTimeline`, `phaseCueAt`), so every option
 * renders exactly the cue stream production would emit. The one preview-only
 * addition is `nextEntry` — which key is coming up and whether a demo
 * precedes it. `PhaseCue` deliberately carries no key identity; the
 * production integration of the winning design must thread this from the
 * session page, which has both the head key and the `shouldDemoHeadKey`
 * result at the cycle boundary.
 */

import {
	buildPhaseTimeline,
	phaseCueAt,
	type PhaseCue,
	type PhaseSegment
} from '$lib/state/lick-practice-phase';
import { planCycleWindows, type CycleWindowPlan } from '$lib/state/lick-practice-rotation';
import { PROGRESSION_TEMPLATES, transposeProgression } from '$lib/data/progressions';
import type { HarmonicSegment, PitchClass } from '$lib/types/music';

export type CueVariant = 'row-tab' | 'surface' | 'cursor';

export const PPQ = 192;
export const TICKS_PER_BAR = PPQ * 4;
export const KEY_BARS = 4;
const KEY_TICKS = KEY_BARS * TICKS_PER_BAR;
const BEATS_PER_KEY = KEY_BARS * 4;

export interface PreviewRow {
	key: PitchClass;
	harmony: HarmonicSegment[];
}

/** One deep-practice cycle: its window plan plus the rotation it plays. */
interface PreviewCycle {
	audioStartTick: number;
	demoBars: number;
	windows: CycleWindowPlan;
	rows: PreviewRow[];
	/**
	 * Tick at which the session's stack swaps to this cycle's rotation. In
	 * production `startLick` runs at the previous cycle's end — one turnaround
	 * bar ahead of this cycle's downbeat — so the swap leads the audio.
	 */
	swapTick: number;
}

export type ScenarioId = 'demo-cycle' | 'skipped-demo' | 'turnaround-demo' | 'turnaround-straight';

export interface PreviewScenario {
	id: ScenarioId;
	name: string;
	note: string;
	timeline: PhaseSegment[];
	cycles: PreviewCycle[];
	loopStartTick: number;
	loopEndTick: number;
}

const LONG_II_V_I = PROGRESSION_TEMPLATES['ii-V-I-major-long'].harmony;

function row(key: PitchClass): PreviewRow {
	return { key, harmony: transposeProgression(LONG_II_V_I, key) };
}

function cycle(
	audioStartTick: number,
	demoBars: number,
	keys: PitchClass[],
	swapTick: number
): PreviewCycle {
	return {
		audioStartTick,
		demoBars,
		swapTick,
		rows: keys.map(row),
		windows: planCycleWindows({
			audioStartTick,
			demoBars,
			keyBars: KEY_BARS,
			ticksPerBar: TICKS_PER_BAR,
			keyCount: keys.length,
			userBarsOffsetTicks: 0
		})
	};
}

function demoCycleScenario(): PreviewScenario {
	const c = cycle(TICKS_PER_BAR, KEY_BARS, ['Eb', 'Ab', 'C'], Number.NEGATIVE_INFINITY);
	return {
		id: 'demo-cycle',
		name: 'Demo cycle',
		note: 'Count-in, the band demos the head key for 4 bars, then 3 keys back-to-back. Watch the listen→play handoff.',
		timeline: buildPhaseTimeline({
			audioStartTick: c.audioStartTick,
			windows: c.windows,
			ticksPerBar: TICKS_PER_BAR,
			countInBars: 1,
			trailingBars: 1
		}),
		cycles: [c],
		loopStartTick: 0,
		loopEndTick: c.windows.cycleEndTick + TICKS_PER_BAR
	};
}

function skippedDemoScenario(): PreviewScenario {
	const c = cycle(TICKS_PER_BAR, 0, ['Eb', 'Ab', 'C'], Number.NEGATIVE_INFINITY);
	// The loop wraps at the cycle end, so the pre-roll bar before the first
	// window plays every pass. `phaseCueAt` reads ticks before the timeline as
	// `transition` counting into the first segment — the straight-in bar.
	return {
		id: 'skipped-demo',
		name: 'Straight in',
		note: 'Head key already proficient: no demo, no melody. The turnaround bar is the only warning you get before your entrance.',
		timeline: buildPhaseTimeline({
			audioStartTick: c.audioStartTick,
			windows: c.windows,
			ticksPerBar: TICKS_PER_BAR,
			countInBars: 0,
			trailingBars: 1
		}),
		cycles: [c],
		loopStartTick: 0,
		loopEndTick: c.windows.cycleEndTick
	};
}

function turnaroundScenario(id: ScenarioId, name: string, note: string, demoBars2: number): PreviewScenario {
	const c1 = cycle(0, 0, ['Ab', 'C'], Number.NEGATIVE_INFINITY);
	const start2 = c1.windows.cycleEndTick + TICKS_PER_BAR;
	const c2 = cycle(start2, demoBars2, ['Eb', 'Ab', 'C'], c1.windows.cycleEndTick);
	const t1 = buildPhaseTimeline({
		audioStartTick: c1.audioStartTick,
		windows: c1.windows,
		ticksPerBar: TICKS_PER_BAR,
		trailingBars: 1
	});
	const t2 = buildPhaseTimeline({
		audioStartTick: start2,
		windows: c2.windows,
		ticksPerBar: TICKS_PER_BAR,
		trailingBars: 1
	});
	// Cycle 1's trailing transition ends exactly where cycle 2's first segment
	// starts, so the concatenation is strictly ordered — the same cue stream
	// production emits when it swaps timelines a bar ahead of the downbeat.
	return {
		id,
		name,
		note,
		timeline: [...t1, ...t2],
		cycles: [c1, c2],
		loopStartTick: c1.windows.cycleEndTick - KEY_TICKS,
		loopEndTick: start2 + (demoBars2 + KEY_BARS) * TICKS_PER_BAR
	};
}

export const SCENARIOS: PreviewScenario[] = [
	demoCycleScenario(),
	skippedDemoScenario(),
	turnaroundScenario(
		'turnaround-demo',
		'Turnaround → demo',
		'Cycle boundary: last key of one cycle, one bar of band turnaround, then the next cycle opens with a demo of its worst key.',
		KEY_BARS
	),
	turnaroundScenario(
		'turnaround-straight',
		'Turnaround → straight in',
		'Cycle boundary straight into your entrance — the rotation swaps, one bar of turnaround, and you are on. The moment that has been failing.',
		0
	)
];

export interface NextEntry {
	key: PitchClass;
	demo: boolean;
}

/** Everything a stage needs to render one animation frame. */
export interface StageFrame {
	cue: PhaseCue;
	rows: PreviewRow[];
	scrollFraction: number;
	/** Fractional beat within the active key's 16-beat loop; -1 when frozen. */
	currentBeat: number;
	/** 0..1 position across the active row's bars; -1 when frozen. */
	rowFraction: number;
	isDemoing: boolean;
	isRecording: boolean;
	isArming: boolean;
	activeRowIndex: number;
	/** What the turnaround/count-in leads into; null once playback is running. */
	nextEntry: NextEntry | null;
}

export function frameAt(scenario: PreviewScenario, tick: number): StageFrame {
	const cue = phaseCueAt(tick, scenario.timeline, PPQ);

	let cyc = scenario.cycles[0];
	for (const c of scenario.cycles) {
		if (tick >= c.swapTick) cyc = c;
	}

	const firstOpen = cyc.windows.opens[0] ?? cyc.audioStartTick;
	const playStartTick = cyc.audioStartTick + cyc.demoBars * TICKS_PER_BAR;
	const running = tick >= cyc.audioStartTick && tick < cyc.windows.cycleEndTick;
	const currentBeat = running ? ((tick - cyc.audioStartTick) / PPQ) % BEATS_PER_KEY : -1;

	const isRecording = cyc.windows.opens.some(
		(open, i) => tick >= open && tick < cyc.windows.closes[i]
	);
	// Mirrors production: `isDemoing` is set when the cycle is scheduled (a
	// turnaround bar ahead of the downbeat) and cleared at the first window.
	const isDemoing = cyc.demoBars > 0 && tick < firstOpen;
	const isArming = cue.countdown > 0 && cue.next === 'play' && !isRecording;

	const scrollFraction = Math.max(0, (tick - playStartTick) / KEY_TICKS);
	const activeRowIndex = Math.min(cyc.rows.length - 1, Math.max(0, Math.floor(scrollFraction)));

	const nextEntry: NextEntry | null =
		cue.phase === 'transition' || cue.phase === 'count-in'
			? { key: cyc.rows[0].key, demo: cyc.demoBars > 0 }
			: null;

	return {
		cue,
		rows: cyc.rows,
		scrollFraction,
		currentBeat,
		rowFraction: currentBeat < 0 ? -1 : currentBeat / BEATS_PER_KEY,
		isDemoing,
		isRecording,
		isArming,
		activeRowIndex,
		nextEntry
	};
}
