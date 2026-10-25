import { assessTerminalArrangement, realizeTerminalArrangement, terminalBarPlan, terminalPianoTrace, terminalDrumTrace, freezeTerminalDecisions, type TerminalArrangementInput, type TerminalReservation, type TerminalArrangementDecision } from './backing-terminal';
import type { BassScalarContinuation } from './backing-bass-continuation';
import { sharedArrivalTick } from './backing-arrival';
/**
 * Pure backing-track event generation: walking bass, comping, and drums.
 *
 * Everything here is deterministic and Node-testable — no Tone.js, no
 * Web Audio. `backing-track.ts` turns these events into scheduled parts.
 * All randomness flows through seeded streams derived from the phrase id,
 * tempo and bar position, so the same phrase at the same tempo always
 * generates the same backing while different bars (and different passes
 * through a tune's form) vary.
 *
 * Seed-stream registry (role key x index -> consumer). Streams are
 * isolated: a draw added to one can never reshuffle another. Intensity
 * (backing-intensity.ts) is RNG-free and only reshapes weights at these
 * sites, so it is invisible to the registry.
 *
 *   bass-arc     | 4-bar group | register contour
 *   bass-feel    | chorusIndex | two/four feel
 *   bass-feel-escape | barIndex | walk-escape from a two-feel bar
 *   bass-target  | segment     | downbeat note choice
 *   bass-appr    | segment     | approach device
 *   bass         | segment     | interior fill, spice, velocity
 *                | barIndex    | (bossa pattern engine: pickups, drops, approach)
 *   bass-ornament| kind + beat | coordinated ornament admission
 *   bass-turnaround | arrival bar | two-bar launch admission
 *   clave        | 0           | bossa clave phase (one draw per phrase)
 *   voicing      | chord index | comp voicing choice
 *   comp-figure  | barIndex    | figure planning (weights only)
 *   comp-motif / comp-motif-development | phrase start | source and transforms
 *   comp         | barIndex    | comp realization
 *   drums        | barIndex    | ride mode, feather, snare, coupling
 *   drum-fill    | barIndex    | fills, setups, crash
 *   ensemble-*  | phrase/bar  | intention, lead, response and fill reservation
 *   <role>-time  | barIndex    | timing jitter (backing-timing.ts)
 *
 * Timing: beat offsets are laid out on a straight grid, then swung at the
 * beat→tick conversion. Original mode uses backing-timing.ts role offsets
 * and dedicated jitter streams. Coordinated mode uses ensemble-timing.ts
 * shared phrase motion, player placement and event-keyed residuals.
 * Musical choices and timing never share a random stream.
 */

import type { HarmonicSegment, ChordQuality } from '$lib/types/music';
import type { PerformanceForm } from '$lib/types/performance-form';
import { performanceBarContext } from './performance-form';
import { planPerformanceEnergy } from './performance-energy';
import { freezeEnsemblePlan, freezeEnsembleMemory, planEnsembleWindow, type EnsembleMemory, type EnsemblePlan, type EnsembleBarPlan, type SoloFeature } from './ensemble-plan';
import { createEnsembleTiming, freezeEnsembleTimingTrace, type EnsemblePhraseTimingTrace } from './ensemble-timing';
import { fractionToFloat } from '$lib/music/intervals';
import { swingForTempo, STRAIGHT_SWING } from '$lib/music/swing';
import {
	SWING_TIMING,
	createTimingStreams,
	placeEventTicks,
	type TimingProfile,
	type TimingRole,
	type TimingStreams
} from './backing-timing';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { createRng, seedFrom, type SeededRng } from './generation-rng';
import { barIntensity, lerp } from './backing-intensity';
import {
	pitchClassToNumber,
	shellVoicing,
	drop2Voicing,
	rootlessVoicingA,
	rootlessVoicingB,
	quartalVoicing,
	guideToneVoicing,
	voiceLead,
	type VoicingFn
} from './voicings';
import { planCompFigures, hitsForPlannedBar, headFigureFor, compMotifTrace, freezeCompMotifTrace, type CompMotifDecision } from './backing-comp-figures';
import { freezeBassTurnaroundTrace, type BassTurnaroundTrace } from './backing-bass-turnaround';
import { planDrumPhrases, freezeDrumPhraseTrace, type DrumPhraseBarPlan, type DrumPhraseDecision } from './backing-drum-phrases';
import type { StyleDefinition, GenerationContext, DrumVoice } from './backing-styles';
import { generateBassLine as generateBassLine2, generateBossaBass } from './backing-bass';
import type { StructuralBassFeel } from './backing-bass-feel';
import { selectCoordinatedVoicingFamily } from './coordinated-voicing-family';
import { preparePianoContour, commitPianoContour, type PianoContourMemory } from './backing-piano-contour';
import { resolveCoordinatedVoicing, type CoordinatedVoicingMemory, type CoordinatedVoicingDecision } from './coordinated-voicing';

// ── Event shapes ─────────────────────────────────────────────

export interface BassEvent {
	/** Tick-based Transport time, e.g. "480i" (swing + jitter applied). */
	time: string;
	midi: number;
	/** Duration in seconds. */
	duration: number;
	/** MIDI velocity 0–127. */
	velocity: number;
	/** Pre-swing beat position on the phrase timeline (diagnostics/tests). */
	absBeat: number;
}

export interface CompEvent {
	time: string;
	notes: number[];
	duration: number;
	velocity: number;
	absBeat: number;
}

export interface DrumEvent {
	time: string;
	drum: DrumVoice;
	/** Normalized velocity 0–1 (converted to MIDI at trigger time). */
	velocity: number;
	absBeat: number;
	/** Musical function, retained for coordinated-generation diagnostics. */
	role?: 'timekeeping' | 'commentary' | 'accent';
}

export interface GeneratedBacking {
	bassEvents: BassEvent[];
	compEvents: CompEvent[];
	drumEvents: DrumEvent[];
	/** Decisions behind this performance; absent for the original generator. */
	ensemblePlan?: EnsemblePlan;
	/** Final planning checkpoint, ready for a future rolling scheduler. */
	ensembleMemory?: EnsembleMemory;
	/** Serializable phrase timing decisions for listening/replay diagnostics. */
	ensembleTiming?: readonly EnsemblePhraseTimingTrace[];
	/** Instrument decisions within this generated performance, not a rolling checkpoint. */
	ensembleDevelopment?: EnsembleDevelopment;
}

