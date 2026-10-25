import { nativeBalladReplyEnabled, captureNativeBalladColor, proposeNativeBalladReply, advanceNativeBalladReplyMemory, validateNativeBalladReply, type NativeBalladReplyMemory } from './backing-ballad-reply';
import { assessTerminalArrangement, realizeTerminalArrangement, terminalBarPlan, terminalPianoTrace, terminalDrumTrace, type TerminalReservation, type TerminalArrangementDecision } from './backing-terminal';
import { BACKING_STYLES } from './backing-styles';
/** Pure append-only, one-bar realization for the finite coordinated listening lab. */
import type { HarmonicSegment } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import type { PerformanceForm } from '$lib/types/performance-form';
import type { BackingGenerationParams, BarInfo, BassEvent, CompEvent, DrumEvent, EnsembleDevelopment, NativeBalladReplyDecision } from './backing-generation';
import { buildBarInfos } from './backing-generation';
import { buildPerformanceForm, performanceBarContext, type PerformanceBarContext } from './performance-form';
import { planPerformanceEnergy } from './performance-energy';
import { planEnsembleWindow, type EnsembleBarContext, type EnsembleMemory, type EnsemblePlan, type SoloFeature } from './ensemble-plan';
import { describeEnsemblePhraseTiming, restoreEnsembleTiming, type EnsemblePhraseTimingTrace } from './ensemble-timing';
import type { BackingStyle } from '$lib/types/instruments';
import type { StyleDefinition } from './backing-styles';
import { fractionToFloat } from '$lib/music/intervals';
import { seedFrom } from './generation-rng';
import { realizeRollingPiano, realizeRollingBalladReply, type RollingPianoMemory } from './backing-rolling-piano';
import { realizeRollingBass, type RollingBassMemory } from './backing-rolling-bass';
import { planDrumPhraseBar, type DrumPhraseMemory } from './backing-drum-phrases';
import type { TimingProfile, TimingRole } from './backing-timing';
import { MAX_ADAPTIVE_BARS, MAX_ADAPTIVE_LOOPS } from './backing-performance-limits';
import { planPianoRecovery, captureReturningDrums, validatePianoRecoveryMemory, type PianoRecoveryMemory } from './backing-piano-recovery';
import { validatePianoContourMemory } from './backing-piano-contour';
import { validatePianoAnswerMemory, type PianoAnswerMemory } from './backing-piano-answer';
import { captureDrumStatement, planDrumPianoFeedback, validateDrumPianoFeedback, type DrumPianoFeedbackMemory } from './backing-ensemble-feedback';
import { pianoPhraseRecallEnabled, validatePianoPhraseRecall } from './backing-piano-motif-memory';

export interface RollingBackingOptions {
	/** Explicit finite repetitions of the source form; never an open-ended loop. */
	readonly loopCount?: number;
}

export interface RollingLoopSpan {
	readonly loopIndex: number;
	readonly startBar: number;
	readonly endBarExclusive: number;
}

/** Source provenance; generation and observation coordinates remain absolute. */
export interface RollingBarIdentity {
	readonly loopIndex: number;
	readonly sourceBarIndex: number;
	readonly sourceChorusIndex: number;
	/** Section occurrence within the source form, distinct from authored sourceSection. */
	readonly sourceSectionIndex: number;
}

export interface RollingBackingDefinition {
	/** Missing on legacy Swing checkpoints. */
	readonly style?: BackingStyle;
	readonly version: 1;
	readonly sessionId: string;
	readonly fingerprint: string;
	readonly phraseId: string;
	readonly totalBars: number;
	readonly sourceBars: number;
	readonly bassScalarContinuation?: true;
	readonly bassApproachHandoff?: true;
	readonly terminalArrangement?: TerminalReservation;
	readonly loopCount: number;
	readonly loops: readonly RollingLoopSpan[];
	readonly tempo: number;
	readonly ppq: number;
	readonly beatsPerBar: 4;
	readonly swing: number;
	readonly performanceForm: PerformanceForm;
	readonly harmony: readonly HarmonicSegment[];
	readonly bars: readonly (EnsembleBarContext & BarInfo & PerformanceBarContext & RollingBarIdentity)[];
	readonly timingProfiles?: Readonly<Record<TimingRole, TimingProfile>>;
}

export interface RollingBackingCheckpoint {
	readonly version: 1;
	readonly checkpointId: string;
	readonly sessionId: string;
	readonly fingerprint: string;
	readonly nextBar: number;
	readonly ensemble: EnsembleMemory;
	readonly piano: RollingPianoMemory;
	readonly bass: RollingBassMemory;
	readonly drums: DrumPhraseMemory;
	readonly timing: EnsemblePhraseTimingTrace;
	/** Actual preceding drum evidence; absent for metadata-free legacy playback. */
	readonly feedback?: DrumPianoFeedbackMemory;
	readonly pianoAnswer?: PianoAnswerMemory;
	readonly pianoRecovery?: PianoRecoveryMemory;
	readonly nativeBalladReply?: NativeBalladReplyMemory;
}

