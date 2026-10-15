/** Phrase-shaped coordinated swing drumming, using the existing kit vocabulary. */
import type { BarInfo } from './backing-generation';
import type { DrumHitSpec, DrumVoice, GenerationContext } from './backing-styles';
import { chooseRideMode, rideBar, hihatBar, featherBar, fillBar, snareBar, couplingBar, type RideMode } from './backing-drum-vocab';
import { createRng, seedFrom } from './generation-rng';

export type DrumCommentaryTransform = 'statement' | 'answer' | 'repeat' | 'displace' | 'orchestrate' | 'space' | 'setup' | 'fallback';
export type DrumPhraseReason = 'ensemble_silence' | 'response_reserved' | 'arrival_reserved' | 'gesture_does_not_fit'
	| 'setup_does_not_fit' | 'motif_gap' | 'not_selected' | 'short_phrase' | 'partial_harmony';
export interface DrumPhraseDecision {
	readonly version: 1;
	readonly barIndex: number;
	readonly phraseStartBar: number;
	readonly phraseLength: number;
	readonly ride: {
		readonly mode: RideMode;
		readonly phase: 'statement' | 'repeat' | 'variation' | 'release' | 'single';
		readonly skipOffsets: readonly number[];
		readonly velocityScale: number;
		/** Actual cymbal onsets after agreed substitutions and arrivals. */
		readonly onsets: readonly number[];
	};
	readonly commentary: {
		readonly motifId: string | null;
		readonly source: 'vocabulary' | 'piano' | 'none';
		readonly sourceId: string | null;
		readonly sourceBar: number | null;
		readonly sourceOffsets: readonly number[];
		readonly transform: DrumCommentaryTransform;
		readonly displacementBeats: number;
		readonly hits: readonly Readonly<DrumHitSpec>[];
		readonly reason?: DrumPhraseReason;
	};
	/** Complete accepted bar after kit-limb and shared-voice collision resolution. */
	readonly hits: readonly Readonly<DrumHitSpec>[];
}
export type DrumPhraseBarPlan = DrumPhraseDecision;
export interface DrumPhrasePlan {
	readonly version: 1;
	readonly bars: readonly DrumPhraseBarPlan[];
	readonly trace: readonly DrumPhraseDecision[];
}
export interface DrumPhraseInput {
	readonly phraseId: string;
	readonly tempo: number;
	readonly beatsPerBar: number;
	readonly bars: readonly BarInfo[];
	readonly compOnsetsByBar?: ReadonlyMap<number, readonly number[]>;
	readonly bassOnsetsByBar?: ReadonlyMap<number, readonly number[]>;
	readonly harmonyEndBeat?: number;
	/** Pure shared-timing eligibility: reject an entire cell before it is traced. */
	readonly acceptsOnset?: (absBeat: number, hit: Readonly<DrumHitSpec>) => boolean;
}

export function freezeDrumPhraseTrace(trace: readonly DrumPhraseDecision[]): readonly DrumPhraseDecision[] {
	for (const entry of trace) {
		for (const hit of entry.hits) Object.freeze(hit);
		for (const hit of entry.commentary.hits) Object.freeze(hit);
		Object.freeze(entry.hits);
		Object.freeze(entry.commentary.hits);
		Object.freeze(entry.commentary.sourceOffsets);
		Object.freeze(entry.commentary);
		Object.freeze(entry.ride.skipOffsets);
		Object.freeze(entry.ride.onsets);
		Object.freeze(entry.ride);
		Object.freeze(entry);
	}
	return Object.freeze(trace);
}

type Cell = { id: string; hits: DrumHitSpec[] };
type Motif = {
	id: string; source: 'vocabulary' | 'piano'; sourceId: string; sourceBar: number;
	startBar: number; sourceOffsets: number[]; hits: DrumHitSpec[]; shift: number;
	orchestration: DrumVoice[]; firstTransform: 'statement' | 'answer'; gapAfterStatement: boolean;
};
type PhraseState = {
	start: number; end: number; mode: RideMode; skips: number[]; variedSkips: number[];
	commentarySelected: boolean; motif?: Motif;
};