export interface EnsembleDevelopment {
	readonly version: 1;
	readonly terminalArrangements?: readonly TerminalArrangementDecision[];
	readonly pianoMotifs: readonly CompMotifDecision[];
	readonly bassTurnarounds: readonly BassTurnaroundTrace[];
	readonly bassFeel?: readonly StructuralBassFeel[];
	readonly bassContinuations?: readonly BassScalarContinuation[];
	readonly pianoVoicings?: readonly CoordinatedPianoVoicing[];
	/** Causal, committed rolling-bar decisions; absent from fixed generation. */
	readonly pianoFeedback?: readonly PianoFeedbackDecision[];
	readonly pianoAnswers?: readonly PianoAnswerDecision[];
	readonly pianoRecoveries?: readonly PianoRecoveryDecision[];
	readonly drumPhrases: readonly DrumPhraseDecision[];
}

/** An accepted one-chord response; no counterfactual removal claim. */
export interface PianoAnswerDecision {
	readonly version: 1;
	readonly barIndex: number;
	readonly source: DrumStatementSource;
	readonly attack: Readonly<CompEvent>;
	readonly replyOffset: number;
	readonly drumCommentary: 'space';
}

/** A local breathing bar after a real answer; no counterfactual removal claim. */
export interface PianoRecoveryDecision {
	readonly version: 1;
	readonly barIndex: number;
	readonly source: { readonly barIndex: number; readonly attack: Readonly<CompEvent> };
	readonly returningDrums: { readonly motifId: string; readonly sourceBar: number; readonly hits: readonly Readonly<DrumEvent>[] } | null;
	readonly action: 'space' | 'none';
	readonly reason: 'after_drum_reply' | 'already_silent' | 'reserved_transition' | 'response_reserved' | 'outside_build' | 'higher_priority_space' | 'no_ordinary_attack' | 'no_drum_return';
	readonly originalMaxAttacks: 0 | 1 | 2;
	readonly effectiveMaxAttacks: 0 | 1 | 2;
	readonly acceptedAttacks: readonly Readonly<CompEvent>[];
}

export interface DrumStatementSource {
	readonly barIndex: number;
	readonly transform: 'statement' | 'repeat' | 'displace' | 'orchestrate' | 'fallback';
	readonly hits: readonly Readonly<DrumEvent>[];
}

export interface PianoFeedbackDecision {
	readonly version: 1;
	readonly barIndex: number;
	readonly source: DrumStatementSource | null;
	readonly action: 'yield' | 'none';
	readonly reason: 'drum_statement' | 'no_statement' | 'already_silent' | 'reserved_transition' | 'response_reserved' | 'cooldown' | 'not_selected';
	readonly originalMaxAttacks: 0 | 1 | 2;
	readonly effectiveMaxAttacks: 0 | 1 | 2;
	readonly acceptedAttacks: readonly { readonly time: string; readonly absBeat: number; readonly notes: readonly number[] }[];
}

/** Objective evidence for one actual accepted piano attack. */
export interface CoordinatedPianoVoicing {
	/** Actual accepted catch, linked to the unchanged shared reservation. */
	readonly arrivalId?: string;
	readonly absBeat: number;
	readonly time: string;
	readonly notes: readonly number[];
	readonly decision: CoordinatedVoicingDecision;
}

function freezeEnsembleDevelopment(trace: EnsembleDevelopment): EnsembleDevelopment {
	if (trace.terminalArrangements) freezeTerminalDecisions(trace.terminalArrangements);
	freezeCompMotifTrace(trace.pianoMotifs);
	freezeBassTurnaroundTrace(trace.bassTurnarounds);
	if (trace.bassFeel) {
		for (const bar of trace.bassFeel) Object.freeze(bar);
		Object.freeze(trace.bassFeel);
	}
	if (trace.pianoVoicings) {
		for (const attack of trace.pianoVoicings) {
			Object.freeze(attack.notes);
			Object.freeze(attack.decision.commonTones);
			if (attack.decision.rootlessTexture) Object.freeze(attack.decision.rootlessTexture);
			if (attack.decision.topLine) Object.freeze(attack.decision.topLine);
			Object.freeze(attack.decision);
			Object.freeze(attack);
		}
		Object.freeze(trace.pianoVoicings);
	}
	if (trace.pianoFeedback) {
		for (const feedback of trace.pianoFeedback) {
			if (feedback.source) {
				for (const hit of feedback.source.hits) Object.freeze(hit);
				Object.freeze(feedback.source.hits);
				Object.freeze(feedback.source);
			}
			for (const attack of feedback.acceptedAttacks) {
				Object.freeze(attack.notes);
				Object.freeze(attack);
			}
			Object.freeze(feedback.acceptedAttacks);
			Object.freeze(feedback);
		}
		Object.freeze(trace.pianoFeedback);
	}
	if (trace.pianoAnswers) {
		for (const answer of trace.pianoAnswers) {
			for (const hit of answer.source.hits) Object.freeze(hit);
			Object.freeze(answer.source.hits); Object.freeze(answer.source);
			Object.freeze(answer.attack.notes); Object.freeze(answer.attack);
			Object.freeze(answer);
		}
		Object.freeze(trace.pianoAnswers);
	}
	if (trace.pianoRecoveries) {
		for (const recovery of trace.pianoRecoveries) {
			Object.freeze(recovery.source.attack.notes); Object.freeze(recovery.source.attack); Object.freeze(recovery.source);
			if (recovery.returningDrums) {
				for (const hit of recovery.returningDrums.hits) Object.freeze(hit);
				Object.freeze(recovery.returningDrums.hits); Object.freeze(recovery.returningDrums);
			}
			for (const attack of recovery.acceptedAttacks) { Object.freeze(attack.notes); Object.freeze(attack); }
			Object.freeze(recovery.acceptedAttacks); Object.freeze(recovery);
		}
		Object.freeze(trace.pianoRecoveries);
	}
	if (trace.bassContinuations) {
		for (const continuation of trace.bassContinuations) {
			for (const note of continuation.notes) Object.freeze(note);
			Object.freeze(continuation.notes); Object.freeze(continuation);
		}
		Object.freeze(trace.bassContinuations);
	}
	freezeDrumPhraseTrace(trace.drumPhrases);
	return Object.freeze(trace);
}

export type SectionMapEntry = { sourceSection: number; barOffset: number };

