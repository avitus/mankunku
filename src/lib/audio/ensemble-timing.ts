/**
 * Deterministic phrase motion for the coordinated 4/4 swing rhythm section.
 *
 * Each event keeps the existing swung grid and capped role offset. A bounded
 * common curve moves the section together, each player keeps a stable phrase
 * placement, and a smaller event-keyed residual avoids identical strokes. This
 * is a tunable musical design, not a model of every professional player's feel.
 * It never changes transport tempo, the melody grid, or scoring expectations.
 */
import { applySwingToBeats } from '$lib/music/swing';
import { SWING_TIMING, type TimingProfile, type TimingRole } from './backing-timing';
import type { EnsembleIntent, EnsemblePlan } from './ensemble-plan';
import { createRng, seedFrom } from './generation-rng';

export type EnsembleTimingPlayer = 'bass' | 'comp' | 'drums';

/** Serializable coefficients: no mutable RNG state or audio-runtime objects. */
export interface EnsemblePhraseTimingTrace {
	readonly version: 1;
	readonly phraseStartBar: number;
	readonly endBarExclusive: number;
	readonly intent: EnsembleIntent;
	readonly boundaryStrength: number;
	readonly commonAmplitudeMs: number;
	readonly playerPlacementMs: Readonly<Record<EnsembleTimingPlayer, number>>;
	readonly roleOffsetMs: Readonly<Record<TimingRole, number>>;
	readonly residualLimitMs: Readonly<Record<TimingRole, number>>;
}

export interface EnsembleTimingInput {
	readonly phraseId: string;
	readonly tempo: number;
	readonly ppq: number;
	readonly swing: number;
	/** Actual phrase groups from the coordinated swing 4/4 planner. */
	readonly plan: EnsemblePlan;
	readonly timingProfiles?: Partial<Record<TimingRole, TimingProfile>>;
}

export interface EnsembleTiming {
	/** Absolute quarter-note beat to scheduled integer transport ticks. */
	place(absBeat: number, role: TimingRole): number;
	/** One shared onset for declared accent participants, without player scatter. */
	arrivalTick(barIndex: number): number;
	readonly trace: readonly EnsemblePhraseTimingTrace[];
}

/** Restore deep immutability after a serialized generation-cache replay. */
export function freezeEnsembleTimingTrace(
	trace: readonly EnsemblePhraseTimingTrace[]
): readonly EnsemblePhraseTimingTrace[] {
	for (const phrase of trace) {
		Object.freeze(phrase.playerPlacementMs);
		Object.freeze(phrase.roleOffsetMs);
		Object.freeze(phrase.residualLimitMs);
		Object.freeze(phrase);
	}
	return Object.freeze(trace);
}

const BEATS_PER_BAR = 4;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function triangular(...key: Array<string | number>): number {
	const rng = createRng(seedFrom(...key));
	return rng.float() + rng.float() - 1;
}

function playerOf(role: TimingRole): EnsembleTimingPlayer {
	return role === 'bass' || role === 'comp' ? role : 'drums';
}

/** Shared displacement and its slope return to zero at both phrase edges. */
function commonMotionMs(phrase: EnsemblePhraseTimingTrace | undefined, absBeat: number): number {
	if (!phrase) return 0;
	const start = phrase.phraseStartBar * BEATS_PER_BAR;
	const span = (phrase.endBarExclusive - phrase.phraseStartBar) * BEATS_PER_BAR;
	const position = (absBeat - start) / span;
	if (position <= 0 || position >= 1) return 0;
	return phrase.commonAmplitudeMs * Math.sin(Math.PI * position) ** 2;
}