const CELLS: readonly Cell[] = [
	{ id: 'snare-charleston', hits: [{ drum: 'snare', beatOffset: 0, velocity: 0.23 }, { drum: 'snare', beatOffset: 1.5, velocity: 0.29 }] },
	{ id: 'snare-offbeat-pair', hits: [{ drum: 'snare', beatOffset: 0.5, velocity: 0.18 }, { drum: 'snare', beatOffset: 2.5, velocity: 0.25 }] },
	{ id: 'snare-late-pair', hits: [{ drum: 'snare', beatOffset: 1.5, velocity: 0.21 }, { drum: 'snare', beatOffset: 3.5, velocity: 0.28 }] },
	{ id: 'snare-jab', hits: [{ drum: 'snare', beatOffset: 1.5, velocity: 0.24 }] }
];
const cymbal = (drum: DrumVoice): boolean => drum === 'ride' || drum === 'ride-bell' || drum === 'crash';
const limb = (drum: DrumVoice): string => drum === 'kick' ? 'right-foot' : drum === 'hihat-pedal' ? 'left-foot'
	: drum === 'snare' || drum === 'crossstick' ? 'left-hand' : 'right-hand';
const slot = (hit: DrumHitSpec): string => `${limb(hit.drum)}:${hit.beatOffset}`;

/** A complete gesture must fit both the actual bar and one player of each limb. */
function fits(hits: readonly DrumHitSpec[], allowance: number, extent: number, acceptsOnset?: (hit: DrumHitSpec) => boolean): boolean {
	return hits.length <= allowance && new Set(hits.map(slot)).size === hits.length &&
		hits.every((hit) => Number.isFinite(hit.beatOffset) && hit.beatOffset >= 0 && hit.beatOffset < extent &&
			(acceptsOnset?.(hit) ?? true));
}

function phraseState(input: DrumPhraseInput, start: number, end: number): PhraseState {
	const rng = createRng(seedFrom(input.phraseId, input.tempo, 'drum-phrase-ride', start));
	const info = input.bars[start];
	const mode = input.tempo >= 240 && rng.chance(0.4) ? 'quarters-only' : chooseRideMode(rng, info.intensity);
	const skips = mode === 'quarters-only' ? [] : mode === 'standard' ? [1.5, 3.5]
		: mode === 'skip-plus' ? [1.5, 3.5, rng.pick([0.5, 2.5])].sort((a, b) => a - b)
			: [0.5, rng.pick([1.5, 3.5])];
	// One recognizable change after the repeated opening, followed by release.
	const variedSkips = skips.length > 1 ? skips.slice(0, -1) : [...skips];
	const commentaryRng = createRng(seedFrom(input.phraseId, input.tempo, 'drum-phrase-intent', start));
	return { start, end, mode, skips, variedSkips, commentarySelected: commentaryRng.chance(0.65) };
}

function chooseMotif(input: DrumPhraseInput, state: PhraseState, bar: number, allowance: number): Motif | undefined {
	const rng = createRng(seedFrom(input.phraseId, input.tempo, 'drum-phrase-source', state.start, bar));
	const accepts = (hit: DrumHitSpec) => input.acceptsOnset?.(bar * 4 + hit.beatOffset, { ...hit, role: 'commentary' }) ?? true;
	// A reply may cross the boundary into this phrase, but its development
	// remains inside this phrase and never reads a future piano bar.
	const previous = input.compOnsetsByBar?.get(bar - 1) ?? [];
	const piano = [...new Set(previous)].sort((a, b) => a - b);
	const pianoHits: DrumHitSpec[] = piano.map((beatOffset, index) => ({ drum: 'snare', beatOffset, velocity: 0.23 + index * 0.04 }));
	const usablePiano = piano.length > 0 && piano.length <= allowance && piano.length <= 2 &&
		piano.every((offset) => Number.isInteger(offset * 2)) && fits(pianoHits, allowance, 4, accepts);
	const answer = usablePiano && rng.chance(input.bars[bar].ensemble!.responseOwner === 'drums' ? 0.85 : 0.55);
	const eligible = CELLS.filter((cell) => fits(cell.hits, allowance, 4, accepts));
	if (!answer && eligible.length === 0) return undefined;
	const source = answer ? undefined : rng.pick(eligible);
	const hits: DrumHitSpec[] = answer ? pianoHits
		: source?.hits.map((hit) => ({ ...hit })) ?? [];
	if (hits.length === 0) return undefined;
	const shifts = [-1, -0.5, 0.5, 1].filter((shift) => hits.every((hit) => hit.beatOffset + shift >= 0 && hit.beatOffset + shift < 4));
	if (shifts.length === 0) return undefined;
	const orchestrations: DrumVoice[][] = [['crossstick', 'snare'], ['snare', 'kick'], ['crossstick', 'ride-bell']];
	const orchestration = rng.pick(orchestrations.filter((voices) =>
		hits.some((hit, index) => voices[index % voices.length] !== hit.drum)));
	return {
		id: `drum-motif:${state.start}:${bar}`, source: answer ? 'piano' : 'vocabulary',
		sourceId: answer ? `piano:${bar - 1}` : source!.id, sourceBar: answer ? bar - 1 : bar,
		startBar: bar, sourceOffsets: hits.map((hit) => hit.beatOffset), hits,
		shift: rng.pick(shifts), orchestration,
		firstTransform: answer ? 'answer' : 'statement', gapAfterStatement: state.end - bar >= 4 && rng.chance(0.5)
	};
}

