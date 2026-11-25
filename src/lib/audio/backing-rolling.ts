import { finishNativeBassAnswer } from './backing-native-melodic-handoff';
import { bassCall, finishKeyboardAnswer, validBassCalls } from './backing-keyboard-melodic-handoff';
import { fitBassAnswer, rememberKeyboard, validMelodicMemory, type MelodicMemory } from './backing-melodic-handoff';
import { sustainAcrossBar, commonToneAtBoundary } from './backing-keyboard-sustain';
import { keyboardFigures } from './backing-keyboard-vocabulary';
import { musicalSentence } from './backing-sentences';
import { liftFootHat } from './backing-inner-motion';
import { snareKickDialogue } from './backing-phrase-dialogue';
import { crossStickUnderChord } from './backing-ensemble-colors';
import { allowsTrioConversation } from './backing-trio-conversation';
import { prepareCoordinatedVoicings } from './coordinated-voicing';
import { nativeBalladReplyEnabled, captureNativeBalladColor, proposeNativeBalladReply, advanceNativeBalladReplyMemory, validateNativeBalladReply, type NativeBalladReplyMemory } from './backing-ballad-reply';
import { assessTerminalArrangement, realizeTerminalArrangement, terminalBarPlan, terminalPianoTrace, terminalDrumTrace, type TerminalReservation, type TerminalArrangementDecision } from './backing-terminal';
import { BACKING_STYLES, type DrumHitSpec, type StyleDefinition } from './backing-styles';
/** Pure append-only, one-bar realization for the finite coordinated listening lab. */
import type { HarmonicSegment } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import type { PerformanceForm } from '$lib/types/performance-form';
import type { BackingGenerationParams, BarInfo, BassEvent, CompEvent, DrumEvent, EnsembleDevelopment, NativeBalladReplyDecision } from './backing-generation';
import { buildBarInfos } from './backing-generation';
import { developRhythm, displacedRhythm, rhythmAnswerOpportunity, validRhythmMemory, type RhythmMemory } from './backing-rhythm-memory';
import { buildPerformanceForm, performanceBarContext, type PerformanceBarContext } from './performance-form';
import { planPerformanceEnergy } from './performance-energy';
import { prepareEnsembleBars, planEnsembleWindow, type EnsembleBarContext, type EnsembleMemory, type EnsemblePlan, type SoloFeature } from './ensemble-plan';
import { describeEnsemblePhraseTiming, restoreEnsembleTiming, type EnsemblePhraseTimingTrace } from './ensemble-timing';
import type { BackingStyle } from '$lib/types/instruments';
import { fractionToFloat } from '$lib/music/intervals';
import { createRng, seedFrom } from './generation-rng';
import { realizeRollingPiano, realizeRollingBalladReply, type RollingPianoMemory } from './backing-rolling-piano';
import { prepareRollingBass, type PreparedRollingBass, realizeRollingBass, type RollingBassMemory } from './backing-rolling-bass';
import { freezeDrumPhraseTrace, planDrumPhraseBar, type DrumPhraseMemory } from './backing-drum-phrases';
import type { TimingProfile, TimingRole } from './backing-timing';
import { MAX_ADAPTIVE_BARS, MAX_ADAPTIVE_LOOPS } from './backing-performance-limits';
import { planPianoRecovery, captureReturningDrums, validatePianoRecoveryMemory, type PianoRecoveryMemory } from './backing-piano-recovery';
import { validatePianoContourMemory } from './backing-piano-contour';
import { validatePianoAnswerMemory, type PianoAnswerMemory } from './backing-piano-answer';
import { captureDrumStatement, planDrumPianoFeedback, validateDrumPianoFeedback, type DrumPianoFeedbackMemory } from './backing-ensemble-feedback';
import { pianoPhraseRecallEnabled, retainPianoPhraseRecall, validatePianoPhraseRecall } from './backing-piano-motif-memory';

