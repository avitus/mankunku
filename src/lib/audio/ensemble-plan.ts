/**
 * Pure phrase-level coordination for the existing rhythm-section vocabulary.
 *
 * This planner chooses roles and budgets before instruments generate notes. It
 * never deletes arbitrary rendered notes, changes the bass pulse, or treats an
 * unavailable microphone as a silent soloist. Musical state belongs to this
 * invocation; named RNG streams keep planning independent of instrument draws.
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
	if (!Number.isFinite(input.tempo) || input.tempo <= 0) throw new Error('Ensemble tempo must be positive');
	for (const [index, bar] of input.bars.entries()) {
		if (bar.barIndex !== index || !Number.isFinite(bar.intensity)) {
			throw new Error('Ensemble bars must be contiguous from zero with finite intensity');
		}
	}
	const features = new Map(input.soloFeatures?.map((feature) => [feature.barIndex, feature]));
	const plans: Draft[] = [];
	const trace: EnsembleDecision[] = [];
	const phrases = new Map<number, PhraseChoice>();
	let previousIntent: EnsembleIntent | undefined;
	let previousLead: PhraseChoice['lead'] = 'nobody';
	let lastResponseBar = -Infinity;
	let lastResponseOwner: ResponseOwner = 'nobody';
	let lastFillBar = -Infinity;
	let sectionStart = 0;
	const sectionEnds: number[] = [];
	let end = input.bars.length;
	for (let i = input.bars.length - 1; i >= 0; i--) {
		sectionEnds[i] = end;
		if (input.bars[i].isSectionFirstBar) end = i;
	}

	for (const bar of input.bars) {
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
		let phrase = phrases.get(phraseStartBar);
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
			phrases.set(phraseStartBar, phrase);
			previousIntent = intent;
			previousLead = lead;
		}

		const reasons: string[] = [`phrase:${phrase.intent}`, `lead:${phrase.lead}`];
		// A preceding setup has already committed this arrival. Reserve the
		// response slot before considering fresh solo evidence, rather than
		// attaching a formal accent to an independently planned answer later.
		const incomingAccent = plans[i - 1]?.setupFor;
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
		const energy = clamp(bar.intensity + movement, 0.2, 0.9);
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
		plans.push(plan);
		trace.push(Object.freeze({
			barIndex: i, phraseStartBar, phraseIntent: phrase.intent, lead: phrase.lead,
			soloEvidence: evidence, responseWindow, responseOwner: owner,
			responseSuppressedByCooldown: responseWindow !== 'none' && cooldown,
			fillReserved: allowFill, reasons: Object.freeze(reasons)
		}));
	}
	return freezeEnsemblePlan({ version: 1, bars: plans, trace });
}
