/**
 * Pure phrase-level coordination for the existing rhythm-section vocabulary.
 *
 * This planner chooses roles and budgets before instruments generate notes. It
 * never deletes arbitrary rendered notes, changes the bass pulse, or treats an
 * unavailable microphone as a silent soloist. Musical state is explicit and
 * resumable; named RNG streams keep planning independent of instrument draws.
 */
import { createRng, seedFrom } from './generation-rng';

export type EnsembleIntent = 'support' | 'leave_space' | 'build' | 'release' | 'answer' | 'mark_form';
export type ResponseOwner = 'piano' | 'drums' | 'bass' | 'nobody';
export type EnsembleRole = 'time' | 'support' | 'lead' | 'respond' | 'leave_space' | 'mark_form';
export type SilenceReason =
	| 'soloist_dense'
	| 'leave_space'
	| 'after_response'
	| 'avoid_overlap'
	| 'phrase_resolution';

/** Structural subset of PerformanceBarContext, with the existing intensity arc. */
export interface EnsembleBarContext {
	readonly barIndex: number;
	readonly intensity: number;
	/** Style ceiling, also binding serialized planner memory. */
	readonly energyCeiling?: number;
	readonly isSectionFirstBar: boolean;
	readonly isSectionFinalBar: boolean;
	readonly isChorusFirstBar?: boolean;
	readonly isChorusFinalBar?: boolean;
	readonly isFinalBar: boolean;
	readonly boundaryStrength?: number;
	readonly role?: 'head' | 'solo';
	readonly phrase4?: {
		readonly index: number;
		readonly barIndex: number;
		readonly lengthBars: number;
		readonly position: number;
		readonly barsRemaining: number;
		readonly isFinalBar: boolean;
	};
}

/**
 * Features are explicitly supplied observations, not inferred from missing input.
 * `barIndex` is the decision bar; `observedAtBar` is when evidence was available.
 * Live observation adapters must never submit a future observation as current.
 */
export interface SoloFeature {
	readonly barIndex: number;
	readonly observedAtBar: number;
	readonly source: 'scripted' | 'microphone' | 'midi';
	readonly confidence: number;
	readonly noteDensity: number;
	readonly restBeats: number;
	readonly phraseEnded?: boolean;
}

export interface CoordinatedAccent {
	readonly id: string;
	readonly targetBarIndex: number;
	readonly beatOffset: 0;
	readonly strength: number;
	readonly participants: readonly ('bass' | 'piano' | 'drums')[];
}

export interface EnsembleBarPlan {
	readonly barIndex: number;
	readonly phraseStartBar: number;
	readonly phraseIntent: EnsembleIntent;
	readonly intent: EnsembleIntent;
	readonly energy: number;
	readonly density: number;
	readonly tension: number;
	readonly boundaryStrength: number;
	readonly responseOwner: ResponseOwner;
	readonly piano: {
		readonly role: EnsembleRole;
		readonly maxAttacks: 0 | 1 | 2;
		readonly densityScale: number;
		readonly silenceReason?: SilenceReason;
	};
	readonly drums: {
		readonly role: EnsembleRole;
		readonly keepTime: true;
		readonly maxCommentaryHits: 0 | 1 | 2 | 3;
		readonly commentaryScale: number;
		readonly allowFill: boolean;
		readonly silenceReason?: SilenceReason;
	};
	readonly bass: {
		readonly role: 'time' | 'respond';
		readonly keepPulse: true;
		readonly ornamentScale: number;
	};
	/** The arrival, attached to its target bar, after a planned preceding setup. */
	readonly coordinatedAccent?: CoordinatedAccent;
	/** Setup reservation on the bar before the coordinated arrival. */
	readonly setupFor?: CoordinatedAccent;
}

export type SoloEvidence = 'unavailable' | 'low_confidence' | 'stale' | 'invalid' | 'active' | 'resting';
export interface EnsembleDecision {
	readonly barIndex: number;
	readonly phraseStartBar: number;
	readonly phraseIntent: EnsembleIntent;
	readonly lead: 'piano' | 'drums' | 'nobody';
	readonly soloEvidence: SoloEvidence;
	readonly responseWindow: 'solo_rest' | 'phrase_boundary' | 'none';
	readonly responseOwner: ResponseOwner;
	readonly responseSuppressedByCooldown: boolean;
	readonly fillReserved: boolean;
	readonly reasons: readonly string[];
}

export interface EnsemblePlan {
	readonly version: 1;
	readonly bars: readonly EnsembleBarPlan[];
	readonly trace: readonly EnsembleDecision[];
}

