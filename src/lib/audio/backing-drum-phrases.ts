/** Phrase development for swing/straight, protected native grooves for bossa/ballad. */
import { BACKING_STYLES } from './backing-styles';
import type { BackingStyle } from '$lib/types/instruments';
import type { BarInfo } from './backing-generation';
import type { DrumHitSpec, DrumVoice, GenerationContext } from './backing-styles';
import { chooseRideMode, rideBar, hihatBar, featherBar, fillBar, snareBar, couplingBar, type RideMode } from './backing-drum-vocab';
import { createRng, seedFrom } from './generation-rng';

export type DrumCommentaryTransform = 'statement' | 'answer' | 'repeat' | 'displace' | 'orchestrate' | 'space' | 'setup' | 'fallback';
export type DrumPhraseReason = 'ensemble_silence' | 'response_reserved' | 'arrival_reserved' | 'gesture_does_not_fit'
	| 'native_groove' | 'setup_does_not_fit' | 'motif_gap' | 'not_selected' | 'short_phrase' | 'partial_harmony';
export interface DrumPhraseDecision {
	/** Native groove identity; absence denotes the original swing phrase vocabulary. */
	readonly style?: BackingStyle;
	readonly version: 1;
	readonly barIndex: number;
	readonly phraseStartBar: number;
	readonly phraseLength: number;
	readonly ride: {
		/** Selected phrase timekeeping voice; actual substitutions remain in hits. */
		readonly voice?: 'ride' | 'ride-bell';
		readonly mode: RideMode | 'none';
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
	readonly style?: BackingStyle;
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

/** One committed bar; future instrument choices are deliberately absent. */
export interface DrumPhraseBarInput {
	readonly style?: BackingStyle;
	readonly phraseId: string;
	readonly tempo: number;
	readonly beatsPerBar: 4;
	readonly barIndex: number;
	readonly info: BarInfo;
	/** Static score boundaries, clipped to section, chorus and complete harmony. */
	readonly phraseStartBar: number;
	readonly phraseEndBarExclusive: number;
	/** Static structural peak extent, clipped to this phrase; never future solo evidence. */
	readonly peakEndBarExclusive?: number;
	readonly harmonyEndBeat: number;
	/** Only attacks accepted for emission in this bar, never candidate rhythms. */
	readonly compOnsets?: readonly number[];
	readonly bassOnsets?: readonly number[];
	readonly acceptsOnset?: DrumPhraseInput['acceptsOnset'];
}

/** Bounded realization state. The caller's enclosing checkpoint binds the full score. */
export interface DrumPhraseMemory {
	readonly style?: BackingStyle;
	readonly version: 1;
	readonly phraseId: string;
	readonly tempo: number;
	readonly harmonyEndBeat: number;
	readonly nextBar: number;
	readonly sectionIndex: number | null;
	readonly chorusIndex: number | null;
	readonly ensemblePhraseStartBar: number;
	readonly phrase: Readonly<PhraseState>;
	readonly previousCompOnsets: readonly number[];
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
	startBar: number; sourceOffsets: readonly number[]; hits: readonly Readonly<DrumHitSpec>[]; shift: number;
	orchestration: readonly DrumVoice[]; firstTransform: 'statement' | 'answer'; gapAfterStatement: boolean;
};
type PhraseState = {
	start: number; end: number; mode: RideMode; skips: readonly number[]; variedSkips: readonly number[];
	/** Absent in legacy checkpoints, which retain ride for their committed phrase. */
	rideVoice?: 'ride' | 'ride-bell';
	commentarySelected: boolean; motif?: Readonly<Motif>;
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

function phraseState(input: DrumPhraseBarInput, start: number, end: number, previous?: Readonly<PhraseState>): PhraseState {
	const rng = createRng(seedFrom(input.phraseId, input.tempo, 'drum-phrase-ride', start));
	const info = input.info;
	const mode = input.tempo >= 240 && rng.chance(0.4) ? 'quarters-only' : chooseRideMode(rng, info.intensity);
	const skips = mode === 'quarters-only' ? [] : mode === 'standard' ? [1.5, 3.5]
		: mode === 'skip-plus' ? [1.5, 3.5, rng.pick([0.5, 2.5])].sort((a, b) => a - b)
			: [0.5, rng.pick([1.5, 3.5])];
	// One recognizable change after the repeated opening, followed by release.
	const variedSkips = skips.length > 1 ? skips.slice(0, -1) : [...skips];
	const commentaryRng = createRng(seedFrom(input.phraseId, input.tempo, 'drum-phrase-intent', start));
	const structural = info.ensemble!.performanceEnergy;
	const bellEligible = structural?.phase === 'solo_peak' && info.ensemble!.energy >= 0.7 &&
		end - start >= 2 && input.peakEndBarExclusive !== undefined && input.peakEndBarExclusive >= end &&
		previous?.rideVoice !== 'ride-bell' && info.ensemble!.drums.silenceReason !== 'soloist_dense';
	const rideVoice = bellEligible && createRng(seedFrom(input.phraseId, input.tempo, 'drum-phrase-texture', start)).chance(0.35)
		? 'ride-bell' as const : 'ride' as const;
	return { start, end, mode, skips, variedSkips, commentarySelected: commentaryRng.chance(0.65),
		...(structural ? { rideVoice } : {}) };
}

function chooseMotif(input: DrumPhraseBarInput, state: PhraseState, bar: number, allowance: number, previous: readonly number[]): Motif | undefined {
	const rng = createRng(seedFrom(input.phraseId, input.tempo, 'drum-phrase-source', state.start, bar));
	const accepts = (hit: DrumHitSpec) => input.acceptsOnset?.(bar * 4 + hit.beatOffset, { ...hit, role: 'commentary' }) ?? true;
	// A reply may cross the boundary into this phrase, but its development
	// remains inside this phrase and never reads a future piano bar.
	const piano = [...new Set(previous)].sort((a, b) => a - b);
	const pianoHits: DrumHitSpec[] = piano.map((beatOffset, index) => ({ drum: 'snare', beatOffset, velocity: 0.23 + index * 0.04 }));
	const usablePiano = piano.length > 0 && piano.length <= allowance && piano.length <= 2 &&
		piano.every((offset) => Number.isInteger(offset * 2)) && fits(pianoHits, allowance, 4, accepts);
	const answer = usablePiano && rng.chance(input.info.ensemble!.responseOwner === 'drums' ? 0.85 : 0.55);
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

function realizeDrumPhraseBar(input: DrumPhraseBarInput, state: PhraseState, previousCompOnsets: readonly number[]): DrumPhraseDecision {
	const bar = input.barIndex;
	const info = input.info;
	const ensemble = info.ensemble!;
	const extent = Math.max(0, Math.min(4, input.harmonyEndBeat - bar * 4));
	const accepts = (hit: DrumHitSpec) => input.acceptsOnset?.(bar * 4 + hit.beatOffset, hit) ?? true;
	const acceptsCommentary = (hit: DrumHitSpec) => accepts({ ...hit, role: 'commentary' });
	const length = state.end - state.start;
	const position = bar - state.start;
	const phase: DrumPhraseDecision['ride']['phase'] = length < 2 ? 'single' : position === 0 ? 'statement'
		: position === 1 ? 'repeat' : position === length - 1 ? 'release' : 'variation';
	const skipOffsets = phase === 'release' ? state.skips.slice(0, 1) : phase === 'variation' ? state.variedSkips : state.skips;
	const velocityScale = phase === 'release' ? 0.94 : phase === 'variation' ? 1.04 : phase === 'repeat' ? 1.01 : 1;
	const timeRng = createRng(seedFrom(input.phraseId, input.tempo, 'drum-phrase-time', bar));
	const ostinato: DrumHitSpec[] = [
		...rideBar(state.mode, bar, 4, timeRng, skipOffsets).map((hit) => ({ ...hit,
			drum: state.rideVoice ?? hit.drum, velocity: hit.velocity * velocityScale })),
		...hihatBar(4, timeRng).map((hit) => ({ ...hit, drum: 'hihat-pedal' as const })),
		...featherBar(4, timeRng, info.intensity)
	].map((hit): DrumHitSpec => ({ ...hit, role: 'timekeeping' }))
		.filter((hit) => hit.beatOffset < extent && accepts(hit));
	const commentaryRng = createRng(seedFrom(input.phraseId, input.tempo, 'drum-phrase-commentary', bar));
	const ctx: GenerationContext = {
		...info, barIndex: bar, beatsPerBar: 4, swing: 0.67, rng: commentaryRng,
		compOnsets: [...input.compOnsets ?? []], bassOnsets: [...input.bassOnsets ?? []]
	};
	const arrival = ensemble.coordinatedAccent?.participants.includes('drums') && extent > 0;
	const accents: DrumHitSpec[] = (arrival ? [
		{ drum: 'crash', beatOffset: 0, velocity: 0.42 + 0.12 * ensemble.coordinatedAccent!.strength, role: 'accent' },
		{ drum: 'kick', beatOffset: 0, velocity: 0.32, role: 'accent' }
	] as DrumHitSpec[] : []).filter(accepts);
	let chosen: readonly DrumHitSpec[] = [];
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
			state.motif = chooseMotif(input, state, bar, allowance, previousCompOnsets);
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
				if (group.length > 0 && fits([...chosen, ...group], allowance, extent, acceptsCommentary)) chosen = [...chosen, ...group];
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
	const decision: DrumPhraseDecision = {
		version: 1, barIndex: bar, phraseStartBar: state.start, phraseLength: length,
		ride: { mode: state.mode, phase, ...(state.rideVoice ? { voice: state.rideVoice } : {}), skipOffsets: [...skipOffsets].filter((offset) => offset < extent), velocityScale,
			onsets: [...new Set(hits.filter((hit) => cymbal(hit.drum)).map((hit) => hit.beatOffset))].sort((a, b) => a - b) },
		commentary: {
			motifId: transform === 'setup' ? null : motif?.id ?? null,
			source: transform === 'setup' ? 'vocabulary' : motif?.source ?? 'none',
			sourceId: setupId ?? motif?.sourceId ?? null,
			sourceBar: transform === 'setup' ? bar : motif?.sourceBar ?? null,
			sourceOffsets: transform === 'setup' ? commentary.map((hit) => hit.beatOffset) : [...motif?.sourceOffsets ?? []],
			transform, displacementBeats: shift, hits: commentary, ...(reason ? { reason } : {})
		}, hits
	};
	return freezeDrumPhraseTrace([decision])[0];
}

/** Restore deep immutability after a JSON checkpoint round trip. */
export function freezeDrumPhraseMemory(memory: DrumPhraseMemory): DrumPhraseMemory {
	Object.freeze(memory.previousCompOnsets);
	Object.freeze(memory.phrase.skips);
	Object.freeze(memory.phrase.variedSkips);
	const motif = memory.phrase.motif;
	if (motif) {
		for (const hit of motif.hits) Object.freeze(hit);
		Object.freeze(motif.hits);
		Object.freeze(motif.sourceOffsets);
		Object.freeze(motif.orchestration);
		Object.freeze(motif);
	}
	Object.freeze(memory.phrase);
	return Object.freeze(memory);
}

const barNumber = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
function validOnsets(values: readonly number[], max = 32): boolean {
	return Array.isArray(values) && values.length <= max && values.every((value) =>
		Number.isFinite(value) && value >= 0 && value < 4);
}

function validateDrumPhraseBar(input: DrumPhraseBarInput, memory?: DrumPhraseMemory): void {
	if (input.beatsPerBar !== 4) throw new Error('Drum phrases require coordinated four-beat accompaniment');
	if (typeof input.phraseId !== 'string' || !input.phraseId || !Number.isFinite(input.tempo) || input.tempo <= 0) {
		throw new Error('Drum phrase identity and tempo must be valid');
	}
	if (!barNumber(input.barIndex) || !barNumber(input.phraseStartBar) || !barNumber(input.phraseEndBarExclusive) ||
		input.phraseStartBar > input.barIndex || input.barIndex >= input.phraseEndBarExclusive ||
		input.phraseEndBarExclusive - input.phraseStartBar > 4 ||
		!Number.isFinite(input.harmonyEndBeat) || input.harmonyEndBeat < 0 ||
		(input.phraseEndBarExclusive - input.phraseStartBar > 1 && input.phraseEndBarExclusive * 4 > input.harmonyEndBeat)) {
		throw new Error('Drum phrase bar and static boundaries must fit the harmony extent');
	}
	const ensemble = input.info.ensemble;
	if (input.peakEndBarExclusive !== undefined && (!barNumber(input.peakEndBarExclusive) ||
		input.peakEndBarExclusive <= input.barIndex || input.peakEndBarExclusive > input.phraseEndBarExclusive ||
		input.peakEndBarExclusive * 4 > input.harmonyEndBeat || ensemble?.performanceEnergy?.phase !== 'solo_peak')) {
		throw new Error('Invalid static drum peak boundary');
	}
	if (!ensemble || ensemble.barIndex !== input.barIndex || !barNumber(ensemble.phraseStartBar) ||
		ensemble.phraseStartBar > input.phraseStartBar || !Number.isFinite(input.info.intensity) ||
		input.info.intensity < 0 || input.info.intensity > 1 ||
		!Number.isInteger(ensemble.drums.maxCommentaryHits) || ensemble.drums.maxCommentaryHits < 0 || ensemble.drums.maxCommentaryHits > 3 ||
		!Number.isFinite(ensemble.drums.commentaryScale) || ensemble.drums.commentaryScale < 0 ||
		!validOnsets(input.compOnsets ?? []) || !validOnsets(input.bassOnsets ?? [])) {
		throw new Error('Drum bar requires valid current ensemble decisions and emitted onsets');
	}
	if (!memory) {
		if (input.barIndex !== 0 || input.phraseStartBar !== 0) throw new Error('Drum continuation must start at bar zero without memory');
		return;
	}
	if (memory.version !== 1 || memory.phraseId !== input.phraseId || memory.tempo !== input.tempo ||
		memory.harmonyEndBeat !== input.harmonyEndBeat || memory.nextBar !== input.barIndex ||
		(memory.style ?? 'swing') !== (input.style ?? 'swing')) {
		throw new Error('Drum continuation requires matching identity and consecutive bars');
	}
	const state = memory.phrase;
	if (!state || !barNumber(state.start) || !barNumber(state.end) || state.end <= state.start || state.end - state.start > 4 ||
		state.start >= memory.nextBar || state.end < memory.nextBar ||
		!['standard', 'quarters-only', 'skip-plus', 'broken'].includes(state.mode) ||
		(state.rideVoice !== undefined && !['ride', 'ride-bell'].includes(state.rideVoice)) ||
		(state.rideVoice === 'ride-bell' && (state.end - state.start < 2 || input.style === 'ballad' || input.style === 'bossa-nova')) ||
		!validOnsets(state.skips, 3) || !validOnsets(state.variedSkips, 3) ||
		typeof state.commentarySelected !== 'boolean' || !validOnsets(memory.previousCompOnsets) ||
		!barNumber(memory.ensemblePhraseStartBar) || memory.ensemblePhraseStartBar > state.start ||
		![memory.sectionIndex, memory.chorusIndex].every((value) => value === null || barNumber(value))) {
		throw new Error('Invalid drum phrase checkpoint');
	}
	if (input.barIndex < state.end) {
		if (state.rideVoice === 'ride-bell' && (input.info.ensemble?.performanceEnergy?.phase !== 'solo_peak' ||
			input.peakEndBarExclusive === undefined || input.peakEndBarExclusive < state.end)) {
			throw new Error('A reserved bell phrase requires its declared peak boundary');
		}
		if (input.phraseStartBar !== state.start || input.phraseEndBarExclusive !== state.end ||
			memory.sectionIndex !== (input.info.sectionIndex ?? null) || memory.chorusIndex !== (input.info.chorusIndex ?? null) ||
			memory.ensemblePhraseStartBar !== ensemble.phraseStartBar) {
			throw new Error('A reserved drum phrase cannot change its static boundaries');
		}
	} else if (input.phraseStartBar !== input.barIndex) {
		throw new Error('The next drum phrase must begin at the continuation bar');
	}
	const motif = state.motif;
	if (motif && (!state.commentarySelected || !barNumber(motif.startBar) || motif.startBar < state.start ||
		motif.startBar >= memory.nextBar || motif.startBar + 2 > state.end ||
		!['piano', 'vocabulary'].includes(motif.source) ||
		motif.id !== `drum-motif:${state.start}:${motif.startBar}` ||
		motif.sourceBar !== motif.startBar - (motif.source === 'piano' ? 1 : 0) || motif.sourceBar < 0 ||
		motif.firstTransform !== (motif.source === 'piano' ? 'answer' : 'statement') ||
		(motif.source === 'piano' ? motif.sourceId !== `piano:${motif.sourceBar}` : !CELLS.some((cell) => cell.id === motif.sourceId)) ||
		!validOnsets(motif.sourceOffsets, 2) || !Array.isArray(motif.hits) || !motif.hits.length || motif.hits.length > 2 ||
		motif.hits.some((hit, index) => hit.drum !== 'snare' || hit.beatOffset !== motif.sourceOffsets[index] ||
			!Number.isFinite(hit.velocity) || hit.velocity <= 0 || hit.velocity > 1) ||
		motif.hits.length !== motif.sourceOffsets.length || ![-1, -0.5, 0.5, 1].includes(motif.shift) ||
		!validOnsets(motif.sourceOffsets.map((offset) => offset + motif.shift), 2) ||
		!Array.isArray(motif.orchestration) || motif.orchestration.length !== 2 ||
		!motif.orchestration.every((voice) => ['crossstick', 'snare', 'kick', 'ride-bell'].includes(voice)) ||
		typeof motif.gapAfterStatement !== 'boolean')) {
		throw new Error('Invalid committed drum motif checkpoint');
	}
}

/** Commit one bar while carrying only already accepted phrase and piano evidence. */
export function planDrumPhraseBar(input: DrumPhraseBarInput, memory?: DrumPhraseMemory): {
	readonly bar: DrumPhraseDecision; readonly memory: DrumPhraseMemory;
} {
	validateDrumPhraseBar(input, memory);
	if (input.style === 'bossa-nova' || input.style === 'ballad') return realizeNativeDrumBar(input, memory);
	// The reserved ride and accepted motif survive later budget changes.
	// Copy before mutation/freezing: a caller may retain an unfrozen JSON checkpoint.
	const previous = memory?.phrase;
	const state: PhraseState = previous && input.barIndex < previous.end ? {
		start: previous.start, end: previous.end, mode: previous.mode,
		...(previous.rideVoice ? { rideVoice: previous.rideVoice } : {}),
		skips: [...previous.skips], variedSkips: [...previous.variedSkips], commentarySelected: previous.commentarySelected,
		...(previous.motif ? { motif: {
			id: previous.motif.id, source: previous.motif.source, sourceId: previous.motif.sourceId,
			sourceBar: previous.motif.sourceBar, startBar: previous.motif.startBar,
			sourceOffsets: [...previous.motif.sourceOffsets],
			hits: previous.motif.hits.map(({ drum, beatOffset, velocity }) => ({ drum, beatOffset, velocity })),
			shift: previous.motif.shift, orchestration: [...previous.motif.orchestration],
			firstTransform: previous.motif.firstTransform, gapAfterStatement: previous.motif.gapAfterStatement
		} } : {})
	} : phraseState(input, input.phraseStartBar, input.phraseEndBarExclusive, previous);
	const bar = realizeDrumPhraseBar(input, state, memory?.previousCompOnsets ?? []);
	return Object.freeze({ bar, memory: freezeDrumPhraseMemory({
		version: 1, ...(input.style && input.style !== 'swing' ? { style: input.style } : {}), phraseId: input.phraseId, tempo: input.tempo, harmonyEndBeat: input.harmonyEndBeat,
		nextBar: input.barIndex + 1, sectionIndex: input.info.sectionIndex ?? null,
		chorusIndex: input.info.chorusIndex ?? null, ensemblePhraseStartBar: input.info.ensemble!.phraseStartBar,
		phrase: state, previousCompOnsets: [...input.compOnsets ?? []]
	}) });
}

/** Realize selected cells causally; later evidence cannot rewrite their source. */
export function planDrumPhrases(input: DrumPhraseInput): DrumPhrasePlan {
	if (input.beatsPerBar !== 4) throw new Error('Drum phrases require coordinated four-beat accompaniment');
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
	let memory: DrumPhraseMemory | undefined;
	for (let bar = 0; bar < input.bars.length; bar++) {
		const info = input.bars[bar];
		const ensemble = info.ensemble!;
		let start = memory?.phrase.start ?? bar;
		let end = memory?.phrase.end ?? bar;
		if (bar >= end) {
			start = bar;
			end = bar + 1;
			while (end < Math.min(input.bars.length, bar + 4, completeBars) &&
				input.bars[end].ensemble!.phraseStartBar === ensemble.phraseStartBar &&
				input.bars[end].sectionIndex === info.sectionIndex &&
				input.bars[end].chorusIndex === info.chorusIndex) end++;
		}
		let peakEnd: number | undefined;
		if (ensemble.performanceEnergy?.phase === 'solo_peak' && (bar + 1) * 4 <= harmonyEnd) {
			peakEnd = bar + 1;
			while (peakEnd < end && input.bars[peakEnd].ensemble?.performanceEnergy?.phase === 'solo_peak') peakEnd++;
		}
		const step: DrumPhraseBarInput = {
			style: input.style, phraseId: input.phraseId, tempo: input.tempo, beatsPerBar: 4, barIndex: bar, info,
			phraseStartBar: start, phraseEndBarExclusive: end, harmonyEndBeat: harmonyEnd,
			...(peakEnd !== undefined ? { peakEndBarExclusive: peakEnd } : {}),
			compOnsets: input.compOnsetsByBar?.get(bar), bassOnsets: input.bassOnsetsByBar?.get(bar),
			acceptsOnset: input.acceptsOnset
		};
		const result = planDrumPhraseBar(step, memory);
		decisions.push(result.bar);
		memory = result.memory;
	}
	const trace = freezeDrumPhraseTrace(decisions);
	return Object.freeze({ version: 1, bars: trace, trace });
}

/** Native timekeeping is protected; only optional commentary competes for a response slot. */
function realizeNativeDrumBar(input: DrumPhraseBarInput, memory?: DrumPhraseMemory): {
	readonly bar: DrumPhraseDecision; readonly memory: DrumPhraseMemory;
} {
	const style = BACKING_STYLES[input.style!];
	const ensemble = input.info.ensemble!;
	const isBossa = input.style === 'bossa-nova';
	const rng = createRng(seedFrom(input.phraseId, input.tempo, 'drums', input.barIndex));
	const raw = style.drumPattern({ ...input.info, ensemble: undefined, barIndex: input.barIndex, beatsPerBar: 4,
		swing: style.defaultSwing, rng, fillRng: createRng(seedFrom(input.phraseId, input.tempo, 'drum-fill', input.barIndex)),
		clavePhase: createRng(seedFrom(input.phraseId, input.tempo, 'clave', 0)).chance(0.5) ? '32' : '23' });
	const time: DrumHitSpec[] = raw.filter((hit) => isBossa || !['snare', 'crossstick'].includes(hit.drum))
		.map((hit) => ({ ...hit, role: 'timekeeping' }));
	const canComment = !isBossa && ensemble.drums.maxCommentaryHits > 0 && !ensemble.coordinatedAccent &&
		(ensemble.responseOwner === 'nobody' || ensemble.responseOwner === 'drums');
	const previous = memory?.previousCompOnsets ?? [];
	// A quiet answer uses only a previously emitted piano onset, with the left hand free.
	const answerOffset = canComment && ensemble.responseOwner === 'drums' ? previous.find((offset) =>
		offset >= 1 && !(input.compOnsets ?? []).includes(offset) && input.barIndex * 4 + offset < input.harmonyEndBeat &&
		(!input.acceptsOnset || input.acceptsOnset(input.barIndex * 4 + offset, { drum: 'crossstick', beatOffset: offset, velocity: 0.28, role: 'commentary' }))) : undefined;
	let commentary: DrumHitSpec[] = !canComment ? [] : answerOffset !== undefined
		? [{ drum: 'crossstick', beatOffset: answerOffset, velocity: 0.28, role: 'commentary' }]
		: raw.filter((hit) => ['snare', 'crossstick'].includes(hit.drum) &&
			(hit.beatOffset !== 3.5 || ensemble.drums.allowFill) && !(input.compOnsets ?? []).includes(hit.beatOffset))
			.slice(0, ensemble.drums.maxCommentaryHits).map((hit) => ({ ...hit, role: 'commentary' }));
	// Form arrivals use the existing soft kick, never introduce a swing crash into bossa/ballad.
	if (ensemble.coordinatedAccent) {
		const kick = time.find((hit) => hit.drum === 'kick' && hit.beatOffset === 0);
		if (kick) { kick.role = 'accent'; kick.velocity = Math.min(isBossa ? 0.4 : 0.22, kick.velocity + 0.04); }
		else time.push({ drum: 'kick', beatOffset: 0, velocity: 0.18, role: 'accent' });
	}
	// Shared phrase energy shapes the groove without changing clave or timekeeping density.
	for (const hit of time) if (hit.role === 'timekeeping') hit.velocity *= 0.9 + 0.2 * ensemble.energy;
	const accepted = (hit: DrumHitSpec) => input.barIndex * 4 + hit.beatOffset < input.harmonyEndBeat &&
		(!input.acceptsOnset || input.acceptsOnset(input.barIndex * 4 + hit.beatOffset, hit));
	commentary = commentary.filter(accepted);
	const hits = [...time.filter(accepted), ...commentary];
	const bar: DrumPhraseDecision = { version: 1, style: input.style, barIndex: input.barIndex,
		phraseStartBar: input.phraseStartBar, phraseLength: input.phraseEndBarExclusive - input.phraseStartBar,
		ride: { mode: isBossa ? 'none' : 'quarters-only', phase: 'single', skipOffsets: [], velocityScale: 0.9 + 0.2 * ensemble.energy,
			onsets: hits.filter((hit) => hit.drum === 'ride').map((hit) => hit.beatOffset) },
		commentary: { motifId: null, source: commentary.length ? answerOffset !== undefined ? 'piano' : 'vocabulary' : 'none',
			sourceId: commentary.length ? answerOffset !== undefined ? 'previous-piano' : 'ballad-color' : null,
			sourceBar: commentary.length && answerOffset !== undefined ? input.barIndex - 1 : null,
			sourceOffsets: commentary.length && answerOffset !== undefined ? [answerOffset] : [],
			transform: commentary.length ? answerOffset !== undefined ? 'answer' : 'fallback' : 'space', displacementBeats: 0, hits: commentary,
			...(!commentary.length ? { reason: isBossa ? 'native_groove' as const : ensemble.coordinatedAccent ? 'arrival_reserved' as const
				: ensemble.responseOwner !== 'nobody' && ensemble.responseOwner !== 'drums' ? 'response_reserved' as const
				: !canComment ? 'ensemble_silence' as const : 'not_selected' as const } : {}) }, hits };
	freezeDrumPhraseTrace([bar]);
	return Object.freeze({ bar, memory: freezeDrumPhraseMemory({ version: 1, style: input.style, phraseId: input.phraseId,
		tempo: input.tempo, harmonyEndBeat: input.harmonyEndBeat, nextBar: input.barIndex + 1,
		sectionIndex: input.info.sectionIndex ?? null, chorusIndex: input.info.chorusIndex ?? null,
		ensemblePhraseStartBar: ensemble.phraseStartBar,
		phrase: { start: input.phraseStartBar, end: input.phraseEndBarExclusive, mode: 'quarters-only', skips: [], variedSkips: [], commentarySelected: false },
		previousCompOnsets: [...input.compOnsets ?? []] }) });
}