export interface BackingGenerationParams {
	readonly terminalArrangement?: TerminalArrangementInput;
	phraseId: string;
	tempo: number;
	ppq: number;
	beatsPerBar: number;
	/** Effective swing ratio (see `resolveBackingSwing`). */
	swing: number;
	sectionMap?: SectionMapEntry[];
	/** Authoritative performed form; repeats alone do not imply new choruses. */
	performanceForm?: PerformanceForm;
	/** Opt into phrase-level coordination. Missing preserves original reference outputs. */
	ensemble?: { soloFeatures?: readonly SoloFeature[] };
	/** Per-role microtiming profiles (style.timing); SWING_TIMING when absent. */
	timing?: Record<TimingRole, TimingProfile>;
}

/** Runtime-only placement, created after the public generation cache key. */
export interface InstrumentGenerationParams extends BackingGenerationParams {
	readonly terminalReservation?: TerminalReservation;
	readonly ensembleTiming?: ReturnType<typeof createEnsembleTiming>;
	readonly bassScalarContinuation?: true;
}

/**
 * Effective swing for the backing.
 *
 * The style owns the grid. A 'fixed' style (straight, bossa nova, ballad)
 * declares a genre whose eighth-note placement is not a matter of taste —
 * a bossa is straight — so its `defaultSwing` wins outright. Only the
 * 'tempo' style (swing) defers to the user's knob, falling back to the
 * Friberg–Sundström curve (`swingForTempo`) when that knob sits straight.
 *
 * This used to be inverted: any `userSwing > STRAIGHT_SWING` overrode the
 * style, and because the knob's first step off its 0.5 minimum is 0.55,
 * every non-default knob position silently swung Straight and Bossa Nova.
 * The old rule existed to keep the band on the soloist's grid; that
 * invariant is preserved by `resolveMelodySwing`, which moves the melody
 * onto the style's grid instead of dragging the band onto the melody's.
 *
 * `swingForTempo` stays banned from playback, scoring, and tricks modules
 * by a unit test — hence the melody-side resolver lives in backing-styles.ts
 * and never references it.
 */
export function resolveBackingSwing(
	userSwing: number,
	style: StyleDefinition,
	tempo: number
): number {
	if (style.swingModel === 'fixed') return style.defaultSwing;
	return userSwing > STRAIGHT_SWING ? userSwing : swingForTempo(tempo);
}

// ── Bar contexts ─────────────────────────────────────────────

export interface BarInfo {
	sectionIndex?: number;
	chorusIndex?: number;
	/** True on the first bar of a section (always true on bar 0 of a mapped phrase). */
	isSectionFirstBar: boolean;
	isSectionFinalBar: boolean;
	/** True on the first bar of a chorus pass (bar 0 of a mapped phrase included). */
	isChorusFirstBar?: boolean;
	/** True on the last bar of a chorus when another chorus follows (never the phrase's final bar). */
	isChorusFinalBar?: boolean;
	isFinalBar: boolean;
	/** Ensemble intensity for this bar (backing-intensity.ts), in [0.2, 0.9]. */
	intensity: number;
	/** Optional shared role assignment; consumed before instrument realization. */
	ensemble?: EnsembleBarPlan;
}

/** Fit only the final span to emitted harmony, retaining explicit pass identity. */
function formForHarmony(form: PerformanceForm | undefined, totalBars: number): PerformanceForm | undefined {
	if (!form || form.totalBars === 0) return undefined;
	if (form.totalBars === totalBars) return form;
	const choruses = form.choruses.filter((span) => span.startBar < totalBars)
		.map((span) => ({ ...span, endBarExclusive: Math.min(span.endBarExclusive, totalBars) }));
	const sections = form.sections.filter((span) => span.startBar < totalBars)
		.map((span) => ({ ...span, endBarExclusive: Math.min(span.endBarExclusive, totalBars) }));
	if (!choruses.length || !sections.length) throw new Error('Performance form has no covered bars');
	choruses[choruses.length - 1].endBarExclusive = totalBars;
	sections[sections.length - 1].endBarExclusive = totalBars;
	return { ...form, totalBars, choruses, sections };
}

/**
 * Explicit performed form takes precedence. Legacy sectionMap callers infer
 * per-bar section/chorus positions as before: a new chorus
 * starts wherever the emitted sourceSection sequence restarts (does not
 * increase) — e.g. body, ending 1, body, ending 2. Bars past the last
 * entry (harmony tail extension) belong to the last section. Without a
 * sectionMap, bars are position-free: only the final bar is flagged.
 */
export function buildBarInfos(totalBars: number, sectionMap?: SectionMapEntry[], performanceForm?: PerformanceForm): BarInfo[] {
	const infos: BarInfo[] = [];
	const form = formForHarmony(performanceForm, totalBars);
	if (form) {
		return Array.from({ length: totalBars }, (_, barIndex) => {
			const context = performanceBarContext(form, barIndex);
			if (!context) throw new Error(`Performance form has no context for bar ${barIndex}`);
			return {
				sectionIndex: context.sectionIndex,
				chorusIndex: context.chorusIndex,
				isSectionFirstBar: context.isSectionFirstBar,
				isSectionFinalBar: context.isSectionFinalBar,
				isChorusFirstBar: context.isChorusFirstBar,
				isChorusFinalBar: context.isChorusFinalBar && barIndex < totalBars - 1,
				isFinalBar: barIndex === totalBars - 1,
				intensity: barIntensity({ chorusIndex: context.chorusIndex, isSectionFinalBar: context.isSectionFinalBar, barIndex, totalBars })
			};
		});
	}
	if (!sectionMap || sectionMap.length === 0) {
		for (let b = 0; b < totalBars; b++) {
			infos.push({
				isSectionFirstBar: false,
				isSectionFinalBar: false,
				isFinalBar: b === totalBars - 1,
				intensity: barIntensity({ isSectionFinalBar: false, barIndex: b, totalBars })
			});
		}
		return infos;
	}

	const chorusOf: number[] = [];
	let chorus = 0;
	for (let k = 0; k < sectionMap.length; k++) {
		if (k > 0 && sectionMap[k].sourceSection <= sectionMap[k - 1].sourceSection) chorus++;
		chorusOf.push(chorus);
	}

	for (let b = 0; b < totalBars; b++) {
		let k = 0;
		for (let i = 0; i < sectionMap.length; i++) {
			if (sectionMap[i].barOffset <= b) k = i;
		}
		const nextOffset = k + 1 < sectionMap.length ? sectionMap[k + 1].barOffset : totalBars;
		const isSectionFinalBar = b === nextOffset - 1;
		infos.push({
			sectionIndex: k,
			chorusIndex: chorusOf[k],
			isSectionFirstBar: b === sectionMap[k].barOffset,
			isSectionFinalBar,
			isChorusFirstBar:
				b === sectionMap[k].barOffset && (k === 0 || chorusOf[k] > chorusOf[k - 1]),
			isChorusFinalBar:
				isSectionFinalBar && k + 1 < sectionMap.length && chorusOf[k + 1] > chorusOf[k],
			isFinalBar: b === totalBars - 1,
			intensity: barIntensity({
				chorusIndex: chorusOf[k],
				isSectionFinalBar,
				barIndex: b,
				totalBars
			})
		});
	}
	return infos;
}

