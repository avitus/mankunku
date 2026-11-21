/** One-use adjacent-phrase recall grounded in a complete emitted piano cell. */
import type { BarInfo, CompEvent } from './backing-generation';
import { type CompMotifDecision, type PianoMotifRecallSource } from './backing-comp-figures';
import { keyboardFigures } from './backing-keyboard-vocabulary';
import type { SoloEvidence } from './ensemble-plan';
import type { RollingBackingDefinition } from './backing-rolling';
import type { RollingPianoMemory } from './backing-rolling-piano';

export interface PianoPhraseRecallMemory {
	readonly version: 1;
	readonly source: PianoMotifRecallSource | null;
	readonly recalledAt: number | null;
}
export const emptyPianoPhraseRecall = (): PianoPhraseRecallMemory => ({ version: 1, source: null, recalledAt: null });
export const pianoPhraseRecallEnabled = (score: RollingBackingDefinition): boolean =>
	!score.longerSentencesVersion && !!score.bars[0]?.performanceEnergy && (!score.style || score.style === 'swing' || score.style === 'straight');

const supportedEvidence = (evidence: SoloEvidence) => evidence !== 'active' && evidence !== 'resting';
function eligible(info: BarInfo, evidence: SoloEvidence): boolean {
	const plan = info.ensemble;
	return !!plan?.performanceEnergy && ['solo_build', 'solo_peak'].includes(plan.performanceEnergy.phase) &&
		supportedEvidence(evidence) && !['active_soloist', 'dense_soloist'].includes(plan.piano.rootlessTexture?.reason ?? '') &&
		plan.piano.maxAttacks > 0 && !plan.piano.silenceReason && !['leave_space', 'release'].includes(plan.phraseIntent) &&
		!['leave_space', 'release'].includes(plan.intent) && plan.responseOwner === 'nobody' &&
		!plan.coordinatedAccent && !plan.setupFor && !plan.drums.allowFill &&
		!info.isSectionFirstBar && !info.isChorusFirstBar && !info.isSectionFinalBar && !info.isChorusFinalBar && !info.isFinalBar;
}
const cloneAttacks = (events: readonly CompEvent[]) => events.map(event => ({ ...event, notes: [...event.notes] }));
const completeStatement = (score: RollingBackingDefinition, trace: CompMotifDecision, events: readonly CompEvent[]): boolean => {
	const figure = keyboardFigures(score).find(figure => figure.id === trace.sourceFigureId);
	return trace.transform === 'statement' && !trace.recall && !!figure && figure.bars === 1 && !figure.tags.includes('pad') &&
		figure.hits[0].length > 0 && figure.hits[0].length === events.length &&
		figure.hits[0].every((hit, index) => events[index].absBeat === trace.barIndex * 4 + hit.b);
};

/** Forget at formal boundaries, expiry or qualified activity; unknown is not a rest. */
export function retainPianoPhraseRecall(previous: PianoPhraseRecallMemory | undefined, score: RollingBackingDefinition,
	bar: number, evidence: SoloEvidence): PianoPhraseRecallMemory {
	const source = previous?.source;
	const current = score.bars[bar];
	if (!source || !supportedEvidence(evidence) || current.chorusIndex !== source.chorusIndex || current.sectionIndex !== source.sectionIndex ||
		current.loopIndex !== source.loopIndex || bar >= source.barIndex + 8 ||
		(previous!.recalledAt === null && bar > source.barIndex + 4)) return emptyPianoPhraseRecall();
	return previous!;
}

export function capturePianoMotifSource(score: RollingBackingDefinition, bar: number, info: BarInfo, evidence: SoloEvidence,
	trace: CompMotifDecision, events: readonly CompEvent[]): PianoMotifRecallSource | null {
	const form = score.bars[bar];
	if (!eligible(info, evidence) || form.phrase4.lengthBars !== 4 || info.ensemble!.phraseStartBar !== bar || !completeStatement(score, trace, events)) return null;
	return { barIndex: bar, phraseStartBar: bar, chorusIndex: form.chorusIndex, sectionIndex: form.sectionIndex,
		loopIndex: form.loopIndex, figureId: trace.sourceFigureId!, attacks: cloneAttacks(events) };
}

export function proposePianoMotifRecall(input: {
	score: RollingBackingDefinition; bar: number; info: BarInfo; evidence: SoloEvidence; memory: PianoPhraseRecallMemory;
	trace: CompMotifDecision; events: readonly CompEvent[]; motif: RollingPianoMemory['motif'];
}): RollingPianoMemory['motif'] | undefined {
	const { source, recalledAt } = input.memory;
	const { bar, info, motif, score } = input;
	if (!source || recalledAt !== null || bar !== source.barIndex + 4 || !motif || motif.startBar !== bar ||
		info.ensemble!.phraseStartBar !== bar || score.bars[bar].phrase4.lengthBars !== 4 || !eligible(info, input.evidence) ||
		!completeStatement(score, input.trace, input.events) || motif.sourceId === source.figureId || source.attacks.length !== input.events.length) return;
	const figure = keyboardFigures(score).find(figure => figure.id === source.figureId)!;
	if (figure.hits[0].length > info.ensemble!.piano.maxAttacks ||
		figure.hits[0].some(hit => hit.b + motif.shift < 0 || hit.b + motif.shift >= 3.5)) return;
	return { ...motif, sourceId: source.figureId };
}

