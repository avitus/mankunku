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
 * Coordinated mode may develop a selected library cell across a four-bar
 * phrase. Each later cell is admitted whole against that bar's shared plan;
 * future solo observations cannot retroactively change the source statement.
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
	/** Density rank 0–2; rank 2 leans in and rank 0 thins out with the intensity arc. */
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
	/** A complete transformed library figure, consumed by the usual realization path. */
	transformedFigure?: CompFigure;
	motif?: CompMotifDecision;
}

export type CompMotifTransform = 'statement' | 'repeat' | 'displace' | 'shorten' | 'space' | 'fallback';
export interface PianoMotifAttack {
	readonly absBeat: number;
	readonly time: string;
	readonly notes: readonly number[];
	readonly duration: number;
	readonly velocity: number;
}
/** A complete independent cell that actually sounded, never a future proposal. */
export interface PianoMotifRecallSource {
	readonly barIndex: number;
	readonly phraseStartBar: number;
	readonly chorusIndex: number;
	readonly sectionIndex: number;
	readonly loopIndex: number;
	readonly figureId: string;
	readonly attacks: readonly PianoMotifAttack[];
}
export interface CompMotifDecision {
	readonly version: 1;
	readonly barIndex: number;
	readonly phraseStartBar: number;
	readonly motifId: string | null;
	readonly sourceFigureId: string | null;
	readonly transform: CompMotifTransform;
	readonly displacementBeats: number;
	/** Planned onsets and nominal durations, before articulation and timing. */
	readonly hits: readonly Readonly<CompFigureHit>[];
	/** Accepted first statement of a one-use adjacent-phrase recall. */
	readonly recall?: { readonly source: PianoMotifRecallSource; readonly attacks: readonly PianoMotifAttack[] };
	readonly reason?: 'native_pattern' | 'native_drum_reply' | 'not_selected' | 'short_phrase' | 'incomplete_harmony' | 'gesture_does_not_fit' | 'ensemble_silence' | 'response_reserved' | 'motif_gap' | 'shared_arrival' | 'drum_reply' | 'terminal_arrangement';
}

export function freezeCompMotifTrace(trace: readonly CompMotifDecision[]): readonly CompMotifDecision[] {
	for (const entry of trace) {
		if (entry.recall) {
			for (const attacks of [entry.recall.source.attacks, entry.recall.attacks]) {
				for (const attack of attacks) { Object.freeze(attack.notes); Object.freeze(attack); }
				Object.freeze(attacks);
			}
			Object.freeze(entry.recall.source); Object.freeze(entry.recall);
		}
		for (const hit of entry.hits) Object.freeze(hit);
		Object.freeze(entry.hits);
		Object.freeze(entry);
	}
	return Object.freeze(trace);
}

export function compMotifTrace(plan: readonly PlannedBar[]): readonly CompMotifDecision[] {
	return freezeCompMotifTrace(plan.flatMap((bar) => bar.motif ? [bar.motif] : []));
}

/** The CompFigure sounding in a planned bar (resolving 2-bar 'cont' tails). */
export function headFigureFor(plan: PlannedBar[], barIndex: number): CompFigure | undefined {
	const planned = plan[barIndex];
	if (!planned) return undefined;
	if (planned.transformedFigure) return planned.transformedFigure;
	const id = planned.figureId === 'cont' ? plan[barIndex - 1]?.figureId : planned.figureId;
	return id !== undefined && id !== 'cont' ? BY_ID.get(id) : undefined;
}

type MotifStep = {
	figure: CompFigure;
	transform: Exclude<CompMotifTransform, 'fallback'>;
	shift: number;
	reason?: CompMotifDecision['reason'];
};
type MotifPhrase = {
	startBar: number;
	source?: CompFigure;
	steps?: MotifStep[];
	reason?: CompMotifDecision['reason'];
};

function transformedFigure(source: CompFigure, hits: CompFigureHit[], id: string): CompFigure {
	const tags: FigureTag[] = [];
	if (hits.some((hit) => hit.b === 0)) tags.push('early');
	if (hits.some((hit) => hit.b === 3.5)) tags.push('push');
	for (const hit of hits) Object.freeze(hit);
	Object.freeze(hits);
	const figure: CompFigure = {
		id, bars: 1, hits: [hits], tags, weight: source.weight,
		busy: hits.length === 0 ? 0 : hits.length === 1 ? 1 : 2,
		repeatKey: source.repeatKey ?? source.id
	};
	Object.freeze(figure.hits);
	Object.freeze(figure.tags);
	return Object.freeze(figure);
}