export interface RollingBackingOptions {
 /** Follow the performance energy with walking articulation and ensemble accents. */
 readonly performanceTouch?: true;
 /** Trade the half-note pulse when a Ballad returns to its melody. */
 readonly balladReturn?: true;
 /** Let the kit displace a recently heard pitched rhythm during a solo. */
 readonly displacedRhythm?: true;
 readonly melodicHandoff?: true;
 readonly eighthAnticipation?: true;
 readonly quarterAnticipation?: true;
 readonly rideTriplet?: true;
 readonly nativeMelodicHandoff?: true;
 readonly keyboardMelodicHandoff?: true;
 readonly rhythmMemory?: true;
 readonly balladThird?: true;
 readonly brokenTwo?: true;
 readonly dominantRiff?: true;
 /** Let native Bossa time answer an octave pickup during the solo. */
 readonly bossaPickup?: true;
 /** 0.19.1: more sustained ordinary Swing/Straight piano support. */
 readonly pianoContinuity?: true | 'refit';
 /** 0.18: bounded same-harmony gate and a supported next-bar breath. */
 readonly keyboardSustain?: true | 'common-tones' | 'harmonic-support';
	/** Normal playback owns a finite timeline; lab capture limits do not apply. */
	readonly preparedPlayback?: true;
	/** Explicit finite repetitions of the source form; never an open-ended loop. */
	readonly loopCount?: number;
	/** Listening release opt-in; generic rolling and the advanced lab keep their prior policy. */
	readonly returningMelodySpace?: boolean;
	/** Listening opt-in to reproducible waves across contiguous solo choruses. */
	readonly performanceEnergySeed?: number;
	/** Listening 0.3 opt-in: connected native piano phrases with deliberate breaths. */
	readonly pianoPresence?: true | 'steady' | 'accompaniment';
	/** Expanded Swing/Straight listening vocabulary; historical policies stay exact. */
	readonly keyboardVariety?: boolean | 'developed';
	/** Prefer a declared chorus seam over a nearby internal section ending. */
	readonly chorusBoundaryPriority?: true;
	/** Phrase-level rootless chord thickness and spacing for the listening desk. */
	readonly keyboardTexture?: true;
	/** Connected lines and captured instrument articulation, all native styles. */
	readonly keyboardPhrasing?: 'piano' | 'organ';
	/** Listening 0.11: scoped phrase dynamics and keyboard gate contrast. */
	readonly phraseExpression?: true;
	readonly trioConversation?: true;
	readonly phraseColors?: true;
	readonly phraseDialogue?: true;
 readonly innerMotion?: true;
 readonly longerSentences?: true;
	readonly ensembleColors?: true;
	/** Listening 0.8 policies; omission preserves earlier event streams. */
	readonly bassDelayedRoot?: true;
	readonly keyboardContraryMotion?: true;
	readonly drumPhraseCushioning?: true;
	/** Listening 0.9: complete inner-voice 4–3 cells within existing native attacks. */
	readonly keyboardSuspensions?: true | 'developed';
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
 readonly pianoContinuityVersion?: 1 | 2;
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
	/** Only explicit forms containing a qualified solo-to-head return. */
	readonly returningMelodySpaceVersion?: 1;
	readonly pianoPresenceVersion?: 1 | 2 | 3;
	readonly keyboardVarietyVersion?: 1 | 2;
	readonly chorusBoundaryPriorityVersion?: 1;
	readonly keyboardTextureVersion?: 1;
	readonly keyboardPhrasing?: { readonly version: 1; readonly instrument: 'piano' | 'organ' };
	readonly bassDelayedRootVersion?: 1;
	readonly phraseExpressionVersion?: 1;
	readonly trioConversationVersion?: 1;
	readonly phraseColorsVersion?: 1;
	readonly phraseDialogueVersion?: 1;
 readonly innerMotionVersion?: 1;
 readonly longerSentencesVersion?: 1;
 readonly keyboardSustainVersion?: 1 | 2;
 readonly harmonicSupportVersion?: 1;
 readonly performanceTouchVersion?: 1;
 readonly balladReturnVersion?: 1;
 readonly displacedRhythmVersion?: 1;
 readonly melodicHandoffVersion?: 1;
 readonly eighthAnticipationVersion?: 1;
 readonly quarterAnticipationVersion?: 1;
 readonly rideTripletVersion?: 1;
 readonly nativeMelodicHandoffVersion?: 1;
 readonly keyboardMelodicHandoffVersion?: 1;
 readonly rhythmMemoryVersion?: 1;
 readonly balladThirdVersion?: 1;
 readonly brokenTwoVersion?: 1;
 readonly dominantRiffVersion?: 1;
 readonly bossaPickupVersion?: 1;
	readonly ensembleColorsVersion?: 1;
	readonly keyboardContraryMotionVersion?: 1;
	readonly drumPhraseCushioningVersion?: 1;
	readonly keyboardSuspensionsVersion?: 1 | 2;
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
	readonly pianoPresence?: { readonly version: 1; readonly silentBars: number; readonly lastSoundingEndTick: number | null };
	readonly pianoAnswer?: PianoAnswerMemory;
	readonly pianoRecovery?: PianoRecoveryMemory;
	readonly nativeBalladReply?: NativeBalladReplyMemory;
	readonly rhythmMemory?: RhythmMemory;
 readonly melodicMemory?: MelodicMemory;
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

// Only the factory owns these deeply frozen scores. Restored or caller-edited
// definitions use fresh preparation; a shallow freeze is not proof of ownership.
const preparedBassScores = new WeakMap<RollingBackingDefinition, PreparedRollingBass>();
const ownedDefinitions = new WeakSet<RollingBackingDefinition>();
// Identity binds deeply frozen, actually produced history to its exact owned
// score. Weak keys retain nothing after callers release their checkpoints.
const ownedCheckpoints = new WeakMap<RollingBackingCheckpoint, RollingBackingDefinition>();

/** Prepare known score/form data only; no future accompaniment is generated. */
export function createRollingBacking(harmony: HarmonicSegment[], style: StyleDefinition, params: BackingGenerationParams,
	options: RollingBackingOptions = {}): RollingBackingDefinition {
	if (!style.coordinatedStyle || params.beatsPerBar !== 4 || !params.ensemble) throw new Error('Rolling backing requires a supported coordinated style in 4/4');
	if (!Number.isFinite(params.tempo) || params.tempo <= 0 || (!options.preparedPlayback && (params.tempo < 30 || params.tempo > 320)) || !Number.isSafeInteger(params.ppq) || params.ppq <= 0 || !Number.isFinite(params.swing) || params.swing < 0.5 || params.swing > 0.8) throw new Error('Invalid rolling backing tempo, PPQ or swing');
	if (style.swingModel === 'fixed') params = { ...params, swing: style.defaultSwing };
	const loopCount = options.loopCount ?? 1;
	if (!Number.isInteger(loopCount) || loopCount < 1 || loopCount > MAX_ADAPTIVE_LOOPS) throw new Error(`Rolling loop count must be 1–${MAX_ADAPTIVE_LOOPS}`);
	let copied: HarmonicSegment[] = JSON.parse(JSON.stringify(harmony));
	let end = 0;
	for (const segment of copied) {
		const start = fractionToFloat(segment.startOffset) * 4;
		const length = fractionToFloat(segment.duration) * 4;
		if (!Number.isFinite(start) || (options.preparedPlayback ? Math.abs(start - end) > 1e-8 : start !== end) || !Number.isFinite(length) || (!options.preparedPlayback && !Number.isInteger(length)) || length <= 0) throw new Error('Rolling harmony must cover complete contiguous quarter beats');
		end = start + length;
	}
	const sourceBars = end / 4;
	if (!Number.isInteger(sourceBars) || sourceBars < 1 || (!options.preparedPlayback && sourceBars > 128)) throw new Error('Rolling source requires 1–128 complete bars');
	const totalBars = sourceBars * loopCount;
	if (!options.preparedPlayback && totalBars > MAX_ADAPTIVE_BARS) throw new Error(`Rolling performance exceeds the ${MAX_ADAPTIVE_BARS}-bar limit`);
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
	const performanceEnergy = params.performanceForm ? planPerformanceEnergy(form, { seed: options.performanceEnergySeed }) : undefined;
	const returningMelodyBars = new Map<number, NonNullable<EnsembleBarContext['returningMelodySpace']>>();
	if (options.returningMelodySpace === true && params.performanceForm) for (const [index, chorus] of form.choruses.entries()) {
		if (chorus.role !== 'head' || form.choruses[index - 1]?.role !== 'solo' || chorus.endBarExclusive - chorus.startBar < 8) continue;
		const firstSection = form.sections.find(section => section.chorusIndex === index && section.startBar === chorus.startBar);
		if (!firstSection || firstSection.endBarExclusive - firstSection.startBar < 4) continue;
		for (const offset of [1, 2] as const) returningMelodyBars.set(chorus.startBar + offset,
			{ version: 1, headStartBar: chorus.startBar, offset });
	}
	const pianoPresence = !!performanceEnergy && (options.pianoPresence === true || options.pianoPresence === 'steady' || options.pianoPresence === 'accompaniment');
	const accompanimentPiano = pianoPresence && options.pianoPresence === 'accompaniment';
	const keyboardVariety = (options.keyboardVariety === true || options.keyboardVariety === 'developed') && accompanimentPiano && ['swing', 'straight'].includes(style.coordinatedStyle!);
	const keyboardPhrasing = accompanimentPiano && (options.keyboardPhrasing === 'piano' || options.keyboardPhrasing === 'organ')
		? { version: 1 as const, instrument: options.keyboardPhrasing } : undefined;
	const keyboardSuspensions = keyboardPhrasing ? options.keyboardSuspensions === 'developed' ? 2 as const : options.keyboardSuspensions === true ? 1 as const : undefined : undefined;
	const displacement = options.rhythmMemory && options.displacedRhythm && performanceEnergy &&
		['swing', 'straight'].includes(style.coordinatedStyle!) && form.choruses.some(c => c.role === 'solo');
	const nativeHandoff = options.nativeMelodicHandoff && options.rhythmMemory && options.melodicHandoff && options.keyboardMelodicHandoff &&
  performanceEnergy && ['bossa-nova', 'ballad'].includes(style.coordinatedStyle!) && form.choruses.some(c => c.role === 'solo');
	const versionedPolicies = {
  ...(options.eighthAnticipation && performanceEnergy && style.coordinatedStyle === 'bossa-nova' && form.choruses.some(c => c.role === 'head')
   ? { eighthAnticipationVersion: 1 as const } : {}),
  ...(options.quarterAnticipation && performanceEnergy && style.coordinatedStyle === 'swing' && form.choruses.some(c => c.role === 'head')
   ? { quarterAnticipationVersion: 1 as const } : {}),
  ...(options.rideTriplet && performanceEnergy && style.coordinatedStyle === 'swing' && form.choruses.some(c => c.role === 'solo')
   ? { rideTripletVersion: 1 as const } : {}),
  ...(nativeHandoff && { nativeMelodicHandoffVersion: 1 as const }),
  ...((displacement || nativeHandoff) && options.melodicHandoff && options.keyboardMelodicHandoff ? { keyboardMelodicHandoffVersion: 1 as const } : {}),
  ...((displacement || nativeHandoff) && options.melodicHandoff ? { melodicHandoffVersion: 1 as const } : {}),
  ...(displacement ? { displacedRhythmVersion: 1 as const } : {}),
  ...(options.rhythmMemory && performanceEnergy && (displacement || nativeHandoff || form.choruses.some((c,i) => c.role === 'solo' && form.choruses[i-1]?.role === 'solo')) ? { rhythmMemoryVersion: 1 as const } : {}),
  ...(options.balladThird && performanceEnergy && style.coordinatedStyle === 'ballad' ? { balladThirdVersion: 1 as const } : {}),
  ...(options.brokenTwo && performanceEnergy && style.coordinatedStyle === 'straight' ? { brokenTwoVersion: 1 as const } : {}),
  ...(options.dominantRiff && performanceEnergy && style.coordinatedStyle === 'swing' ? { dominantRiffVersion: 1 as const } : {}),
  ...(options.balladReturn && performanceEnergy && style.coordinatedStyle === 'ballad' ? { balladReturnVersion: 1 as const } : {}),
  ...(options.bossaPickup && performanceEnergy && style.coordinatedStyle === 'bossa-nova' ? { bossaPickupVersion: 1 as const } : {}),
  ...(options.performanceTouch && performanceEnergy && ['swing', 'straight'].includes(style.coordinatedStyle!) ? { performanceTouchVersion: 1 as const } : {}),
  ...(options.keyboardSustain === 'harmonic-support' && keyboardPhrasing &&
   (style.coordinatedStyle === 'ballad' || (keyboardPhrasing.instrument === 'organ' && style.compPlanning))
   ? { harmonicSupportVersion: 1 as const } : {}),
  ...(keyboardPhrasing?.instrument === 'piano' && options.pianoContinuity && ['swing','straight'].includes(style.coordinatedStyle!) ? { pianoContinuityVersion: options.pianoContinuity === 'refit' ? 2 as const : 1 as const } : {}),
  ...(keyboardPhrasing && options.keyboardVariety === 'developed' && options.longerSentences === true ? { longerSentencesVersion: 1 as const } : {}),
  ...(keyboardPhrasing && options.keyboardSustain ? { keyboardSustainVersion: options.keyboardSustain === true ? 1 as const : 2 as const } : {}),
  ...(keyboardPhrasing && options.innerMotion === true ? { innerMotionVersion: 1 as const } : {}),
        ...(keyboardPhrasing && options.phraseDialogue === true ? { phraseDialogueVersion: 1 as const } : {}),
		...(keyboardPhrasing && options.ensembleColors === true ? { ensembleColorsVersion: 1 as const } : {}),
		...(keyboardPhrasing && options.phraseColors === true ? { phraseColorsVersion: 1 as const } : {}),
		...(keyboardPhrasing && options.trioConversation === true ? { trioConversationVersion: 1 as const } : {}),
		...(keyboardPhrasing && ['swing', 'straight'].includes(style.coordinatedStyle!) && options.phraseExpression === true ? { phraseExpressionVersion: 1 as const } : {}),
		...(performanceEnergy && options.bassDelayedRoot === true ? { bassDelayedRootVersion: 1 as const } : {}),
		...(keyboardPhrasing && options.keyboardContraryMotion === true ? { keyboardContraryMotionVersion: 1 as const } : {}),
		...(performanceEnergy && options.drumPhraseCushioning === true ? { drumPhraseCushioningVersion: 1 as const } : {})
	};
	const keyboardTexture = options.keyboardTexture === true && accompanimentPiano && ['swing', 'straight'].includes(style.coordinatedStyle!);
	const keyboardVarietyVersion = options.keyboardVariety === 'developed' ? 2 as const : 1 as const;
	const chorusBoundaryPriority = options.chorusBoundaryPriority === true && !!params.performanceForm && ['swing', 'straight'].includes(style.coordinatedStyle!);
	const steadyPiano = pianoPresence && (options.pianoPresence === 'steady' || accompanimentPiano);
	const bars = buildBarInfos(totalBars, undefined, form).map((info, barIndex) => {
		const sourceBarIndex = barIndex % sourceBars;
		const sourceContext = performanceBarContext(sourceForm, sourceBarIndex)!;
		return { ...info, ...(chorusBoundaryPriority ? { chorusBoundaryPriority: true as const } : {}), ...(pianoPresence ? { pianoPresencePolicy: accompanimentPiano ? 'accompaniment-v3' as const : steadyPiano ? 'steady-v2' as const : 'phrase-v1' as const, ...(steadyPiano ? { pianoPresenceSeed: options.performanceEnergySeed ?? 0 } : {}) } : {}), ...(returningMelodyBars.has(barIndex) ? { returningMelodySpace: returningMelodyBars.get(barIndex)! } : {}), ...(terminalArrangement?.barIndex === barIndex ? { terminalArrangement } : {}), ...(style.intensityCap !== undefined ? { intensity: Math.min(info.intensity, style.intensityCap), energyCeiling: style.intensityCap } : {}), ...performanceBarContext(form, barIndex)!, ...(performanceEnergy ? { performanceEnergy: performanceEnergy[barIndex], ...(['swing', 'straight'].includes(style.coordinatedStyle!) ? { pianoArrivalPolicy: 'shared-v1' as const } : {}) } : {}), barIndex, loopIndex: Math.floor(barIndex / sourceBars),
			sourceBarIndex, sourceChorusIndex: sourceContext.chorusIndex, sourceSectionIndex: sourceContext.sectionIndex };
	});
	const timingProfiles = params.timing ?? style.timing;
	// Preserve the one-pass binding. An explicit repeat is a distinct declared
	// performance even when its flattened score matches some other source.
	const serialized = JSON.stringify([1, params.phraseId, params.tempo, params.ppq, params.swing, copied, form, timingProfiles,
		...(performanceEnergy ? [{ performanceEnergyVersion: 1, structuralTextureVersion: 1, coordinatedVoicingVersion: 4, reciprocalFeedbackVersion: 1, ...(['swing', 'straight'].includes(style.coordinatedStyle!) ? { pianoArrivalVersion: 1, bassScalarContinuationVersion: 1, bassApproachHandoffVersion: 1, pianoAnswerVersion: 1, pianoContourVersion: 1, pianoRecoveryVersion: 1, pianoPhraseRecallVersion: 1 } : style.coordinatedStyle === 'bossa-nova' ? { pianoContourVersion: 1 } : style.coordinatedStyle === 'ballad' ? { nativeBalladReplyVersion: 1 } : {}) }] : []),
		...(returningMelodyBars.size ? [{ returningMelodySpaceVersion: 1 }] : []),
		...(keyboardVariety ? [{ keyboardVarietyVersion }] : []),
		...(keyboardTexture ? [{ keyboardTextureVersion: 1 }] : []),
		...(keyboardPhrasing ? [{ keyboardPhrasing }] : []),
		...(keyboardSuspensions ? [{ keyboardSuspensionsVersion: keyboardSuspensions }] : []),
		...(Object.keys(versionedPolicies).length ? [versionedPolicies] : []),
		...(chorusBoundaryPriority ? [{ chorusBoundaryPriorityVersion: 1 }] : []),
		...(pianoPresence ? [{ pianoPresenceVersion: accompanimentPiano ? 3 : steadyPiano ? 2 : 1, ...(steadyPiano ? { seed: options.performanceEnergySeed ?? 0 } : {}) }] : []),
		...(performanceEnergy && options.performanceEnergySeed !== undefined ? [{ performanceEnergyWavesVersion: 1, seed: options.performanceEnergySeed }] : []),
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
	const definition: RollingBackingDefinition = freeze({ version: 1, ...(keyboardSuspensions ? { keyboardSuspensionsVersion: keyboardSuspensions } : {}), ...versionedPolicies, ...(keyboardPhrasing ? { keyboardPhrasing } : {}), ...(keyboardTexture ? { keyboardTextureVersion: 1 as const } : {}), ...(keyboardVariety ? { keyboardVarietyVersion } : {}), ...(chorusBoundaryPriority ? { chorusBoundaryPriorityVersion: 1 as const } : {}), ...(pianoPresence ? { pianoPresenceVersion: accompanimentPiano ? 3 as const : steadyPiano ? 2 as const : 1 as const } : {}), ...(returningMelodyBars.size ? { returningMelodySpaceVersion: 1 as const } : {}), ...(performanceEnergy && ['swing', 'straight'].includes(style.coordinatedStyle!) ? { bassScalarContinuation: true as const, bassApproachHandoff: true as const } : {}), ...(style.coordinatedStyle !== 'swing' ? { style: style.coordinatedStyle } : {}), sessionId: `rolling:${seedFrom(fingerprint).toString(16)}`, fingerprint,
		phraseId: params.phraseId, totalBars, sourceBars, loopCount, loops, ...(terminalArrangement ? { terminalArrangement } : {}), tempo: params.tempo, ppq: params.ppq, beatsPerBar: 4, swing: params.swing,
		performanceForm: form, harmony: copied, bars: prepareEnsembleBars(bars),
		...(timingProfiles ? { timingProfiles: JSON.parse(JSON.stringify(timingProfiles)) } : {}) });
	prepareCoordinatedVoicings(definition.harmony.map(segment => segment.chord));
	const bass = prepareRollingBass(definition);
	if (bass) preparedBassScores.set(definition, bass);
	ownedDefinitions.add(definition);
	return definition;
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
	if (score.keyboardMelodicHandoffVersion ? !validBassCalls(checkpoint.melodicMemory?.bassCalls, checkpoint.nextBar, !!score.nativeMelodicHandoffVersion) : checkpoint.melodicMemory?.bassCalls !== undefined) invalid();
	if (score.melodicHandoffVersion ? !validMelodicMemory(checkpoint.melodicMemory, checkpoint.nextBar, !!score.nativeMelodicHandoffVersion) : checkpoint.melodicMemory !== undefined) invalid();
	if (score.rhythmMemoryVersion ? !validRhythmMemory(checkpoint.rhythmMemory, checkpoint.nextBar) : checkpoint.rhythmMemory !== undefined) invalid();
	const presence = checkpoint.pianoPresence;
	if (score.pianoPresenceVersion ? !presence || presence.version !== 1 || !Number.isInteger(presence.silentBars) || presence.silentBars < 0 || presence.silentBars > checkpoint.nextBar ||
		(presence.lastSoundingEndTick !== null && (!Number.isFinite(presence.lastSoundingEndTick) || presence.lastSoundingEndTick <= 0 || presence.lastSoundingEndTick > (checkpoint.nextBar * 4 + (score.keyboardSustainVersion ? 1 : 0)) * score.ppq + 0.00001)) : presence !== undefined) invalid();
	if (presence) {
		const sounded = checkpoint.drums.previousCompOnsets.length > 0;
		const soundingBar = checkpoint.nextBar - presence.silentBars - 1;
		if (Object.keys(presence).sort().join(',') !== 'lastSoundingEndTick,silentBars,version' || sounded !== (presence.silentBars === 0) ||
			(presence.lastSoundingEndTick === null ? presence.silentBars !== checkpoint.nextBar :
				presence.lastSoundingEndTick <= soundingBar * 4 * score.ppq || presence.lastSoundingEndTick > ((soundingBar + 1) * 4 + (score.keyboardSustainVersion ? 1 : 0)) * score.ppq + .00001)) invalid();
	}
	const carry = checkpoint.piano.crossBarReleaseTick;
	if (carry !== undefined && (!score.keyboardSustainVersion || !Number.isSafeInteger(carry) || carry <= checkpoint.nextBar * 4 * score.ppq || carry > (checkpoint.nextBar * 4 + 1) * score.ppq || checkpoint.nextBar >= score.totalBars || Math.abs(carry - (presence?.lastSoundingEndTick ?? -1)) > .00001)) invalid();
	if (presence?.lastSoundingEndTick && presence.lastSoundingEndTick > checkpoint.nextBar * 4 * score.ppq + .00001 && carry === undefined) invalid();
	const common = checkpoint.piano.commonToneNotes;
	if (common !== undefined && (score.keyboardSustainVersion !== 2 || carry === undefined || !Array.isArray(common) || common.length < 1 || common.length > 2 || new Set(common).size !== common.length || common.some(n => !Number.isInteger(n) || n < 0 || n > 127 || !checkpoint.piano.lastVoicing.includes(n) || !commonToneAtBoundary(score,checkpoint.nextBar,n)))) invalid();
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
 if (score.longerSentencesVersion && checkpoint.piano.motif) {
  const motif = checkpoint.piano.motif, lastBar = checkpoint.nextBar - 1;
  const sentence = ['swing','straight'].includes(score.style ?? 'swing') ? musicalSentence(score, lastBar) : undefined;
  const start = sentence?.startBar ?? lastBar - score.bars[lastBar].phrase4.barIndex;
  if (motif.startBar !== start || typeof motif.repeat !== 'boolean' || !Number.isFinite(motif.shift) ||
   motif.sourceId !== null && !keyboardFigures(score).some(f => f.id === motif.sourceId)) invalid();
  if (motif.sourceBar !== undefined && (!sentence || motif.sourceId === null || !Number.isInteger(motif.sourceBar) ||
   motif.sourceBar < start || motif.sourceBar > start + 2 || motif.sourceBar > lastBar)) invalid();
  if (sentence && motif.sourceId !== null && motif.sourceBar === undefined) invalid();
 }
 const opening=checkpoint.bass.openingMotif;
 const openingPolicy=!!score.phraseDialogueVersion && ['swing','straight'].includes(score.style??'swing');
 if(opening!==undefined&&!openingPolicy || openingPolicy&&checkpoint.nextBar<score.totalBars&&opening===undefined)invalid();
 if(opening!==undefined && opening!==null && (Object.keys(opening).sort().join(',')!=='barIndex,notes' || opening.barIndex!==checkpoint.nextBar-1 ||
  !Array.isArray(opening.notes)||opening.notes.length!==2||opening.notes.some(n=>!Number.isInteger(n)||n<28||n>55)||
  !Math.abs(opening.notes[1]-opening.notes[0])||Math.abs(opening.notes[1]-opening.notes[0])>5))invalid();
	const scalar = checkpoint.bass.scalarHistory;
	if (scalar !== undefined && (!score.bassScalarContinuation || !scalar || typeof scalar.ornamentAfterPulse !== 'boolean' ||
		!scalar.pulse || !Number.isInteger(scalar.pulse.absBeat) || Math.floor(scalar.pulse.absBeat / 4) !== checkpoint.nextBar - 1 ||
		!Number.isInteger(scalar.pulse.midi) || scalar.pulse.midi < 28 || scalar.pulse.midi > 55 ||
		typeof scalar.pulse.time !== 'string' || !/^\d+i$/.test(scalar.pulse.time) || parseInt(scalar.pulse.time) < (checkpoint.nextBar - 1) * 4 * score.ppq ||
		parseInt(scalar.pulse.time) >= checkpoint.nextBar * 4 * score.ppq || scalar.pulse.midi !== checkpoint.bass.previousMidi)) invalid();
	const voicing = checkpoint.piano.voicing;
	const lastSuspensionBar = checkpoint.piano.lastSuspensionBar;
	if (lastSuspensionBar !== undefined && (![1, 2].includes(score.keyboardSuspensionsVersion ?? 0) || !Number.isSafeInteger(lastSuspensionBar) ||
		lastSuspensionBar < 0 || lastSuspensionBar >= checkpoint.nextBar ||
		!['solo_build', 'solo_peak', 'solo_release'].includes(score.bars[lastSuspensionBar].performanceEnergy?.phase ?? ''))) invalid();
	const coordinatedVoicing = score.bars[0]?.performanceEnergy !== undefined;
	if (coordinatedVoicing) validateDrumPianoFeedback(checkpoint.feedback!, checkpoint.nextBar, score.ppq);
	else if (checkpoint.feedback !== undefined) invalid();
	if (coordinatedVoicing && checkpoint.piano.lastVoicing.length > 0 && !voicing) invalid();
	if (voicing) {
		const index = checkpoint.piano.segmentIndex;
		const chord = index !== null && Number.isInteger(index) && index >= 0 ? score.harmony[index]?.chord : undefined;
		if (!coordinatedVoicing || voicing.version !== 1 || !voicing.chord || !PITCH_CLASSES.includes(voicing.chord.root) ||
			!Object.hasOwn(CHORD_DEFINITIONS, voicing.chord.quality) || !Array.isArray(voicing.notes) || voicing.notes.length < 2 || voicing.notes.length > 8 ||
			voicing.notes.some((note, i) => !Number.isInteger(note) || note < (score.ensembleColorsVersion ? 45 : 48) || note > 84 || (i > 0 && voicing.notes[i - 1] >= note)) ||
			voicing.notes.length !== checkpoint.piano.lastVoicing.length || voicing.notes.some((note, i) => note !== checkpoint.piano.lastVoicing[i]) ||
			!chord || chord.root !== voicing.chord.root || chord.quality !== voicing.chord.quality) invalid();
	}
}

/** Commit exactly one new bar. Past events are never regenerated or modified. */
export function advanceRollingBacking(definition: RollingBackingDefinition, checkpoint?: RollingBackingCheckpoint, soloFeatures: readonly SoloFeature[] = []): RollingBackingBar {
	if (checkpoint && ownedCheckpoints.get(checkpoint) !== definition) {
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
		startBar: bar, endBarExclusive: bar + 1, memory: checkpoint?.ensemble, ...(definition.pianoPresenceVersion ? { pianoSilentBars: checkpoint?.pianoPresence?.silentBars ?? 0 } : {}),
		soloFeatures: latest ? [{ ...latest, barIndex: bar }] : [] });
 // A committed partial sustain needs a fresh harmonic entrance, even when
 // optional comping would otherwise leave space. Preserve foreground ownership.
 if (checkpoint?.piano.commonToneNotes) {
  const planned=window.plan.bars[0];
  const piano={...planned.piano,maxAttacks:Math.max(1,planned.piano.maxAttacks) as 1|2,
   densityScale:Math.max(.5,planned.piano.densityScale),harmonicSupport:planned.piano.harmonicSupport ?? 'under_response' as const,
   role:planned.piano.role==='leave_space'?'support' as const:planned.piano.role,silenceReason:undefined};
  window={...window,plan:{...window.plan,bars:[{...planned,piano}],trace:window.plan.trace.map(t=>({...t,reasons:[...t.reasons,'common-tone harmonic entrance']}))}};
 }
	const ensemble = window.plan.bars[0];
	const bossaWindow = definition.bossaPickupVersion === 1 && ['solo_build', 'solo_peak'].includes(ensemble.performanceEnergy?.phase ?? '');
	const balladWindow = definition.balladReturnVersion === 1 && ensemble.performanceEnergy?.phase === 'head_return' &&
		!definition.bars[bar].returningMelodySpace && !definition.bars[bar].isSectionFinalBar;
	const riffWindow = definition.dominantRiffVersion === 1 && ['solo_build', 'solo_peak'].includes(ensemble.performanceEnergy?.phase ?? '') &&
		!ensemble.drums.allowFill && !definition.bars[bar].isSectionFinalBar;
	const phrase = definition.bars[bar].phrase4;
	const headWindow = definition.brokenTwoVersion === 1 && phrase?.lengthBars === 4 &&
		(phrase.barIndex === 1 || phrase.barIndex === 2) &&
		['head_in', 'head_return'].includes(ensemble.performanceEnergy?.phase ?? '') &&
		createRng(seedFrom(definition.phraseId, definition.bars[bar].pianoPresenceSeed ?? 0, bar - phrase.barIndex, 'broken-two')).chance(.6) &&
		!definition.bars[bar].returningMelodySpace && !definition.bars[bar].isSectionFinalBar && !ensemble.drums.allowFill;
	const thirdWindow = definition.balladThirdVersion === 1 && ['solo_build', 'solo_peak'].includes(ensemble.performanceEnergy?.phase ?? '') &&
		!definition.bars[bar].isSectionFinalBar && !ensemble.drums.allowFill &&
		createRng(seedFrom(definition.phraseId, definition.bars[bar].pianoPresenceSeed ?? 0, bar, 'ballad-third')).chance(.65);
	const anticipationWindow = definition.quarterAnticipationVersion === 1 && definition.bars[bar].role === 'head' &&
		['head_in','head_return'].includes(ensemble.performanceEnergy?.phase ?? '') && !definition.bars[bar].returningMelodySpace &&
		!definition.bars[bar].isSectionFinalBar && !ensemble.drums.allowFill && ensemble.bass.keepPulse &&
		!['leave_space','release'].includes(ensemble.phraseIntent) &&
		createRng(seedFrom(definition.phraseId, definition.bars[bar].pianoPresenceSeed ?? 0, bar, 'quarter-anticipation')).chance(.55);
	const eighthWindow = definition.eighthAnticipationVersion === 1 && definition.bars[bar].role === 'head' &&
  !definition.bars[bar].returningMelodySpace && !ensemble.drums.allowFill && ensemble.bass.keepPulse &&
  !['leave_space', 'release'].includes(ensemble.phraseIntent) &&
  createRng(seedFrom(definition.phraseId, definition.bars[bar].pianoPresenceSeed ?? 0, bar, 'bossa-anticipation')).chance(.45);
 const unreserved = (eighthWindow || anticipationWindow || bossaWindow || balladWindow || riffWindow || headWindow || thirdWindow) &&
		ensemble.responseOwner === 'nobody' && !ensemble.coordinatedAccent && !ensemble.setupFor &&
		!ensemble.terminalArrangement && !definition.bars[bar].isChorusFinalBar &&
		!['active', 'resting'].includes(window.plan.trace[0].soloEvidence) &&
		!['active_soloist', 'dense_soloist', 'under_response'].includes(ensemble.piano.rootlessTexture?.reason ?? '');
	const openHarmony = (balladWindow || bossaWindow || headWindow || thirdWindow) && unreserved && definition.harmony.some(segment => fractionToFloat(segment.startOffset) <= bar &&
			fractionToFloat(segment.startOffset) + fractionToFloat(segment.duration) >= bar + 1);
	const baseInfo = { ...definition.bars[bar], ensemble, intensity: ensemble.energy,
		eighthAnticipationAllowed: eighthWindow && unreserved,
		anticipationAllowed: anticipationWindow && unreserved,
		balladThirdAllowed: thirdWindow && openHarmony, brokenTwoAllowed: headWindow && openHarmony, bossaPickupAllowed: bossaWindow && openHarmony, balladHoldAllowed: balladWindow && openHarmony, dominantRiffAllowed: riffWindow && unreserved };
	const phraseEnd = ensemble.phraseStartBar + definition.bars[bar].phrase4!.lengthBars;
	const timingTrace = checkpoint?.timing.phraseStartBar === ensemble.phraseStartBar ? checkpoint.timing : describeEnsemblePhraseTiming({
		phraseId: definition.phraseId, tempo: definition.tempo, ppq: definition.ppq, swing: definition.swing,
		phraseStartBar: ensemble.phraseStartBar, endBarExclusive: phraseEnd, intent: ensemble.phraseIntent,
		boundaryStrength: definition.bars[phraseEnd - 1].boundaryStrength ?? 0, timingProfiles: definition.timingProfiles });
	const timing = restoreEnsembleTiming({ phraseId: definition.phraseId, tempo: definition.tempo, ppq: definition.ppq, swing: definition.swing,
		trace: [timingTrace], timingProfiles: definition.timingProfiles });
	// Only a plain bar of four actual walking quarters invites the other players
	// to lean into backbeats. Setups, ornaments and two-feel keep their own touch.
	let bass = realizeRollingBass(definition, bar, baseInfo, timing, checkpoint?.bass, preparedBassScores.get(definition));
	const energy = ensemble.performanceEnergy;
	const walkingTouch = definition.performanceTouchVersion && energy && !ensemble.coordinatedAccent &&
		!ensemble.terminalArrangement && !ensemble.setupFor && ensemble.responseOwner === 'nobody' &&
		!['active_soloist', 'dense_soloist', 'under_response'].includes(ensemble.piano.rootlessTexture?.reason ?? '') &&
		bass.memory.feel === 'four' && !bass.memory.pendingLaunch && !checkpoint?.bass.pendingLaunch &&
		!bass.delayedRootTrace && !bass.continuationTrace?.length && bass.events.length === 4 &&
		bass.events.every((event, i) => event.absBeat === bar * 4 + i && !event.conversation && !event.expression &&
			!event.phraseColor && !event.phraseDialogue && !event.ensembleColor && !event.innerMotion)
		? Math.max(0, Math.min(1, (energy.targetEnergy - .38) / .42)) : undefined;
	const info = { ...baseInfo, walkingTouch };
	if (walkingTouch !== undefined) {
		const gate = (.58 + .27 * walkingTouch) * 60 / definition.tempo;
		bass = { ...bass, events: bass.events.map(event => gate < event.duration
			? { ...event, duration: gate, walkingGateBefore: event.duration } : event) };
	}
	const feedback = ensemble.performanceEnergy ? planDrumPianoFeedback({ phraseId: definition.phraseId,
		tempo: definition.tempo, barIndex: bar, info, previous: checkpoint?.feedback }) : undefined;
	// Keep shared intentions intact. The piano receives the optional breath;
	// an accepted reply or supported keyboard breath reserves local commentary space below.
	const pianoInfo = feedback?.action === 'yield'
		? { ...info, ensemble: { ...ensemble, piano: { ...ensemble.piano, maxAttacks: feedback.effectiveMaxAttacks, ...(ensemble.piano.harmonicSupport ? { harmonicSupport: 'under_drums' as const, rootlessTexture: { request: 'two' as const, reason: 'under_response' as const } } : {}) } } } : info;
	const answerPolicy = !!feedback && (!definition.style || definition.style === 'swing' || definition.style === 'straight');
	let piano = realizeRollingPiano(definition, bar, pianoInfo, timing, checkpoint?.piano,
		answerPolicy ? { feedback: feedback!, previous: checkpoint?.pianoAnswer } : undefined, window.plan.trace[0].soloEvidence, bass.events);
	const startTick = bar * 4 * definition.ppq;
	const endTick = (bar + 1) * 4 * definition.ppq;
	let peakEnd: number | undefined;
	if (ensemble.performanceEnergy?.phase === 'solo_peak') {
		peakEnd = bar + 1;
		while (peakEnd < phraseEnd && definition.bars[peakEnd].performanceEnergy?.phase === 'solo_peak') peakEnd++;
	}
	const sentence = musicalSentence(definition, bar);
 const drumSentence = sentence && ['swing','straight'].includes(definition.style ?? 'swing') ? sentence : undefined;
	const current = definition.bars[bar];
	const solo = current.role === 'solo';
	const previous = solo && bar > 0 && current.loopIndex === definition.bars[bar-1].loopIndex &&
		definition.bars[bar-1].role === 'solo' ? checkpoint?.rhythmMemory : undefined;
	const offerAnswer = definition.displacedRhythmVersion && solo && !ensemble.drums.allowFill &&
		!ensemble.terminalArrangement && !ensemble.setupFor && !ensemble.coordinatedAccent && !current.isChorusFinalBar &&
		!bass.memory.pendingLaunch && !['active','resting'].includes(window.plan.trace[0].soloEvidence) &&
		!['active_soloist','dense_soloist','under_response'].includes(ensemble.piano.rootlessTexture?.reason ?? '') &&
		ensemble.drums.maxCommentaryHits >= 2 && ['nobody','drums'].includes(ensemble.responseOwner);
 const answerSeed = seedFrom(definition.phraseId, current.pianoPresenceSeed ?? 0);
 const followsSolo = definition.performanceForm.choruses[current.chorusIndex - 1]?.role === 'solo';
 const realizeDrums = (pianoResult: typeof piano) => {
	 const compOnsets = pianoResult.events.map(event => event.absBeat - bar*4);
   const openSolo = definition.rideTripletVersion && solo && (!followsSolo || !rhythmAnswerOpportunity(answerSeed, bar)) && !pianoResult.answer && !bass.memory.pendingLaunch &&
    !['active','resting'].includes(window.plan.trace[0].soloEvidence);
	 const planned = planDrumPhraseBar({
		rideTripletSeed: openSolo ? current.pianoPresenceSeed ?? 0 : undefined,
		displaced: offerAnswer && !pianoResult.answer && pianoResult.trace.carriedReleaseTick === undefined && !pianoResult.trace.commonToneEntry
			? displacedRhythm(previous, bar, compOnsets, seedFrom(definition.phraseId,current.pianoPresenceSeed ?? 0)) : undefined,
  ...(definition.longerSentencesVersion ? { longerSentences: true as const } : {}),
		...(definition.phraseColorsVersion ? { phraseColors: true as const, phraseColorSeed: definition.bars[bar].pianoPresenceSeed ?? 0 } : {}),
		...(definition.phraseExpressionVersion ? { phraseExpression: true as const } : {}),
		...(definition.trioConversationVersion ? { trioConversation: true as const } : {}),
		...(definition.rideTripletVersion || definition.trioConversationVersion || definition.bossaPickupVersion || definition.balladReturnVersion || definition.dominantRiffVersion || definition.brokenTwoVersion || definition.balladThirdVersion ? { bassEvents: bass.events } : {}),
		...(definition.drumPhraseCushioningVersion ? { phraseCushioning: true as const, compAttacks: pianoResult.events.map(event => ({ beatOffset: event.absBeat - bar * 4, durationBeats: event.duration * definition.tempo / 60, time: event.time, durationSeconds: event.duration })) } : {}),
		...(nativeBalladReplyEnabled(definition) && checkpoint?.nativeBalladReply?.lastReplyBar === bar - 1 ? { suppressPreviousPianoAnswer: true as const } : {}), style: definition.style, phraseId: definition.phraseId, tempo: definition.tempo, beatsPerBar: 4,
		barIndex: bar, info: pianoResult.answer || pianoResult.trace.carriedReleaseTick !== undefined || (pianoResult.trace.commonToneEntry && ensemble.responseOwner === 'nobody') ? { ...info, ensemble: { ...ensemble, drums: { ...ensemble.drums, maxCommentaryHits: 0 as const } } } : info, ...(pianoResult.answer ? { compIsDrumReply: true as const } : {}), phraseStartBar: drumSentence?.startBar ?? ensemble.phraseStartBar, phraseEndBarExclusive: drumSentence?.endBarExclusive ?? phraseEnd, harmonyEndBeat: definition.totalBars * 4,
		...(peakEnd !== undefined ? { peakEndBarExclusive: peakEnd } : {}),
		balladAnswerOnFour: definition.balladThirdVersion === 1 && pianoResult.events.some(event => event.balladThird),
		compOnsets, bassOnsets: bass.events.map((event) => event.absBeat - bar * 4),
		acceptsOnset: (absBeat, hit) => (hit.role === 'accent' && absBeat === bar * 4 ? timing.arrivalTick(bar) : timing.place(absBeat, hit.drum)) < endTick
	}, checkpoint?.drums);
  if(planned.bar.commentary.sourceId === 'displaced-rhythm' || !['swing','straight'].includes(definition.style??'swing') || planned.bar.cushioning || pianoResult.answer || pianoResult.trace.reason==='native_drum_reply')return planned;
  let hits=definition.ensembleColorsVersion&&allowsTrioConversation(info)?crossStickUnderChord(planned.bar.hits,pianoResult.events,bar,definition.tempo,definition.ppq,beat=>timing.place(beat,'snare')):[...planned.bar.hits];
  if(definition.phraseDialogueVersion && !info.isFinalBar && !ensemble.terminalArrangement && !ensemble.coordinatedAccent &&
   ['nobody','drums'].includes(ensemble.responseOwner) && ['solo_build','solo_peak'].includes(ensemble.performanceEnergy?.phase??'') &&
   !['active_soloist','dense_soloist','under_response'].includes(ensemble.piano.rootlessTexture?.reason??'') &&
   (allowsTrioConversation(info)||planned.bar.commentary.transform==='setup')) {
   const candidate=snareKickDialogue(hits,pianoResult.events,bar);
   const answer=candidate.find(h=>h.phraseDialogue?.kind==='kick-answer');
   if(answer && candidate.filter(h=>h!==answer&&h.drum==='kick').every(h=>Math.abs(timing.place(bar*4+h.beatOffset,'kick')-timing.place(bar*4+answer.beatOffset,'snare'))>=.2*definition.ppq))hits=candidate;
  }
  if(definition.innerMotionVersion && planned.bar.ride.voice!=='hihat' && !info.isChorusFinalBar && !info.isSectionFinalBar && !info.isFinalBar && !ensemble.coordinatedAccent && !ensemble.terminalArrangement && !ensemble.setupFor &&
   ensemble.responseOwner==='nobody' && ['solo_build','solo_peak'].includes(ensemble.performanceEnergy?.phase??'') &&
   !['active_soloist','dense_soloist','under_response'].includes(ensemble.piano.rootlessTexture?.reason??'') &&
   info.phrase4.barIndex===info.phrase4.lengthBars-1 && createRng(seedFrom(definition.phraseId,definition.bars[bar].pianoPresenceSeed??0,bar,'foot-hat-lift')).chance(.7))
    hits=liftFootHat(hits,pianoResult.events,bar,definition.ppq,timing.place(bar*4+3,'hihat-pedal'));
  if(!hits.some(hit=>hit.ensembleColor||hit.phraseDialogue||hit.innerMotion))return planned;
  const commentary={...planned.bar.commentary,hits:planned.bar.commentary.hits.map(hit=>
   hits.find(candidate=>candidate.beatOffset===hit.beatOffset && (candidate.ensembleColor||candidate.phraseDialogue) && hit.drum==='snare')??hit)};
  return {...planned,bar:freezeDrumPhraseTrace([{...planned.bar,hits,commentary}])[0]};
 };
	const scheduleDrums = (result: ReturnType<typeof realizeDrums>): DrumEvent[] => result.bar.hits.map((hit) => {
		const absBeat = bar * 4 + hit.beatOffset;
		const tick = hit.role === 'accent' && hit.beatOffset === 0 ? timing.arrivalTick(bar) : timing.place(absBeat, (hit.ensembleColor?.kind === 'cross-stick' || hit.phraseDialogue?.kind === 'kick-answer') ? 'snare' : result.bar.ride.voice === 'hihat' && hit.drum === 'hihat' && hit.role === 'timekeeping' ? 'ride' : hit.drum);
		return { absBeat, time: `${Math.max(startTick, tick)}i`, drum: hit.drum, velocity: hit.velocity, ...(hit.rideTriplet ? { rideTriplet: true as const } : {}), ...(hit.displacedAnswer ? { displacedAnswer: hit.displacedAnswer } : {}), ...(hit.balladThird ? { balladThird: true as const } : {}), ...(hit.brokenTwo ? { brokenTwo: true as const } : {}), ...(hit.dominantRiff ? { dominantRiff: true as const } : {}), ...(hit.bossaPickupKick ? { bossaPickupKick: true as const } : {}), ...(hit.walkingBackbeatLift ? { walkingBackbeatLift: hit.walkingBackbeatLift } : {}), ...(hit.expression ? { expression: hit.expression } : {}), ...(hit.conversation ? { conversation: hit.conversation } : {}), ...(hit.role ? { role: hit.role } : {}), ...(hit.ensembleColor ? { ensembleColor: hit.ensembleColor } : {}), ...(hit.phraseDialogue ? { phraseDialogue: hit.phraseDialogue } : {}), ...(hit.innerMotion ? { innerMotion: hit.innerMotion } : {}) };
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
					...(checkpoint?.piano.lastSuspensionBar !== undefined ? { lastSuspensionBar: checkpoint.piano.lastSuspensionBar } : {}),
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
 const sustained = !terminalAccepted && piano.trace.reason !== 'drum_reply' && piano.trace.reason !== 'native_drum_reply' ? sustainAcrossBar(definition,bar,pianoInfo,piano.events,checkpoint?.piano.crossBarReleaseTick) : undefined;
 if (sustained) {
  const held=sustained.at(-1)!;
  piano = {...piano, events:[...piano.events.slice(0,-1),...sustained],
   memory:{...piano.memory,crossBarReleaseTick:held.barLineSustain!.releaseTick,...(held.barLineSustain!.version===2?{commonToneNotes:[...held.notes]}:{})},
   voicingTrace:piano.voicingTrace?.flatMap(v=>v.time!==held.time?[v]:sustained.map(event=>({...v,notes:[...event.notes],decision:{...v.decision,
    ...(sustained.length > 1 && (definition.harmonicSupportVersion || definition.pianoContinuityVersion === 2) ? {rootlessTexture: undefined} : {}),
    ...(v.decision.keyboardArticulation?{keyboardArticulation:{...v.decision.keyboardArticulation,durationSeconds:event.duration,durationBeats:event.duration*definition.tempo/60}}:{})}}))) };
 }

	let melodicMemory: MelodicMemory | undefined;
	let rhythmMemory: RhythmMemory | undefined;
	if (definition.rhythmMemoryVersion) {
		const eligible = solo && !terminalAccepted && !recovery && !drums.bar.cushioning && !ensemble.setupFor && !ensemble.coordinatedAccent &&
			!ensemble.terminalArrangement && !current.isChorusFinalBar && !ensemble.drums.allowFill &&
			ensemble.responseOwner === 'nobody' && !piano.answer && !nativeReply && !bass.memory.pendingLaunch &&
			!['active', 'resting'].includes(window.plan.trace[0].soloEvidence) &&
			!['active_soloist', 'dense_soloist', 'under_response'].includes(ensemble.piano.rootlessTexture?.reason ?? '');
		const displaced = drumEvents.find(event=>event.displacedAnswer)?.displacedAnswer;
		const canAnswer = !displaced && piano.trace.carriedReleaseTick === undefined && !piano.trace.commonToneEntry &&
			followsSolo &&
			['solo_build', 'solo_peak'].includes(ensemble.performanceEnergy?.phase ?? '');
		const developed = developRhythm({ bass: bass.events, piano: piano.events, drums: drumEvents },
			previous, bar, eligible, canAnswer, answerSeed);
		rhythmMemory = developed.memory;
		bass = { ...bass, events: developed.parts.bass };
		piano = { ...piano, events: developed.parts.piano };
		if (developed.parts.drums !== drumEvents) {
			drumEvents = developed.parts.drums;
			const shade = (hit: DrumHitSpec) => {
				const answer = drumEvents.find(e => e.rhythmAnswer && e.drum === hit.drum && e.absBeat === bar*4+hit.beatOffset);
				return answer ? { ...hit, velocity: answer.velocity } : hit;
			};
			drums = { ...drums, bar: freezeDrumPhraseTrace([{ ...drums.bar, hits: drums.bar.hits.map(shade),
				commentary: { ...drums.bar.commentary, hits: drums.bar.commentary.hits.map(shade) } }])[0] };
		}
		if (definition.melodicHandoffVersion) {
			const memory = solo && bar > 0 && current.loopIndex === definition.bars[bar-1].loopIndex &&
				current.chorusIndex === definition.bars[bar-1].chorusIndex ? checkpoint?.melodicMemory : undefined;
			let lastAnswerBar = memory?.lastAnswerBar ?? null;
			const heard = memory?.keyboard ?? [];
			const native = !!definition.nativeMelodicHandoffVersion;
			const source = heard.slice(-bass.events.length);
			const nativeGesture = native && (bass.events.some(e => e.balladThird || e.balladHeldBass || e.bossaOctavePickup) ||
    piano.events.some(e => e.balladReturnAnswer || e.balladThird || e.bossaReplyFrom !== undefined));
   const open = eligible && !nativeGesture && !displaced && !checkpoint?.bass.pendingLaunch &&
				!bass.trace.length && !bass.delayedRootTrace && !bass.continuationTrace?.length &&
				!piano.trace.commonToneEntry && piano.trace.carriedReleaseTick === undefined &&
				!Object.values(rhythmMemory.lastAnswer).includes(bar) && (lastAnswerBar === null || bar - lastAnswerBar >= 5) &&
				!bass.events.some(e => e.innerMotion || e.phraseDialogue || e.ensembleColor || e.phraseColor || e.expression || e.conversation) &&
				!piano.events.some(e => e.conversation || e.phraseDialogue || e.innerMotion || e.ensembleColor || e.phraseColor);
			const chart = preparedBassScores.get(definition) ?? (open && !native ? prepareRollingBass(definition) : undefined);
			const walk = bass.events.filter(event => Number.isInteger(event.absBeat));
			const fullWalk = walk.length === 4 && walk.every((event, i) => event.absBeat === bar * 4 + i);
			const pitches = open && !native && bass.memory.feel === 'four' && fullWalk && chart ? fitBassAnswer(source, bass.events, chart.segments) : undefined;
			if (pitches) {
				const events = bass.events.map((event, i) => ({ ...event, midi: pitches[i], melodicSource: source,
					velocity: event.velocity < 50 ? 67 : event.velocity }));
				const pulses = events.filter(event => Number.isInteger(event.absBeat));
				const penultimate = pulses.at(-2)!;
				bass = { ...bass, events, memory: { ...bass.memory, previousPreviousMidi: penultimate.midi,
					direction: Math.sign(pulses.at(-1)!.midi - penultimate.midi) } };
				// A performed answer cannot become a fresh source for another motif.
				rhythmMemory = { ...rhythmMemory, cells: rhythmMemory.cells.filter(cell => cell.player !== 'bass' || cell.bar !== bar) };
				lastAnswerBar = bar;
			}
			let calls = memory?.bassCalls ?? [];
			const nativeBass = open && native && (definition.style === 'bossa-nova' || definition.style === 'ballad') &&
			 finishNativeBassAnswer(definition.style, heard, calls.flat(), bass.events, definition.harmony);
			if (nativeBass) {
			 const last = nativeBass.events.at(-1)!.midi;
			 const before = nativeBass.events.at(-2)?.midi ?? checkpoint?.bass.previousMidi ?? last;
			 bass = { ...bass, events: nativeBass.events, memory: { ...bass.memory, previousMidi: last,
			  previousPreviousMidi: before, direction: Math.sign(last - before) } };
			 rhythmMemory = { ...rhythmMemory, cells: rhythmMemory.cells.filter(cell => cell.player !== 'bass' || cell.bar !== bar) };
			 lastAnswerBar = bar;
			 calls = [];
			}
			const answer = definition.keyboardMelodicHandoffVersion && eligible && !nativeGesture && !displaced && !pitches && !nativeBass && !piano.trace.recall &&
				!(bass.trace.length || bass.delayedRootTrace || checkpoint?.bass.pendingLaunch) &&
				(lastAnswerBar === null || bar - lastAnswerBar >= 5) && !Object.values(rhythmMemory.lastAnswer).includes(bar) &&
				!piano.trace.commonToneEntry && piano.trace.carriedReleaseTick === undefined &&
				!piano.events.some(e => e.conversation || e.phraseDialogue || e.innerMotion || e.ensembleColor || e.phraseColor || e.expression) &&
				!piano.memory.crossBarReleaseTick && !piano.memory.commonToneNotes && piano.voicingTrace &&
				finishKeyboardAnswer({ calls, native, keyboard: heard, events: piano.events, trace: piano.voicingTrace,
					harmony: definition.harmony, previous: checkpoint?.piano.voicing, register: Math.round(58 + 8 * info.intensity) });
			if (answer) {
				const notes = [...answer.voicing.notes];
				const contour = piano.memory.contour;
				piano = { ...piano, events: answer.events, voicingTrace: answer.trace, memory: { ...piano.memory,
					lastVoicing: notes, segmentVoicing: notes, voicing: answer.voicing,
					...(piano.memory.phraseRecall?.source?.barIndex === bar && { phraseRecall:
						retainPianoPhraseRecall(checkpoint?.piano.phraseRecall, definition, bar, window.plan.trace[0].soloEvidence) }),
					...(contour && { contour: { ...contour, lastTopMidi: notes.at(-1)! } }) } };
				lastAnswerBar = bar;
				calls = [];
				rhythmMemory = { ...rhythmMemory, cells: rhythmMemory.cells.filter(cell => cell.player !== 'piano' || cell.bar !== bar) };
			}
			const call = definition.keyboardMelodicHandoffVersion && solo && !answer && bassCall(bass.events, native);
			melodicMemory = { keyboard: solo && !answer ? rememberKeyboard(pitches || nativeBass ? [] : heard, piano.events, bar, native) : [], lastAnswerBar,
				...(definition.keyboardMelodicHandoffVersion && { bassCalls: [
					...calls.filter(notes => notes[0].beat >= (bar-3)*4), ...(call ? [call] : [])] }) };
		}

		if (displaced) {
			rhythmMemory = {
				cells: rhythmMemory.cells.filter(cell =>
					!(cell.player === displaced.player && cell.bar === displaced.bar) &&
					!(cell.player === 'drums' && cell.bar === bar)),
				lastAnswer: { ...rhythmMemory.lastAnswer, drums: bar }
			};
		}
	}
	const contents: Omit<RollingBackingCheckpoint, 'checkpointId'> = { version: 1, sessionId: definition.sessionId, fingerprint: definition.fingerprint,
		nextBar: bar + 1, ...(melodicMemory ? { melodicMemory } : {}), ...(rhythmMemory ? { rhythmMemory } : {}), ...(definition.pianoPresenceVersion ? { pianoPresence: { version: 1 as const, silentBars: piano.events.length ? 0 : (checkpoint?.pianoPresence?.silentBars ?? 0) + 1,
			lastSoundingEndTick: piano.events.length ? Math.max(...piano.events.map(event => parseInt(event.time, 10) + event.duration * definition.tempo / 60 * definition.ppq)) : checkpoint?.pianoPresence?.lastSoundingEndTick ?? null } } : {}), ...(nativeBalladReplyEnabled(definition) ? { nativeBalladReply: advanceNativeBalladReplyMemory(definition, bar,
			checkpoint?.nativeBalladReply, terminalAccepted ? null : captureNativeBalladColor(info, drums.bar, drumEvents), !!nativeReply) } : {}), ...(answerPolicy ? { pianoRecovery: { version: 1 as const, previousAnswer: piano.answer ? { barIndex: bar, attack: { ...piano.answer.attack, notes: [...piano.answer.attack.notes] } } : null }, pianoAnswer: { version: 1 as const, lastAnswerBar: piano.answer ? bar : checkpoint?.pianoAnswer?.lastAnswerBar ?? null } } : {}), ensemble: window.memory, piano: piano.memory, bass: bass.memory, drums: drums.memory, timing: timingTrace,
		...(feedback ? { feedback: { version: 1 as const, previousDrumStatement: captureDrumStatement(drums.bar, drumEvents),
			lastYieldBar: !terminalAccepted && feedback.action === 'yield' ? bar : checkpoint?.feedback?.lastYieldBar ?? null } } : {}) };
	const ticks = [...bass.events, ...piano.events, ...drumEvents].map((event) => parseInt(event.time, 10));
	const result: RollingBackingBar = freeze({ version: 1, sessionId: definition.sessionId, fromBar: bar, toBarExclusive: bar + 1,
		loopIndex: definition.bars[bar].loopIndex, sourceBarIndex: definition.bars[bar].sourceBarIndex,
		sourceChorusIndex: definition.bars[bar].sourceChorusIndex, sourceSectionIndex: definition.bars[bar].sourceSectionIndex,
		startTick, earliestTick: ticks.length ? Math.min(...ticks) : startTick, committedThroughTick: endTick,
		previousCheckpointId: checkpoint?.checkpointId ?? null,
		checkpoint: { ...contents, checkpointId: checkpointId(contents) },
		bassEvents: bass.events, compEvents: piano.events, drumEvents, ensemblePlan: window.plan, ensembleTiming: [timingTrace],
		ensembleDevelopment: { version: 1,
   ...(sentence && !terminalAccepted ? { musicalSentences: [{ ...sentence, barIndex: bar,
    ...(drumSentence && bass.events.length && !bass.memory.pendingLaunch && !checkpoint?.bass.pendingLaunch && !bass.delayedRootTrace && !ensemble.coordinatedAccent && !ensemble.setupFor ? { bass: {
     registerTargetMidi: (preparedBassScores.get(definition) ?? prepareRollingBass(definition))!.centers[bar],
     attacks: bass.events.map(({time,midi})=>({time,midi})) } } : {}),
    ...(piano.trace.motifId && piano.trace.sourceFigureId && piano.trace.phraseStartBar === sentence.startBar && piano.events.length ? { keyboard: {
     motifId: piano.trace.motifId, sourceFigureId: piano.trace.sourceFigureId,
     attacks: piano.events.map(({time,notes})=>({time,notes:[...notes]})) } } : {}),
    ...(!drumSentence && piano.voicingTrace?.some(v => v.decision.keyboardLine?.status === 'connected' && v.decision.keyboardLine.contour !== 'settle') ? { keyboardLine: piano.voicingTrace.filter(v => v.decision.keyboardLine?.status === 'connected' && v.decision.keyboardLine.contour !== 'settle').map(v => ({ time:v.time, notes:[...v.notes], targetMidi:v.decision.keyboardLine!.targetMidi })) } : {}),
    ...(drumSentence && drums.bar.phraseLength === 8 && drumEvents.length ? { drums: { attacks: drumEvents.map(({time,drum,velocity})=>({time,drum,velocity})) } } : {})
   }] } : {}), ...(nativeReply ? { nativeBalladReplies: [nativeReply] } : {}), ...(terminalDecision ? { terminalArrangements: [terminalDecision] } : {}), ...(recovery ? { pianoRecoveries: [{ ...recovery, acceptedAttacks: piano.events.map(event => ({ ...event, notes: [...event.notes] })) }] } : {}), ...(piano.answer ? { pianoAnswers: [piano.answer] } : {}), pianoMotifs: [piano.trace], bassTurnarounds: bass.trace,
			...(feedback && !terminalAccepted ? { pianoFeedback: [{ ...feedback, acceptedAttacks: piano.events.map(({ time, absBeat, notes }) => ({ time, absBeat, notes: [...notes] })) }] } : {}),
			...(bass.feelTrace ? { bassFeel: [bass.feelTrace] } : {}),
			...(bass.continuationTrace?.length ? { bassContinuations: bass.continuationTrace } : {}),
			...(!terminalAccepted && bass.delayedRootTrace ? { bassDelayedRoots: [bass.delayedRootTrace] } : {}),
			...(piano.voicingTrace ? { pianoVoicings: piano.voicingTrace } : {}), drumPhrases: [drums.bar] } });
	if (ownedDefinitions.has(definition)) ownedCheckpoints.set(result.checkpoint, definition);
	return result;
}
