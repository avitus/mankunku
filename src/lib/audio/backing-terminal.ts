/** Explicit finite arrangement cue. Ordinary continuing accompaniment is the default. */
import type { HarmonicSegment, Note, PitchClass, ChordQuality } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { MAX_ADAPTIVE_LOOPS } from './backing-performance-limits';
import { getScale } from '$lib/music/scales';
import { fractionToFloat } from '$lib/music/intervals';
import type { BackingGenerationParams, BassEvent, CompEvent, DrumEvent, CoordinatedPianoVoicing } from './backing-generation';
import type { StyleDefinition } from './backing-styles';
import type { EnsembleBarPlan } from './ensemble-plan';
import type { CompMotifDecision } from './backing-comp-figures';
import type { DrumPhraseDecision } from './backing-drum-phrases';
import { seedFrom } from './generation-rng';
import { selectCoordinatedVoicingFamily } from './coordinated-voicing-family';
import { resolveCoordinatedVoicing, type CoordinatedVoicingMemory } from './coordinated-voicing';
import { preparePianoContour, commitPianoContour, type PianoContourMemory } from './backing-piano-contour';

export interface TerminalArrangementInput {
	readonly ending: 'continue' | 'hold-release';
	/** Required for the hold: [] explicitly declares an instrumental performance. */
	readonly melody?: readonly Note[];
}
export interface TerminalReservation {
	readonly version: 1;
	readonly id: string;
	readonly barIndex: number;
	readonly absBeat: number;
	readonly releaseBeat: number;
	readonly holdBeats: number;
	readonly participants: readonly ['bass', 'piano', 'drums'];
	readonly chord: { readonly root: PitchClass; readonly quality: ChordQuality };
}
export type TerminalArrangementDecision = {
	readonly version: 1; readonly reservationId: string; readonly barIndex: number;
} & ({ readonly status: 'accepted'; readonly bass: Readonly<BassEvent>; readonly piano: Readonly<CompEvent>; readonly drums: readonly Readonly<DrumEvent>[] }
	| { readonly status: 'withheld'; readonly reason: 'preceding_release' | 'unrealizable' });
export type TerminalAssessment = { readonly available: true; readonly reservation: TerminalReservation }
	| { readonly available: false; readonly reason: string };

function freeze<T>(value: T): T {
	if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
	return value;
}
export const freezeTerminalDecisions = (decisions: readonly TerminalArrangementDecision[]): readonly TerminalArrangementDecision[] => freeze(decisions);
export const freezeTerminalReservation = (reservation: TerminalReservation): TerminalReservation => freeze(reservation);
const fraction = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 &&
	value.every(Number.isSafeInteger) && value[0] >= 0 && value[1] > 0;
const chordValid = (chord: TerminalReservation['chord']): boolean => !!chord && PITCH_CLASSES.includes(chord.root) && Object.hasOwn(CHORD_DEFINITIONS, chord.quality);