// ── Timing ───────────────────────────────────────────────────
// The coordinated placer is runtime-only. Its absence retains the original
// swung grid + role offset + dedicated timing-stream jitter byte for byte.

function timingTableOf(params: BackingGenerationParams): Record<TimingRole, TimingProfile> {
	return params.timing ?? SWING_TIMING;
}

function place(
	absBeat: number,
	role: TimingRole,
	params: InstrumentGenerationParams,
	streams: TimingStreams,
	beatsPerBar: number
): string {
	const ticks = params.ensembleTiming?.place(absBeat, role) ?? placeEventTicks(
		absBeat,
		params.swing,
		params.ppq,
		params.tempo,
		timingTableOf(params)[role],
		streams.for(role, Math.floor(absBeat / beatsPerBar))
	);
	return `${ticks}i`;
}

// ── Harmony helpers ──────────────────────────────────────────

interface SegmentInfo {
	startBeats: number;
	totalBeats: number;
	rootPc: number;
	quality: ChordQuality;
}

function toSegmentInfos(harmony: HarmonicSegment[]): SegmentInfo[] {
	return harmony.map((seg) => ({
		startBeats: fractionToFloat(seg.startOffset) * 4,
		totalBeats: Math.round(fractionToFloat(seg.duration) * 4),
		rootPc: pitchClassToNumber(seg.chord.root),
		quality: seg.chord.quality
	}));
}

/** Index of the segment sounding at the given beat, or -1. */
function segmentIndexAt(segments: SegmentInfo[], beat: number): number {
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		if (beat >= s.startBeats && beat < s.startBeats + s.totalBeats) return i;
	}
	return -1;
}

// ── Walking bass ─────────────────────────────────────────────
// Lives in backing-bass.ts (phrase-aware contour planner). Re-exported
// here so existing consumers/tests keep one import surface.
export { chordToneIntervalsForBass, generateBassLine } from './backing-bass';

// ── Comping ──────────────────────────────────────────────────

const COMP_REGISTER = 62;

function hasSeventhSlot(quality: ChordQuality): boolean {
	const def = CHORD_DEFINITIONS[quality];
	return def ? def.intervals.some((i) => i >= 9 && i <= 11) : false;
}

/**
 * Generate comp events: a voicing type per chord (rootless A/B, shell, or
 * drop-2 — seeded, quality-aware), voice-led across the sequence, placed by
 * the style's per-bar figures. Off-beat (eighth) hits voice the chord
 * sounding on the NEXT beat, so a push across a chord change anticipates
 * the coming harmony the way a comper actually plays it.
 */