export interface RollingBackingBar extends RollingBarIdentity {
	readonly version: 1;
	readonly sessionId: string;
	readonly fromBar: number;
	readonly toBarExclusive: number;
	readonly startTick: number;
	readonly earliestTick: number;
	readonly committedThroughTick: number;
	readonly previousCheckpointId: string | null;
	readonly checkpoint: RollingBackingCheckpoint;
	readonly bassEvents: readonly BassEvent[];
	readonly compEvents: readonly CompEvent[];
	readonly drumEvents: readonly DrumEvent[];
	readonly ensemblePlan: EnsemblePlan;
	readonly ensembleTiming: readonly EnsemblePhraseTimingTrace[];
	readonly ensembleDevelopment: EnsembleDevelopment;
}

function freeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

/** Prepare known score/form data only; no future accompaniment is generated. */
export function createRollingBacking(harmony: HarmonicSegment[], style: StyleDefinition, params: BackingGenerationParams,
	options: RollingBackingOptions = {}): RollingBackingDefinition {
	if (!style.coordinatedStyle || params.beatsPerBar !== 4 || !params.ensemble) throw new Error('Rolling backing requires a supported coordinated style in 4/4');
	if (!Number.isFinite(params.tempo) || params.tempo < 30 || params.tempo > 320 || !Number.isSafeInteger(params.ppq) || params.ppq <= 0 || !Number.isFinite(params.swing) || params.swing < 0.5 || params.swing > 0.8) throw new Error('Invalid rolling backing tempo, PPQ or swing');
	if (style.swingModel === 'fixed') params = { ...params, swing: style.defaultSwing };
	const loopCount = options.loopCount ?? 1;
	if (!Number.isInteger(loopCount) || loopCount < 1 || loopCount > MAX_ADAPTIVE_LOOPS) throw new Error(`Rolling loop count must be 1–${MAX_ADAPTIVE_LOOPS}`);
	let copied: HarmonicSegment[] = JSON.parse(JSON.stringify(harmony));
	let end = 0;
	for (const segment of copied) {
		const start = fractionToFloat(segment.startOffset) * 4;
		const length = fractionToFloat(segment.duration) * 4;
		if (start !== end || !Number.isInteger(length) || length <= 0) throw new Error('Rolling harmony must cover complete contiguous quarter beats');
		end += length;
	}
	const sourceBars = end / 4;
	if (!Number.isInteger(sourceBars) || sourceBars < 1 || sourceBars > 128) throw new Error('Rolling source requires 1–128 complete bars');
	const totalBars = sourceBars * loopCount;
	if (totalBars > MAX_ADAPTIVE_BARS) throw new Error(`Rolling performance exceeds the ${MAX_ADAPTIVE_BARS}-bar limit`);
	let form: PerformanceForm = params.performanceForm ? JSON.parse(JSON.stringify(params.performanceForm)) : buildPerformanceForm({ totalBars: sourceBars,
		sectionMap: params.sectionMap ?? [], choruses: [{ role: 'solo', startBar: 0, endBarExclusive: sourceBars }] });
	if (form.totalBars !== sourceBars) throw new Error('Rolling performance form must match complete harmony');
	if (form.version !== 1 || !form.choruses.length || !form.sections.length) throw new Error('Invalid rolling performance form');
	for (const spans of [form.choruses, form.sections]) {
		let next = 0;
		for (const [index, span] of spans.entries()) {
			if (span.index !== index || span.startBar !== next || !Number.isInteger(span.endBarExclusive) || span.endBarExclusive <= next || span.endBarExclusive > sourceBars) throw new Error('Rolling performance form must cover complete contiguous bars');
			next = span.endBarExclusive;
		}
		if (next !== sourceBars) throw new Error('Rolling performance form must cover complete contiguous bars');
	}
	const sourceForm = form;
	const terminalAssessment = params.terminalArrangement?.ending === 'hold-release' ? assessTerminalArrangement(harmony, style, params, { loopCount }) : undefined;
	const terminalArrangement = terminalAssessment?.available ? terminalAssessment.reservation : undefined;
	const loops = Array.from({ length: loopCount }, (_, loopIndex) => ({ loopIndex, startBar: loopIndex * sourceBars, endBarExclusive: (loopIndex + 1) * sourceBars }));
	if (loopCount > 1) {
		// Repeat declared score data only. Instrument decisions remain causal
		// one-bar steps on the single absolute performance timeline.
		copied = loops.flatMap(({ startBar }) => copied.map((segment) => ({ ...segment,
			startOffset: [segment.startOffset[0] + startBar * segment.startOffset[1], segment.startOffset[1]] as [number, number] })));
		const occurrences = new Map<number | null, number>();
		for (const section of sourceForm.sections) occurrences.set(section.sourceSection, (occurrences.get(section.sourceSection) ?? 0) + 1);
		form = { version: 1, totalBars,
			choruses: loops.flatMap(({ loopIndex, startBar }) => sourceForm.choruses.map((chorus) => ({ ...chorus,
				index: loopIndex * sourceForm.choruses.length + chorus.index, startBar: startBar + chorus.startBar, endBarExclusive: startBar + chorus.endBarExclusive }))),
			sections: loops.flatMap(({ loopIndex, startBar }) => sourceForm.sections.map((section) => ({ ...section,
				index: loopIndex * sourceForm.sections.length + section.index,
				chorusIndex: loopIndex * sourceForm.choruses.length + section.chorusIndex,
				occurrenceIndex: section.occurrenceIndex + loopIndex * occurrences.get(section.sourceSection)!,
				startBar: startBar + section.startBar, endBarExclusive: startBar + section.endBarExclusive }))) };
	}
	const performanceEnergy = params.performanceForm ? planPerformanceEnergy(form) : undefined;
	const bars = buildBarInfos(totalBars, undefined, form).map((info, barIndex) => {
		const sourceBarIndex = barIndex % sourceBars;
		const sourceContext = performanceBarContext(sourceForm, sourceBarIndex)!;
		return { ...info, ...(terminalArrangement?.barIndex === barIndex ? { terminalArrangement } : {}), ...(style.intensityCap !== undefined ? { intensity: Math.min(info.intensity, style.intensityCap), energyCeiling: style.intensityCap } : {}), ...performanceBarContext(form, barIndex)!, ...(performanceEnergy ? { performanceEnergy: performanceEnergy[barIndex], ...(['swing', 'straight'].includes(style.coordinatedStyle!) ? { pianoArrivalPolicy: 'shared-v1' as const } : {}) } : {}), barIndex, loopIndex: Math.floor(barIndex / sourceBars),
			sourceBarIndex, sourceChorusIndex: sourceContext.chorusIndex, sourceSectionIndex: sourceContext.sectionIndex };
	});
	const timingProfiles = params.timing ?? style.timing;
	// Preserve the one-pass binding. An explicit repeat is a distinct declared
	// performance even when its flattened score matches some other source.
	const serialized = JSON.stringify([1, params.phraseId, params.tempo, params.ppq, params.swing, copied, form, timingProfiles,
		...(performanceEnergy ? [{ performanceEnergyVersion: 1, structuralTextureVersion: 1, coordinatedVoicingVersion: 4, reciprocalFeedbackVersion: 1, ...(['swing', 'straight'].includes(style.coordinatedStyle!) ? { pianoArrivalVersion: 1, bassScalarContinuationVersion: 1, bassApproachHandoffVersion: 1, pianoAnswerVersion: 1, pianoContourVersion: 1, pianoRecoveryVersion: 1, pianoPhraseRecallVersion: 1 } : style.coordinatedStyle === 'bossa-nova' ? { pianoContourVersion: 1 } : style.coordinatedStyle === 'ballad' ? { nativeBalladReplyVersion: 1 } : {}) }] : []),
		...(loopCount > 1 ? [{ sourceBars, loopCount }] : []),
		...(terminalArrangement ? [{ terminalArrangementVersion: 1, terminalArrangement }] : []),
		...(style.coordinatedStyle !== 'swing' ? [{ style: style.coordinatedStyle }] : [])]);
	// The definition retains the complete immutable score once. Repeating its
	// raw JSON in every retained bar would make the export grow quadratically.
	// This deterministic binding detects accidental mismatches; it is not an
	// authentication token for accepting untrusted checkpoints.
	const fingerprint = loopCount > 1
		? `rolling-repeat-v1:${serialized.length}:${seedFrom('score-a', serialized).toString(16)}:${seedFrom('score-b', serialized).toString(16)}`
		: serialized;
	return freeze({ version: 1, ...(performanceEnergy && ['swing', 'straight'].includes(style.coordinatedStyle!) ? { bassScalarContinuation: true as const, bassApproachHandoff: true as const } : {}), ...(style.coordinatedStyle !== 'swing' ? { style: style.coordinatedStyle } : {}), sessionId: `rolling:${seedFrom(fingerprint).toString(16)}`, fingerprint,
		phraseId: params.phraseId, totalBars, sourceBars, loopCount, loops, ...(terminalArrangement ? { terminalArrangement } : {}), tempo: params.tempo, ppq: params.ppq, beatsPerBar: 4, swing: params.swing,
		performanceForm: form, harmony: copied, bars,
		...(timingProfiles ? { timingProfiles: JSON.parse(JSON.stringify(timingProfiles)) } : {}) });
}

