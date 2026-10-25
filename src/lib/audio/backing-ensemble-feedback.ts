/** Causal, optional piano breathing after a committed independent drum phrase. */
import type { BarInfo, DrumEvent, DrumStatementSource, PianoFeedbackDecision } from './backing-generation';
import type { DrumPhraseDecision } from './backing-drum-phrases';
import { createRng, seedFrom } from './generation-rng';

export interface DrumPianoFeedbackMemory {
	readonly version: 1;
	readonly previousDrumStatement: DrumStatementSource | null;
	readonly lastYieldBar: number | null;
}

type PlannedFeedback = Omit<PianoFeedbackDecision, 'acceptedAttacks'>;
const voices = ['snare', 'crossstick', 'kick'];
const transforms = ['statement', 'repeat', 'displace', 'orchestrate', 'fallback'];

/** Require agreement between the chosen gesture, accepted kit hits and scheduled events. */
export function captureDrumStatement(decision: DrumPhraseDecision, events: readonly DrumEvent[]): DrumStatementSource | null {
	if (decision.commentary.source !== 'vocabulary' || !transforms.includes(decision.commentary.transform)) return null;
	const matches = (event: DrumEvent, hit: DrumPhraseDecision['hits'][number]) =>
		hit.role === 'commentary' && event.absBeat === decision.barIndex * 4 + hit.beatOffset &&
		event.drum === hit.drum && event.velocity === hit.velocity;
	const hits = events.filter((event) => event.role === 'commentary' && voices.includes(event.drum) &&
		decision.commentary.hits.some((hit) => matches(event, hit)) && decision.hits.some((hit) => matches(event, hit)));
	if (hits.length < 2 || hits.length > 3 || new Set(hits.map((hit) => hit.absBeat)).size < 2) return null;
	return { barIndex: decision.barIndex, transform: decision.commentary.transform as DrumStatementSource['transform'],
		hits: hits.map((hit) => ({ ...hit })) };
}

/** A conservative one-in-three breath; unchanged native patterns handle every other bar. */
export function planDrumPianoFeedback(input: {
	readonly phraseId: string;
	readonly tempo: number;
	readonly barIndex: number;
	readonly info: BarInfo;
	readonly previous?: DrumPianoFeedbackMemory;
}): PlannedFeedback {
	const { info, barIndex: bar, previous } = input;
	const plan = info.ensemble!;
	const source = previous?.previousDrumStatement?.barIndex === bar - 1 ? previous.previousDrumStatement : null;
	let reason: PianoFeedbackDecision['reason'];
	if (!source) reason = 'no_statement';
	else if (plan.piano.maxAttacks === 0) reason = 'already_silent';
	else if (info.isSectionFirstBar || info.isChorusFirstBar || info.isFinalBar || plan.coordinatedAccent || plan.setupFor ||
		plan.performanceEnergy?.phase === 'ending') reason = 'reserved_transition';
	else if (plan.responseOwner !== 'nobody') reason = 'response_reserved';
	else if (previous?.lastYieldBar !== null && previous?.lastYieldBar !== undefined && bar - previous.lastYieldBar < 3) reason = 'cooldown';
	else if (!createRng(seedFrom(input.phraseId, input.tempo, 'drum-piano-yield', bar)).chance(1 / 3)) reason = 'not_selected';
	else reason = 'drum_statement';
	return { version: 1, barIndex: bar, source, action: reason === 'drum_statement' ? 'yield' : 'none', reason,
		originalMaxAttacks: plan.piano.maxAttacks, effectiveMaxAttacks: reason === 'drum_statement' ? 0 : plan.piano.maxAttacks };
}

/** Shape and timeline validation, not authentication of externally supplied musical evidence. */
export function validateDrumPianoFeedback(memory: DrumPianoFeedbackMemory, nextBar: number, ppq: number): void {
	const invalid = () => { throw new Error('Invalid rolling feedback checkpoint'); };
	if (!memory || memory.version !== 1 || Object.keys(memory).length !== 3 ||
		!Object.hasOwn(memory, 'previousDrumStatement') || !Object.hasOwn(memory, 'lastYieldBar') ||
		(memory.lastYieldBar !== null && (!Number.isSafeInteger(memory.lastYieldBar) || memory.lastYieldBar < 1 || memory.lastYieldBar >= nextBar))) invalid();
	const source = memory.previousDrumStatement;
	if (source === null) return;
	if (!source || Object.keys(source).length !== 3 || source.barIndex !== nextBar - 1 || !transforms.includes(source.transform) ||
		!Array.isArray(source.hits) || source.hits.length < 2 || source.hits.length > 3) invalid();
	for (const hit of source.hits) {
		if (!hit || Object.keys(hit).length !== 5 || hit.role !== 'commentary' || !voices.includes(hit.drum) ||
			!Number.isFinite(hit.absBeat) || hit.absBeat < source.barIndex * 4 || hit.absBeat >= nextBar * 4 ||
			!Number.isFinite(hit.velocity) || hit.velocity <= 0 || hit.velocity > 1 || typeof hit.time !== 'string' || !/^(0|[1-9]\d*)i$/.test(hit.time)) invalid();
		const tick = Number(hit.time.slice(0, -1));
		if (!Number.isSafeInteger(tick) || tick < source.barIndex * 4 * ppq || tick >= nextBar * 4 * ppq) invalid();
	}
	if (new Set(source.hits.map((hit) => hit.absBeat)).size < 2 ||
		new Set(source.hits.map((hit) => `${hit.drum}:${hit.absBeat}`)).size !== source.hits.length) invalid();
}