export function generateComping(
	harmony: HarmonicSegment[],
	beatsPerBar: number,
	style: StyleDefinition,
	params: InstrumentGenerationParams,
	barInfos: BarInfo[]
): { events: CompEvent[]; onsetsByBar: Map<number, number[]>; motifTrace?: readonly CompMotifDecision[]; voicingTrace?: readonly CoordinatedPianoVoicing[]; terminalContext?: { voicing?: CoordinatedVoicingMemory; contour?: PianoContourMemory } } {
	const { phraseId, tempo, swing } = params;
	const segments = toSegmentInfos(harmony);
	const beatDuration = 60 / tempo;
	const events: CompEvent[] = [];
	const onsetsByBar = new Map<number, number[]>();
	const streams = createTimingStreams(phraseId, tempo);
	const coordinatedVoicing = !!params.ensemble && !!style.coordinatedStyle && beatsPerBar === 4 &&
		barInfos.length > 0 && barInfos.every((info) => info.ensemble?.performanceEnergy);
	let voicingMemory: CoordinatedVoicingMemory | undefined;
	const contourEnabled = coordinatedVoicing && ['swing', 'straight', 'bossa-nova'].includes(style.coordinatedStyle!);
	let contourMemory: PianoContourMemory | undefined;
	let terminalContext: { voicing?: CoordinatedVoicingMemory; contour?: PianoContourMemory } | undefined;
	const voicingTrace: CoordinatedPianoVoicing[] = [];

	// Voicing selection per chord, then voice-lead the whole sequence.
	// Quartal shapes join the rotation only for the qualities they suit
	// (they return [] for altered/diminished colors, which would silence
	// the hit rather than falling through).
	const chords = harmony.map((seg) => ({ root: seg.chord.root, quality: seg.chord.quality }));
	// Each chord reads the intensity of the bar it starts in: sparse shells
	// early, quartal color as the band digs in, and the register center
	// drifting up — voiceLead's closeness-to-previous keeps the drift smooth.
	const chordIntensity = segments.map(
		(seg) =>
			barInfos[Math.min(Math.floor(seg.startBeats / beatsPerBar), barInfos.length - 1)]
				?.intensity ?? 0.5
	);
	const bias = style.voicingBias ?? {};
	const selectVoicing = (c: typeof chords[number], i: number, intensity: number): VoicingFn => {
		const rng = createRng(seedFrom(phraseId, tempo, 'voicing', i));
		if (!hasSeventhSlot(c.quality)) {
			return rng.weighted<VoicingFn>([
				{ value: shellVoicing, weight: 2 * (bias.shell ?? 1) },
				{ value: drop2Voicing, weight: 1 * (bias.drop2 ?? 1) }
			]);
		}
		const options: Array<{ value: VoicingFn; weight: number }> = [
			{ value: rootlessVoicingA, weight: 4 * (bias.rootlessA ?? 1) },
			{ value: rootlessVoicingB, weight: 3 * (bias.rootlessB ?? 1) },
			{ value: shellVoicing, weight: 2 * lerp(1.5, 0.6, intensity) * (bias.shell ?? 1) },
			{ value: drop2Voicing, weight: 1 * (bias.drop2 ?? 1) }
		];
		if (quartalVoicing(c.root, c.quality).length > 0) {
			options.push({
				value: quartalVoicing,
				weight: lerp(0.5, 1.5, intensity) * (bias.quartal ?? 1)
			});
		}
		return rng.weighted<VoicingFn>(options);
	};
	const fns: VoicingFn[] = coordinatedVoicing ? [] : chords.map((chord, index) => selectVoicing(chord, index, chordIntensity[index]));
	const voicings = coordinatedVoicing ? [] : voiceLead(
		chords,
		fns,
		chordIntensity.map((n) => Math.round(lerp(58, 66, n)))
	);

	// Figure planning (compPlanning styles — swing and straight — 4/4 only:
	// the vocabulary is written for four beats; other meters use the
	// style's own fallback): one pass over the
	// phrase with anti-repetition memory; each bar's plan resolves to
	// concrete hits here so the style's pattern function only realizes
	// velocity/articulation.
	const harmonyEnd = segments.reduce((max, s) => Math.max(max, s.startBeats + s.totalBeats), 0);
	const motifMode = !!params.ensemble && !!style.compPlanning && !!style.coordinatedStyle && beatsPerBar === 4 &&
		barInfos.length > 0 && barInfos.every((info) => info.ensemble);
	const compPlan =
		style.compPlanning && beatsPerBar === 4
			? planCompFigures(barInfos, beatsPerBar, phraseId, tempo, style.compFigureBias,
				motifMode ? { motifs: true, harmonyEndBeat: harmonyEnd } : undefined)
			: null;

	const totalBars = barInfos.length;
	const pianoSilentAt = (bar: number) => barInfos[bar].ensemble?.piano.maxAttacks === 0 ||
		compPlan?.[bar].motif?.transform === 'space';
	// A rest reserves sounding space, including the tail of a preceding
	// anticipation. Store the next silent boundary on the transport grid;
	// duration clipping below uses the actual swung/microtimed attack.
	const nextSilenceTicks = new Array<number>(totalBars);
	let silenceTick = Infinity;
	for (let bar = totalBars - 1; bar >= 0; bar--) {
		nextSilenceTicks[bar] = silenceTick;
		if (barInfos[bar].ensemble?.piano.arrival || pianoSilentAt(bar)) silenceTick = bar * beatsPerBar * params.ppq;
	}

	const clavePhase = clavePhaseFor(phraseId, tempo);
	for (let bar = 0; bar < totalBars; bar++) {
		if (params.terminalReservation?.barIndex === bar) terminalContext = { voicing: voicingMemory, contour: contourMemory };
		const rng = createRng(seedFrom(phraseId, tempo, 'comp', bar));
		const planned = compPlan?.[bar];
		const headFigure = compPlan ? headFigureFor(compPlan, bar) : undefined;
		const ctx: GenerationContext = {
			barIndex: bar,
			beatsPerBar,
			swing,
			rng,
			clavePhase,
			...barInfos[bar],
			plannedComp:
				planned && compPlan
					? {
							hits: hitsForPlannedBar(planned, compPlan, bar, barInfos[bar], beatsPerBar),
							tags: headFigure?.tags ?? [],
							guideTones: planned.guideTones
						}
					: undefined
		};
		const hits = style.compPattern(ctx);
		// Coordinated drums hear emitted attacks, including partial-harmony
		// filtering, rather than reacting to notes that never sounded.
		onsetsByBar.set(bar, barInfos[bar].ensemble ? [] : hits.map((h) => h.beatOffset));

		for (const hit of hits) {
			const absBeat = bar * beatsPerBar + hit.beatOffset;
			if (absBeat >= harmonyEnd) continue;
			// Eighth off-beats anticipate: voice the chord on the next beat.
			const lookup = hit.beatOffset % 1 !== 0 ? absBeat + 0.5 : absBeat;
			let segIdx = segmentIndexAt(segments, Math.min(lookup, harmonyEnd - 0.001));
			if (segIdx < 0) segIdx = segmentIndexAt(segments, absBeat);
			if (segIdx < 0) continue;
			// Guide-tone bars thin the voicing to the 3rd+7th — the "leave
			// space" color — regardless of the chord's led shape.
			const chord = chords[segIdx];
			let voicing = coordinatedVoicing ? undefined : ctx.plannedComp?.guideTones
				? guideToneVoicing(chord.root, chord.quality, COMP_REGISTER)
				: voicings[segIdx];
			if (!coordinatedVoicing && (!voicing || voicing.length === 0)) continue;

			const arrival = barInfos[bar].ensemble?.piano.arrival?.action === 'catch' ? barInfos[bar].ensemble!.piano.arrival : undefined;
			let time = arrival ? `${sharedArrivalTick(params.ensembleTiming!, barInfos[bar].ensemble!, params.ppq)}i` : place(absBeat, 'comp', params, streams, beatsPerBar);
			let startTick = parseInt(time, 10);
			// An on-top profile must not resume early inside the preceding rest.
			if (!arrival && bar > 0 && pianoSilentAt(bar - 1)) {
				startTick = Math.max(startTick, bar * beatsPerBar * params.ppq);
				time = `${startTick}i`;
			}
			const duration = Math.min(beatDuration * hit.durationBeats,
				(nextSilenceTicks[bar] - startTick) * beatDuration / params.ppq);
			if (duration <= 0) continue;
			if (coordinatedVoicing) {
				if (!Number.isFinite(startTick) || !Number.isFinite(duration) || startTick >= harmonyEnd * params.ppq) continue;
				// Anticipations may know the upcoming chord, but cannot borrow a
				// future bar's observation-derived energy for this committed attack.
				const currentIntensity = barInfos[bar].intensity;
				const ensemble = barInfos[bar].ensemble!;
				const contourContext = { barIndex: bar, phraseStartBar: ensemble.phraseStartBar, chorusIndex: ensemble.performanceEnergy!.chorusIndex, phase: ensemble.performanceEnergy!.phase };
				const contour = contourEnabled ? preparePianoContour(contourContext, contourMemory) : undefined;
				const selected = resolveCoordinatedVoicing({ chord,
					family: ctx.plannedComp?.guideTones ? 'guide' : selectCoordinatedVoicingFamily({ chord, phraseId, tempo, segmentIndex: segIdx, intensity: currentIntensity, voicingBias: style.voicingBias }),
					registerMidi: ctx.plannedComp?.guideTones ? COMP_REGISTER : Math.round(lerp(58, 66, currentIntensity)),
					previous: voicingMemory, ...(contour ? { targetTopMidi: contour.targetMidi } : {}), rootlessTexture: barInfos[bar].ensemble?.piano.rootlessTexture?.request });
				if (!selected.notes.length) continue;
				voicing = [...selected.notes];
				voicingMemory = selected.memory;
				if (contour) contourMemory = commitPianoContour(contourContext, contour, selected.notes);
				voicingTrace.push(Object.freeze({ absBeat, time, notes: selected.notes, decision: selected.decision, ...(arrival ? { arrivalId: arrival.accentId } : {}) }));
			}
			events.push({
				time,
				notes: voicing!,
				duration,
				velocity: hit.velocity,
				absBeat
			});
			if (barInfos[bar].ensemble) onsetsByBar.get(bar)!.push(hit.beatOffset);
		}
	}

	return { events, onsetsByBar, ...(terminalContext ? { terminalContext } : {}), ...(coordinatedVoicing ? { voicingTrace: Object.freeze(voicingTrace) } : {}), ...(motifMode ? { motifTrace: compMotifTrace(compPlan ?? []) }
		: barInfos.some((info) => info.ensemble) ? { motifTrace: freezeCompMotifTrace(barInfos.map((info, barIndex) => ({
			version: 1 as const, barIndex, phraseStartBar: info.ensemble!.phraseStartBar, motifId: null, sourceFigureId: null,
			transform: info.ensemble!.piano.maxAttacks === 0 ? 'space' as const : 'fallback' as const,
			displacementBeats: 0, hits: events.filter((event) => Math.floor(event.absBeat / beatsPerBar) === barIndex)
				.map((event) => ({ b: event.absBeat % beatsPerBar, d: event.duration / beatDuration })),
			reason: info.ensemble!.piano.maxAttacks === 0 ? 'ensemble_silence' as const : 'native_pattern' as const
		}))) } : {}) };
}