function checkpointId(checkpoint: Omit<RollingBackingCheckpoint, 'checkpointId'>): string {
	return `${checkpoint.sessionId}:${checkpoint.nextBar}:${seedFrom(JSON.stringify(checkpoint)).toString(16)}`;
}

function validateCheckpoint(score: RollingBackingDefinition, checkpoint: RollingBackingCheckpoint): void {
	const invalid = () => { throw new Error('Invalid rolling checkpoint'); };
	if (!checkpoint || checkpoint.version !== 1 || checkpoint.fingerprint !== score.fingerprint || checkpoint.sessionId !== score.sessionId ||
		!Number.isSafeInteger(checkpoint.nextBar) || checkpoint.nextBar < 1 || checkpoint.nextBar > score.totalBars ||
		checkpoint.nextBar !== checkpoint.ensemble?.nextBar || checkpoint.nextBar !== checkpoint.drums?.nextBar || !checkpoint.piano || !checkpoint.bass || !checkpoint.timing) invalid();
	const { checkpointId: identity, ...contents } = checkpoint;
	if (identity !== checkpointId(contents)) invalid();
	const numeric = (value: unknown): boolean => value === null || typeof value === 'number' && Number.isFinite(value);
	if (![checkpoint.bass.previousMidi, checkpoint.bass.previousPreviousMidi, checkpoint.bass.segmentAnchor, checkpoint.bass.nextTarget].every((value) =>
		value === null || Number.isInteger(value) && value >= 28 && value <= 55) || ![-1, 0, 1].includes(checkpoint.bass.direction)) invalid();
	if (checkpoint.piano.recentFigures.length > 3 || checkpoint.piano.segmentVoicing.length > 12 || checkpoint.piano.lastVoicing.length > 12 ||
		![...checkpoint.piano.segmentVoicing, ...checkpoint.piano.lastVoicing].every((value) => Number.isInteger(value) && value >= 0 && value <= 127) ||
		!numeric(checkpoint.piano.segmentIndex)) invalid();
	const nativeTerminal = ((score.style === 'ballad' && score.terminalArrangement?.profile === 'ballad-v1') ||
		(score.style === 'bossa-nova' && score.terminalArrangement?.profile === 'bossa-v1')) &&
		checkpoint.nextBar === score.totalBars && score.terminalArrangement.barIndex === checkpoint.nextBar - 1 &&
		checkpoint.piano.recentFigures.at(-1) === 'terminal-arrangement' && checkpoint.piano.motif === null;
	if (checkpoint.drums.previousCompIsSharedArrival !== undefined && !score.bars[checkpoint.nextBar - 1]?.pianoArrivalPolicy && !nativeTerminal) invalid();
	if (nativeTerminal && (checkpoint.drums.previousCompIsSharedArrival !== true || checkpoint.drums.previousCompIsDrumReply !== undefined ||
		checkpoint.drums.previousCompOnsets.length !== 1 || checkpoint.drums.previousCompOnsets[0] !== 0 ||
		checkpoint.piano.lastVoicing.length < 2 || checkpoint.bass.previousMidi === null ||
		checkpoint.bass.previousMidi % 12 !== PITCH_CLASSES.indexOf(score.terminalArrangement!.chord.root) ||
		checkpoint.bass.nextTarget !== null || checkpoint.bass.pendingLaunch !== null)) invalid();
	if (nativeBalladReplyEnabled(score)) validateNativeBalladReply(checkpoint.nativeBalladReply, score, checkpoint.nextBar,
		checkpoint.piano.recentFigures, checkpoint.drums.previousCompOnsets);
	else if (checkpoint.nativeBalladReply !== undefined) invalid();
	const answerPolicy = !!score.bars[0]?.performanceEnergy && (!score.style || score.style === 'swing' || score.style === 'straight');
	if (pianoPhraseRecallEnabled(score)) validatePianoPhraseRecall(checkpoint.piano.phraseRecall, score, checkpoint.nextBar, checkpoint.piano.motif);
	else if (checkpoint.piano.phraseRecall !== undefined) invalid();
	if (answerPolicy) validatePianoAnswerMemory(checkpoint.pianoAnswer, checkpoint.nextBar);
	else if (checkpoint.pianoAnswer !== undefined || checkpoint.drums.previousCompIsDrumReply !== undefined) invalid();
	if (checkpoint.drums.previousCompIsDrumReply !== undefined && (checkpoint.drums.previousCompIsDrumReply !== true ||
		checkpoint.pianoAnswer?.lastAnswerBar !== checkpoint.nextBar - 1 || checkpoint.drums.previousCompOnsets.length !== 1 ||
		checkpoint.drums.previousCompOnsets[0] < 1 || checkpoint.drums.previousCompOnsets[0] >= 3.5 || !Number.isInteger(checkpoint.drums.previousCompOnsets[0] * 2) || checkpoint.drums.previousCompIsSharedArrival)) invalid();
	if (checkpoint.pianoAnswer?.lastAnswerBar === checkpoint.nextBar - 1 && checkpoint.drums.previousCompIsDrumReply !== true) invalid();
	if (answerPolicy) validatePianoRecoveryMemory(checkpoint.pianoRecovery, { nextBar: checkpoint.nextBar, ppq: score.ppq, tempo: score.tempo,
		lastAnswerBar: checkpoint.pianoAnswer!.lastAnswerBar, replyMarked: checkpoint.drums.previousCompIsDrumReply === true,
		previousCompOnsets: checkpoint.drums.previousCompOnsets, lastVoicing: checkpoint.piano.lastVoicing });
	else if (checkpoint.pianoRecovery !== undefined) invalid();
	const contour = checkpoint.piano.contour;
	const contourPolicy = !!score.bars[0]?.performanceEnergy && (!score.style || ['swing', 'straight', 'bossa-nova'].includes(score.style));
	if (contourPolicy && checkpoint.piano.lastVoicing.length > 0) {
		validatePianoContourMemory(contour!, checkpoint.nextBar, checkpoint.piano.lastVoicing);
		const lastBar = score.bars[contour!.lastBarIndex];
		if (lastBar.chorusIndex !== contour!.chorusIndex || contour!.lastBarIndex - lastBar.phrase4.barIndex !== contour!.phraseStartBar) invalid();
	} else if (contour !== undefined) invalid();
	const scalar = checkpoint.bass.scalarHistory;
	if (scalar !== undefined && (!score.bassScalarContinuation || !scalar || typeof scalar.ornamentAfterPulse !== 'boolean' ||
		!scalar.pulse || !Number.isInteger(scalar.pulse.absBeat) || Math.floor(scalar.pulse.absBeat / 4) !== checkpoint.nextBar - 1 ||
		!Number.isInteger(scalar.pulse.midi) || scalar.pulse.midi < 28 || scalar.pulse.midi > 55 ||
		typeof scalar.pulse.time !== 'string' || !/^\d+i$/.test(scalar.pulse.time) || parseInt(scalar.pulse.time) < (checkpoint.nextBar - 1) * 4 * score.ppq ||
		parseInt(scalar.pulse.time) >= checkpoint.nextBar * 4 * score.ppq || scalar.pulse.midi !== checkpoint.bass.previousMidi)) invalid();
	const voicing = checkpoint.piano.voicing;
	const coordinatedVoicing = score.bars[0]?.performanceEnergy !== undefined;
	if (coordinatedVoicing) validateDrumPianoFeedback(checkpoint.feedback!, checkpoint.nextBar, score.ppq);
	else if (checkpoint.feedback !== undefined) invalid();
	if (coordinatedVoicing && checkpoint.piano.lastVoicing.length > 0 && !voicing) invalid();
	if (voicing) {
		const index = checkpoint.piano.segmentIndex;
		const chord = index !== null && Number.isInteger(index) && index >= 0 ? score.harmony[index]?.chord : undefined;
		if (!coordinatedVoicing || voicing.version !== 1 || !voicing.chord || !PITCH_CLASSES.includes(voicing.chord.root) ||
			!Object.hasOwn(CHORD_DEFINITIONS, voicing.chord.quality) || !Array.isArray(voicing.notes) || voicing.notes.length < 2 || voicing.notes.length > 8 ||
			voicing.notes.some((note, i) => !Number.isInteger(note) || note < 48 || note > 84 || (i > 0 && voicing.notes[i - 1] >= note)) ||
			voicing.notes.length !== checkpoint.piano.lastVoicing.length || voicing.notes.some((note, i) => note !== checkpoint.piano.lastVoicing[i]) ||
			!chord || chord.root !== voicing.chord.root || chord.quality !== voicing.chord.quality) invalid();
	}
}

