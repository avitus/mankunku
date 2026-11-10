/** Stateful one-bar piano realization. Multi-bar source cells are proposals, not future budgets. */
import type { RollingBackingDefinition } from './backing-rolling';
import { clavePhaseFor, type BarInfo, type BassEvent, type CompEvent, type CoordinatedPianoVoicing, type PianoAnswerDecision, type PianoFeedbackDecision } from './backing-generation';
import type { CompHitSpec } from './backing-styles';
import type { EnsembleTiming } from './ensemble-timing';
import { type CompFigure, type CompFigureHit, type CompMotifDecision } from './backing-comp-figures';
import { keyboardFigures, hasWrittenKeyboardArticulation } from './backing-keyboard-vocabulary';
import { KEYBOARD_DEVELOPMENTS, keyboardDevelopment, keyboardAnswerFigure, articulateKeyboardDevelopment, keyboardDevelopmentVelocity, type KeyboardDevelopment } from './backing-keyboard-development';
import { BACKING_STYLES } from './backing-styles';
import { createRng, seedFrom } from './generation-rng';
import { fractionToFloat } from '$lib/music/intervals';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { rootlessVoicingA, rootlessVoicingB, shellVoicing, drop2Voicing, quartalVoicing, guideToneVoicing, voiceLead, type VoicingFn } from './voicings';
import { preparePianoContour, commitPianoContour, type PianoContourMemory } from './backing-piano-contour';
import { proposePianoAnswer, type PianoAnswerMemory } from './backing-piano-answer';
import { planKeyboardLine } from './backing-keyboard-line';
import { articulateKeyboardHit } from './backing-keyboard-articulation';
import { planKeyboardTexture, planNativeKeyboardTexture } from './backing-keyboard-texture';
import { selectCoordinatedVoicingFamily } from './coordinated-voicing-family';
import { describeCoordinatedPlacement, resolveCoordinatedVoicing, type CoordinatedVoicingMemory } from './coordinated-voicing';
import { proposeKeyboardSuspension } from './backing-keyboard-suspension';
import type { SoloEvidence } from './ensemble-plan';
import { pianoPhraseRecallEnabled, retainPianoPhraseRecall, capturePianoMotifSource, proposePianoMotifRecall, type PianoPhraseRecallMemory } from './backing-piano-motif-memory';

export interface RollingPianoMemory {
	readonly recentFigures: readonly string[];
	readonly motif: { readonly startBar: number; readonly sourceId: string | null; readonly shift: number; readonly repeat: boolean } | null;
	readonly segmentIndex: number | null;
	readonly segmentVoicing: readonly number[];
	readonly lastVoicing: readonly number[];
	/** Last emitted harmony and pitches, including guide-tone overrides. */
	readonly voicing?: CoordinatedVoicingMemory;
	readonly contour?: PianoContourMemory;
	/** Bounded accepted source; required (with null source) only by the scoped recall policy. */
	readonly phraseRecall?: PianoPhraseRecallMemory;
	/** Accepted color only: never advanced by an ineligible or rejected proposal. */
	readonly lastSuspensionBar?: number;
}

const emptyMemory = (): RollingPianoMemory => ({ recentFigures: [], motif: null, segmentIndex: null, segmentVoicing: [], lastVoicing: [] });
const figureById = (score: RollingBackingDefinition, id: string) => keyboardFigures(score).find((figure) => figure.id === id)!;
const shiftsFor = (figure: CompFigure) => [-1, -0.5, 0.5, 1].filter((shift) => figure.hits[0].every((hit) => hit.b + shift >= 0 && hit.b + shift < 3.5));