/**
 * One phrase-level draw from the dedicated `clave` stream: the bossa clave
 * side must be constant across the whole phrase AND across the comp and
 * drum generators (a rim and a guitar-hand on different sides is the one
 * unforgivable bossa mistake — caught by a property test when the phase
 * initially lived only in the drum ctx). Deterministic in (phraseId,
 * tempo), so every caller computes the identical phase.
 */
export function clavePhaseFor(phraseId: string, tempo: number): '32' | '23' {
	return createRng(seedFrom(phraseId, tempo, 'clave', 0)).chance(0.5) ? '32' : '23';
}

// ── Drums ────────────────────────────────────────────────────

/**
 * Generate drum events from the style's per-bar pattern. Receives the comp
 * and bass onsets so the pattern can talk to the band (snare echoes, kick
 * catches and pickup doubles), and hands each bar a dedicated
 * `('drum-fill', bar)` stream so form punctuation never reshuffles the
 * timekeeping draws.
 */
export function generateDrums(
	beatsPerBar: number,
	style: StyleDefinition,
	params: InstrumentGenerationParams,
	barInfos: BarInfo[],
	compOnsetsByBar: Map<number, number[]>,
	bassOnsetsByBar?: Map<number, number[]>,
	plannedDrums?: readonly DrumPhraseBarPlan[]
): DrumEvent[] {
	const { phraseId, tempo, swing } = params;
	const events: DrumEvent[] = [];
	const streams = createTimingStreams(phraseId, tempo);
	const clavePhase = clavePhaseFor(phraseId, tempo);
	const byAbsBeat = new Map<string, { drum: DrumVoice; velocity: number; absBeat: number; role?: DrumEvent['role'] }>();

	for (let bar = 0; bar < barInfos.length; bar++) {
		const rng = createRng(seedFrom(phraseId, tempo, 'drums', bar));
		const ctx: GenerationContext = {
			barIndex: bar,
			beatsPerBar,
			swing,
			rng,
			compOnsets: compOnsetsByBar.get(bar),
			bassOnsets: bassOnsetsByBar?.get(bar),
			plannedDrums: plannedDrums?.[bar],
			fillRng: createRng(seedFrom(phraseId, tempo, 'drum-fill', bar)),
			clavePhase,
			...barInfos[bar]
		};
		// The feathered-kick, comp-accent, and section-final setup branches
		// can collide on one offset — and the anticipated push (a negative
		// offset emitted by the NEXT bar) lands inside the previous bar,
		// where that bar's own kick may sit. Two sampler starts at the
		// identical tick read as a doubled hit, so the ledger spans bars:
		// keep the louder one per (voice, absBeat). Map insertion order is
		// emission order, which fixes each hit's jitter-draw index.
		for (const hit of ctx.plannedDrums?.hits ?? style.drumPattern(ctx)) {
			const absBeat = bar * beatsPerBar + hit.beatOffset;
			const key = `${hit.drum}:${absBeat}`;
			const prev = byAbsBeat.get(key);
			if (!prev || hit.velocity > prev.velocity) {
					byAbsBeat.set(key, { drum: hit.drum, velocity: hit.velocity, absBeat, ...(hit.role ? { role: hit.role } : {}) });
			}
		}
	}

	// A crash is the right hand leaving the ride — wherever one lands, a
	// tick-coincident ride or hat stroke would need a third limb. Downbeat
	// crashes already displace their ride at the pattern level
	// (suppressDownbeatRide), but the anticipated push lands inside the
	// PREVIOUS bar, on top of its ride skip (and sometimes a setup hat) at
	// the same swung eighth — only this cross-bar sweep can see that. Kick
	// and snare stay: crash-with-shot is idiomatic, crash-with-ride is
	// impossible.
	for (const { drum, absBeat } of [...byAbsBeat.values()]) {
		if (drum !== 'crash') continue;
		byAbsBeat.delete(`ride:${absBeat}`);
		byAbsBeat.delete(`hihat:${absBeat}`);
	}

	for (const { drum, velocity, absBeat, role } of byAbsBeat.values()) {
		events.push({
			time: place(absBeat, drum, params, streams, beatsPerBar),
			drum,
			velocity,
			absBeat,
			...(role ? { role } : {})
		});
	}

	return events;
}

// ── Entry point ──────────────────────────────────────────────