export interface EnsemblePlanInput {
	readonly phraseId: string;
	readonly tempo: number;
	readonly bars: readonly EnsembleBarContext[];
	readonly soloFeatures?: readonly SoloFeature[];
}

export interface EnsemblePhraseMemory {
	readonly startBar: number;
	readonly endBarExclusive: number;
	readonly intent: EnsembleIntent;
	readonly lead: 'piano' | 'drums' | 'nobody';
	readonly barsPlanned: number;
	readonly energyTotal: number;
	readonly responseCount: number;
	readonly fillCount: number;
}

/** A bounded, JSON-safe checkpoint for one explicitly identified full form. */
export interface EnsembleMemory {
	readonly version: 1;
	readonly phraseId: string;
	readonly tempo: number;
	readonly formFingerprint: string;
	readonly totalBars: number;
	readonly nextBar: number;
	readonly activePhrase: {
		readonly startBar: number;
		readonly intent: EnsembleIntent;
		readonly lead: 'piano' | 'drums' | 'nobody';
	} | null;
	readonly previousIntent: EnsembleIntent | null;
	readonly previousLead: 'piano' | 'drums' | 'nobody';
	readonly lastResponseBar: number | null;
	readonly lastResponseOwner: ResponseOwner;
	readonly lastFillBar: number | null;
	readonly pendingArrival: CoordinatedAccent | null;
	/** Short-term memory: the last two planning decisions. */
	readonly recentBars: readonly {
		readonly barIndex: number;
		readonly phraseStartBar: number;
		readonly intent: EnsembleIntent;
		readonly responseOwner: ResponseOwner;
		readonly pianoAttackBudget: number;
		readonly drumCommentaryBudget: number;
		readonly energy: number;
		readonly density: number;
		readonly tension: number;
		readonly fill: boolean;
		readonly setupTargetBar: number | null;
	}[];
	/** Medium-term memory: up to four phrase summaries, including the active phrase. */
	readonly recentPhrases: readonly EnsemblePhraseMemory[];
	readonly performance: {
		readonly barsPlanned: number;
		readonly phrasesPlanned: number;
		readonly responseCount: number;
		readonly fillCount: number;
		readonly arrivalCount: number;
		readonly peakEnergy: number;
		readonly peakDensity: number;
		readonly intentCounts: Readonly<Record<EnsembleIntent, number>>;
		readonly responseCounts: Readonly<Record<ResponseOwner, number>>;
	};
}

export interface EnsembleWindowInput extends EnsemblePlanInput {
	/** Every call receives the full known form, not a sliced list of bars. */
	readonly startBar?: number;
	readonly endBarExclusive?: number;
	readonly memory?: EnsembleMemory;
}

export interface EnsembleWindowResult {
	readonly plan: EnsemblePlan;
	readonly memory: EnsembleMemory;
}

/** Restore checkpoint immutability after JSON persistence or cache replay. */
export function freezeEnsembleMemory(memory: EnsembleMemory): EnsembleMemory {
	if (memory.activePhrase) Object.freeze(memory.activePhrase);
	if (memory.pendingArrival) {
		Object.freeze(memory.pendingArrival.participants);
		Object.freeze(memory.pendingArrival);
	}
	for (const bar of memory.recentBars) Object.freeze(bar);
	for (const phrase of memory.recentPhrases) Object.freeze(phrase);
	Object.freeze(memory.recentBars);
	Object.freeze(memory.recentPhrases);
	Object.freeze(memory.performance.intentCounts);
	Object.freeze(memory.performance.responseCounts);
	Object.freeze(memory.performance);
	return Object.freeze(memory);
}

/** Restore the immutable plan contract after a serialized cache or event replay. */
export function freezeEnsemblePlan(plan: EnsemblePlan): EnsemblePlan {
	for (const bar of plan.bars) {
		Object.freeze(bar.piano);
		Object.freeze(bar.drums);
		Object.freeze(bar.bass);
		for (const accent of [bar.coordinatedAccent, bar.setupFor]) {
			if (!accent) continue;
			Object.freeze(accent.participants);
			Object.freeze(accent);
		}
		Object.freeze(bar);
	}
	for (const entry of plan.trace) {
		Object.freeze(entry.reasons);
		Object.freeze(entry);
	}
	Object.freeze(plan.bars);
	Object.freeze(plan.trace);
	return Object.freeze(plan);
}

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));
type PhraseChoice = { intent: EnsembleIntent; lead: 'piano' | 'drums' | 'nobody' };
type Draft = { -readonly [K in keyof EnsembleBarPlan]: EnsembleBarPlan[K] };

