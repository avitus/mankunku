/**
 * Swing comping rhythm vocabulary: a library of 1- and 2-bar figures and a
 * sequential planner with anti-repetition memory.
 *
 * Pros vary their comping per phrase and never loop one pattern — the old
 * stateless per-bar draw could (and did) deal the same figure three bars
 * running. The planner keeps each bar's `comp-figure` seed stream intact
 * (memory only reshapes WEIGHTS — derived state, not RNG state): the plan
 * itself is sequential, but each bar's DRAWS are stream-isolated, so
 * recomputing a prefix costs a few float draws per bar and adding a figure
 * to the library shifts selection without touching realization streams.
 *
 * Figure grammar: hits are (beatOffset, durationBeats) on the x.0/x.5
 * eighth grid — the anticipated-next-chord voicing on pushes in
 * `generateComping` depends on the x.5 convention. Durations that cross
 * the barline are intentional (pushes tie across).
 */

import { createRng, seedFrom } from './generation-rng';
import { lerp } from './backing-intensity';
import type { BarInfo } from './backing-generation';

export type FigureTag = 'early' | 'push' | 'pad';

/** One comp hit: beat offset within the bar + duration, both in beats. */
export interface CompFigureHit {
	b: number;
	d: number;
}

export interface CompFigure {
	id: string;
	bars: 1 | 2;
	/** Per-bar hit lists: hits[0] is the figure's first bar, hits[1] its second. */
	hits: CompFigureHit[][];
	weight: number;
	/** Density rank 0–2; biased by section position (and, later, intensity). */
	busy: 0 | 1 | 2;
	tags: FigureTag[];
	/**
	 * Memory identity for anti-repetition: figures whose opening bar SOUNDS
	 * like another figure share its key (charleston-answer opens note-for-
	 * note as charleston), so id-hopping can't smuggle three identical bars.
	 */
	repeatKey?: string;
}

export const COMP_FIGURES: CompFigure[] = [
	{ id: 'charleston', bars: 1, hits: [[{ b: 0, d: 1.8 }, { b: 1.5, d: 0.4 }]], weight: 3, busy: 2, tags: ['early'] },
	{ id: 'late-charleston', bars: 1, hits: [[{ b: 2, d: 1.4 }, { b: 3.5, d: 1.1 }]], weight: 1.5, busy: 2, tags: ['push'] },
	{ id: 'and2-4', bars: 1, hits: [[{ b: 1.5, d: 0.5 }, { b: 3, d: 0.6 }]], weight: 3, busy: 2, tags: [] },
	{ id: 'and2-only', bars: 1, hits: [[{ b: 1.5, d: 1.2 }]], weight: 2, busy: 1, tags: [] },
	{ id: 'offbeat-pair', bars: 1, hits: [[{ b: 0.5, d: 0.5 }, { b: 2.5, d: 0.6 }]], weight: 2, busy: 2, tags: [] },
	{ id: 'push-only', bars: 1, hits: [[{ b: 3.5, d: 1.5 }]], weight: 1.5, busy: 1, tags: ['push'] },
	{ id: 'pad-whole', bars: 1, hits: [[{ b: 0, d: 3.6 }]], weight: 2, busy: 1, tags: ['early', 'pad'] },
	{ id: 'pads-halves', bars: 1, hits: [[{ b: 0, d: 1.8 }, { b: 2, d: 1.7 }]], weight: 1.5, busy: 1, tags: ['early', 'pad'] },
	{ id: 'two-and-four', bars: 1, hits: [[{ b: 1, d: 0.5 }, { b: 3, d: 0.5 }]], weight: 1.5, busy: 2, tags: [] },
	{ id: 'rest', bars: 1, hits: [[]], weight: 2, busy: 0, tags: [] },
	{
		id: 'red-garland',
		bars: 2,
		hits: [
			[{ b: 1.5, d: 0.6 }, { b: 3.5, d: 0.6 }],
			[{ b: 1.5, d: 0.6 }]
		],
		weight: 2,
		busy: 2,
		tags: ['push']
	},
	{
		id: 'charleston-answer',
		bars: 2,
		hits: [
			[{ b: 0, d: 1.8 }, { b: 1.5, d: 0.4 }],
			[{ b: 2, d: 0.8 }, { b: 3.5, d: 1.2 }]
		],
		weight: 2,
		busy: 2,
		tags: ['early', 'push'],
		repeatKey: 'charleston'
	},
	{ id: 'sparse-2bar', bars: 2, hits: [[{ b: 0.5, d: 0.7 }], []], weight: 1.5, busy: 1, tags: [] }
];

const BY_ID = new Map(COMP_FIGURES.map((f) => [f.id, f]));
const REST_FIGURE = COMP_FIGURES.find((f) => f.id === 'rest')!;

export function compFigureById(id: string): CompFigure | undefined {
	return BY_ID.get(id);
}

export interface PlannedBar {
	/** Figure id sounding in this bar; the literal 'cont' marks a 2-bar figure's tail. */
	figureId: string;
	/** This bar voices only guide tones (the "leave space" color). */
	guideTones: boolean;
}