/** Place already committed phrase coefficients without planning other bars. */
export function restoreEnsembleTiming(input: Omit<EnsembleTimingInput, 'plan'> & {
	trace: readonly EnsemblePhraseTimingTrace[];
}): EnsembleTiming {
	const { phraseId, tempo, ppq, swing, trace } = input;
	const beatMs = 60_000 / tempo;
	const msPerTick = beatMs / ppq;
	const phraseAt = (bar: number) => trace.find((entry) => entry.phraseStartBar <= bar && bar < entry.endBarExclusive);
	return Object.freeze({
		trace: freezeEnsembleTimingTrace(trace),
		place(absBeat: number, role: TimingRole): number {
			if (!Number.isFinite(absBeat) || absBeat < 0) throw new Error('Ensemble event beat must be nonnegative');
			const phrase = phraseAt(Math.floor(absBeat / BEATS_PER_BAR));
			const profile = input.timingProfiles?.[role] ?? SWING_TIMING[role];
			const offset = phrase?.roleOffsetMs[role] ?? clamp(profile.offsetMs, -0.04 * beatMs, 0.04 * beatMs);
			const residualLimit = phrase?.residualLimitMs[role] ?? Math.min(profile.jitterMs / 4, 2, beatMs * 0.005);
			const residual = triangular(phraseId, tempo, 'ensemble-timing-event', phrase?.phraseStartBar ?? 'outside', role, absBeat) * residualLimit;
			const placement = phrase?.playerPlacementMs[playerOf(role)] ?? 0;
			return Math.max(0, Math.round(applySwingToBeats(absBeat, swing) * ppq +
				(offset + commonMotionMs(phrase, absBeat) + placement + residual) / msPerTick));
		},
		arrivalTick(barIndex: number): number {
			if (!Number.isInteger(barIndex) || barIndex < 0) throw new Error('Ensemble arrival bar must be nonnegative');
			const absBeat = barIndex * BEATS_PER_BAR;
			return Math.max(0, Math.round(absBeat * ppq + commonMotionMs(phraseAt(barIndex), absBeat) / msPerTick));
		}
	});
}

/** Latch one phrase from current intent and known form, without future evidence. */
export function describeEnsemblePhraseTiming(input: Omit<EnsembleTimingInput, 'plan'> & {
	phraseStartBar: number; endBarExclusive: number; intent: EnsembleIntent; boundaryStrength: number;
}): EnsemblePhraseTimingTrace {
	const { phraseId, tempo, phraseStartBar, endBarExclusive, intent } = input;
	const beatMs = 60_000 / tempo;
	const commonLimitMs = Math.min(6, beatMs * 0.015);
	const playerLimitMs = Math.min(2, beatMs * 0.0075);
	const boundaryStrength = clamp(input.boundaryStrength, 0, 1);
	const roleOffsetMs = {} as Record<TimingRole, number>;
	const residualLimitMs = {} as Record<TimingRole, number>;
	for (const role of Object.keys(SWING_TIMING) as TimingRole[]) {
		const profile = input.timingProfiles?.[role] ?? SWING_TIMING[role];
		if (!Number.isFinite(profile.offsetMs) || !Number.isFinite(profile.jitterMs) || profile.jitterMs < 0) throw new Error(`Invalid ensemble timing profile for ${role}`);
		roleOffsetMs[role] = clamp(profile.offsetMs, -0.04 * beatMs, 0.04 * beatMs);
		residualLimitMs[role] = Math.min(profile.jitterMs / 4, 2, beatMs * 0.005);
	}
	const intentBias = intent === 'build' ? -1 : intent === 'release' ? 1 : 0;
	const amplitude = triangular(phraseId, tempo, 'ensemble-timing-common', phraseStartBar) * 0.75 + intentBias * 0.25;
	const playerPlacementMs = {} as Record<EnsembleTimingPlayer, number>;
	for (const player of ['bass', 'comp', 'drums'] as const) {
		playerPlacementMs[player] = triangular(phraseId, tempo, 'ensemble-timing-player', phraseStartBar, player) * playerLimitMs;
	}
	return freezeEnsembleTimingTrace([{ version: 1, phraseStartBar, endBarExclusive, intent, boundaryStrength,
		commonAmplitudeMs: amplitude * commonLimitMs * (1 - 0.2 * boundaryStrength), playerPlacementMs, roleOffsetMs, residualLimitMs }])[0];
}

/**
 * Build a stateless placer. Named seeds include the exact event role/beat, so
 * adding a chord tone, drum limb or ghost note cannot move an existing event.
 * An event at or beyond the final plan edge has no phrase motion or placement;
 * its ordinary role offset and small event residual remain well-defined.
 */