/** Choose a source from current evidence; only known form constrains future cells. */
function chooseMotifPhrase(
	infos: BarInfo[], startBar: number, phraseId: string, tempo: number,
	figureBias?: Partial<Record<string, number>>, harmonyEndBeat?: number
): MotifPhrase {
	const start = infos[startBar];
	const group = infos.slice(startBar, startBar + 4);
	if (group.length !== 4 || group.some((info) =>
		info.ensemble?.phraseStartBar !== startBar || info.sectionIndex !== start.sectionIndex)) {
		return { startBar, reason: 'short_phrase' };
	}
	if (harmonyEndBeat !== undefined && (startBar + 4) * 4 > harmonyEndBeat) {
		return { startBar, reason: 'incomplete_harmony' };
	}
	const rng = createRng(seedFrom(phraseId, tempo, 'comp-motif', startBar));
	if (!rng.chance(0.55)) return { startBar, reason: 'not_selected' };
	const fits = (hits: CompFigureHit[], offset: number): boolean => {
		const info = group[offset];
		return (offset !== 0 || (hits.length <= info.ensemble!.piano.maxAttacks &&
			!info.ensemble!.coordinatedAccent && info.ensemble!.responseOwner === 'nobody')) &&
			(startBar + offset !== 0 || hits.some((hit) => hit.b === 0)) &&
			hits.every((hit) => hit.b >= 0 && hit.b < (info.isFinalBar ? 3.5 : 4));
	};
	const candidates = COMP_FIGURES.flatMap((source) => {
		if (source.bars !== 1 || source.hits[0].length === 0 || source.tags.includes('pad') || !fits(source.hits[0], 0)) return [];
		return [-1, -0.5, 0.5, 1].flatMap((shift) => {
			const displaced = source.hits[0].map((hit) => ({ b: hit.b + shift, d: hit.d }));
			const shortened = [{ b: displaced[0].b, d: Math.min(displaced[0].d, 0.45) }];
			if (!fits(displaced, 2) || !fits(shortened, 3)) return [];
			return [{ value: { source, shift, displaced, shortened }, weight: source.weight * (figureBias?.[source.id] ?? 1) }];
		}).filter((candidate) => candidate.weight > 0);
	});
	if (candidates.length === 0) return { startBar, reason: 'gesture_does_not_fit' };
	const { source, shift, displaced, shortened } = rng.weighted(candidates);
	const develop = createRng(seedFrom(phraseId, tempo, 'comp-motif-development', startBar));
	const step = (transform: MotifStep['transform'], hits: CompFigureHit[], displacement = 0, reason?: MotifStep['reason']): MotifStep => ({
		figure: transformedFigure(source, hits.map((hit) => ({ ...hit })), `motif:${startBar}:${source.id}:${transform}`),
		transform, shift: displacement, ...(reason ? { reason } : {})
	});
	return {
		startBar, source,
		steps: [
			step('statement', source.hits[0]),
			develop.chance(0.35) ? step('repeat', source.hits[0]) : step('space', [], 0, 'motif_gap'),
			step('displace', displaced, shift),
			step('shorten', shortened, shift)
		]
	};
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
	tempo: number,
	/** Per-figure weight multipliers (`StyleDefinition.compFigureBias`) —
	 *  how a style leans the shared library, e.g. straight rests more. */
	figureBias?: Partial<Record<string, number>>,
	options?: { motifs?: boolean; harmonyEndBeat?: number }
): PlannedBar[] {
	const plan: PlannedBar[] = [];
	const recent: string[] = []; // last selections, newest last
	const motifs = options?.motifs === true && beatsPerBar === 4 && barInfos.every((info) => Boolean(info.ensemble));
	let motifPhrase: MotifPhrase | undefined;

	for (let bar = 0; bar < barInfos.length; bar++) {
		if (plan.length > bar) continue; // consumed by a 2-bar figure
		const info = barInfos[bar];
		const rng = createRng(seedFrom(phraseId, tempo, 'comp-figure', bar));
		if (info.ensemble?.piano.arrival?.action === 'catch') {
			const figure: CompFigure = { ...REST_FIGURE, id: 'shared-arrival', hits: [[{ b: 0, d: 0.45 }]], busy: 1, tags: ['early'] };
			plan.push({ figureId: figure.id, guideTones: false, transformedFigure: figure,
				...(motifs ? { motif: { version: 1 as const, barIndex: bar, phraseStartBar: info.ensemble.phraseStartBar,
					motifId: null, sourceFigureId: null, transform: 'fallback' as const, displacementBeats: 0,
					hits: [], reason: 'shared_arrival' as const } } : {}) });
			recent.push(figure.id);
			continue;
		}
		if (motifs && motifPhrase?.startBar !== info.ensemble!.phraseStartBar) {
			motifPhrase = chooseMotifPhrase(barInfos, info.ensemble!.phraseStartBar, phraseId, tempo, figureBias, options?.harmonyEndBeat);
		}
		let motifStep = motifPhrase?.steps?.[bar - motifPhrase.startBar];
		if (motifStep) {
			// Later observations may withhold a whole cell, but never rewrite
			// its earlier audible source. This is causal phrase development.
			const budget = info.ensemble!.piano.maxAttacks;
			const reason: CompMotifDecision['reason'] = budget === 0 || info.ensemble!.coordinatedAccent ? 'ensemble_silence'
				: info.ensemble!.responseOwner !== 'nobody' ? 'response_reserved'
				: motifStep.figure.hits[0].length > budget ? 'gesture_does_not_fit' : undefined;
			if (reason) motifStep = {
				figure: transformedFigure(motifPhrase!.source!, [], `motif:${motifPhrase!.startBar}:withheld:${bar}`),
				transform: 'space', shift: 0, reason
			};
		}

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
			// Select complete figures that fit every reserved bar, rather than
			// deleting arbitrary notes after a motif has been composed.
			if (f.hits.some((hits, offset) => hits.length > (barInfos[bar + offset]?.ensemble?.piano.maxAttacks ?? Infinity))) return false;
			if (f.bars === 2 && (!sameSectionNext || barInfos[bar + 1]?.ensemble?.piano.arrival)) return false;
			if (motifs && f.bars === 2 && barInfos[bar + 1]?.ensemble?.phraseStartBar !== info.ensemble!.phraseStartBar) return false;
			// A 2-bar figure's tail would swallow the cadence bar and bypass
			// its push weighting — only push-tagged figures may land there.
			if (f.bars === 2 && nextIsCadence && !f.tags.includes('push')) return false;
			if (isBarZero && info.ensemble?.piano.maxAttacks !== 0 && !f.tags.includes('early')) return false;
			// The phrase's last bar resolves; a rest there sounds like the band
			// stopped early (space belongs mid-phrase).
			if (info.isFinalBar && info.ensemble?.piano.maxAttacks !== 0 && f.id === 'rest') return false;
			return true;
		}).map((f) => {
			const isCadenceBar = info.isSectionFinalBar && !info.isFinalBar;
			let weight = f.weight * (figureBias?.[f.id] ?? 1);
			if (info.ensemble && f.busy > 0) weight *= info.ensemble.piano.densityScale;
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

		const figure = motifStep?.figure ?? (weighted.length > 0 ? rng.weighted(weighted) : REST_FIGURE);

		// The "leave space" color: occasionally a bar speaks in guide tones
		// only — a low-intensity color that mostly retires as the band digs
		// in. Conditional draw (rest bars consume one draw, others two) —
		// safe because nothing draws from this bar's stream afterwards.
		const guideTones = figure.id !== 'rest' && (!motifs || figure.hits[0].length > 0) && rng.chance(0.06 * lerp(1.6, 0.4, info.intensity));

		plan.push({ figureId: figure.id, guideTones, ...(motifStep ? { transformedFigure: figure } : {}) });
		if (motifs) {
			plan[bar].motif = {
				version: 1, barIndex: bar, phraseStartBar: info.ensemble!.phraseStartBar,
				motifId: motifPhrase?.source ? `motif:${motifPhrase.startBar}:${motifPhrase.source.id}` : null,
				sourceFigureId: motifPhrase?.source?.id ?? null,
				transform: motifStep?.transform ?? 'fallback', displacementBeats: motifStep?.shift ?? 0,
				hits: [], ...(motifStep?.reason || motifPhrase?.reason ? { reason: motifStep?.reason ?? motifPhrase?.reason } : {})
			};
		}
		recent.push(figure.repeatKey ?? figure.id);
		if (figure.bars === 2) {
			plan.push({ figureId: 'cont', guideTones });
			if (motifs) plan[bar + 1].motif = { ...plan[bar].motif!, barIndex: bar + 1 };
		}
	}
	if (motifs) {
		for (const [bar, planned] of plan.entries()) {
			planned.motif = { ...planned.motif!, hits: hitsForPlannedBar(planned, plan, bar, barInfos[bar], beatsPerBar).map((hit) => ({ ...hit })) };
		}
		compMotifTrace(plan);
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
	if (info.ensemble?.piano.maxAttacks === 0 || planned.motif?.transform === 'space') return [];
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
