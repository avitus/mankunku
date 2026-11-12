/** Native late-pad experiment using only an immediately preceding accepted drum color. */
import type { BarInfo, CompEvent, DrumEvent, NativeBalladColor } from './backing-generation';
import type { DrumPhraseDecision } from './backing-drum-phrases';
import type { CompMotifDecision } from './backing-comp-figures';
import type { RollingBackingDefinition } from './backing-rolling';
import type { SoloEvidence } from './ensemble-plan';
import { fractionToFloat } from '$lib/music/intervals';

export interface NativeBalladReplyMemory {
	readonly version: 1;
	readonly previousColor: NativeBalladColor | null;
	readonly lastReplyBar: number | null;
}
export const nativeBalladReplyEnabled = (score: RollingBackingDefinition): boolean =>
	score.style === 'ballad' && !!score.bars[0]?.performanceEnergy;

export function captureNativeBalladColor(info: BarInfo, trace: DrumPhraseDecision, events: readonly DrumEvent[]): NativeBalladColor | null {
	const plan = info.ensemble, commentary = trace.commentary;
	if (!plan?.performanceEnergy || trace.style !== 'ballad' || plan.coordinatedAccent || plan.setupFor || plan.drums.allowFill ||
		commentary.source !== 'vocabulary' || commentary.sourceId !== 'ballad-color' || commentary.transform !== 'fallback' || commentary.hits.length !== 1) return null;
	const hit = commentary.hits[0];
	if (hit.role !== 'commentary' || !['snare', 'crossstick'].includes(hit.drum) || ![2.5, 3].includes(hit.beatOffset)) return null;
	const actual = events.filter(event => event.role === 'commentary');
	if (actual.length !== 1 || actual[0].absBeat !== trace.barIndex * 4 + hit.beatOffset || actual[0].drum !== hit.drum ||
		actual[0].velocity !== hit.velocity || !trace.hits.some(value => value.role === hit.role && value.drum === hit.drum && value.beatOffset === hit.beatOffset && value.velocity === hit.velocity)) return null;
	return { barIndex: trace.barIndex, hit: { ...actual[0] } };
}

/** The ordinary whole pad must already exist; no silence or partial figure becomes a response. */
export function proposeNativeBalladReply(input: {
	readonly score: RollingBackingDefinition; readonly bar: number; readonly info: BarInfo;
	readonly evidence: SoloEvidence; readonly previous?: NativeBalladReplyMemory;
	readonly trace: CompMotifDecision; readonly events: readonly CompEvent[];
	readonly drumTrace: DrumPhraseDecision; readonly drumEvents: readonly DrumEvent[];
}): NativeBalladColor | undefined {
	const { score, bar, info, previous, trace, events } = input, plan = info.ensemble!;
	const source = previous?.previousColor;
	if (!nativeBalladReplyEnabled(score) || !source || source.barIndex !== bar - 1 ||
		(previous!.lastReplyBar !== null && bar - previous!.lastReplyBar < 3) ||
		['active', 'resting'].includes(input.evidence) || plan.piano.maxAttacks === 0 || plan.piano.silenceReason ||
		['active_soloist', 'dense_soloist'].includes(plan.piano.rootlessTexture?.reason ?? '') ||
		plan.performanceEnergy?.phase !== 'solo_build' || ['release', 'leave_space'].includes(plan.intent) || ['release', 'leave_space'].includes(plan.phraseIntent) ||
		bar === plan.phraseStartBar || info.isSectionFirstBar || info.isSectionFinalBar || info.isChorusFirstBar || info.isChorusFinalBar || info.isFinalBar ||
		plan.terminalArrangement || plan.coordinatedAccent || plan.setupFor || plan.drums.allowFill || plan.responseOwner !== 'nobody' ||
		trace.reason !== 'native_pattern' || trace.transform !== 'fallback' || trace.hits.length !== 1 || trace.hits[0].b !== 0 || trace.hits[0].d !== 3.6 ||
		events.length !== 1 || events[0].absBeat !== bar * 4 || input.drumTrace.commentary.hits.length || input.drumEvents.some(event => event.role === 'commentary')) return;
	const before = score.bars[source.barIndex], current = score.bars[bar];
	if (!before || before.sectionIndex !== current.sectionIndex || before.chorusIndex !== current.chorusIndex || before.loopIndex !== current.loopIndex) return;
	const stable = score.harmony.some(segment => fractionToFloat(segment.startOffset) * 4 <= bar * 4 &&
		(fractionToFloat(segment.startOffset) + fractionToFloat(segment.duration)) * 4 >= (bar + 1) * 4);
	if (!stable) return;
	return source;
}