/**
 * Generate the full backing for a harmony timeline: comp first (drums read
 * its onsets for accents), then bass, then drums. `params.sectionMap`
 * (from `Phrase.sectionMap`) drives section/chorus awareness; without it
 * bars are counted flat.
 */
export function generateBacking(
	harmony: HarmonicSegment[],
	style: StyleDefinition,
	params: BackingGenerationParams
): GeneratedBacking {
	if (params.ensemble && params.beatsPerBar === 4 && style.coordinatedStyle && style.swingModel === 'fixed') params = { ...params, swing: style.defaultSwing };
	const { beatsPerBar } = params;
	const harmonyBeats = harmony.reduce(
		(max, seg) => Math.max(max, fractionToFloat(seg.startOffset) * 4 + fractionToFloat(seg.duration) * 4),
		0
	);
	const totalBars = Math.max(1, Math.ceil(harmonyBeats / beatsPerBar));
	const performanceForm = formForHarmony(params.performanceForm, totalBars);
	const terminalAssessment = params.terminalArrangement?.ending === 'hold-release' ? assessTerminalArrangement(harmony, style, params) : undefined;
	const terminalReservation = terminalAssessment?.available ? terminalAssessment.reservation : undefined;
	const performanceEnergy = params.ensemble && style.coordinatedStyle && beatsPerBar === 4 && performanceForm
		? planPerformanceEnergy(performanceForm) : undefined;
	let barInfos = buildBarInfos(totalBars, params.sectionMap, performanceForm);
	// A style may cap the ensemble arc (ballad: never dig in past 0.6);
	// applied to the whole timeline so every generator reads the same
	// ceiling.
	if (style.intensityCap !== undefined) {
		const cap = style.intensityCap;
		barInfos = barInfos.map((info) => ({ ...info, intensity: Math.min(info.intensity, cap), energyCeiling: cap }));
	}
	// Start with the existing vocabulary. The planner reserves space and
	// assigns commentary before any instrument chooses its notes or hits.
	let ensembleWindow = params.ensemble && !!style.coordinatedStyle && beatsPerBar === 4
		? planEnsembleWindow({
			phraseId: params.phraseId,
			tempo: params.tempo,
			bars: barInfos.map((info, barIndex) => ({
				...info,
				barIndex,
				...(terminalReservation?.barIndex === barIndex ? { terminalArrangement: terminalReservation } : {}),
				...(performanceEnergy ? { performanceEnergy: performanceEnergy[barIndex],
					...(['swing', 'straight'].includes(style.coordinatedStyle!) ? { pianoArrivalPolicy: 'shared-v1' as const } : {}) } : {}),
				...(performanceForm ? performanceBarContext(performanceForm, barIndex) : {})
			})),
			soloFeatures: params.ensemble.soloFeatures
		}) : undefined;
	const ensemblePlan = ensembleWindow?.plan;
	if (ensemblePlan) {
		barInfos = barInfos.map((info, barIndex) => ({
			...info, ensemble: ensemblePlan.bars[barIndex], intensity: ensemblePlan.bars[barIndex].energy
		}));
	}

	const timing = params.timing ?? style.timing;
	const ensembleTiming = ensemblePlan ? createEnsembleTiming({
		phraseId: params.phraseId, tempo: params.tempo, ppq: params.ppq,
		swing: params.swing, plan: ensemblePlan, timingProfiles: timing
	}) : undefined;
	const timedParams: InstrumentGenerationParams = { ...params, performanceForm, timing, ensembleTiming, ...(terminalReservation ? { terminalReservation } : {}),
		...(performanceEnergy && ['swing', 'straight'].includes(style.coordinatedStyle!) ? { bassScalarContinuation: true as const } : {}) };
	const { events: compEvents, onsetsByBar, motifTrace: ordinaryMotifTrace, voicingTrace: ordinaryVoicingTrace, terminalContext } = generateComping(harmony, beatsPerBar, style, timedParams, barInfos);
	// Bass engine dispatch: the bossa root–fifth pattern is a 4/4 statement;
	// 'two' pins the walking planner to permanent two-feel (ballad); other
	// meters (and every 'auto' style) take the plain walking planner.
	const { events: bassEvents, onsetsByBar: bassOnsetsByBar, turnaroundTrace: ordinaryTurnaroundTrace, feelTrace: ordinaryFeelTrace, continuationTrace: ordinaryContinuationTrace } =
		style.bass === 'pattern' && beatsPerBar === 4
			? generateBossaBass(harmony, beatsPerBar, timedParams, barInfos)
			: generateBassLine2(
					harmony,
					beatsPerBar,
					timedParams,
					barInfos,
					style.bass === 'two' ? 'two' : undefined
				);
	const drumPhrases = ensemblePlan ? planDrumPhrases({
		style: style.coordinatedStyle,
		phraseId: params.phraseId, tempo: params.tempo, beatsPerBar: 4, bars: barInfos,
		compOnsetsByBar: onsetsByBar, bassOnsetsByBar, harmonyEndBeat: harmonyBeats,
		// Swing and phrase placement can move an otherwise valid final-bar
		// onset past the ending. Admit whole gestures before freezing the trace.
		acceptsOnset: (absBeat, hit) => {
			const bar = Math.floor(absBeat / 4);
			const arrival = hit.role === 'accent' && absBeat % 4 === 0 && ensemblePlan.bars[bar]?.coordinatedAccent;
			const tick = arrival ? sharedArrivalTick(ensembleTiming!, ensemblePlan.bars[bar], params.ppq) : ensembleTiming!.place(absBeat, hit.drum);
			return tick < harmonyBeats * params.ppq;
		}
	}) : undefined;
	const drumEvents = generateDrums(beatsPerBar, style, timedParams, barInfos, onsetsByBar, bassOnsetsByBar, drumPhrases?.bars);

	// A planned arrival shares one onset. Ordinary timekeeping keeps the
	// phrase placement; intentional unisons share the phrase motion without a player residual.
	for (const bar of ensemblePlan?.bars ?? []) {
		const accent = bar.coordinatedAccent;
		if (!accent) continue;
		const absBeat = bar.barIndex * beatsPerBar;
		const time = `${sharedArrivalTick(ensembleTiming!, bar, params.ppq)}i`;
		if (accent.participants.includes('bass')) {
			const bass = bassEvents.find((event) => event.absBeat === absBeat);
			if (bass) { bass.time = time; bass.velocity = Math.min(110, bass.velocity + 5); }
		}
		for (const hit of drumEvents.filter((event) => event.absBeat === absBeat && event.role === 'accent')) hit.time = time;
	}
	let motifTrace = ordinaryMotifTrace, voicingTrace = ordinaryVoicingTrace;
	let turnaroundTrace = ordinaryTurnaroundTrace, feelTrace = ordinaryFeelTrace, continuationTrace = ordinaryContinuationTrace;
	let finalDrumTrace = drumPhrases?.trace;
	let terminalDecision: TerminalArrangementDecision | undefined;
	if (terminalReservation && ensembleWindow && terminalContext) {
		const bar = terminalReservation.barIndex;
		const priorEvents = [...bassEvents, ...compEvents].filter(event => event.absBeat < terminalReservation.absBeat);
		const candidate = realizeTerminalArrangement({ reservation: terminalReservation, plan: ensembleWindow.plan.bars[bar], style,
			phraseId: params.phraseId, tempo: params.tempo, ppq: params.ppq, segmentIndex: harmony.length - 1,
			previousBass: bassEvents.filter(event => event.absBeat < terminalReservation.absBeat).at(-1)?.midi,
			previousVoicing: terminalContext.voicing, previousContour: terminalContext.contour,
			...(terminalReservation.profile === 'ballad-v1' ? { ordinaryBass: bassEvents, ordinaryDrums: drumEvents } : {}),
			precedingRelease: priorEvents.some(event => parseInt(event.time) + event.duration * params.tempo / 60 * params.ppq > terminalReservation.absBeat * params.ppq + 1e-7),
			committedLaunch: turnaroundTrace?.some(trace => trace.status === 'planned' && trace.arrivalBar === bar) });
		terminalDecision = candidate.decision;
		if (candidate.decision.status === 'accepted' && candidate.voicingTrace) {
			const accepted = candidate.decision;
			bassEvents.splice(0, bassEvents.length, ...bassEvents.filter(event => event.absBeat < terminalReservation.absBeat), { ...accepted.bass });
			compEvents.splice(0, compEvents.length, ...compEvents.filter(event => event.absBeat < terminalReservation.absBeat), { ...accepted.piano, notes: [...accepted.piano.notes] });
			drumEvents.splice(0, drumEvents.length, ...drumEvents.filter(event => event.absBeat < terminalReservation.absBeat), ...accepted.drums.map(event => ({ ...event })));
			const plan = terminalBarPlan(ensembleWindow.plan.bars[bar]);
			ensembleWindow = { plan: freezeEnsemblePlan({ ...ensembleWindow.plan,
				bars: ensembleWindow.plan.bars.map(entry => entry.barIndex === bar ? plan : entry),
				trace: ensembleWindow.plan.trace.map(entry => entry.barIndex === bar ? { ...entry, reasons: [...entry.reasons, 'terminal_arrangement'] } : entry) }),
				memory: freezeEnsembleMemory({ ...ensembleWindow.memory, recentBars: ensembleWindow.memory.recentBars.map(entry => entry.barIndex === bar ? { ...entry, pianoAttackBudget: 1, drumCommentaryBudget: 0 } : entry) }) };
			motifTrace = [...(motifTrace ?? []).filter(entry => entry.barIndex !== bar), terminalPianoTrace(plan, terminalReservation)];
			voicingTrace = [...(voicingTrace ?? []).filter(entry => Math.floor(entry.absBeat / 4) !== bar), candidate.voicingTrace];
			finalDrumTrace = (finalDrumTrace ?? []).map(entry => entry.barIndex === bar ? terminalDrumTrace(entry, accepted) : entry);
			turnaroundTrace = turnaroundTrace?.filter(entry => entry.startBar !== bar);
			feelTrace = feelTrace?.filter(entry => entry.barIndex !== bar);
			continuationTrace = continuationTrace?.filter(entry => entry.barIndex !== bar);
		}
	}
	return { bassEvents, compEvents, drumEvents, ...(ensembleWindow ? {
		ensemblePlan: ensembleWindow.plan, ensembleMemory: ensembleWindow.memory,
		ensembleTiming: ensembleTiming!.trace,
		ensembleDevelopment: freezeEnsembleDevelopment({
			version: 1, ...(terminalDecision ? { terminalArrangements: [terminalDecision] } : {}), pianoMotifs: motifTrace ?? [], bassTurnarounds: turnaroundTrace ?? [],
			...(feelTrace ? { bassFeel: feelTrace } : {}),
			...(continuationTrace?.length ? { bassContinuations: continuationTrace } : {}),
			...(voicingTrace ? { pianoVoicings: voicingTrace } : {}),
			drumPhrases: finalDrumTrace ?? []
		})
	} : {}) };
}

