/** Pure append-only, one-bar realization for the finite coordinated listening lab. */
import type { HarmonicSegment } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import type { PerformanceForm } from '$lib/types/performance-form';
import type { BackingGenerationParams, BarInfo, BassEvent, CompEvent, DrumEvent, EnsembleDevelopment } from './backing-generation';
import { buildBarInfos } from './backing-generation';
import { buildPerformanceForm, performanceBarContext, type PerformanceBarContext } from './performance-form';
import { planPerformanceEnergy } from './performance-energy';
import { planEnsembleWindow, type EnsembleBarContext, type EnsembleMemory, type EnsemblePlan, type SoloFeature } from './ensemble-plan';
import { describeEnsemblePhraseTiming, restoreEnsembleTiming, type EnsemblePhraseTimingTrace } from './ensemble-timing';
import type { BackingStyle } from '$lib/types/instruments';
import type { StyleDefinition } from './backing-styles';
import { fractionToFloat } from '$lib/music/intervals';
import { seedFrom } from './generation-rng';
import { realizeRollingPiano, type RollingPianoMemory } from './backing-rolling-piano';
import { realizeRollingBass, type RollingBassMemory } from './backing-rolling-bass';
import { planDrumPhraseBar, type DrumPhraseMemory } from './backing-drum-phrases';
import type { TimingProfile, TimingRole } from './backing-timing';
import { MAX_ADAPTIVE_BARS, MAX_ADAPTIVE_LOOPS } from './backing-performance-limits';
import { captureDrumStatement, planDrumPianoFeedback, validateDrumPianoFeedback, type DrumPianoFeedbackMemory } from './backing-ensemble-feedback';

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
		return { ...info, ...(style.intensityCap !== undefined ? { intensity: Math.min(info.intensity, style.intensityCap), energyCeiling: style.intensityCap } : {}), ...performanceBarContext(form, barIndex)!, ...(performanceEnergy ? { performanceEnergy: performanceEnergy[barIndex], ...(['swing', 'straight'].includes(style.coordinatedStyle!) ? { pianoArrivalPolicy: 'shared-v1' as const } : {}) } : {}), barIndex, loopIndex: Math.floor(barIndex / sourceBars),
			sourceBarIndex, sourceChorusIndex: sourceContext.chorusIndex, sourceSectionIndex: sourceContext.sectionIndex };
	});
	const timingProfiles = params.timing ?? style.timing;
	// Preserve the one-pass binding. An explicit repeat is a distinct declared
	// performance even when its flattened score matches some other source.
	const serialized = JSON.stringify([1, params.phraseId, params.tempo, params.ppq, params.swing, copied, form, timingProfiles,
		...(performanceEnergy ? [{ performanceEnergyVersion: 1, structuralTextureVersion: 1, coordinatedVoicingVersion: 3, reciprocalFeedbackVersion: 1, ...(['swing', 'straight'].includes(style.coordinatedStyle!) ? { pianoArrivalVersion: 1 } : {}) }] : []),
		...(loopCount > 1 ? [{ sourceBars, loopCount }] : []),
		...(style.coordinatedStyle !== 'swing' ? [{ style: style.coordinatedStyle }] : [])]);
	// The definition retains the complete immutable score once. Repeating its
	// raw JSON in every retained bar would make the export grow quadratically.
	// This deterministic binding detects accidental mismatches; it is not an
	// authentication token for accepting untrusted checkpoints.
	const fingerprint = loopCount > 1
		? `rolling-repeat-v1:${serialized.length}:${seedFrom('score-a', serialized).toString(16)}:${seedFrom('score-b', serialized).toString(16)}`
		: serialized;
	return freeze({ version: 1, ...(style.coordinatedStyle !== 'swing' ? { style: style.coordinatedStyle } : {}), sessionId: `rolling:${seedFrom(fingerprint).toString(16)}`, fingerprint,
		phraseId: params.phraseId, totalBars, sourceBars, loopCount, loops, tempo: params.tempo, ppq: params.ppq, beatsPerBar: 4, swing: params.swing,
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
	if (checkpoint.drums.previousCompIsSharedArrival !== undefined && !score.bars[checkpoint.nextBar - 1]?.pianoArrivalPolicy) invalid();
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
	const window = planEnsembleWindow({ phraseId: definition.phraseId, tempo: definition.tempo, bars: definition.bars,
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
	// Keep shared intentions intact. Only this piano realization receives the
	// optional breath; bass and drums retain their existing native contracts.
	const pianoInfo = feedback?.action === 'yield'
		? { ...info, ensemble: { ...ensemble, piano: { ...ensemble.piano, maxAttacks: feedback.effectiveMaxAttacks } } } : info;
	const piano = realizeRollingPiano(definition, bar, pianoInfo, timing, checkpoint?.piano);
	const bass = realizeRollingBass(definition, bar, info, timing, checkpoint?.bass);
	const startTick = bar * 4 * definition.ppq;
	const endTick = (bar + 1) * 4 * definition.ppq;
	let peakEnd: number | undefined;
	if (ensemble.performanceEnergy?.phase === 'solo_peak') {
		peakEnd = bar + 1;
		while (peakEnd < phraseEnd && definition.bars[peakEnd].performanceEnergy?.phase === 'solo_peak') peakEnd++;
	}
	const drums = planDrumPhraseBar({ style: definition.style, phraseId: definition.phraseId, tempo: definition.tempo, beatsPerBar: 4,
		barIndex: bar, info, phraseStartBar: ensemble.phraseStartBar, phraseEndBarExclusive: phraseEnd, harmonyEndBeat: definition.totalBars * 4,
		...(peakEnd !== undefined ? { peakEndBarExclusive: peakEnd } : {}),
		compOnsets: piano.events.map((event) => event.absBeat - bar * 4), bassOnsets: bass.events.map((event) => event.absBeat - bar * 4),
		acceptsOnset: (absBeat, hit) => (hit.role === 'accent' && absBeat === bar * 4 ? timing.arrivalTick(bar) : timing.place(absBeat, hit.drum)) < endTick
	}, checkpoint?.drums);
	const drumEvents: DrumEvent[] = drums.bar.hits.map((hit) => {
		const absBeat = bar * 4 + hit.beatOffset;
		const tick = hit.role === 'accent' && hit.beatOffset === 0 ? timing.arrivalTick(bar) : timing.place(absBeat, hit.drum);
		return { absBeat, time: `${Math.max(startTick, tick)}i`, drum: hit.drum, velocity: hit.velocity, ...(hit.role ? { role: hit.role } : {}) };
	});
	if (ensemble.coordinatedAccent?.participants.includes('bass')) {
		const downbeat = bass.events.find((event) => event.absBeat === bar * 4);
		if (downbeat) { downbeat.time = `${Math.max(startTick, timing.arrivalTick(bar))}i`; downbeat.velocity = Math.min(110, downbeat.velocity + 5); }
	}
	const contents: Omit<RollingBackingCheckpoint, 'checkpointId'> = { version: 1, sessionId: definition.sessionId, fingerprint: definition.fingerprint,
		nextBar: bar + 1, ensemble: window.memory, piano: piano.memory, bass: bass.memory, drums: drums.memory, timing: timingTrace,
		...(feedback ? { feedback: { version: 1 as const, previousDrumStatement: captureDrumStatement(drums.bar, drumEvents),
			lastYieldBar: feedback.action === 'yield' ? bar : checkpoint?.feedback?.lastYieldBar ?? null } } : {}) };
	const ticks = [...bass.events, ...piano.events, ...drumEvents].map((event) => parseInt(event.time, 10));
	return freeze({ version: 1, sessionId: definition.sessionId, fromBar: bar, toBarExclusive: bar + 1,
		loopIndex: definition.bars[bar].loopIndex, sourceBarIndex: definition.bars[bar].sourceBarIndex,
		sourceChorusIndex: definition.bars[bar].sourceChorusIndex, sourceSectionIndex: definition.bars[bar].sourceSectionIndex,
		startTick, earliestTick: ticks.length ? Math.min(...ticks) : startTick, committedThroughTick: endTick,
		previousCheckpointId: checkpoint?.checkpointId ?? null,
		checkpoint: { ...contents, checkpointId: checkpointId(contents) },
		bassEvents: bass.events, compEvents: piano.events, drumEvents, ensemblePlan: window.plan, ensembleTiming: [timingTrace],
		ensembleDevelopment: { version: 1, pianoMotifs: [piano.trace], bassTurnarounds: bass.trace,
			...(feedback ? { pianoFeedback: [{ ...feedback, acceptedAttacks: piano.events.map(({ time, absBeat, notes }) => ({ time, absBeat, notes: [...notes] })) }] } : {}),
			...(bass.feelTrace ? { bassFeel: [bass.feelTrace] } : {}),
			...(piano.voicingTrace ? { pianoVoicings: piano.voicingTrace } : {}), drumPhrases: [drums.bar] } });
}