/** The CompFigure sounding in a planned bar (resolving 2-bar 'cont' tails). */
export function headFigureFor(plan: PlannedBar[], barIndex: number): CompFigure | undefined {
	const planned = plan[barIndex];
	if (!planned) return undefined;
	const id = planned.figureId === 'cont' ? plan[barIndex - 1]?.figureId : planned.figureId;
	return id !== undefined && id !== 'cont' ? BY_ID.get(id) : undefined;
}

/**
 * Plan one figure choice per bar. Sequential (memory needs order), but each
 * bar draws from its own `('comp-figure', barIndex)` stream — recomputing a
 * prefix is a few float draws per bar, so random access stays cheap and the
 * streams stay isolated.
 */
export function planCompFigures(
	barInfos: BarInfo[],
	beatsPerBar: number,
	phraseId: string,
	tempo: number
): PlannedBar[] {
	const plan: PlannedBar[] = [];
	const recent: string[] = []; // last selections, newest last

	for (let bar = 0; bar < barInfos.length; bar++) {
		if (plan.length > bar) continue; // consumed by a 2-bar figure
		const info = barInfos[bar];
		const rng = createRng(seedFrom(phraseId, tempo, 'comp-figure', bar));

		const isBarZero = bar === 0;
		const sameSectionNext =
			bar + 1 < barInfos.length &&
			barInfos[bar + 1].sectionIndex === info.sectionIndex &&
			!info.isSectionFinalBar;

		const nextIsCadence =
			bar + 1 < barInfos.length &&
			barInfos[bar + 1].isSectionFinalBar &&
			!barInfos[bar + 1].isFinalBar;
		const weighted = COMP_FIGURES.filter((f) => {
			if (f.bars === 2 && !sameSectionNext) return false;
			// A 2-bar figure's tail would swallow the cadence bar and bypass
			// its push weighting — only push-tagged figures may land there.
			if (f.bars === 2 && nextIsCadence && !f.tags.includes('push')) return false;
			if (isBarZero && !f.tags.includes('early')) return false;
			// The phrase's last bar resolves; a rest there sounds like the band
			// stopped early (space belongs mid-phrase).
			if (info.isFinalBar && f.id === 'rest') return false;
			return true;
		}).map((f) => {
			const isCadenceBar = info.isSectionFinalBar && !info.isFinalBar;
			let weight = f.weight;
			// Anti-repetition on the figure's MEMORY key (repeatKey lets
			// sound-alike figures share one identity): same as previous
			// ×0.25; twice in the last three ×0.5; a third consecutive
			// repeat is forbidden outright.
			const key = f.repeatKey ?? f.id;
			const prev = recent[recent.length - 1];
			const prev2 = recent[recent.length - 2];
			if (key === prev && key === prev2) weight = 0;
			else if (key === prev) weight *= 0.25;
			else if (recent.slice(-3).filter((r) => r === key).length >= 2) weight *= 0.5;
			// Cadence bars set up the arrival with a push. The boost must beat
			// a large non-push pool (2-bar figures are filtered out at section
			// boundaries), so pushes are strongly favored AND the rest damped.
			if (isCadenceBar) {
				weight *= f.tags.includes('push') ? 5 : 0.5;
			}
			// Density arc: busy figures lean in and deliberate rest thins out
			// as intensity builds through the form (cadence bars already run
			// hotter — the arc adds +0.08 there).
			if (f.busy >= 2) weight *= lerp(0.7, 1.7, info.intensity);
			if (f.busy === 0) weight *= lerp(2.2, 0.6, info.intensity);
			return { value: f, weight };
		}).filter((w) => w.weight > 0);

		const figure = weighted.length > 0 ? rng.weighted(weighted) : REST_FIGURE;

		// The "leave space" color: occasionally a bar speaks in guide tones
		// only — a low-intensity color that mostly retires as the band digs
		// in. Conditional draw (rest bars consume one draw, others two) —
		// safe because nothing draws from this bar's stream afterwards.
		const guideTones = figure.id !== 'rest' && rng.chance(0.06 * lerp(1.6, 0.4, info.intensity));

		plan.push({ figureId: figure.id, guideTones });
		recent.push(figure.repeatKey ?? figure.id);
		if (figure.bars === 2) {
			plan.push({ figureId: 'cont', guideTones });
		}
	}
	// Defensive only: a 2-bar head is never selectable on the last bar
	// (sameSectionNext requires a next bar), so the plan cannot overrun.
	return plan.slice(0, barInfos.length);
}

/**
 * Hits for one planned bar, with final-bar suppression: the phrase's last
 * bar must not push into a bar that does not exist — late onsets are
 * stripped and an empty result falls back to a resolution pad.
 */
export function hitsForPlannedBar(
	planned: PlannedBar,
	plan: PlannedBar[],
	barIndex: number,
	info: BarInfo,
	beatsPerBar: number
): CompFigureHit[] {
	const figure = headFigureFor(plan, barIndex);
	const hits = (planned.figureId === 'cont' ? figure?.hits[1] : figure?.hits[0]) ?? [];
	if (info.isFinalBar) {
		const kept = hits.filter((h) => h.b < beatsPerBar - 0.5);
		// The phrase's final bar never falls silent: 'rest' is excluded at
		// plan time, and an empty result here (a stripped pure-push figure
		// or sparse-2bar's empty tail) resolves instead.
		if (kept.length === 0) return [{ b: 0, d: 2.0 }];
		return kept;
	}
	return hits;
}