export function realizeRollingPiano(score: RollingBackingDefinition, bar: number, info: BarInfo,
	timing: EnsembleTiming, previous?: RollingPianoMemory, answerContext?: { feedback: Omit<PianoFeedbackDecision, 'acceptedAttacks'>; previous?: PianoAnswerMemory }, soloEvidence: SoloEvidence = 'unavailable', bassEvents?: readonly BassEvent[]) {
	const ordinary = realizePianoCandidate(score, bar, info, timing, previous, answerContext, undefined, false, bassEvents);
	if (!pianoPhraseRecallEnabled(score)) return ordinary;
	const retained = retainPianoPhraseRecall(previous?.phraseRecall, score, bar, soloEvidence);
	const proposed = proposePianoMotifRecall({ score, bar, info, evidence: soloEvidence, memory: retained,
		trace: ordinary.trace, events: ordinary.events, motif: ordinary.memory.motif });
	let selected = ordinary;
	let recall: CompMotifDecision['recall'];
	if (proposed) {
		// Both candidates start from the original actual history and consume the
		// same existing selection streams. Never commit a partially played recall.
		const candidate = realizePianoCandidate(score, bar, info, timing, previous, answerContext, proposed, false, bassEvents);
		const source = retained.source!;
		const figure = figureById(score, source.figureId);
		if (!candidate.answer && candidate.trace.transform === 'statement' && candidate.events.length === ordinary.events.length &&
			figure.hits[0].every((hit, index) => candidate.events[index]?.absBeat === bar * 4 + hit.b)) {
			selected = candidate;
			recall = { source, attacks: candidate.events.map(event => ({ ...event, notes: [...event.notes] })) };
		}
	}
	const source = recall ? null : capturePianoMotifSource(score, bar, info, soloEvidence, selected.trace, selected.events);
	const phraseRecall: PianoPhraseRecallMemory = recall ? { version: 1, source: recall.source, recalledAt: bar }
		: source ? { version: 1, source, recalledAt: null } : retained;
	return { ...selected, memory: { ...selected.memory, phraseRecall }, trace: { ...selected.trace, ...(recall ? { recall } : {}) } };
}

/** A separate pure native candidate; caller commits only a complete coordinated result. */
export function realizeRollingBalladReply(score: RollingBackingDefinition, bar: number, info: BarInfo,
	timing: EnsembleTiming, previous?: RollingPianoMemory) {
	return realizePianoCandidate(score, bar, info, timing, previous, undefined, undefined, true);
}