/** Same admission for Studio, fixed playback and the final declared rolling loop. */
export function assessTerminalArrangement(harmony: readonly HarmonicSegment[], style: StyleDefinition,
	params: BackingGenerationParams, options: { loopCount?: number } = {}): TerminalAssessment {
	const unavailable = (reason: string): TerminalAssessment => ({ available: false, reason });
	if (params.terminalArrangement?.ending !== 'hold-release') return unavailable('Continuing accompaniment selected');
	if (!params.ensemble || !params.performanceForm || params.beatsPerBar !== 4 || !['swing', 'straight'].includes(style.coordinatedStyle ?? '')) {
		return unavailable('Requires explicit Coordinated Swing or Straight in 4/4');
	}
	const sourceBars = params.performanceForm.totalBars;
	const loops = options.loopCount ?? 1;
	if (!Number.isSafeInteger(sourceBars) || sourceBars < 1 || !Number.isSafeInteger(loops) || loops < 1 || loops > MAX_ADAPTIVE_LOOPS ||
		!Number.isFinite(params.tempo) || params.tempo <= 0 || !Number.isSafeInteger(params.ppq) || params.ppq <= 0) return unavailable('Invalid finite performance');
	const sourceEnd = sourceBars * 4;
	const start = sourceEnd - 4;
	let previousEnd = 0;
	for (const segment of harmony) {
		if (!fraction(segment.startOffset) || !fraction(segment.duration)) return unavailable('Invalid harmony timing');
		const offset = fractionToFloat(segment.startOffset) * 4;
		const duration = fractionToFloat(segment.duration) * 4;
		if (offset !== previousEnd || !Number.isInteger(duration) || duration <= 0) return unavailable('Requires complete quarter-aligned harmony');
		previousEnd = offset + duration;
	}
	const last = harmony.at(-1);
	if (!last || previousEnd !== sourceEnd || fractionToFloat(last.startOffset) * 4 !== start || fractionToFloat(last.duration) * 4 !== 4 ||
		!chordValid(last.chord) || !getScale(last.scaleId)) return unavailable('Requires one supported harmony throughout the final bar');
	const melody = params.terminalArrangement.melody;
	if (!Array.isArray(melody)) return unavailable('The closing melody must be known');
	let sustainEnd = start;
	let prior: Note | undefined;
	let priorEnd = 0;
	for (const note of melody) {
		if (!note || !fraction(note.offset) || !fraction(note.duration) ||
			(note.pitch !== null && (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127)) ||
			(note.tied !== undefined && typeof note.tied !== 'boolean')) return unavailable('Invalid closing melody');
		const offset = fractionToFloat(note.offset) * 4;
		const end = offset + fractionToFloat(note.duration) * 4;
		if (end <= offset || offset + 1e-7 < priorEnd || end > sourceEnd + 1e-7) return unavailable('Invalid closing melody timing');
		const continuation = prior?.tied === true && prior.pitch === note.pitch && Math.abs(priorEnd - offset) < 1e-7 && note.pitch !== null;
		if (note.pitch !== null && offset > start && !continuation) return unavailable('The melody continues after the closing downbeat');
		if (note.pitch !== null && end > start) sustainEnd = Math.max(sustainEnd, end);
		prior = note; priorEnd = end;
	}
	if (prior?.tied) return unavailable('The closing melody tie has no known release');
	const holdBeats = Math.max(2, sustainEnd - start);
	const barIndex = sourceBars * loops - 1;
	const absBeat = barIndex * 4;
	const chord = { root: last.chord.root, quality: last.chord.quality };
	return { available: true, reservation: freezeTerminalReservation({ version: 1,
		id: `terminal:${seedFrom(params.phraseId, style.coordinatedStyle!, barIndex, chord.root, chord.quality, holdBeats).toString(16)}`,
		barIndex, absBeat, releaseBeat: absBeat + holdBeats, holdBeats, participants: ['bass', 'piano', 'drums'], chord }) };
}

/** Bounded score contract, also checked on the direct planner's public input. */
export function validTerminalReservation(value: TerminalReservation, finalBar: number): boolean {
	return !!value && Object.keys(value).length === 8 && value.version === 1 && typeof value.id === 'string' && value.id.startsWith('terminal:') &&
		value.barIndex === finalBar && value.absBeat === finalBar * 4 && Number.isFinite(value.holdBeats) && value.holdBeats >= 2 && value.holdBeats <= 4 &&
		value.releaseBeat === value.absBeat + value.holdBeats && JSON.stringify(value.participants) === '["bass","piano","drums"]' &&
		chordValid(value.chord) && Object.keys(value.chord).length === 2;
}

export interface TerminalCandidateInput {
	readonly reservation: TerminalReservation;
	readonly plan: EnsembleBarPlan;
	readonly style: StyleDefinition;
	readonly phraseId: string;
	readonly tempo: number;
	readonly ppq: number;
	readonly segmentIndex: number;
	readonly previousBass?: number | null;
	readonly previousVoicing?: CoordinatedVoicingMemory;
	readonly previousContour?: PianoContourMemory;
	readonly precedingRelease?: boolean;
	readonly committedLaunch?: boolean;
}

export interface TerminalCandidateResult {
	readonly decision: TerminalArrangementDecision;
	readonly voicing?: CoordinatedVoicingMemory;
	readonly contour?: PianoContourMemory;
	readonly voicingTrace?: CoordinatedPianoVoicing;
}