/** Commit exactly one new bar. Past events are never regenerated or modified. */
export function advanceRollingBacking(definition: RollingBackingDefinition, checkpoint?: RollingBackingCheckpoint, soloFeatures: readonly SoloFeature[] = []): RollingBackingBar {
	if (checkpoint) {
		validateCheckpoint(definition, checkpoint);
		// A caller may keep editing its restored JSON. The returned frozen
		// transaction owns every nested object, including latched motifs/timing.
		checkpoint = JSON.parse(JSON.stringify(checkpoint));
	}
	const bar = checkpoint?.nextBar ?? 0;
	if (bar >= definition.totalBars) throw new Error('Rolling performance is complete');
	const latest = soloFeatures.filter((feature) => Number.isSafeInteger(feature.barIndex) && feature.barIndex >= 0 && feature.barIndex <= bar &&
		Number.isSafeInteger(feature.observedAtBar) && feature.observedAtBar >= 0 && feature.observedAtBar <= feature.barIndex)
		.reduce<SoloFeature | undefined>((latest, feature) => !latest || feature.barIndex > latest.barIndex ||
			(feature.barIndex === latest.barIndex && feature.observedAtBar >= latest.observedAtBar) ? feature : latest, undefined);
	let window = planEnsembleWindow({ phraseId: definition.phraseId, tempo: definition.tempo, bars: definition.bars,
		startBar: bar, endBarExclusive: bar + 1, memory: checkpoint?.ensemble,
		soloFeatures: latest ? [{ ...latest, barIndex: bar }] : [] });
	const ensemble = window.plan.bars[0];
	const info = { ...definition.bars[bar], ensemble, intensity: ensemble.energy };
	const phraseEnd = ensemble.phraseStartBar + definition.bars[bar].phrase4!.lengthBars;
	const timingTrace = checkpoint?.timing.phraseStartBar === ensemble.phraseStartBar ? checkpoint.timing : describeEnsemblePhraseTiming({
		phraseId: definition.phraseId, tempo: definition.tempo, ppq: definition.ppq, swing: definition.swing,
		phraseStartBar: ensemble.phraseStartBar, endBarExclusive: phraseEnd, intent: ensemble.phraseIntent,
		boundaryStrength: definition.bars[phraseEnd - 1].boundaryStrength ?? 0, timingProfiles: definition.timingProfiles });
	const timing = restoreEnsembleTiming({ phraseId: definition.phraseId, tempo: definition.tempo, ppq: definition.ppq, swing: definition.swing,
		trace: [timingTrace], timingProfiles: definition.timingProfiles });
	const feedback = ensemble.performanceEnergy ? planDrumPianoFeedback({ phraseId: definition.phraseId,
		tempo: definition.tempo, barIndex: bar, info, previous: checkpoint?.feedback }) : undefined;
	// Keep shared intentions intact. The piano receives the optional breath;
	// only an accepted reply can reserve local drummer commentary space below.
	const pianoInfo = feedback?.action === 'yield'
		? { ...info, ensemble: { ...ensemble, piano: { ...ensemble.piano, maxAttacks: feedback.effectiveMaxAttacks } } } : info;
	const answerPolicy = !!feedback && (!definition.style || definition.style === 'swing' || definition.style === 'straight');
	let piano = realizeRollingPiano(definition, bar, pianoInfo, timing, checkpoint?.piano,
		answerPolicy ? { feedback: feedback!, previous: checkpoint?.pianoAnswer } : undefined, window.plan.trace[0].soloEvidence);
	let bass = realizeRollingBass(definition, bar, info, timing, checkpoint?.bass);
	const startTick = bar * 4 * definition.ppq;
	const endTick = (bar + 1) * 4 * definition.ppq;
	let peakEnd: number | undefined;
	if (ensemble.performanceEnergy?.phase === 'solo_peak') {
		peakEnd = bar + 1;
		while (peakEnd < phraseEnd && definition.bars[peakEnd].performanceEnergy?.phase === 'solo_peak') peakEnd++;
	}
	const realizeDrums = (pianoResult: typeof piano) => planDrumPhraseBar({
		...(nativeBalladReplyEnabled(definition) && checkpoint?.nativeBalladReply?.lastReplyBar === bar - 1 ? { suppressPreviousPianoAnswer: true as const } : {}), style: definition.style, phraseId: definition.phraseId, tempo: definition.tempo, beatsPerBar: 4,
		barIndex: bar, info: pianoResult.answer ? { ...info, ensemble: { ...ensemble, drums: { ...ensemble.drums, maxCommentaryHits: 0 as const } } } : info, ...(pianoResult.answer ? { compIsDrumReply: true as const } : {}), phraseStartBar: ensemble.phraseStartBar, phraseEndBarExclusive: phraseEnd, harmonyEndBeat: definition.totalBars * 4,
		...(peakEnd !== undefined ? { peakEndBarExclusive: peakEnd } : {}),
		compOnsets: pianoResult.events.map((event) => event.absBeat - bar * 4), bassOnsets: bass.events.map((event) => event.absBeat - bar * 4),
		acceptsOnset: (absBeat, hit) => (hit.role === 'accent' && absBeat === bar * 4 ? timing.arrivalTick(bar) : timing.place(absBeat, hit.drum)) < endTick
	}, checkpoint?.drums);
	const scheduleDrums = (result: ReturnType<typeof realizeDrums>): DrumEvent[] => result.bar.hits.map((hit) => {
		const absBeat = bar * 4 + hit.beatOffset;
		const tick = hit.role === 'accent' && hit.beatOffset === 0 ? timing.arrivalTick(bar) : timing.place(absBeat, hit.drum);
		return { absBeat, time: `${Math.max(startTick, tick)}i`, drum: hit.drum, velocity: hit.velocity, ...(hit.role ? { role: hit.role } : {}) };
	});
	let drums = realizeDrums(piano);
	let drumEvents = scheduleDrums(drums);
	let nativeReply: NativeBalladReplyDecision | undefined;
	if (nativeBalladReplyEnabled(definition)) {
		const source = proposeNativeBalladReply({ score: definition, bar, info: pianoInfo, evidence: window.plan.trace[0].soloEvidence,
			previous: checkpoint?.nativeBalladReply, trace: piano.trace, events: piano.events, drumTrace: drums.bar, drumEvents });
		if (source) {
			const candidate = realizeRollingBalladReply(definition, bar, pianoInfo, timing, checkpoint?.piano);
			const event = candidate.events[0];
			if (candidate.trace.reason === 'native_drum_reply' && candidate.events.length === 1 && event.absBeat === bar * 4 + 2 &&
				parseInt(event.time) > parseInt(source.hit.time) && event.velocity === piano.events[0].velocity - 2 &&
				event.duration > 0 && event.duration <= 1.8 * 60 / definition.tempo + 1e-9) {
				const candidateDrums = realizeDrums(candidate), candidateEvents = scheduleDrums(candidateDrums);
				if (JSON.stringify(candidateEvents) === JSON.stringify(drumEvents) && !candidateDrums.bar.commentary.hits.length) {
					piano = candidate; drums = candidateDrums; drumEvents = candidateEvents;
					nativeReply = { version: 1, profile: 'ballad-late-pad-v1', barIndex: bar, source,
						attack: { ...event, notes: [...event.notes] }, drumCommentary: 'space' };
				}
			}
		}
	}
	let recovery = answerPolicy ? planPianoRecovery({ barIndex: bar, info, currentMaxAttacks: pianoInfo.ensemble!.piano.maxAttacks,
		previous: checkpoint?.pianoRecovery, ordinaryAttacks: piano.events,
		returningDrums: captureReturningDrums(drums.bar, drumEvents, checkpoint?.drums.phrase.motif) }) : undefined;
	if (recovery?.action === 'space') {
		// Both passes start from the original checkpoint. No speculative piano,
		// contour or drum motif state can leak into the committed result.
		const recoveredPiano = realizeRollingPiano(definition, bar,
			{ ...pianoInfo, ensemble: { ...pianoInfo.ensemble!, piano: { ...pianoInfo.ensemble!.piano, maxAttacks: 0 } } }, timing, checkpoint?.piano, undefined, window.plan.trace[0].soloEvidence);
		const recoveredDrums = realizeDrums(recoveredPiano);
		const recoveredEvents = scheduleDrums(recoveredDrums);
		const returningDrums = captureReturningDrums(recoveredDrums.bar, recoveredEvents, checkpoint?.drums.phrase.motif);
		if (!recoveredPiano.events.length && returningDrums && JSON.stringify(recoveredEvents) === JSON.stringify(drumEvents)) {
			piano = recoveredPiano; drums = recoveredDrums; drumEvents = recoveredEvents;
			recovery = { ...recovery, returningDrums };
		} else recovery = { ...recovery, action: 'none', reason: 'no_drum_return', effectiveMaxAttacks: pianoInfo.ensemble!.piano.maxAttacks };
	}
	if (ensemble.coordinatedAccent?.participants.includes('bass')) {
		const downbeat = bass.events.find((event) => event.absBeat === bar * 4);
		if (downbeat) { downbeat.time = `${Math.max(startTick, timing.arrivalTick(bar))}i`; downbeat.velocity = Math.min(110, downbeat.velocity + 5); }
	}
	let terminalDecision: TerminalArrangementDecision | undefined;
	const reservation = definition.terminalArrangement?.barIndex === bar ? definition.terminalArrangement : undefined;
	if (reservation) {
		const candidate = realizeTerminalArrangement({ reservation, plan: ensemble, style: BACKING_STYLES[definition.style ?? 'swing'],
			phraseId: definition.phraseId, tempo: definition.tempo, ppq: definition.ppq, segmentIndex: definition.harmony.length - 1,
			previousBass: checkpoint?.bass.previousMidi, previousVoicing: checkpoint?.piano.voicing, previousContour: checkpoint?.piano.contour,
			...(reservation.profile !== undefined ? { ordinaryBass: bass.events, ordinaryDrums: drumEvents } : {}),
			committedLaunch: !!checkpoint?.bass.pendingLaunch });
		terminalDecision = candidate.decision;
		if (candidate.decision.status === 'accepted' && candidate.voicing && (reservation.profile === 'ballad-v1' || candidate.contour) && candidate.voicingTrace) {
			const accepted = candidate.decision;
			const plan = terminalBarPlan(ensemble);
			window = { plan: { ...window.plan, bars: [plan], trace: window.plan.trace.map(entry => ({ ...entry, reasons: [...entry.reasons, 'terminal_arrangement'] })) },
				memory: { ...window.memory, recentBars: window.memory.recentBars.map(entry => entry.barIndex === bar ? { ...entry, pianoAttackBudget: 1, drumCommentaryBudget: 0 } : entry) } };
			piano = { events: [{ ...accepted.piano, notes: [...accepted.piano.notes] }], trace: terminalPianoTrace(plan, reservation), voicingTrace: [candidate.voicingTrace],
				memory: { recentFigures: [...(checkpoint?.piano.recentFigures ?? []), 'terminal-arrangement'].slice(-3), motif: null,
					segmentIndex: definition.harmony.length - 1, segmentVoicing: [...accepted.piano.notes], lastVoicing: [...accepted.piano.notes],
					voicing: candidate.voicing, ...(candidate.contour ? { contour: candidate.contour } : {}),
					...(pianoPhraseRecallEnabled(definition) ? { phraseRecall: { version: 1 as const, source: null, recalledAt: null } } : {}) } };
			const previousMidi = checkpoint?.bass.previousMidi ?? null;
			bass = { events: [{ ...accepted.bass }], trace: [], memory: {
				previousMidi: accepted.bass.midi, previousPreviousMidi: previousMidi,
				direction: previousMidi === null ? 0 : Math.sign(accepted.bass.midi - previousMidi), segmentIndex: definition.harmony.length - 1,
				segmentAnchor: accepted.bass.midi, nextTarget: null, approach: checkpoint?.bass.approach ?? 'chromatic-below', feel: 'two', pendingLaunch: null,
				...(definition.bassScalarContinuation ? { scalarHistory: { pulse: { absBeat: accepted.bass.absBeat, midi: accepted.bass.midi, time: accepted.bass.time }, ornamentAfterPulse: false } } : {}) } };
			const { motif: _motif, ...drumPhrase } = drums.memory.phrase;
			const { previousCompIsDrumReply: _reply, previousCompIsSharedArrival: _arrival, ...drumMemory } = drums.memory;
			drums = { bar: terminalDrumTrace(drums.bar, accepted, reservation.profile), memory: { ...drumMemory,
				phrase: { ...drumPhrase, commentarySelected: false }, previousCompOnsets: [0], previousCompIsSharedArrival: true } };
			drumEvents = accepted.drums.map(event => ({ ...event }));
			recovery = undefined;
		}
	}
	const terminalAccepted = terminalDecision?.status === 'accepted';
	const contents: Omit<RollingBackingCheckpoint, 'checkpointId'> = { version: 1, sessionId: definition.sessionId, fingerprint: definition.fingerprint,
		nextBar: bar + 1, ...(nativeBalladReplyEnabled(definition) ? { nativeBalladReply: advanceNativeBalladReplyMemory(definition, bar,
			checkpoint?.nativeBalladReply, terminalAccepted ? null : captureNativeBalladColor(info, drums.bar, drumEvents), !!nativeReply) } : {}), ...(answerPolicy ? { pianoRecovery: { version: 1 as const, previousAnswer: piano.answer ? { barIndex: bar, attack: { ...piano.answer.attack, notes: [...piano.answer.attack.notes] } } : null }, pianoAnswer: { version: 1 as const, lastAnswerBar: piano.answer ? bar : checkpoint?.pianoAnswer?.lastAnswerBar ?? null } } : {}), ensemble: window.memory, piano: piano.memory, bass: bass.memory, drums: drums.memory, timing: timingTrace,
		...(feedback ? { feedback: { version: 1 as const, previousDrumStatement: captureDrumStatement(drums.bar, drumEvents),
			lastYieldBar: !terminalAccepted && feedback.action === 'yield' ? bar : checkpoint?.feedback?.lastYieldBar ?? null } } : {}) };
	const ticks = [...bass.events, ...piano.events, ...drumEvents].map((event) => parseInt(event.time, 10));
	return freeze({ version: 1, sessionId: definition.sessionId, fromBar: bar, toBarExclusive: bar + 1,
		loopIndex: definition.bars[bar].loopIndex, sourceBarIndex: definition.bars[bar].sourceBarIndex,
		sourceChorusIndex: definition.bars[bar].sourceChorusIndex, sourceSectionIndex: definition.bars[bar].sourceSectionIndex,
		startTick, earliestTick: ticks.length ? Math.min(...ticks) : startTick, committedThroughTick: endTick,
		previousCheckpointId: checkpoint?.checkpointId ?? null,
		checkpoint: { ...contents, checkpointId: checkpointId(contents) },
		bassEvents: bass.events, compEvents: piano.events, drumEvents, ensemblePlan: window.plan, ensembleTiming: [timingTrace],
		ensembleDevelopment: { version: 1, ...(nativeReply ? { nativeBalladReplies: [nativeReply] } : {}), ...(terminalDecision ? { terminalArrangements: [terminalDecision] } : {}), ...(recovery ? { pianoRecoveries: [{ ...recovery, acceptedAttacks: piano.events.map(event => ({ ...event, notes: [...event.notes] })) }] } : {}), ...(piano.answer ? { pianoAnswers: [piano.answer] } : {}), pianoMotifs: [piano.trace], bassTurnarounds: bass.trace,
			...(feedback && !terminalAccepted ? { pianoFeedback: [{ ...feedback, acceptedAttacks: piano.events.map(({ time, absBeat, notes }) => ({ time, absBeat, notes: [...notes] })) }] } : {}),
			...(bass.feelTrace ? { bassFeel: [bass.feelTrace] } : {}),
			...(bass.continuationTrace?.length ? { bassContinuations: bass.continuationTrace } : {}),
			...(piano.voicingTrace ? { pianoVoicings: piano.voicingTrace } : {}), drumPhrases: [drums.bar] } });
}