const INTENTS: readonly EnsembleIntent[] = ['support', 'leave_space', 'build', 'release', 'answer', 'mark_form'];
const OWNERS: readonly ResponseOwner[] = ['piano', 'drums', 'bass', 'nobody'];
const isIntent = (value: unknown): value is EnsembleIntent => INTENTS.includes(value as EnsembleIntent);
const isOwner = (value: unknown): value is ResponseOwner => OWNERS.includes(value as ResponseOwner);
const isLead = (value: unknown): value is PhraseChoice['lead'] => value === 'piano' || value === 'drums' || value === 'nobody';
const count = (value: unknown, max: number): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const unit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const keysAre = (value: object, keys: readonly string[]): boolean =>
	Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** Hash only the semantic full-form fields; this identity is not a security signature. */
function formFingerprint(bars: readonly EnsembleBarContext[]): string {
	const canonical = JSON.stringify(bars.map((bar) => [
		bar.barIndex, bar.intensity, bar.isSectionFirstBar, bar.isSectionFinalBar,
		bar.isChorusFirstBar ?? false, bar.isChorusFinalBar ?? false, bar.isFinalBar,
		bar.boundaryStrength ?? null, bar.role ?? null,
		bar.phrase4 ? [bar.phrase4.index, bar.phrase4.barIndex, bar.phrase4.lengthBars,
			bar.phrase4.position, bar.phrase4.barsRemaining, bar.phrase4.isFinalBar] : null,
		...(bar.energyCeiling !== undefined ? [bar.energyCeiling] : [])
	]));
	return `form-v1:${bars.length}:${seedFrom('ensemble-form', canonical).toString(16)}`;
}

function initialMemory(input: EnsemblePlanInput, fingerprint: string): EnsembleMemory {
	return {
		version: 1, phraseId: input.phraseId, tempo: input.tempo,
		formFingerprint: fingerprint, totalBars: input.bars.length, nextBar: 0,
		activePhrase: null, previousIntent: null, previousLead: 'nobody',
		lastResponseBar: null, lastResponseOwner: 'nobody', lastFillBar: null, pendingArrival: null,
		recentBars: [], recentPhrases: [],
		performance: {
			barsPlanned: 0, phrasesPlanned: 0, responseCount: 0, fillCount: 0, arrivalCount: 0,
			peakEnergy: 0, peakDensity: 0,
			intentCounts: { support: 0, leave_space: 0, build: 0, release: 0, answer: 0, mark_form: 0 },
			responseCounts: { piano: 0, drums: 0, bass: 0, nobody: 0 }
		}
	};
}