function realizePianoCandidate(score: RollingBackingDefinition, bar: number, info: BarInfo,
	timing: EnsembleTiming, previous?: RollingPianoMemory, answerContext?: { feedback: Omit<PianoFeedbackDecision, 'acceptedAttacks'>; previous?: PianoAnswerMemory },
	motifOverride?: RollingPianoMemory['motif'], nativeLatePad = false, bassEvents?: readonly BassEvent[]): { answer?: PianoAnswerDecision; events: CompEvent[]; memory: RollingPianoMemory; trace: CompMotifDecision; voicingTrace?: readonly CoordinatedPianoVoicing[] } {
	const memory = previous ?? emptyMemory();
	let lastSuspensionBar = memory.lastSuspensionBar;
	const style = BACKING_STYLES[score.style ?? 'swing'];
	const ensemble = info.ensemble!;
	const coordinatedVoicing = !!ensemble.performanceEnergy;
	let voicingMemory = memory.voicing;
	let contourMemory = memory.contour;
	const contourEnabled = coordinatedVoicing && (!score.style || ['swing', 'straight', 'bossa-nova'].includes(score.style));
	const contourContext = coordinatedVoicing ? { barIndex: bar, phraseStartBar: ensemble.phraseStartBar, chorusIndex: ensemble.performanceEnergy!.chorusIndex, phase: ensemble.performanceEnergy!.phase } : undefined;
	const voicingTrace: CoordinatedPianoVoicing[] = [];
	const form = score.bars[bar];
	const phraseStart = ensemble.phraseStartBar;
	const budget = ensemble.piano.maxAttacks;
	const harmonicSupport = ensemble.piano.harmonicSupport !== undefined;
	const backgroundHarmony = harmonicSupport && ensemble.piano.harmonicSupport !== 'ordinary';
	const arrival = ensemble.piano.arrival?.action === 'catch' ? ensemble.piano.arrival : undefined;
	const cellFits = (hits: readonly CompFigureHit[]) => hits.every((hit) => hit.b >= 0 && hit.b < 4 &&
		timing.place(bar * 4 + hit.b, 'comp') < (bar + 1) * 4 * score.ppq);
	const fits = (figure: CompFigure) => figure.bars === 1 && figure.hits[0].length <= budget &&
		(!harmonicSupport || figure.hits[0].length > 0) &&
		cellFits(figure.hits[0]) &&
		(bar !== 0 || budget === 0 || figure.tags.includes('early')) &&
		(!info.isFinalBar || figure.hits[0].every((hit) => hit.b < 3.5));
	let motif = memory.motif;
	let figure: CompFigure = figureById(score, 'rest');
	let hits: CompFigureHit[] = [];
	let transform: CompMotifDecision['transform'] = 'fallback';
	let shift = 0;
	let reason: CompMotifDecision['reason'];
	let development: KeyboardDevelopment | undefined;
	let answerFigureId: string | undefined;
	let guideTones = false;
	let realized: CompHitSpec[];
	if (style.compPlanning) {
		if (!motif || motif.startBar !== phraseStart) {
			const rng = createRng(seedFrom(score.phraseId, score.tempo, 'comp-motif', phraseStart));
			const candidates = keyboardFigures(score).filter((figure) => fits(figure) && figure.hits[0].length > 0 && !figure.tags.includes('pad') && shiftsFor(figure).length > 0);
			const selected = !backgroundHarmony && form.phrase4?.lengthBars === 4 && budget > 0 && ensemble.responseOwner === 'nobody' && !ensemble.coordinatedAccent && rng.chance(0.55) && candidates.length > 0;
			const source = selected ? rng.weighted(candidates.map((figure) => ({ value: figure, weight: figure.weight * (score.keyboardVarietyVersion && memory.recentFigures.includes(figure.repeatKey ?? figure.id) ? .25 : 1) }))) : undefined;
			motif = { startBar: phraseStart, sourceId: source?.id ?? null, shift: source ? rng.pick(shiftsFor(source)) : 0,
				repeat: createRng(seedFrom(score.phraseId, score.tempo, 'comp-motif-development', phraseStart)).chance(ensemble.piano.texture === 'steady' ? .7 : .35) };
		}
		if (motifOverride) motif = motifOverride;
		const rng = createRng(seedFrom(score.phraseId, score.tempo, 'comp-figure', bar));

		if (motif.sourceId) {
			figure = figureById(score, motif.sourceId);
			const position = bar - motif.startBar;
			transform = position === 0 ? 'statement' : position === 1 ? motif.repeat ? 'repeat' : 'space' : position === 2 ? 'displace' : 'shorten';
			shift = position >= 2 ? motif.shift : 0;
			if (score.keyboardVarietyVersion === 2) {
				development = keyboardDevelopment(score.phraseId, score.tempo, phraseStart, score.bars[phraseStart].pianoPresenceSeed ?? 0);
				transform = KEYBOARD_DEVELOPMENTS[development][position];
				shift = transform === 'displace' ? motif.shift : 0;
				if (transform === 'answer') {
					figure = keyboardAnswerFigure(keyboardFigures(score), figure, score.phraseId, score.tempo, phraseStart);
					answerFigureId = figure.id;
				}
			}
			hits = transform === 'space' ? [] : figure.hits[0].map((hit) => ({ b: hit.b + shift, d: hit.d }));
			if (transform === 'shorten') hits = [{ b: hits[0].b, d: Math.min(hits[0].d, 0.45) }];
			if (development) hits = articulateKeyboardDevelopment(hits, transform, development);
			if (transform === 'space') reason = 'motif_gap';
			const withheld = budget === 0 || ensemble.coordinatedAccent ? 'ensemble_silence'
				: ensemble.responseOwner !== 'nobody' ? 'response_reserved'
					: hits.length > budget || !cellFits(hits) ? 'gesture_does_not_fit' : undefined;
			if (withheld) { hits = []; transform = 'space'; shift = 0; reason = withheld; development = undefined; answerFigureId = undefined; }
		} else {
			const options = keyboardFigures(score).filter(fits).map((candidate) => {
				const key = candidate.repeatKey ?? candidate.id;
				let weight = candidate.weight * (style.compFigureBias?.[candidate.id] ?? 1) * (candidate.busy > 0 ? ensemble.piano.densityScale : 1);
				if (ensemble.piano.texture === 'steady' && !candidate.hits[0].length) weight *= .2;
				if (memory.recentFigures.at(-1) === key && memory.recentFigures.at(-2) === key) weight = 0;
				else if (memory.recentFigures.at(-1) === key) weight *= 0.25;
				if (info.isSectionFinalBar && !info.isFinalBar) weight *= candidate.tags.includes('push') ? 5 : 0.5;
				return { value: candidate, weight };
			}).filter((entry) => entry.weight > 0);
			figure = options.length ? rng.weighted(options) : figureById(score, 'rest');
			hits = figure.hits[0].map((hit) => ({ ...hit }));
			if (budget === 0 || ensemble.coordinatedAccent || (ensemble.responseOwner !== 'nobody' && ensemble.responseOwner !== 'piano')) {
				hits = []; transform = 'space'; reason = budget === 0 ? 'ensemble_silence' : 'response_reserved';
			} else reason = form.phrase4?.lengthBars === 4 ? 'not_selected' : 'short_phrase';
		}
		// Choose a complete native cell before realization: either causal
		// re-entry after accepted silence, or a steady phrase whose retained
		// gesture no longer fits the current permission.
		if (!hits.length && budget > 0 && (harmonicSupport || ensemble.piano.presence === 'reentry' || ensemble.piano.texture === 'steady' && reason === 'gesture_does_not_fit') && !ensemble.coordinatedAccent && (harmonicSupport || ensemble.responseOwner === 'nobody')) {
			const candidates = keyboardFigures(score).filter(candidate => fits(candidate) && candidate.hits[0].length > 0).map(candidate => {
				let weight = candidate.weight * (style.compFigureBias?.[candidate.id] ?? 1);
				if (ensemble.piano.texture === 'steady') {
					const key = candidate.repeatKey ?? candidate.id;
					if (memory.recentFigures.at(-1) === key && memory.recentFigures.at(-2) === key) weight = 0;
					else if (memory.recentFigures.at(-1) === key) weight *= .25;
				}
				return { value: candidate, weight };
			}).filter(candidate => candidate.weight > 0);
			if (candidates.length) {
				figure = rng.weighted(candidates); development = undefined; answerFigureId = undefined;
				hits = figure.hits[0].map(hit => ({ ...hit })); transform = 'fallback'; shift = 0; reason = harmonicSupport ? 'harmonic_support' : ensemble.piano.presence === 'reentry' ? 'phrase_reentry' : 'gesture_refit';
			}
		}
		// A foreground bass/drum response still needs harmonic support. Use
		// the native sustained cell with a smaller, quieter voicing, not a
		// competing rhythmic answer. The response owner remains unchanged.
		if (backgroundHarmony && budget > 0 && !ensemble.coordinatedAccent) {
			development = undefined; answerFigureId = undefined;
			figure = figureById(score, 'pad-whole'); hits = figure.hits[0].map(hit => ({ ...hit }));
			transform = 'fallback'; shift = 0; reason = 'harmonic_support';
		}
		if (arrival) {
			development = undefined; answerFigureId = undefined;
			hits = [{ b: 0, d: 0.45 }]; transform = 'fallback'; shift = 0; reason = 'shared_arrival';
		}
		const tags = [...figure.tags.filter((tag) => tag === 'pad'), ...(hits.some((hit) => hit.b === 3.5) ? ['push'] : []), ...(hits.some((hit) => hit.b === 0) ? ['early'] : [])];
		guideTones = !backgroundHarmony && !arrival && hits.length > 0 && rng.chance(0.06);
		realized = style.compPattern({ ...info, barIndex: bar, beatsPerBar: 4, swing: score.swing,
			rng: createRng(seedFrom(score.phraseId, score.tempo, 'comp', bar)), plannedComp: { hits, tags, guideTones, ...(development || score.keyboardVarietyVersion && hasWrittenKeyboardArticulation(figure.id) ? { articulation: 'written' as const } : {}) } });
	} else {
		motif = { startBar: phraseStart, sourceId: null, shift: 0, repeat: false };
		realized = style.compPattern({ ...info, barIndex: bar, beatsPerBar: 4, swing: score.swing,
			rng: createRng(seedFrom(score.phraseId, score.tempo, 'comp', bar)), clavePhase: clavePhaseFor(score.phraseId, score.tempo) });
		hits = realized.map((hit) => ({ b: hit.beatOffset, d: hit.durationBeats }));
		if (budget === 0) { transform = 'space'; reason = 'ensemble_silence'; }
		else reason = 'native_pattern';
	}
	if (development && realized.length) {
		const base = realized[0].velocity;
		realized = realized.map((hit, index) => ({ ...hit,
			velocity: keyboardDevelopmentVelocity(base, index, realized.length, transform) }));
	}
	if (backgroundHarmony) realized = realized.map(hit => ({ ...hit, velocity: Math.max(24, hit.velocity - 12) }));
	if (nativeLatePad && score.style === 'ballad' && coordinatedVoicing && realized.length === 1 &&
		realized[0].beatOffset === 0 && realized[0].durationBeats === 3.6) {
		realized = [{ ...realized[0], beatOffset: 2, durationBeats: 1.8, velocity: realized[0].velocity - 2 }];
		hits = [{ b: 2, d: 1.8 }]; reason = 'native_drum_reply';
	}
	let proposal = !backgroundHarmony && answerContext && coordinatedVoicing && (!score.style || score.style === 'swing' || score.style === 'straight')
		? proposePianoAnswer({ barIndex: bar, info, feedback: answerContext.feedback, previous: answerContext.previous, retainedMotif: !!motif?.sourceId, realized }) : undefined;
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
	const prepare = (hit: CompHitSpec) => {
		const protectedGesture = backgroundHarmony || !!arrival || !!proposal || nativeLatePad || ensemble.responseOwner !== 'nobody' ||
			ensemble.coordinatedAccent || ['active_soloist', 'dense_soloist', 'under_response'].includes(ensemble.piano.rootlessTexture?.reason ?? '');
		const phrasing = score.keyboardPhrasing && !protectedGesture ? score.keyboardPhrasing : undefined;
		const absBeat = bar * 4 + hit.beatOffset;
		const lookup = Math.min(score.totalBars * 4 - 0.001, absBeat + (hit.beatOffset % 1 ? 0.5 : 0));
		const index = score.harmony.findIndex((segment) => lookup >= fractionToFloat(segment.startOffset) * 4 && lookup < fractionToFloat(segment.startOffset) * 4 + fractionToFloat(segment.duration) * 4);
		if (index < 0) return;
		const chord = score.harmony[index].chord;
		const tick = Math.max(bar * 4 * score.ppq, arrival ? timing.arrivalTick(bar) : timing.place(absBeat, 'comp'));
		// The style's articulation jitter and swing happen after the written
		// contrast. Bound the new phrase's release against its next actual tick.
		const nextHit = development || phrasing ? realized.find(candidate => candidate.beatOffset > hit.beatOffset) : undefined;
		const nextLimit = nextHit ? Math.min(barEnd, timing.place(bar * 4 + nextHit.beatOffset, 'comp')) : barEnd;
		const segment = score.harmony[index];
		const harmonyEnd = (fractionToFloat(segment.startOffset) + fractionToFloat(segment.duration)) * 4 * score.ppq;
		const releaseLimit = phrasing ? Math.min(nextLimit, harmonyEnd) : nextLimit;
		const availableBeats = (releaseLimit - tick) / score.ppq;
		const articulation = phrasing && availableBeats > 0 ? articulateKeyboardHit({ style: score.style ?? 'swing', instrument: phrasing.instrument,
			durationBeats: hit.durationBeats, velocity: hit.velocity, availableBeats }) : undefined;
		const duration = articulation ? articulation.durationBeats * 60 / score.tempo
			: Math.min(hit.durationBeats * 60 / score.tempo, (releaseLimit - tick) * 60 / score.tempo / score.ppq);
		if (!Number.isFinite(tick) || tick >= barEnd || !Number.isFinite(duration) || duration <= 0 || absBeat >= score.totalBars * 4) return;
		const contour = contourEnabled ? preparePianoContour(contourContext!, contourMemory) : undefined;
		const family = backgroundHarmony || guideTones ? 'guide' : selectCoordinatedVoicingFamily({ chord, phraseId: score.phraseId, tempo: score.tempo, segmentIndex: index, intensity: info.intensity, voicingBias: style.voicingBias });
		const textureInput: Parameters<typeof planKeyboardTexture>[0] = { quality: chord.quality, family, phraseId: score.phraseId, tempo: score.tempo,
			phraseStartBar: phraseStart, seed: score.bars[phraseStart].pianoPresenceSeed ?? 0, answering: transform === 'answer',
			allowedTexture: ensemble.piano.rootlessTexture?.request ?? 'full' as const };
		const nativeTexture = phrasing && (score.style === 'bossa-nova' || score.style === 'ballad') && !guideTones
			? planNativeKeyboardTexture({ ...textureInput, style: score.style, barIndex: bar }) : undefined;
		const texture = nativeTexture ?? (score.keyboardTextureVersion === 1 && !backgroundHarmony && !guideTones && !arrival && !proposal &&
			ensemble.responseOwner === 'nobody' && !ensemble.coordinatedAccent &&
			!['active_soloist', 'dense_soloist', 'under_response'].includes(ensemble.piano.rootlessTexture?.reason ?? '')
			? planKeyboardTexture({ quality: chord.quality, family, phraseId: score.phraseId, tempo: score.tempo,
				phraseStartBar: phraseStart, seed: score.bars[phraseStart].pianoPresenceSeed ?? 0, answering: transform === 'answer',
				allowedTexture: ensemble.piano.rootlessTexture?.request ?? 'full' }) : undefined);
		const keyboardLine = phrasing && !guideTones ? planKeyboardLine({ style: score.style ?? 'swing', phraseId: score.phraseId, tempo: score.tempo,
			seed: score.bars[phraseStart].pianoPresenceSeed ?? 0, barIndex: bar, phraseStartBar: phraseStart,
			phase: ensemble.performanceEnergy!.phase, attackIndex: events.length, previous: voicingMemory }) : undefined;
		// Native rhythm, selected families and strict motion bounds already make
		// this a rare opportunity. Only the first accepted chord may propose it.
		const contraryMotion = score.keyboardContraryMotionVersion === 1 && phrasing && !guideTones && events.length === 0;
		const resolved = resolveCoordinatedVoicing({ chord, family: texture?.family ?? family,
			registerMidi: guideTones ? 62 : Math.round(58 + 8 * info.intensity), previous: voicingMemory,
			rootlessTexture: texture?.rootlessTexture ?? ensemble.piano.rootlessTexture?.request,
			...(contraryMotion ? { keyboardContraryMotion: true } : {}), ...(keyboardLine ? { keyboardLine } : {}), ...(texture ? { spacing: texture.spacing } : {}), ...(contour ? { targetTopMidi: contour.targetMidi } : {}) });
		const selected = texture || articulation ? { ...resolved, decision: Object.freeze({ ...resolved.decision,
			...(texture ? { keyboardTexture: texture.trace } : {}), ...(articulation ? { keyboardArticulation: Object.freeze({ instrument: phrasing!.instrument,
				profile: articulation.profile, durationSeconds: duration, durationBeats: duration * score.tempo / 60, originalDurationBeats: hit.durationBeats }) } : {}) }) } : resolved;
		if (!selected.notes.length) return;
		return { index, selected, contour, event: { absBeat, time: `${tick}i`, notes: [...selected.notes], duration, velocity: hit.velocity } };
	};
	// Preparation is pure: rejected replies retain the already valid native fallback,
	// and neither candidate can advance the last actually emitted voicing.
	let preparedReply: ReturnType<typeof prepare>;
	if (proposal) {
		const ordinary = prepare(realized[0]);
		preparedReply = ordinary ? prepare({ ...proposal.hit, durationBeats: Math.min(proposal.hit.durationBeats, ordinary.event.duration * score.tempo / 60) }) : undefined;
		if (!preparedReply) proposal = undefined;
	}
	for (const hit of realized) {
		if (coordinatedVoicing) {
			const accepted = preparedReply ?? prepare(hit);
			if (!accepted) continue;
			const { index, selected, event, contour } = accepted;
			events.push(event);
			voicingTrace.push(Object.freeze({ absBeat: event.absBeat, time: event.time, notes: selected.notes, decision: selected.decision, ...(arrival ? { arrivalId: arrival.accentId } : {}) }));
			voicingMemory = selected.memory;
			if (contour) contourMemory = commitPianoContour(contourContext!, contour, selected.notes);
			segmentIndex = index; segmentVoicing = event.notes; lastVoicing = event.notes;
			continue;
		}
		const absBeat = bar * 4 + hit.beatOffset;
		const lookup = Math.min(score.totalBars * 4 - 0.001, absBeat + (hit.beatOffset % 1 ? 0.5 : 0));
		const index = score.harmony.findIndex((segment) => lookup >= fractionToFloat(segment.startOffset) * 4 && lookup < fractionToFloat(segment.startOffset) * 4 + fractionToFloat(segment.duration) * 4);
		if (index < 0) continue;
		const chord = score.harmony[index].chord;
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
	// An atomic two-attack cell: the resolution is already in this accepted bar,
	// never borrowed from a future bar or another player's response allowance.
	// Its final chord/history and both native attack envelopes remain unchanged.
	if (score.keyboardSuspensionsVersion === 1 && events.length === 2 && voicingTrace.length === 2 &&
		!backgroundHarmony && !arrival && !proposal && !nativeLatePad && !guideTones &&
		ensemble.responseOwner === 'nobody' && !ensemble.coordinatedAccent && !info.isSectionFinalBar && !info.isFinalBar &&
		['solo_build', 'solo_peak', 'solo_release'].includes(ensemble.performanceEnergy?.phase ?? '') &&
		!['active_soloist', 'dense_soloist', 'under_response'].includes(ensemble.piano.rootlessTexture?.reason ?? '') &&
		voicingTrace[0].decision.keyboardContraryMotion?.status !== 'changed' &&
		(lastSuspensionBar === undefined || bar - lastSuspensionBar >= 3) &&
		createRng(seedFrom(score.phraseId, score.bars[phraseStart].pianoPresenceSeed ?? 0, bar, 'suspension-cell')).chance(.7)) {
		const [first, second] = events;
		const segmentAt = (event: CompEvent) => score.harmony.findIndex(segment => {
			const lookup = event.absBeat + (event.absBeat % 1 ? .5 : 0);
			return lookup >= fractionToFloat(segment.startOffset) * 4 &&
				lookup < (fractionToFloat(segment.startOffset) + fractionToFloat(segment.duration)) * 4;
		});
		const index = segmentAt(first), segment = score.harmony[index];
		const gap = second.absBeat - first.absBeat;
		if (segment && index === segmentAt(second) && first.absBeat >= fractionToFloat(segment.startOffset) * 4 &&
			gap >= .5 && gap <= 3 && parseFloat(first.time) + first.duration * score.tempo / 60 * score.ppq <= parseFloat(second.time) + 1e-8 &&
			voicingTrace[0].decision.resolvedFamily === voicingTrace[1].decision.resolvedFamily) {
			const cell = proposeKeyboardSuspension({ chord: segment.chord, family: voicingTrace[0].decision.resolvedFamily,
				notes: first.notes, resolutionNotes: second.notes });
			const thirdPc = cell ? cell.toMidi % 12 : -1;
			const onset = parseFloat(first.time), release = onset + first.duration * score.tempo / 60 * score.ppq;
			const bassClash = !bassEvents || bassEvents.some(event => event.midi % 12 === thirdPc &&
				parseFloat(event.time) < release && parseFloat(event.time) + event.duration * score.tempo / 60 * score.ppq > onset);
			const spacing = voicingTrace[0].decision.spacing;
			const span = cell ? cell.suspendedNotes.at(-1)! - cell.suspendedNotes[0] : 0;
			if (cell && !bassClash && !(spacing?.applied === 'open' && span < 14)) {
				lastSuspensionBar = bar;
				events[0] = { ...first, notes: [...cell.suspendedNotes] };
				for (const attack of [0, 1] as const) {
					const voiced = voicingTrace[attack], notes = Object.freeze([...events[attack].notes]);
					// These comparisons were made before decoration, so do not expose
					// them as claims about the performed suspension or its resolution.
					const { keyboardLine: _line, keyboardContraryMotion: _contrary, ...decision } = voiced.decision;
					const previous = attack === 0 ? memory.voicing : { version: 1 as const, chord: segment.chord, notes: cell.suspendedNotes };
					voicingTrace[attack] = Object.freeze({ ...voiced, notes, decision: Object.freeze({ ...decision,
						...describeCoordinatedPlacement(segment.chord, notes, decision.resolvedFamily, Math.round(58 + 8 * info.intensity), previous),
						...(decision.spacing ? { spacing: Object.freeze({ ...decision.spacing, spanSemitones: notes.at(-1)! - notes[0] }) } : {}),
						keyboardSuspension: Object.freeze({ phase: attack === 0 ? 'suspension' as const : 'resolution' as const,
							fromMidi: cell.fromMidi, toMidi: cell.toMidi, suspensionAbsBeat: first.absBeat, resolutionAbsBeat: second.absBeat }) }) });
				}
			}
		}
	}
	const answer: PianoAnswerDecision | undefined = proposal && events.length === 1 ? { version: 1, barIndex: bar, source: proposal.source, attack: events[0], replyOffset: proposal.hit.beatOffset, drumCommentary: 'space' } : undefined;
	if (answer) { hits = [{ b: proposal!.hit.beatOffset, d: events[0].duration * score.tempo / 60 }]; transform = 'fallback'; shift = 0; reason = 'drum_reply'; development = undefined; answerFigureId = undefined; }
	return { events, ...(answer ? { answer } : {}), ...(coordinatedVoicing ? { voicingTrace: Object.freeze(voicingTrace) } : {}),
		memory: { recentFigures: [...memory.recentFigures, reason === 'native_drum_reply' ? 'ballad-drum-reply' : answer ? 'drum-reply' : arrival ? 'shared-arrival' : style.compPlanning ? figure.repeatKey ?? figure.id : `${score.style}:${hits.map((hit) => hit.b).join(',')}`].slice(-3), motif, segmentIndex, segmentVoicing, lastVoicing,
			...(coordinatedVoicing && voicingMemory ? { voicing: voicingMemory } : {}),
			...(score.keyboardSuspensionsVersion === 1 && lastSuspensionBar !== undefined ? { lastSuspensionBar } : {}),
			...(contourEnabled && contourMemory ? { contour: contourMemory } : {}) },
		trace: { version: 1, barIndex: bar, phraseStartBar: phraseStart, motifId: reason !== 'harmonic_support' && reason !== 'phrase_reentry' && reason !== 'gesture_refit' && !answer && !arrival && motif.sourceId ? `motif:${phraseStart}:${motif.sourceId}` : null,
			sourceFigureId: answer || arrival ? null : reason === 'harmonic_support' || reason === 'phrase_reentry' || reason === 'gesture_refit' || score.keyboardVarietyVersion && !motif.sourceId ? figure.id : motif.sourceId, transform, displacementBeats: shift, ...(development && events.length ? { development } : {}), ...(answerFigureId && events.length ? { answerFigureId } : {}), hits: hits.filter((hit) => events.some((event) => event.absBeat === bar * 4 + hit.b)), ...(reason ? { reason } : {}) } };
}