/** Realize selected cells causally; later evidence cannot rewrite their source. */
export function planDrumPhrases(input: DrumPhraseInput): DrumPhrasePlan {
	if (input.beatsPerBar !== 4) throw new Error('Drum phrases require coordinated four-beat swing');
	if (!Number.isFinite(input.tempo) || input.tempo <= 0) throw new Error('Drum phrase tempo must be positive');
	if (input.bars.some((bar, index) => !bar.ensemble || bar.ensemble.barIndex !== index)) {
		throw new Error('Drum phrases require a contiguous coordinated ensemble plan');
	}
	const harmonyEnd = input.harmonyEndBeat ?? input.bars.length * 4;
	if (!Number.isFinite(harmonyEnd) || harmonyEnd < 0 || harmonyEnd > input.bars.length * 4) {
		throw new Error('Drum phrase harmony extent must fit the full bar timeline');
	}
	const completeBars = Math.floor(harmonyEnd / 4);
	const decisions: DrumPhraseDecision[] = [];
	let state: PhraseState | undefined;
	for (let bar = 0; bar < input.bars.length; bar++) {
		const info = input.bars[bar];
		const ensemble = info.ensemble!;
		const extent = Math.max(0, Math.min(4, harmonyEnd - bar * 4));
		const accepts = (hit: DrumHitSpec) => input.acceptsOnset?.(bar * 4 + hit.beatOffset, hit) ?? true;
		const acceptsCommentary = (hit: DrumHitSpec) => accepts({ ...hit, role: 'commentary' });
		if (!state || bar >= state.end) {
			let end = bar + 1;
			while (end < Math.min(input.bars.length, bar + 4, completeBars) &&
				input.bars[end].ensemble!.phraseStartBar === ensemble.phraseStartBar &&
				input.bars[end].sectionIndex === info.sectionIndex &&
				input.bars[end].chorusIndex === info.chorusIndex) end++;
			state = phraseState(input, bar, end);
		}
		const length = state.end - state.start;
		const position = bar - state.start;
		const phase: DrumPhraseDecision['ride']['phase'] = length < 2 ? 'single' : position === 0 ? 'statement'
			: position === 1 ? 'repeat' : position === length - 1 ? 'release' : 'variation';
		const skipOffsets = phase === 'release' ? state.skips.slice(0, 1) : phase === 'variation' ? state.variedSkips : state.skips;
		const velocityScale = phase === 'release' ? 0.94 : phase === 'variation' ? 1.04 : phase === 'repeat' ? 1.01 : 1;
		const timeRng = createRng(seedFrom(input.phraseId, input.tempo, 'drum-phrase-time', bar));
		const ostinato: DrumHitSpec[] = [
			...rideBar(state.mode, bar, 4, timeRng, skipOffsets).map((hit) => ({ ...hit, velocity: hit.velocity * velocityScale })),
			...hihatBar(4, timeRng).map((hit) => ({ ...hit, drum: 'hihat-pedal' as const })),
			...featherBar(4, timeRng, info.intensity)
		].map((hit): DrumHitSpec => ({ ...hit, role: 'timekeeping' }))
			.filter((hit) => hit.beatOffset < extent && accepts(hit));
		const commentaryRng = createRng(seedFrom(input.phraseId, input.tempo, 'drum-phrase-commentary', bar));
		const ctx: GenerationContext = {
			...info, barIndex: bar, beatsPerBar: 4, swing: 0.67, rng: commentaryRng,
			compOnsets: [...input.compOnsetsByBar?.get(bar) ?? []], bassOnsets: [...input.bassOnsetsByBar?.get(bar) ?? []]
		};
		const arrival = ensemble.coordinatedAccent?.participants.includes('drums') && extent > 0;
		const accents: DrumHitSpec[] = (arrival ? [
			{ drum: 'crash', beatOffset: 0, velocity: 0.42 + 0.12 * ensemble.coordinatedAccent!.strength, role: 'accent' },
			{ drum: 'kick', beatOffset: 0, velocity: 0.32, role: 'accent' }
		] as DrumHitSpec[] : []).filter(accepts);
		let chosen: DrumHitSpec[] = [];
		let transform: DrumCommentaryTransform = 'space';
		let shift = 0;
		let reason: DrumPhraseReason | undefined;
		let setupId: string | undefined;
		const allowance = ensemble.drums.maxCommentaryHits;
		if (arrival) reason = 'arrival_reserved';
		else if (allowance === 0) reason = 'ensemble_silence';
		else if (ensemble.responseOwner === 'piano' || ensemble.responseOwner === 'bass') reason = 'response_reserved';
		else if (ensemble.drums.allowFill) {
			const fill = fillBar({ ...ctx, isSectionFirstBar: false, isSectionFinalBar: true, isChorusFinalBar: false },
				createRng(seedFrom(input.phraseId, input.tempo, 'drum-fill', bar))).hits;
			if (fill.length > 0 && fits(fill, allowance, extent, acceptsCommentary)) {
				chosen = fill; transform = 'setup';
				setupId = `fill:${fill.map((hit) => `${hit.drum}@${hit.beatOffset}`).join(',')}`;
			} else reason = 'setup_does_not_fit';
		} else {
			if (!state.motif && state.commentarySelected && state.end - bar >= 2 && extent === 4) {
				state.motif = chooseMotif(input, state, bar, allowance);
			}
			const motif = state.motif;
			if (motif) {
				const age = bar - motif.startBar;
				if (age === 0) { transform = motif.firstTransform; chosen = motif.hits; }
				else if (age === 1 && motif.gapAfterStatement) reason = 'motif_gap';
				else if (age === state.end - motif.startBar - 1) {
					transform = 'orchestrate';
					chosen = motif.hits.map((hit, index) => ({ ...hit, drum: motif.orchestration[index % motif.orchestration.length] }));
				} else if (age === 2 || state.end - motif.startBar === 3) {
					transform = 'displace'; shift = motif.shift;
					chosen = motif.hits.map((hit) => ({ ...hit, beatOffset: hit.beatOffset + shift }));
				} else { transform = 'repeat'; chosen = motif.hits; }
				if (!fits(chosen, allowance, extent, acceptsCommentary)) {
					chosen = []; transform = 'space'; shift = 0; reason = extent < 4 ? 'partial_harmony' : 'gesture_does_not_fit';
				}
			} else {
				transform = 'fallback';
				reason = extent < 4 ? 'partial_harmony' : length < 2 ? 'short_phrase' : 'not_selected';
				// Retain the existing current-bar coupling only for fallback bars;
				// it never refills a motif gap or a withheld transformed cell.
				for (const group of [snareBar(ctx, commentaryRng), couplingBar(ctx, commentaryRng)]) {
					if (group.length > 0 && fits([...chosen, ...group], allowance, extent, acceptsCommentary)) chosen.push(...group);
				}
			}
		}
		const commentary = chosen.map((hit) => ({ ...hit,
			velocity: hit.velocity * ensemble.drums.commentaryScale, role: 'commentary' as const }));
		// Each whole accepted gesture owns its physical limbs. Cymbal color
		// replaces that instant's ride, and a foot accent replaces feathering.
		const occupied = new Set([...commentary, ...accents].map(slot));
		const hits = [...ostinato.filter((hit) => !occupied.has(slot(hit))), ...accents, ...commentary];
		const motif = state.motif;
		decisions.push({
			version: 1, barIndex: bar, phraseStartBar: state.start, phraseLength: length,
			ride: { mode: state.mode, phase, skipOffsets: [...skipOffsets].filter((offset) => offset < extent), velocityScale,
				onsets: [...new Set(hits.filter((hit) => cymbal(hit.drum)).map((hit) => hit.beatOffset))].sort((a, b) => a - b) },
			commentary: {
				motifId: transform === 'setup' ? null : motif?.id ?? null,
				source: transform === 'setup' ? 'vocabulary' : motif?.source ?? 'none',
				sourceId: setupId ?? motif?.sourceId ?? null,
				sourceBar: transform === 'setup' ? bar : motif?.sourceBar ?? null,
				sourceOffsets: transform === 'setup' ? commentary.map((hit) => hit.beatOffset) : [...motif?.sourceOffsets ?? []],
				transform, displacementBeats: shift, hits: commentary, ...(reason ? { reason } : {})
			}, hits
		});
	}
	const trace = freezeDrumPhraseTrace(decisions);
	return Object.freeze({ version: 1, bars: trace, trace });
}