/** Source evidence expires at the next bar; formal seams also reset the historical cooldown. */
export function advanceNativeBalladReplyMemory(score: RollingBackingDefinition, bar: number,
	previous: NativeBalladReplyMemory | undefined, source: NativeBalladColor | null, replied: boolean): NativeBalladReplyMemory {
	const current = score.bars[bar], next = score.bars[bar + 1];
	const seam = !next || current.sectionIndex !== next.sectionIndex || current.chorusIndex !== next.chorusIndex || current.loopIndex !== next.loopIndex;
	return { version: 1, previousColor: seam || next.phrase4.barIndex === 0 || replied ? null : source,
		lastReplyBar: seam ? null : replied ? bar : previous?.lastReplyBar ?? null };
}

/** Check bounded provenance and cross-field consistency, not authenticity of forged evidence. */
export function validateNativeBalladReply(memory: NativeBalladReplyMemory | undefined, score: RollingBackingDefinition,
	nextBar: number, recentFigures: readonly string[], onsets: readonly number[]): void {
	const invalid = () => { throw new Error('Invalid native Ballad reply checkpoint'); };
	if (!memory || memory.version !== 1 || Object.keys(memory).length !== 3 || !Object.hasOwn(memory, 'previousColor') ||
		!Object.hasOwn(memory, 'lastReplyBar') || (memory.lastReplyBar !== null && (!Number.isSafeInteger(memory.lastReplyBar) || memory.lastReplyBar < 1 || memory.lastReplyBar >= nextBar))) invalid();
	const current = score.bars[nextBar];
	const sameContext = (bar: number) => !!current && score.bars[bar]?.sectionIndex === current.sectionIndex &&
		score.bars[bar]?.chorusIndex === current.chorusIndex && score.bars[bar]?.loopIndex === current.loopIndex;
	if (memory!.lastReplyBar !== null && !sameContext(memory!.lastReplyBar)) invalid();
	const replied = memory!.lastReplyBar === nextBar - 1;
	if (replied !== (recentFigures.at(-1) === 'ballad-drum-reply') || (replied && (onsets.length !== 1 || onsets[0] !== 2))) invalid();
	const source = memory!.previousColor;
	if (source === null) return;
	if (!source || replied || Object.keys(source).length !== 2 || source.barIndex !== nextBar - 1 || !sameContext(source.barIndex) || current?.phrase4.barIndex === 0) invalid();
	const hit = source.hit;
	if (!hit || Object.keys(hit).length !== 5 || hit.role !== 'commentary' || !['snare', 'crossstick'].includes(hit.drum) ||
		![2.5, 3].includes(hit.absBeat - source.barIndex * 4) || !Number.isFinite(hit.velocity) || hit.velocity <= 0 || hit.velocity > 1 ||
		typeof hit.time !== 'string' || !/^(0|[1-9]\d*)i$/.test(hit.time)) invalid();
	const tick = Number(hit.time.slice(0, -1));
	if (!Number.isSafeInteger(tick) || tick < source.barIndex * 4 * score.ppq || tick >= nextBar * 4 * score.ppq) invalid();
}