/** Validate persisted state before cloning or consuming any musical memory. */
function validateMemory(memory: EnsembleMemory, input: EnsemblePlanInput, fingerprint: string): void {
	const invalid = (): never => { throw new Error('Invalid ensemble memory checkpoint'); };
	if (!memory || memory.version !== 1) throw new Error('Unsupported ensemble memory checkpoint version');
	if (!keysAre(memory, ['version', 'phraseId', 'tempo', 'formFingerprint', 'totalBars', 'nextBar',
		'activePhrase', 'previousIntent', 'previousLead', 'lastResponseBar', 'lastResponseOwner', 'lastFillBar',
		'pendingArrival', 'recentBars', 'recentPhrases', 'performance'])) invalid();
	if (memory.phraseId !== input.phraseId || memory.tempo !== input.tempo) {
		throw new Error('Ensemble memory belongs to another phrase or tempo');
	}
	if (memory.totalBars !== input.bars.length || memory.formFingerprint !== fingerprint) {
		throw new Error('Ensemble memory requires the same explicit full form timeline');
	}
	const next = memory.nextBar;
	if (!count(next, input.bars.length)) invalid();
	// Memory is deliberately bounded; reject malformed arrays before traversing them.
	if (!Array.isArray(memory.recentBars) || memory.recentBars.length !== Math.min(2, next) ||
		!Array.isArray(memory.recentPhrases) || memory.recentPhrases.length > 4) invalid();
	const performance = memory.performance;
	if (!performance || performance.barsPlanned !== next || !count(performance.phrasesPlanned, next) ||
		!count(performance.responseCount, next) || !count(performance.fillCount, next) ||
		!count(performance.arrivalCount, performance.fillCount) || !unit(performance.peakEnergy) ||
		!unit(performance.peakDensity) || !performance.intentCounts || !performance.responseCounts) invalid();
	if (!keysAre(performance, ['barsPlanned', 'phrasesPlanned', 'responseCount', 'fillCount', 'arrivalCount',
		'peakEnergy', 'peakDensity', 'intentCounts', 'responseCounts'])) invalid();
	if (Object.keys(performance.intentCounts).length !== INTENTS.length ||
		Object.keys(performance.responseCounts).length !== OWNERS.length ||
		INTENTS.some((intent) => !count(performance.intentCounts[intent], next)) ||
		OWNERS.some((owner) => !count(performance.responseCounts[owner], next)) ||
		INTENTS.reduce((sum, intent) => sum + performance.intentCounts[intent], 0) !== performance.phrasesPlanned ||
		OWNERS.reduce((sum, owner) => sum + performance.responseCounts[owner], 0) !== next ||
		performance.responseCount !== next - performance.responseCounts.nobody ||
		memory.recentPhrases.length !== Math.min(4, performance.phrasesPlanned)) invalid();
	for (const index of [memory.lastResponseBar, memory.lastFillBar]) {
		if (index !== null && !count(index, next - 1)) invalid();
	}
	if (!isOwner(memory.lastResponseOwner) || !isLead(memory.previousLead) ||
		(memory.lastResponseBar === null) !== (performance.responseCount === 0) ||
		(memory.lastFillBar === null) !== (performance.fillCount === 0) ||
		(memory.lastResponseBar === null) !== (memory.lastResponseOwner === 'nobody')) invalid();
	if (next === 0) {
		if (memory.activePhrase !== null || memory.previousIntent !== null || memory.previousLead !== 'nobody') invalid();
	} else {
		const active = memory.activePhrase;
		if (!active) return invalid();
		if (!keysAre(active, ['startBar', 'intent', 'lead']) ||
			!count(active.startBar, next - 1) || !isIntent(active.intent) || !isLead(active.lead) ||
			memory.previousIntent !== active.intent || memory.previousLead !== active.lead) invalid();
		const lastBar = input.bars[next - 1];
		let sectionStart = next - 1;
		while (sectionStart > 0 && !input.bars[sectionStart].isSectionFirstBar) sectionStart--;
		const expectedStart = lastBar.phrase4 ? next - 1 - lastBar.phrase4.barIndex
			: sectionStart + Math.floor((next - 1 - sectionStart) / 4) * 4;
		if (active.startBar !== expectedStart) invalid();
	}
	for (const [index, bar] of memory.recentBars.entries()) {
		if (!bar || !keysAre(bar, ['barIndex', 'phraseStartBar', 'intent', 'responseOwner', 'pianoAttackBudget',
			'drumCommentaryBudget', 'energy', 'density', 'tension', 'fill', 'setupTargetBar']) ||
			bar.barIndex !== next - memory.recentBars.length + index ||
			!count(bar.phraseStartBar, bar.barIndex) || !isIntent(bar.intent) || !isOwner(bar.responseOwner) ||
			!count(bar.pianoAttackBudget, 2) || !count(bar.drumCommentaryBudget, 3) || !unit(bar.energy) ||
			!unit(bar.density) || !unit(bar.tension) || typeof bar.fill !== 'boolean' ||
			(bar.setupTargetBar !== null && (!bar.fill || bar.setupTargetBar !== bar.barIndex + 1 ||
				bar.setupTargetBar >= input.bars.length))) invalid();
	}
	const recentResponse = memory.recentBars.slice().reverse().find((bar) => bar.responseOwner !== 'nobody');
	const recentFill = memory.recentBars.slice().reverse().find((bar) => bar.fill);
	if ((recentResponse && (memory.lastResponseBar !== recentResponse.barIndex ||
		memory.lastResponseOwner !== recentResponse.responseOwner)) ||
		(!recentResponse && memory.lastResponseBar !== null && memory.lastResponseBar >= next - memory.recentBars.length) ||
		(recentFill && memory.lastFillBar !== recentFill.barIndex) ||
		(!recentFill && memory.lastFillBar !== null && memory.lastFillBar >= next - memory.recentBars.length)) invalid();
	for (const [index, phrase] of memory.recentPhrases.entries()) {
		if (!phrase || !keysAre(phrase, ['startBar', 'endBarExclusive', 'intent', 'lead', 'barsPlanned',
			'energyTotal', 'responseCount', 'fillCount']) ||
			!count(phrase.startBar, next - 1) || !count(phrase.endBarExclusive, next) ||
			phrase.endBarExclusive <= phrase.startBar || !isIntent(phrase.intent) || !isLead(phrase.lead) ||
			phrase.barsPlanned !== phrase.endBarExclusive - phrase.startBar ||
			!count(phrase.responseCount, phrase.barsPlanned) || !count(phrase.fillCount, phrase.barsPlanned) ||
			!Number.isFinite(phrase.energyTotal) || phrase.energyTotal < 0 || phrase.energyTotal > phrase.barsPlanned ||
			(index > 0 && memory.recentPhrases[index - 1].endBarExclusive !== phrase.startBar)) invalid();
	}
	const latestPhrase = memory.recentPhrases.at(-1);
	if (next > 0 && (!latestPhrase || latestPhrase.startBar !== memory.activePhrase!.startBar ||
		latestPhrase.endBarExclusive !== next || latestPhrase.intent !== memory.activePhrase!.intent ||
		latestPhrase.lead !== memory.activePhrase!.lead)) invalid();
	const arrival = memory.pendingArrival;
	if ((memory.recentBars.at(-1)?.setupTargetBar ?? null) !== (arrival?.targetBarIndex ?? null)) invalid();
	if (arrival !== null && (!arrival || next === 0 || next >= input.bars.length || arrival.targetBarIndex !== next ||
		!keysAre(arrival, ['id', 'targetBarIndex', 'beatOffset', 'strength', 'participants']) ||
		arrival.id !== `arrival:${next}` || arrival.beatOffset !== 0 || !unit(arrival.strength) ||
		!Array.isArray(arrival.participants) || arrival.participants.length === 0 || arrival.participants.length > 3 ||
		new Set(arrival.participants).size !== arrival.participants.length ||
		arrival.participants.some((role) => role !== 'bass' && role !== 'piano' && role !== 'drums') ||
		memory.lastFillBar !== next - 1 || !memory.recentBars.at(-1)?.fill)) invalid();
}

