/** Bounded replies to an independent, already committed drummer statement. */
import type { BarInfo, DrumStatementSource, PianoFeedbackDecision } from './backing-generation';
import type { CompHitSpec } from './backing-styles';

export interface PianoAnswerMemory {
	readonly version: 1;
	readonly lastAnswerBar: number | null;
}

export interface PianoAnswerProposal {
	readonly source: DrumStatementSource;
	readonly hit: CompHitSpec;
}

/** Preserve native fallback selection/articulation draws; move only one existing attack. */
export function proposePianoAnswer(input: {
	readonly barIndex: number;
	readonly info: BarInfo;
	readonly feedback?: Omit<PianoFeedbackDecision, 'acceptedAttacks'>;
	readonly previous?: PianoAnswerMemory;
	readonly retainedMotif: boolean;
	readonly realized: readonly CompHitSpec[];
}): PianoAnswerProposal | undefined {
	const { barIndex: bar, info, feedback, previous } = input;
	const plan = info.ensemble;
	const source = feedback?.source;
	if (!plan?.performanceEnergy || feedback?.reason !== 'not_selected' || !source || source.barIndex !== bar - 1 ||
		plan.piano.maxAttacks !== 1 || input.retainedMotif || input.realized.length !== 1 ||
		plan.piano.silenceReason || plan.piano.rootlessTexture?.reason === 'active_soloist' ||
		plan.phraseIntent === 'leave_space' || plan.phraseIntent === 'release' || plan.intent === 'leave_space' || plan.intent === 'release' ||
		plan.performanceEnergy.phase !== 'solo_build' ||
		info.isSectionFirstBar || info.isChorusFirstBar || info.isSectionFinalBar || info.isChorusFinalBar || info.isFinalBar ||
		plan.coordinatedAccent || plan.setupFor || plan.drums.allowFill || plan.responseOwner !== 'nobody' ||
		(previous?.lastAnswerBar !== null && previous?.lastAnswerBar !== undefined && bar - previous.lastAnswerBar < 3)) return;
	const offset = Math.min(...source.hits.map((hit) => hit.absBeat - source.barIndex * 4)) + 1;
	const original = input.realized[0];
	if (!Number.isFinite(offset) || offset < 1 || offset >= 3.5 || offset * 2 !== Math.round(offset * 2) ||
		!Number.isFinite(original.durationBeats) || original.durationBeats <= 0 || offset === original.beatOffset) return;
	return { source, hit: { ...original, beatOffset: offset, durationBeats: Math.min(original.durationBeats, 0.7) } };
}

export function validatePianoAnswerMemory(memory: PianoAnswerMemory | undefined, nextBar: number): void {
	if (!memory || memory.version !== 1 || Object.keys(memory).length !== 2 || !Object.hasOwn(memory, 'lastAnswerBar') ||
		(memory.lastAnswerBar !== null && (!Number.isSafeInteger(memory.lastAnswerBar) || memory.lastAnswerBar < 1 || memory.lastAnswerBar >= nextBar))) {
		throw new Error('Invalid rolling piano answer checkpoint');
	}
}