export function createEnsembleTiming(input: EnsembleTimingInput): EnsembleTiming {
	const { phraseId, tempo, ppq, swing, plan } = input;
	if (!Number.isFinite(tempo) || tempo <= 0 || !Number.isFinite(ppq) || ppq <= 0 || !Number.isFinite(swing)) {
		throw new Error('Ensemble timing requires positive tempo/PPQ and finite swing');
	}
	const beatMs = 60_000 / tempo;
	const msPerTick = beatMs / ppq;
	const commonLimitMs = Math.min(6, beatMs * 0.015);
	const playerLimitMs = Math.min(2, beatMs * 0.0075);
	const roleOffsetMs = {} as Record<TimingRole, number>;
	const residualLimitMs = {} as Record<TimingRole, number>;
	for (const role of Object.keys(SWING_TIMING) as TimingRole[]) {
		const profile = input.timingProfiles?.[role] ?? SWING_TIMING[role];
		if (!Number.isFinite(profile.offsetMs) || !Number.isFinite(profile.jitterMs) || profile.jitterMs < 0) {
			throw new Error(`Invalid ensemble timing profile for ${role}`);
		}
		// Preserve the existing role-offset cap; only the independent jitter is reduced.
		roleOffsetMs[role] = clamp(profile.offsetMs, -0.04 * beatMs, 0.04 * beatMs);
		residualLimitMs[role] = Math.min(profile.jitterMs / 4, 2, beatMs * 0.005);
	}
	Object.freeze(roleOffsetMs);
	Object.freeze(residualLimitMs);

	const trace: EnsemblePhraseTimingTrace[] = [];
	const phraseByBar = new Map<number, EnsemblePhraseTimingTrace>();
	for (let start = 0; start < plan.bars.length;) {
		const first = plan.bars[start];
		if (first.barIndex !== start || first.phraseStartBar !== start) {
			throw new Error('Ensemble timing requires contiguous phrase groups starting at bar zero');
		}
		let end = start + 1;
		while (end < plan.bars.length && plan.bars[end].phraseStartBar === start) {
			if (plan.bars[end].barIndex !== end) throw new Error('Ensemble timing bars must be contiguous');
			end++;
		}
		const boundaryStrength = clamp(plan.bars[end - 1].boundaryStrength, 0, 1);
		// A build can lean forward and a release can relax, without a tempo ramp.
		// Intent contributes at most 1.5ms, and a strong boundary settles the curve.
		const intentBias = first.phraseIntent === 'build' ? -1 : first.phraseIntent === 'release' ? 1 : 0;
		const amplitude = triangular(phraseId, tempo, 'ensemble-timing-common', start) * 0.75 + intentBias * 0.25;
		const playerPlacementMs = {} as Record<EnsembleTimingPlayer, number>;
		for (const player of ['bass', 'comp', 'drums'] as const) {
			playerPlacementMs[player] = triangular(phraseId, tempo, 'ensemble-timing-player', start, player) * playerLimitMs;
		}
		const phrase: EnsemblePhraseTimingTrace = {
			version: 1, phraseStartBar: start, endBarExclusive: end, intent: first.phraseIntent,
			boundaryStrength, commonAmplitudeMs: amplitude * commonLimitMs * (1 - 0.2 * boundaryStrength),
			playerPlacementMs, roleOffsetMs, residualLimitMs
		};
		trace.push(phrase);
		for (let bar = start; bar < end; bar++) phraseByBar.set(bar, phrase);
		start = end;
	}

	return Object.freeze({
		trace: freezeEnsembleTimingTrace(trace),
		place(absBeat: number, role: TimingRole): number {
			if (!Number.isFinite(absBeat) || absBeat < 0) throw new Error('Ensemble event beat must be nonnegative');
			const phrase = phraseByBar.get(Math.floor(absBeat / BEATS_PER_BAR));
			const residual = triangular(phraseId, tempo, 'ensemble-timing-event', phrase?.phraseStartBar ?? 'outside', role, absBeat) * residualLimitMs[role];
			const placement = phrase?.playerPlacementMs[playerOf(role)] ?? 0;
			const offsetMs = roleOffsetMs[role] + commonMotionMs(phrase, absBeat) + placement + residual;
			return Math.max(0, Math.round(applySwingToBeats(absBeat, swing) * ppq + offsetMs / msPerTick));
		},
		arrivalTick(barIndex: number): number {
			if (!Number.isInteger(barIndex) || barIndex < 0) throw new Error('Ensemble arrival bar must be nonnegative');
			const absBeat = barIndex * BEATS_PER_BAR;
			return Math.max(0, Math.round(absBeat * ppq + commonMotionMs(phraseByBar.get(barIndex), absBeat) / msPerTick));
		}
	});
}