function roleWeight(previous: ResponseOwner, role: ResponseOwner, ordinary: number, repeated: number): number {
	return previous === role ? repeated : ordinary;
}

/** Accept only fresh, finite and sufficiently confident evidence. */
function soloEvidence(feature: SoloFeature | undefined, barIndex: number): SoloEvidence {
	if (!feature) return 'unavailable';
	if (
		!Number.isFinite(feature.confidence) ||
		!Number.isFinite(feature.noteDensity) || feature.noteDensity < 0 || feature.noteDensity > 1 ||
		!Number.isFinite(feature.restBeats) || feature.restBeats < 0 ||
		!Number.isInteger(feature.observedAtBar) || feature.observedAtBar < 0 || feature.confidence > 1
	) return 'invalid';
	if (feature.confidence < 0.7) return 'low_confidence';
	if (feature.observedAtBar > barIndex || barIndex - feature.observedAtBar > 1) return 'stale';
	return feature.restBeats >= 1 && feature.noteDensity < 0.5 ? 'resting' : 'active';
}

/** Plan the whole known timeline; replaying it never consumes external memory. */
export function planEnsemble(input: EnsemblePlanInput): EnsemblePlan {
	return planEnsembleWindow({
		phraseId: input.phraseId, tempo: input.tempo, bars: input.bars, soloFeatures: input.soloFeatures
	}).plan;
}

/**
 * Plan one consecutive window against the same complete form on every call.
 * A checkpoint commits the prefix: only observations for newly planned bars are
 * consumed. The caller owns scheduling and decides when to advance the window.
 */
