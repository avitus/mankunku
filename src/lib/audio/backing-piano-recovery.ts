/** One current-bar recovery experiment, grounded in an accepted reply and returning drums. */
import type { BarInfo, CompEvent, DrumEvent, PianoRecoveryDecision } from './backing-generation';
import type { DrumPhraseDecision, DrumPhraseMemory } from './backing-drum-phrases';

export interface PianoRecoveryMemory {
	readonly version: 1;
	readonly previousAnswer: PianoRecoveryDecision['source'] | null;
}

/** Match the accepted return of the independent motif retained during the reply. */
export function captureReturningDrums(decision: DrumPhraseDecision, events: readonly DrumEvent[], held: DrumPhraseMemory['phrase']['motif']): PianoRecoveryDecision['returningDrums'] {
	const commentary = decision.commentary;
	if (!held || held.source !== 'vocabulary' || commentary.source !== 'vocabulary' ||
		commentary.motifId !== held.id || commentary.sourceBar !== held.sourceBar ||
		!['repeat', 'displace', 'orchestrate'].includes(commentary.transform) || !commentary.hits.length) return null;
	const matches = (event: DrumEvent, hit: DrumPhraseDecision['hits'][number]) => hit.role === 'commentary' &&
		event.drum === hit.drum && event.absBeat === decision.barIndex * 4 + hit.beatOffset && event.velocity === hit.velocity;
	const hits = events.filter(event => event.role === 'commentary' && commentary.hits.some(hit => matches(event, hit)) &&
		decision.hits.some(hit => matches(event, hit)));
	if (hits.length !== commentary.hits.length) return null;
	return { motifId: held.id, sourceBar: held.sourceBar, hits: hits.map(hit => ({ ...hit })) };
}

export function planPianoRecovery(input: {
	readonly barIndex: number;
	readonly info: BarInfo;
	readonly currentMaxAttacks: 0 | 1 | 2;
	readonly previous?: PianoRecoveryMemory;
	readonly ordinaryAttacks: readonly CompEvent[];
	readonly returningDrums: PianoRecoveryDecision['returningDrums'];
}): Omit<PianoRecoveryDecision, 'acceptedAttacks'> | undefined {
	const source = input.previous?.previousAnswer;
	if (!source || source.barIndex !== input.barIndex - 1) return;
	const { info, barIndex: bar } = input;
	const plan = info.ensemble!;
	let reason: PianoRecoveryDecision['reason'];
	if (plan.piano.maxAttacks === 0) reason = 'already_silent';
	else if (input.currentMaxAttacks === 0 || plan.phraseIntent === 'leave_space' || plan.phraseIntent === 'release' ||
		plan.intent === 'leave_space' || plan.intent === 'release' || plan.piano.silenceReason) reason = 'higher_priority_space';
	else if (plan.performanceEnergy?.phase !== 'solo_build') reason = 'outside_build';
	else if (bar === plan.phraseStartBar || info.isSectionFirstBar || info.isChorusFirstBar || info.isSectionFinalBar ||
		info.isChorusFinalBar || info.isFinalBar || plan.coordinatedAccent || plan.setupFor || plan.drums.allowFill) reason = 'reserved_transition';
	else if (plan.responseOwner !== 'nobody') reason = 'response_reserved';
	else if (input.ordinaryAttacks.length !== 1) reason = 'no_ordinary_attack';
	else if (!input.returningDrums) reason = 'no_drum_return';
	else reason = 'after_drum_reply';
	return { version: 1, barIndex: bar, source, returningDrums: input.returningDrums,
		action: reason === 'after_drum_reply' ? 'space' : 'none', reason,
		originalMaxAttacks: plan.piano.maxAttacks, effectiveMaxAttacks: reason === 'after_drum_reply' ? 0 : input.currentMaxAttacks };
}

/** Bounded shape and cross-field consistency, not authentication of uploaded evidence. */
export function validatePianoRecoveryMemory(memory: PianoRecoveryMemory | undefined, input: {
	readonly nextBar: number; readonly ppq: number; readonly tempo: number;
	readonly lastAnswerBar: number | null; readonly replyMarked: boolean;
	readonly previousCompOnsets: readonly number[]; readonly lastVoicing: readonly number[];
}): void {
	const invalid = () => { throw new Error('Invalid rolling piano recovery checkpoint'); };
	if (!memory || memory.version !== 1 || Object.keys(memory).length !== 2 || !Object.hasOwn(memory, 'previousAnswer')) invalid();
	const source = memory!.previousAnswer;
	if (source === null) {
		if (input.replyMarked || input.lastAnswerBar === input.nextBar - 1) invalid();
		return;
	}
	if (!source || Object.keys(source).length !== 2 || source.barIndex !== input.nextBar - 1 ||
		input.lastAnswerBar !== source.barIndex || !input.replyMarked) invalid();
	const event = source.attack;
	if (!event || Object.keys(event).length !== 5 || !Array.isArray(event.notes) || event.notes.length < 2 || event.notes.length > 8 ||
		event.notes.some((note, index) => !Number.isInteger(note) || note < 48 || note > 84 || (index > 0 && note <= event.notes[index - 1])) ||
		event.notes.length !== input.lastVoicing.length || event.notes.some((note, index) => note !== input.lastVoicing[index]) ||
		!Number.isFinite(event.absBeat) || !Number.isInteger(event.absBeat * 2) || event.absBeat < source.barIndex * 4 + 1 || event.absBeat >= source.barIndex * 4 + 3.5 ||
		input.previousCompOnsets.length !== 1 || input.previousCompOnsets[0] !== event.absBeat - source.barIndex * 4 ||
		!Number.isFinite(event.duration) || event.duration <= 0 || event.duration > 0.7 * 60 / input.tempo + 1e-9 ||
		!Number.isInteger(event.velocity) || event.velocity <= 0 || event.velocity > 127 ||
		typeof event.time !== 'string' || !/^(0|[1-9]\d*)i$/.test(event.time)) invalid();
	const tick = Number(event.time.slice(0, -1));
	if (!Number.isSafeInteger(tick) || tick < source.barIndex * 4 * input.ppq || tick >= input.nextBar * 4 * input.ppq ||
		event.duration > (input.nextBar * 4 * input.ppq - tick) * 60 / input.tempo / input.ppq + 1e-9) invalid();
}