// Only keyboard receipts belong in a recalled chord. Keep their JSON shape so
// export/replay is identical to the owned in-memory checkpoint, while rejecting
// unknown fields, non-finite numbers and receipts for the other musicians.
function validRecallAttackShape(event: CompEvent): boolean {
 const required = ['absBeat', 'time', 'notes', 'duration', 'velocity'];
 const optional = ['expression', 'ensembleColor', 'phraseColor', 'phraseDialogue', 'innerMotion', 'conversation'];
 if (!required.every(key => Object.hasOwn(event, key)) || Object.keys(event).some(key => !required.includes(key) && !optional.includes(key))) return false;
 type Check = (value: unknown) => boolean;
 const finite: Check = value => typeof value === 'number' && Number.isFinite(value);
 const midi: Check = value => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 127;
 const pc: Check = value => Number.isInteger(value) && Number(value) >= 0 && Number(value) < 12;
 const positive: Check = value => finite(value) && Number(value) > 0;
 const velocity: Check = value => positive(value) && Number(value) <= 127;
 const notes: Check = value => Array.isArray(value) && value.length >= 2 && value.length <= 8 && value.every(midi);
 const oneOf = (...values: unknown[]): Check => value => values.includes(value);
 const shape = (value: unknown, fields: Record<string, Check>): boolean => !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === Object.keys(fields).length && Object.entries(fields).every(([key, check]) => Object.hasOwn(value, key) && check((value as Record<string, unknown>)[key]));
 const receipts: Record<string, Record<string, Check>> = {
  expression: { kind: oneOf('short-held'), originalVelocity: velocity, originalDuration: positive, part: oneOf('statement', 'answer') },
  ensembleColor: { kind: oneOf('drop3'), fromMidi: midi, toMidi: midi, originalNotes: notes },
  phraseColor: { kind: oneOf('upper-structure'), rootPc: pc, addedMidi: midi, originalNotes: notes },
  phraseDialogue: { kind: oneOf('fourth-stack'), originalVelocity: velocity, velocityScale: positive, originalNotes: notes, notes, rootPc: pc, third: oneOf(3, 4), seventh: oneOf(10, 11) },
  innerMotion: { kind: oneOf('chromatic-inner'), phase: oneOf('approach', 'resolution'), fromMidi: midi, toMidi: midi, approachBeat: finite, resolutionBeat: finite, rootPc: pc },
  conversation: { kind: oneOf('dominant-b9'), fromMidi: midi, toMidi: midi, rootPc: pc, targetRootPc: pc }
 };
 return optional.every(key => !Object.hasOwn(event, key) || shape((event as unknown as Record<string, unknown>)[key], receipts[key]));
}

/** Validate shape, score identity and bounded provenance, not authenticity of uploads. */
export function validatePianoPhraseRecall(memory: PianoPhraseRecallMemory | undefined, score: RollingBackingDefinition,
	nextBar: number, motif: RollingPianoMemory['motif']): void {
	const invalid = (): never => { throw new Error('Invalid rolling piano phrase recall checkpoint'); };
	const keys = (value: object, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
	if (!memory || memory.version !== 1 || !keys(memory, ['version', 'source', 'recalledAt'])) return invalid();
	const source = memory.source;
	if (source === null) { if (memory.recalledAt !== null) invalid(); return; }
	if (!source || !keys(source, ['barIndex', 'phraseStartBar', 'chorusIndex', 'sectionIndex', 'loopIndex', 'figureId', 'attacks']) ||
		!Number.isSafeInteger(source.barIndex) || source.barIndex < 0 || source.barIndex >= nextBar || nextBar - source.barIndex > 8 ||
		source.phraseStartBar !== source.barIndex) return invalid();
	const form = score.bars[source.barIndex], last = score.bars[nextBar - 1];
	if (form.phrase4.lengthBars !== 4 || form.phrase4.barIndex !== 0 || form.role !== 'solo' ||
		!['solo_build', 'solo_peak'].includes(form.performanceEnergy?.phase ?? '') ||
		form.chorusIndex !== source.chorusIndex || form.sectionIndex !== source.sectionIndex || form.loopIndex !== source.loopIndex ||
		last.chorusIndex !== source.chorusIndex || last.sectionIndex !== source.sectionIndex || last.loopIndex !== source.loopIndex) invalid();
	if (memory.recalledAt !== null && (!Number.isSafeInteger(memory.recalledAt) || memory.recalledAt !== source.barIndex + 4 || memory.recalledAt >= nextBar ||
		motif?.startBar !== memory.recalledAt || motif.sourceId !== source.figureId)) invalid();
	if (memory.recalledAt === null && nextBar - 1 > source.barIndex + 4) invalid();
	const figure = keyboardFigures(score).find(figure => figure.id === source.figureId);
	if (!figure || figure.bars !== 1 || figure.tags.includes('pad') || !figure.hits[0].length || !Array.isArray(source.attacks) ||
		source.attacks.length !== figure.hits[0].length || source.attacks.length > 2) return invalid();
	for (const [index, event] of source.attacks.entries()) {
		if (!event || !validRecallAttackShape(event) ||
			event.absBeat !== source.barIndex * 4 + figure.hits[0][index].b || !Array.isArray(event.notes) || event.notes.length < 2 || event.notes.length > 8 ||
			event.notes.some((note: number, i: number) => !Number.isInteger(note) || note < (score.ensembleColorsVersion ? 45 : 48) || note > 84 || (i > 0 && note <= event.notes[i - 1])) ||
			!Number.isFinite(event.duration) || event.duration <= 0 || !Number.isFinite(event.velocity) || event.velocity < 1 || event.velocity > 127 ||
			typeof event.time !== 'string' || !/^(0|[1-9]\d*)i$/.test(event.time)) return invalid();
		const tick = Number(event.time.slice(0, -1)), end = (source.barIndex + 1) * 4 * score.ppq;
		if (!Number.isSafeInteger(tick) || tick < source.barIndex * 4 * score.ppq || tick >= end ||
			event.duration > (end - tick) * 60 / score.tempo / score.ppq + 1e-9) invalid();
	}
}