export function planEnsembleWindow(input: EnsembleWindowInput): EnsembleWindowResult {
	if (typeof input.phraseId !== 'string') throw new Error('Ensemble phrase identity must be a string');
	if (!Number.isFinite(input.tempo) || input.tempo <= 0) throw new Error('Ensemble tempo must be positive');
	for (const [index, bar] of input.bars.entries()) {
		if (bar.barIndex !== index || !Number.isFinite(bar.intensity) || (bar.energyCeiling !== undefined && (!Number.isFinite(bar.energyCeiling) || bar.energyCeiling < 0.2 || bar.energyCeiling > 0.9))) {
			throw new Error('Ensemble bars must be contiguous from zero with finite intensity');
		}
		if ((bar.boundaryStrength !== undefined && !unit(bar.boundaryStrength)) ||
			(bar.phrase4 && (!count(bar.phrase4.index, input.bars.length) ||
				!count(bar.phrase4.lengthBars, 4) || bar.phrase4.lengthBars < 1 ||
				!count(bar.phrase4.barIndex, Math.min(index, bar.phrase4.lengthBars - 1)) ||
				!unit(bar.phrase4.position) || bar.phrase4.barsRemaining !== bar.phrase4.lengthBars - bar.phrase4.barIndex))) {
			throw new Error('Ensemble form context must contain finite valid phrase positions and boundaries');
		}
	}
	const fingerprint = formFingerprint(input.bars);
	if (input.memory) validateMemory(input.memory, input, fingerprint);
	const checkpoint = input.memory ?? initialMemory(input, fingerprint);
	const startBar = input.startBar ?? checkpoint.nextBar;
	const endBarExclusive = input.endBarExclusive ?? input.bars.length;
	if (!count(startBar, input.bars.length) || !count(endBarExclusive, input.bars.length) || endBarExclusive < startBar) {
		throw new Error('Ensemble window must be an ordered range within the full form timeline');
	}
	if (startBar !== checkpoint.nextBar) {
		throw new Error('Ensemble windows must be consecutive from the checkpoint next bar, or zero without memory');
	}
	const features = new Map(input.soloFeatures?.map((feature) => [feature.barIndex, feature]));
	const plans: Draft[] = [];
	const trace: EnsembleDecision[] = [];
	let activePhrase = checkpoint.activePhrase ? { ...checkpoint.activePhrase } : null;
	let previousIntent = checkpoint.previousIntent;
	let previousLead = checkpoint.previousLead;
	let lastResponseBar = checkpoint.lastResponseBar ?? -Infinity;
	let lastResponseOwner = checkpoint.lastResponseOwner;
	let lastFillBar = checkpoint.lastFillBar ?? -Infinity;
	let pendingArrival = checkpoint.pendingArrival ? {
		...checkpoint.pendingArrival, participants: [...checkpoint.pendingArrival.participants]
	} as CoordinatedAccent : null;
	const recentBars = checkpoint.recentBars.map((bar) => ({ ...bar }));
	const recentPhrases = checkpoint.recentPhrases.map((phrase) => ({ ...phrase }));
	const performance = {
		...checkpoint.performance,
		intentCounts: { ...checkpoint.performance.intentCounts },
		responseCounts: { ...checkpoint.performance.responseCounts }
	};
	let sectionStart = 0;
	for (let i = 0; i < startBar; i++) if (input.bars[i].isSectionFirstBar) sectionStart = i;
	const sectionEnds: number[] = [];
	let end = input.bars.length;
	for (let i = input.bars.length - 1; i >= 0; i--) {
		sectionEnds[i] = end;
		if (input.bars[i].isSectionFirstBar) end = i;
	}

	for (const bar of input.bars.slice(startBar, endBarExclusive)) {
		const i = bar.barIndex;
		if (bar.isSectionFirstBar) sectionStart = i;
		const phraseStartBar = bar.phrase4
			? i - bar.phrase4.barIndex
			: sectionStart + Math.floor((i - sectionStart) / 4) * 4;
		const length = bar.phrase4?.lengthBars ?? Math.min(4, sectionEnds[i] - phraseStartBar);
		const position = bar.phrase4?.position ?? (length > 1 ? (i - phraseStartBar) / (length - 1) : 1);
		const phraseFinal = bar.phrase4?.isFinalBar ?? i === phraseStartBar + length - 1;
		const boundaryStrength = clamp(bar.boundaryStrength ?? (
			bar.isChorusFinalBar ? 1 : bar.isSectionFinalBar ? 0.85 : phraseFinal ? 0.5 : 0
		));
		let phrase: PhraseChoice | null = activePhrase?.startBar === phraseStartBar ? activePhrase : null;
		if (!phrase) {
			const rng = createRng(seedFrom(input.phraseId, input.tempo, 'ensemble-intent', phraseStartBar));
			const weights: Array<{ value: EnsembleIntent; weight: number }> = [
				{ value: 'support', weight: 5 },
				{ value: 'leave_space', weight: 2 },
				{ value: 'build', weight: 2 },
				{ value: 'release', weight: 1 },
				{ value: 'mark_form', weight: 1 }
			];
			const intent = rng.weighted(weights.map((entry) => ({
				...entry, weight: entry.weight * (entry.value === previousIntent ? 0.4 : 1)
			})));
			const leadRng = createRng(seedFrom(input.phraseId, input.tempo, 'ensemble-lead', phraseStartBar));
			const lead: PhraseChoice['lead'] = intent === 'leave_space' || intent === 'release' ? 'nobody' : leadRng.weighted<PhraseChoice['lead']>([
				{ value: 'piano' as const, weight: roleWeight(previousLead, 'piano', 4, 2) },
				{ value: 'drums' as const, weight: roleWeight(previousLead, 'drums', 2, 1) },
				{ value: 'nobody' as const, weight: 1 }
			]);
			phrase = { intent, lead };
			activePhrase = { startBar: phraseStartBar, intent, lead };
			previousIntent = intent;
			previousLead = lead;
		}

		const reasons: string[] = [`phrase:${phrase.intent}`, `lead:${phrase.lead}`];
		// A preceding setup has already committed this arrival. Reserve the
		// response slot before considering fresh solo evidence, rather than
		// attaching a formal accent to an independently planned answer later.
		const incomingAccent = pendingArrival;
		const feature = features.get(i);
		const evidence = soloEvidence(feature, i);
		const reliable = evidence === 'active' || evidence === 'resting';
		const dense = reliable && feature!.noteDensity >= 0.75;
		const responseWindow = dense || incomingAccent ? 'none' : evidence === 'resting' ? 'solo_rest'
			: !reliable && phraseFinal && !bar.isFinalBar ? 'phrase_boundary' : 'none';
		const cooldown = i - lastResponseBar < 3;
		let owner: ResponseOwner = 'nobody';
		if (responseWindow !== 'none' && !cooldown && phrase.intent !== 'leave_space') {
			const rng = createRng(seedFrom(input.phraseId, input.tempo, 'ensemble-response', i));
			if (rng.chance(responseWindow === 'solo_rest' ? 0.48 : 0.3)) {
				owner = rng.weighted<ResponseOwner>([
					{ value: 'piano' as const, weight: roleWeight(lastResponseOwner, 'piano', 4, 1) },
					{ value: 'drums' as const, weight: roleWeight(lastResponseOwner, 'drums', 3, 1) },
					{ value: 'bass' as const, weight: roleWeight(lastResponseOwner, 'bass', 0.6, 0.2) }
				]);
				lastResponseBar = i;
				lastResponseOwner = owner;
			}
		}

		let piano: 0 | 1 | 2 = phrase.lead === 'drums' ? 1 : 2;
		let commentary: 0 | 1 | 2 | 3 = phrase.lead === 'piano' ? 0 : phrase.lead === 'drums' ? 2 : 1;
		let pianoReason: SilenceReason | undefined;
		let drumReason: SilenceReason | undefined = commentary === 0 ? 'avoid_overlap' : undefined;
		if (phrase.intent === 'leave_space') {
			piano = position >= 1 ? 1 : 0;
			commentary = 0;
			pianoReason = 'leave_space';
			drumReason = 'leave_space';
		} else if (phrase.intent === 'release') {
			piano = position >= 0.5 ? 0 : 1;
			commentary = position >= 0.5 ? 0 : 1;
			pianoReason = 'phrase_resolution';
			drumReason = 'phrase_resolution';
		} else if (phrase.intent === 'build' && position < 0.5) {
			piano = 1;
			commentary = 0;
			drumReason = 'leave_space';
		} else if (phrase.intent === 'mark_form') {
			// Keep the lead-in uncluttered so a selected boundary gesture can
			// carry the form. A form-marking phrase still need not take a fill.
			piano = 1;
			commentary = phraseFinal ? 1 : 0;
			drumReason = 'leave_space';
		}
		if (i === lastResponseBar + 1) {
			piano = 0;
			commentary = 0;
			pianoReason = drumReason = 'after_response';
		}
		if (owner !== 'nobody') {
			piano = owner === 'piano' ? 2 : 0;
			commentary = owner === 'drums' ? 2 : 0;
			pianoReason = drumReason = 'avoid_overlap';
			reasons.push(`response:${responseWindow}:${owner}`);
		}
		if (dense) {
			piano = boundaryStrength >= 0.85 ? Math.min(piano, 1) as 0 | 1 : 0;
			commentary = 0;
			pianoReason = drumReason = 'soloist_dense';
			reasons.push('soloist_dense');
		}
		if (incomingAccent) {
			// The dedicated bass/drum accent is outside commentary budgets.
			// Give that formal arrival a breathing bar instead of simultaneously
			// assigning another voice to fill the same space.
			piano = 0;
			commentary = 0;
			pianoReason = drumReason = 'avoid_overlap';
			reasons.push('coordinated_arrival_reserved');
		}

		const fillRng = createRng(seedFrom(input.phraseId, input.tempo, 'ensemble-fill', i));
		const allowFill = !dense && !incomingAccent && !bar.isFinalBar && boundaryStrength >= 0.5 && i - lastFillBar >= 4 &&
			i - lastResponseBar !== 1 && owner !== 'piano' && owner !== 'bass' &&
			phrase.intent !== 'leave_space' && phrase.intent !== 'release' &&
			fillRng.chance((boundaryStrength >= 0.85 ? 0.62 : 0.24) + (phrase.intent === 'mark_form' ? 0.1 : 0));
		if (allowFill) {
			lastFillBar = i;
			commentary = 3;
			piano = Math.min(piano, 1) as 0 | 1;
			reasons.push('formal_setup_reserved');
		}
		const movement = phrase.intent === 'build' ? -0.04 + 0.1 * position
			: phrase.intent === 'release' ? -0.12 * position : 0;
		const energy = clamp(bar.intensity + movement, 0.2, bar.energyCeiling ?? 0.9);
		const plan: Draft = {
			barIndex: i, phraseStartBar, phraseIntent: phrase.intent,
			intent: owner === 'nobody' ? phrase.intent : 'answer',
			energy,
			density: clamp((piano + commentary * 0.5) / 3),
			tension: clamp(0.15 + energy * 0.25 + boundaryStrength * 0.2 + movement),
			boundaryStrength, responseOwner: owner,
			piano: Object.freeze({
				role: owner === 'piano' ? 'respond' : piano === 0 ? 'leave_space' : phrase.lead === 'piano' ? 'lead' : 'support',
				maxAttacks: piano, densityScale: piano / 2,
				...(piano === 0 ? { silenceReason: pianoReason ?? 'leave_space' } : {})
			}),
			drums: Object.freeze({
				role: owner === 'drums' ? 'respond' : allowFill || incomingAccent ? 'mark_form' : commentary === 0 ? 'time' : 'support',
				keepTime: true, maxCommentaryHits: commentary, commentaryScale: Math.min(commentary / 2, 1), allowFill,
				...(commentary === 0 ? { silenceReason: drumReason ?? 'leave_space' } : {})
			}),
			bass: Object.freeze({
				role: owner === 'bass' ? 'respond' : 'time', keepPulse: true,
				ornamentScale: dense ? 0.35 : owner === 'bass' ? 1 : phrase.intent === 'leave_space' ? 0.5 : 0.75
			})
		};
		if (allowFill && boundaryStrength >= 0.85 && i + 1 < input.bars.length && fillRng.chance(0.65)) {
			plan.setupFor = Object.freeze({
				id: `arrival:${i + 1}`, targetBarIndex: i + 1, beatOffset: 0,
				strength: boundaryStrength, participants: Object.freeze(['bass', 'drums'] as const)
			});
		}
		if (incomingAccent) plan.coordinatedAccent = incomingAccent;
		pendingArrival = plan.setupFor ?? null;
		plans.push(plan);
		trace.push(Object.freeze({
			barIndex: i, phraseStartBar, phraseIntent: phrase.intent, lead: phrase.lead,
			soloEvidence: evidence, responseWindow, responseOwner: owner,
			responseSuppressedByCooldown: responseWindow !== 'none' && cooldown,
			fillReserved: allowFill, reasons: Object.freeze(reasons)
		}));

		// Bounded evidence for diagnostics and subsequent planning. Aggregation
		// happens once per committed bar, independent of window boundaries.
		recentBars.push({
			barIndex: i, phraseStartBar, intent: plan.intent, responseOwner: owner,
			pianoAttackBudget: piano, drumCommentaryBudget: commentary, energy,
			density: plan.density, tension: plan.tension, fill: allowFill,
			setupTargetBar: plan.setupFor?.targetBarIndex ?? null
		});
		if (recentBars.length > 2) recentBars.shift();
		if (recentPhrases.at(-1)?.startBar !== phraseStartBar) {
			recentPhrases.push({
				startBar: phraseStartBar, endBarExclusive: i, intent: phrase.intent, lead: phrase.lead,
				barsPlanned: 0, energyTotal: 0, responseCount: 0, fillCount: 0
			});
			if (recentPhrases.length > 4) recentPhrases.shift();
			performance.phrasesPlanned++;
			performance.intentCounts[phrase.intent]++;
		}
		const summary = recentPhrases[recentPhrases.length - 1];
		summary.endBarExclusive = i + 1;
		summary.barsPlanned++;
		summary.energyTotal += energy;
		summary.responseCount += Number(owner !== 'nobody');
		summary.fillCount += Number(allowFill);
		performance.barsPlanned++;
		performance.responseCount += Number(owner !== 'nobody');
		performance.fillCount += Number(allowFill);
		performance.arrivalCount += Number(Boolean(incomingAccent));
		performance.responseCounts[owner]++;
		performance.peakEnergy = Math.max(performance.peakEnergy, energy);
		performance.peakDensity = Math.max(performance.peakDensity, plan.density);
	}
	return Object.freeze({
		plan: freezeEnsemblePlan({ version: 1, bars: plans, trace }),
		memory: freezeEnsembleMemory({
			version: 1, phraseId: input.phraseId, tempo: input.tempo,
			formFingerprint: fingerprint, totalBars: input.bars.length, nextBar: endBarExclusive,
			activePhrase, previousIntent, previousLead,
			lastResponseBar: Number.isFinite(lastResponseBar) ? lastResponseBar : null,
			lastResponseOwner, lastFillBar: Number.isFinite(lastFillBar) ? lastFillBar : null,
			pendingArrival, recentBars, recentPhrases, performance
		})
	});
}
