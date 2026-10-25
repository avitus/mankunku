/** Stateful one-bar piano realization. Multi-bar source cells are proposals, not future budgets. */
import type { RollingBackingDefinition } from './backing-rolling';
import { clavePhaseFor, type BarInfo, type CompEvent, type CoordinatedPianoVoicing } from './backing-generation';
import type { CompHitSpec } from './backing-styles';
import type { EnsembleTiming } from './ensemble-timing';
import { COMP_FIGURES, type CompFigure, type CompFigureHit, type CompMotifDecision } from './backing-comp-figures';
import { BACKING_STYLES } from './backing-styles';
import { createRng, seedFrom } from './generation-rng';
import { fractionToFloat } from '$lib/music/intervals';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { rootlessVoicingA, rootlessVoicingB, shellVoicing, drop2Voicing, quartalVoicing, guideToneVoicing, voiceLead, type VoicingFn } from './voicings';
import { resolveCoordinatedVoicing, coordinatedVoicingFamily, type CoordinatedVoicingMemory } from './coordinated-voicing';

export interface RollingPianoMemory {
	readonly recentFigures: readonly string[];
	readonly motif: { readonly startBar: number; readonly sourceId: string | null; readonly shift: number; readonly repeat: boolean } | null;
	readonly segmentIndex: number | null;
	readonly segmentVoicing: readonly number[];
	readonly lastVoicing: readonly number[];
	/** Last emitted harmony and pitches, including guide-tone overrides. */
	readonly voicing?: CoordinatedVoicingMemory;
}

const emptyMemory = (): RollingPianoMemory => ({ recentFigures: [], motif: null, segmentIndex: null, segmentVoicing: [], lastVoicing: [] });
const figureById = (id: string) => COMP_FIGURES.find((figure) => figure.id === id)!;
const shiftsFor = (figure: CompFigure) => [-1, -0.5, 0.5, 1].filter((shift) => figure.hits[0].every((hit) => hit.b + shift >= 0 && hit.b + shift < 3.5));