/** Pure complete alternative. No ordinary event, RNG stream or previous memory is mutated. */
export function realizeTerminalArrangement(input: TerminalCandidateInput): TerminalCandidateResult {
	const { reservation, plan, tempo, ppq } = input;
	const base = { version: 1 as const, reservationId: reservation.id, barIndex: reservation.barIndex };
	const withheld = (reason: 'preceding_release' | 'unrealizable') => ({ decision: { ...base, status: 'withheld' as const, reason } });
	if (input.precedingRelease) return withheld('preceding_release');
	if (input.committedLaunch || plan.coordinatedAccent || plan.setupFor || plan.responseOwner !== 'nobody' || !['swing', 'straight'].includes(input.style.coordinatedStyle ?? '') ||
		(input.previousBass != null && (!Number.isInteger(input.previousBass) || input.previousBass < 28 || input.previousBass > 55)) || !validTerminalReservation(reservation, plan.barIndex) || !plan.performanceEnergy ||
		!Number.isFinite(tempo) || tempo <= 0 || !Number.isSafeInteger(ppq) || ppq <= 0 || !Number.isInteger(input.segmentIndex) || input.segmentIndex < 0) return withheld('unrealizable');
	const context = { barIndex: plan.barIndex, phraseStartBar: plan.phraseStartBar,
		chorusIndex: plan.performanceEnergy.chorusIndex, phase: plan.performanceEnergy.phase };
	const contour = preparePianoContour(context, input.previousContour);
	const selected = resolveCoordinatedVoicing({ chord: reservation.chord,
		family: selectCoordinatedVoicingFamily({ chord: reservation.chord, phraseId: input.phraseId, tempo,
			segmentIndex: input.segmentIndex, intensity: plan.energy, voicingBias: input.style.voicingBias }),
		registerMidi: Math.round(58 + 8 * plan.energy), previous: input.previousVoicing,
		rootlessTexture: plan.piano.rootlessTexture?.request, targetTopMidi: contour.targetMidi });
	if (selected.notes.length < 2 || selected.notes.some(note => !Number.isInteger(note) || note < 48 || note > 84)) return withheld('unrealizable');
	const center = input.previousBass ?? 36;
	const roots = Array.from({ length: 28 }, (_, index) => index + 28).filter(midi => midi % 12 === PITCH_CLASSES.indexOf(reservation.chord.root));
	const midi = roots.reduce((best, note) => Math.abs(note - center) < Math.abs(best - center) ? note : best);
	const time = `${reservation.absBeat * ppq}i`;
	const duration = reservation.holdBeats * 60 / tempo;
	const bass: BassEvent = { absBeat: reservation.absBeat, time, midi, duration, velocity: Math.round(70 + plan.energy * 12) };
	const piano: CompEvent = { absBeat: reservation.absBeat, time, notes: [...selected.notes], duration, velocity: Math.round(64 + plan.energy * 12) };
	const drums: DrumEvent[] = [{ absBeat: reservation.absBeat, time, drum: 'ride', velocity: .4, role: 'accent' },
		{ absBeat: reservation.absBeat, time, drum: 'kick', velocity: .3, role: 'accent' }];
	const decision: TerminalArrangementDecision = { ...base, status: 'accepted', bass, piano, drums };
	const voicingTrace: CoordinatedPianoVoicing = { absBeat: piano.absBeat, time, notes: [...piano.notes], decision: selected.decision };
	return { decision, voicing: selected.memory, contour: commitPianoContour(context, contour, selected.notes), voicingTrace };
}

export function terminalBarPlan(plan: EnsembleBarPlan): EnsembleBarPlan {
	const { silenceReason: _pianoReason, ...piano } = plan.piano;
	const { silenceReason: _drumReason, ...drums } = plan.drums;
	return { ...plan, piano: { ...piano, role: 'mark_form', maxAttacks: 1, densityScale: .5 },
		drums: { ...drums, role: 'mark_form', keepTime: false, maxCommentaryHits: 0, commentaryScale: 0, allowFill: false },
		bass: { ...plan.bass, keepPulse: false, ornamentScale: 0 } };
}
export function terminalPianoTrace(plan: EnsembleBarPlan, reservation: TerminalReservation): CompMotifDecision {
	return { version: 1, barIndex: plan.barIndex, phraseStartBar: plan.phraseStartBar, motifId: null, sourceFigureId: null,
		transform: 'fallback', displacementBeats: 0, hits: [{ b: 0, d: reservation.holdBeats }], reason: 'terminal_arrangement' };
}
export function terminalDrumTrace(ordinary: DrumPhraseDecision, decision: Extract<TerminalArrangementDecision, { status: 'accepted' }>): DrumPhraseDecision {
	return { ...ordinary, ride: { ...ordinary.ride, voice: 'ride', mode: 'none', phase: 'release', velocityScale: 1, skipOffsets: [], onsets: [0] },
		commentary: { motifId: null, source: 'none', sourceId: null, sourceBar: null, sourceOffsets: [], transform: 'space', displacementBeats: 0, hits: [], reason: 'terminal_arrangement' },
		hits: decision.drums.map(event => ({ beatOffset: 0, drum: event.drum, velocity: event.velocity, role: event.role })) };
}
