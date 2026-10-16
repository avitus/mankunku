/** Pure append-only, one-bar realization for the finite coordinated listening lab. */
import type { HarmonicSegment } from '$lib/types/music';
import type { PerformanceForm } from '$lib/types/performance-form';
import type { BackingGenerationParams, BarInfo, BassEvent, CompEvent, DrumEvent, EnsembleDevelopment } from './backing-generation';
import { buildBarInfos } from './backing-generation';
import { buildPerformanceForm, performanceBarContext, type PerformanceBarContext } from './performance-form';
import { planEnsembleWindow, type EnsembleBarContext, type EnsembleMemory, type EnsemblePlan, type SoloFeature } from './ensemble-plan';
import { describeEnsemblePhraseTiming, restoreEnsembleTiming, type EnsemblePhraseTimingTrace } from './ensemble-timing';
import type { StyleDefinition } from './backing-styles';
import { fractionToFloat } from '$lib/music/intervals';
import { seedFrom } from './generation-rng';
import { realizeRollingPiano, type RollingPianoMemory } from './backing-rolling-piano';
import { realizeRollingBass, type RollingBassMemory } from './backing-rolling-bass';
import { planDrumPhraseBar, type DrumPhraseMemory } from './backing-drum-phrases';
import type { TimingProfile, TimingRole } from './backing-timing';

export interface RollingBackingDefinition {
	readonly version: 1;
	readonly sessionId: string;
	readonly fingerprint: string;
	readonly phraseId: string;
	readonly totalBars: number;
	readonly tempo: number;
	readonly ppq: number;
	readonly beatsPerBar: 4;
	readonly swing: number;
	readonly performanceForm: PerformanceForm;
	readonly harmony: readonly HarmonicSegment[];
	readonly bars: readonly (EnsembleBarContext & BarInfo & PerformanceBarContext)[];
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
}

export interface RollingBackingBar {
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
export function createRollingBacking(harmony: HarmonicSegment[], style: StyleDefinition, params: BackingGenerationParams): RollingBackingDefinition {
	if (style.name !== 'Swing' || params.beatsPerBar !== 4 || !params.ensemble) throw new Error('Rolling backing requires coordinated swing 4/4');
	if (!Number.isFinite(params.tempo) || params.tempo < 30 || params.tempo > 320 || !Number.isSafeInteger(params.ppq) || params.ppq <= 0 || !Number.isFinite(params.swing) || params.swing < 0.5 || params.swing > 0.8) throw new Error('Invalid rolling backing tempo, PPQ or swing');
	const copied: HarmonicSegment[] = JSON.parse(JSON.stringify(harmony));
	let end = 0;
	for (const segment of copied) {
		const start = fractionToFloat(segment.startOffset) * 4;
		const length = fractionToFloat(segment.duration) * 4;
		if (start !== end || !Number.isInteger(length) || length <= 0) throw new Error('Rolling harmony must cover complete contiguous quarter beats');
		end += length;
	}
	const totalBars = end / 4;
	if (!Number.isInteger(totalBars) || totalBars < 1 || totalBars > 128) throw new Error('Rolling backing requires 1–128 complete bars');
	const form: PerformanceForm = params.performanceForm ? JSON.parse(JSON.stringify(params.performanceForm)) : buildPerformanceForm({ totalBars,
		sectionMap: params.sectionMap ?? [], choruses: [{ role: 'solo', startBar: 0, endBarExclusive: totalBars }] });
	if (form.totalBars !== totalBars) throw new Error('Rolling performance form must match complete harmony');
	if (form.version !== 1 || !form.choruses.length || !form.sections.length) throw new Error('Invalid rolling performance form');
	for (const spans of [form.choruses, form.sections]) {
		let next = 0;
		for (const [index, span] of spans.entries()) {
			if (span.index !== index || span.startBar !== next || !Number.isInteger(span.endBarExclusive) || span.endBarExclusive <= next || span.endBarExclusive > totalBars) throw new Error('Rolling performance form must cover complete contiguous bars');
			next = span.endBarExclusive;
		}
		if (next !== totalBars) throw new Error('Rolling performance form must cover complete contiguous bars');
	}
	const bars = buildBarInfos(totalBars, undefined, form).map((info, barIndex) => ({ ...info, ...performanceBarContext(form, barIndex)!, barIndex }));
	const timingProfiles = params.timing ?? style.timing;
	const fingerprint = JSON.stringify([1, params.phraseId, params.tempo, params.ppq, params.swing, copied, form, timingProfiles]);
	return freeze({ version: 1, sessionId: `rolling:${seedFrom(fingerprint).toString(16)}`, fingerprint,
		phraseId: params.phraseId, totalBars, tempo: params.tempo, ppq: params.ppq, beatsPerBar: 4, swing: params.swing,
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
	const piano = realizeRollingPiano(definition, bar, info, timing, checkpoint?.piano);
	const bass = realizeRollingBass(definition, bar, info, timing, checkpoint?.bass);
	const startTick = bar * 4 * definition.ppq;
	const endTick = (bar + 1) * 4 * definition.ppq;
	const drums = planDrumPhraseBar({ phraseId: definition.phraseId, tempo: definition.tempo, beatsPerBar: 4,
		barIndex: bar, info, phraseStartBar: ensemble.phraseStartBar, phraseEndBarExclusive: phraseEnd, harmonyEndBeat: definition.totalBars * 4,
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
		nextBar: bar + 1, ensemble: window.memory, piano: piano.memory, bass: bass.memory, drums: drums.memory, timing: timingTrace };
	const ticks = [...bass.events, ...piano.events, ...drumEvents].map((event) => parseInt(event.time, 10));
	return freeze({ version: 1, sessionId: definition.sessionId, fromBar: bar, toBarExclusive: bar + 1,
		startTick, earliestTick: ticks.length ? Math.min(...ticks) : startTick, committedThroughTick: endTick,
		previousCheckpointId: checkpoint?.checkpointId ?? null,
		checkpoint: { ...contents, checkpointId: checkpointId(contents) },
		bassEvents: bass.events, compEvents: piano.events, drumEvents, ensemblePlan: window.plan, ensembleTiming: [timingTrace],
		ensembleDevelopment: { version: 1, pianoMotifs: [piano.trace], bassTurnarounds: bass.trace, drumPhrases: [drums.bar] } });
}