export function realizeRollingPiano(score: RollingBackingDefinition, bar: number, info: BarInfo,
	timing: EnsembleTiming, previous?: RollingPianoMemory): { events: CompEvent[]; memory: RollingPianoMemory; trace: CompMotifDecision; voicingTrace?: readonly CoordinatedPianoVoicing[] } {
	const memory = previous ?? emptyMemory();
	const style = BACKING_STYLES[score.style ?? 'swing'];
	const ensemble = info.ensemble!;
	const coordinatedVoicing = !!ensemble.performanceEnergy;
	let voicingMemory = memory.voicing;
	const voicingTrace: CoordinatedPianoVoicing[] = [];
	const form = score.bars[bar];
	const phraseStart = ensemble.phraseStartBar;
	const budget = ensemble.piano.maxAttacks;
	const cellFits = (hits: readonly CompFigureHit[]) => hits.every((hit) => hit.b >= 0 && hit.b < 4 &&
		timing.place(bar * 4 + hit.b, 'comp') < (bar + 1) * 4 * score.ppq);
	const fits = (figure: CompFigure) => figure.bars === 1 && figure.hits[0].length <= budget &&
		cellFits(figure.hits[0]) &&
		(bar !== 0 || budget === 0 || figure.tags.includes('early')) &&
		(!info.isFinalBar || figure.hits[0].every((hit) => hit.b < 3.5));
	let motif = memory.motif;
	let figure: CompFigure = figureById('rest');
	let hits: CompFigureHit[] = [];
	let transform: CompMotifDecision['transform'] = 'fallback';
	let shift = 0;
	let reason: CompMotifDecision['reason'];
	let guideTones = false;
	let realized: CompHitSpec[];
	if (style.compPlanning) {
		if (!motif || motif.startBar !== phraseStart) {
			const rng = createRng(seedFrom(score.phraseId, score.tempo, 'comp-motif', phraseStart));
			const candidates = COMP_FIGURES.filter((figure) => fits(figure) && figure.hits[0].length > 0 && !figure.tags.includes('pad') && shiftsFor(figure).length > 0);
			const selected = form.phrase4?.lengthBars === 4 && budget > 0 && ensemble.responseOwner === 'nobody' && !ensemble.coordinatedAccent && rng.chance(0.55) && candidates.length > 0;
			const source = selected ? rng.weighted(candidates.map((figure) => ({ value: figure, weight: figure.weight }))) : undefined;
			motif = { startBar: phraseStart, sourceId: source?.id ?? null, shift: source ? rng.pick(shiftsFor(source)) : 0,
				repeat: createRng(seedFrom(score.phraseId, score.tempo, 'comp-motif-development', phraseStart)).chance(0.35) };
		}
		const rng = createRng(seedFrom(score.phraseId, score.tempo, 'comp-figure', bar));

		if (motif.sourceId) {
			figure = figureById(motif.sourceId);
			const position = bar - motif.startBar;
			transform = position === 0 ? 'statement' : position === 1 ? motif.repeat ? 'repeat' : 'space' : position === 2 ? 'displace' : 'shorten';
			shift = position >= 2 ? motif.shift : 0;
			hits = transform === 'space' ? [] : figure.hits[0].map((hit) => ({ b: hit.b + shift, d: hit.d }));
			if (transform === 'shorten') hits = [{ b: hits[0].b, d: Math.min(hits[0].d, 0.45) }];
			if (transform === 'space') reason = 'motif_gap';
			const withheld = budget === 0 || ensemble.coordinatedAccent ? 'ensemble_silence'
				: ensemble.responseOwner !== 'nobody' ? 'response_reserved'
					: hits.length > budget || !cellFits(hits) ? 'gesture_does_not_fit' : undefined;
			if (withheld) { hits = []; transform = 'space'; shift = 0; reason = withheld; }
		} else {
			const options = COMP_FIGURES.filter(fits).map((candidate) => {
				const key = candidate.repeatKey ?? candidate.id;
				let weight = candidate.weight * (style.compFigureBias?.[candidate.id] ?? 1) * (candidate.busy > 0 ? ensemble.piano.densityScale : 1);
				if (memory.recentFigures.at(-1) === key && memory.recentFigures.at(-2) === key) weight = 0;
				else if (memory.recentFigures.at(-1) === key) weight *= 0.25;
				if (info.isSectionFinalBar && !info.isFinalBar) weight *= candidate.tags.includes('push') ? 5 : 0.5;
				return { value: candidate, weight };
			}).filter((entry) => entry.weight > 0);
			figure = options.length ? rng.weighted(options) : figureById('rest');
			hits = figure.hits[0].map((hit) => ({ ...hit }));
			if (budget === 0 || ensemble.coordinatedAccent || (ensemble.responseOwner !== 'nobody' && ensemble.responseOwner !== 'piano')) {
				hits = []; transform = 'space'; reason = budget === 0 ? 'ensemble_silence' : 'response_reserved';
			} else reason = form.phrase4?.lengthBars === 4 ? 'not_selected' : 'short_phrase';
		}
		const tags = [...figure.tags.filter((tag) => tag === 'pad'), ...(hits.some((hit) => hit.b === 3.5) ? ['push'] : []), ...(hits.some((hit) => hit.b === 0) ? ['early'] : [])];
		guideTones = hits.length > 0 && rng.chance(0.06);
		realized = style.compPattern({ ...info, barIndex: bar, beatsPerBar: 4, swing: score.swing,
			rng: createRng(seedFrom(score.phraseId, score.tempo, 'comp', bar)), plannedComp: { hits, tags, guideTones } });
	} else {
		motif = { startBar: phraseStart, sourceId: null, shift: 0, repeat: false };
		realized = style.compPattern({ ...info, barIndex: bar, beatsPerBar: 4, swing: score.swing,
			rng: createRng(seedFrom(score.phraseId, score.tempo, 'comp', bar)), clavePhase: clavePhaseFor(score.phraseId, score.tempo) });
		hits = realized.map((hit) => ({ b: hit.beatOffset, d: hit.durationBeats }));
		if (budget === 0) { transform = 'space'; reason = 'ensemble_silence'; }
		else reason = 'native_pattern';
	}
	const events: CompEvent[] = [];
	let segmentIndex = memory.segmentIndex;
	let segmentVoicing = [...memory.segmentVoicing];
	let lastVoicing = [...memory.lastVoicing];
	const barEnd = (bar + 1) * 4 * score.ppq;
	const selectFamily = (index: number): VoicingFn => {
		const chord = score.harmony[index].chord;
		const voicingRng = createRng(seedFrom(score.phraseId, score.tempo, 'voicing', index));
		const seventh = CHORD_DEFINITIONS[chord.quality]?.intervals.some((interval) => interval >= 9 && interval <= 11);
		const bias = style.voicingBias ?? {};
		const options: Array<{ value: VoicingFn; weight: number }> = seventh
			? [{ value: rootlessVoicingA, weight: 4 * (bias.rootlessA ?? 1) }, { value: rootlessVoicingB, weight: 3 * (bias.rootlessB ?? 1) }, { value: shellVoicing, weight: 2 * (bias.shell ?? 1) }, { value: drop2Voicing, weight: (bias.drop2 ?? 1) }]
			: [{ value: shellVoicing, weight: 2 * (bias.shell ?? 1) }, { value: drop2Voicing, weight: (bias.drop2 ?? 1) }];
		if (seventh && quartalVoicing(chord.root, chord.quality).length) options.push({ value: quartalVoicing, weight: (bias.quartal ?? 1) });
		return voicingRng.weighted(options);
	};
	for (const hit of realized) {
		const absBeat = bar * 4 + hit.beatOffset;
		const lookup = Math.min(score.totalBars * 4 - 0.001, absBeat + (hit.beatOffset % 1 ? 0.5 : 0));
		const index = score.harmony.findIndex((segment) => lookup >= fractionToFloat(segment.startOffset) * 4 && lookup < fractionToFloat(segment.startOffset) * 4 + fractionToFloat(segment.duration) * 4);
		if (index < 0) continue;
		const chord = score.harmony[index].chord;
		if (coordinatedVoicing) {
			const tick = Math.max(bar * 4 * score.ppq, timing.place(absBeat, 'comp'));
			const duration = Math.min(hit.durationBeats * 60 / score.tempo, (barEnd - tick) * 60 / score.tempo / score.ppq);
			if (!Number.isFinite(tick) || tick >= barEnd || !Number.isFinite(duration) || duration <= 0 || absBeat >= score.totalBars * 4) continue;
			const selected = resolveCoordinatedVoicing({ chord, family: guideTones ? 'guide' : coordinatedVoicingFamily(selectFamily(index)),
				registerMidi: guideTones ? 62 : Math.round(58 + 8 * info.intensity), previous: voicingMemory });
			if (!selected.notes.length) continue;
			const notes = [...selected.notes];
			const time = `${tick}i`;
			events.push({ absBeat, time, notes, duration, velocity: hit.velocity });
			voicingTrace.push(Object.freeze({ absBeat, time, notes: selected.notes, decision: selected.decision }));
			voicingMemory = selected.memory;
			segmentIndex = index; segmentVoicing = notes; lastVoicing = notes;
			continue;
		}
		if (segmentIndex !== index) {
			const fn = selectFamily(index);
			const register = Math.round(58 + 8 * info.intensity);
			segmentVoicing = lastVoicing.length ? voiceLead([chord, chord], [() => lastVoicing, fn], register)[1] : fn(chord.root, chord.quality, register);
			segmentIndex = index;
		}
		const notes = guideTones ? guideToneVoicing(chord.root, chord.quality, 62) : [...segmentVoicing];
		if (!notes.length) continue;
		const tick = Math.max(bar * 4 * score.ppq, timing.place(absBeat, 'comp'));
		if (tick >= barEnd) continue;
		const duration = Math.min(hit.durationBeats * 60 / score.tempo, (barEnd - tick) * 60 / score.tempo / score.ppq);
		events.push({ absBeat, time: `${tick}i`, notes, duration, velocity: hit.velocity });
		lastVoicing = notes;
	}
	return { events, ...(coordinatedVoicing ? { voicingTrace: Object.freeze(voicingTrace) } : {}),
		memory: { recentFigures: [...memory.recentFigures, style.compPlanning ? figure.repeatKey ?? figure.id : `${score.style}:${hits.map((hit) => hit.b).join(',')}`].slice(-3), motif, segmentIndex, segmentVoicing, lastVoicing,
			...(coordinatedVoicing && voicingMemory ? { voicing: voicingMemory } : {}) },
		trace: { version: 1, barIndex: bar, phraseStartBar: phraseStart, motifId: motif.sourceId ? `motif:${phraseStart}:${motif.sourceId}` : null,
			sourceFigureId: motif.sourceId, transform, displacementBeats: shift, hits: hits.filter((hit) => events.some((event) => event.absBeat === bar * 4 + hit.b)), ...(reason ? { reason } : {}) } };
}