// ── Memoized entry point ─────────────────────────────────────

const GENERATION_CACHE_LIMIT = 4;
/** key → serialized result. Values are stored as JSON and re-parsed per
 *  hit so every caller gets fresh objects — no shared-mutation hazard. */
const generationCache = new Map<string, string>();

/**
 * `generateBacking` behind a small LRU — provably safe because generation
 * is deterministic in (harmony, style, params): same key, same events.
 * Serves the live scheduler, where lick-practice loops and tempo retries
 * regenerate the identical backing many times per session. The key
 * includes the full harmony content (styles are keyed by name — their
 * functions aren't serializable, and name identifies the vocabulary).
 */
export function generateBackingCached(
	harmony: HarmonicSegment[],
	style: StyleDefinition,
	params: BackingGenerationParams
): GeneratedBacking {
	const key = JSON.stringify([style.name, params, harmony]);
	const hit = generationCache.get(key);
	if (hit !== undefined) {
		// Refresh recency (Map preserves insertion order).
		generationCache.delete(key);
		generationCache.set(key, hit);
		const generated = JSON.parse(hit) as GeneratedBacking;
		if (generated.ensemblePlan) freezeEnsemblePlan(generated.ensemblePlan);
		if (generated.ensembleMemory) freezeEnsembleMemory(generated.ensembleMemory);
		if (generated.ensembleTiming) freezeEnsembleTimingTrace(generated.ensembleTiming);
		if (generated.ensembleDevelopment) freezeEnsembleDevelopment(generated.ensembleDevelopment);
		return generated;
	}
	const generated = generateBacking(harmony, style, params);
	const serialized = JSON.stringify(generated);
	generationCache.set(key, serialized);
	if (generationCache.size > GENERATION_CACHE_LIMIT) {
		generationCache.delete(generationCache.keys().next().value as string);
	}
	return generated;
}
