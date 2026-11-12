/** Independent causal microphone observations for the backing listening lab. */
import type { SoloFeature } from './ensemble-plan';
import { MAX_ADAPTIVE_BARS } from './backing-performance-limits';

export interface SoloObserverConfig {
	readonly sessionId: string;
	readonly tempo: number;
	readonly beatsPerBar: 4;
	readonly totalBars: number;
}

export interface SoloObservationFrame {
	readonly timeSeconds: number;
	readonly availableAtSeconds: number;
	readonly rms: number;
	readonly midi: number | null;
	readonly clarity: number;
	readonly inputAvailable: boolean;
	readonly backingMidi: readonly number[];
	readonly nearBackingTransient: boolean;
}

export interface SoloObservationWindow {
	readonly version: 1;
	readonly sessionId: string;
	readonly source: 'microphone';
	readonly barIndex: number;
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly availableAtSeconds: number;
	readonly coverage: number;
	readonly confidence: number;
	readonly status: 'active' | 'resting' | 'unknown';
	readonly reason: string;
	readonly attackCount: number;
	readonly noteDensity: number;
	readonly restBeats: number;
	readonly registerCenter: number | null;
	readonly registerWidth: number | null;
	readonly dynamicLevel: number | null;
	readonly feature?: SoloFeature;
}

export interface SoloObserver {
	push(frame: SoloObservationFrame): readonly SoloObservationWindow[];
	finish(availableAtSeconds: number): readonly SoloObservationWindow[];
	snapshot(): readonly SoloObservationWindow[];
}

/**
 * Conservative engineering limits, not microphone calibration or source
 * separation. RMS is raw full-scale amplitude; gain varies across devices.
 * Quiet precedes backing masks so headphones plus a quiet mic can establish
 * a rest even while the band plays. A nonquiet ambiguous frame cannot do so.
 */
export const SOLO_OBSERVER_POLICY = Object.freeze({
	maxBars: MAX_ADAPTIVE_BARS, minTempo: 30, maxTempo: 320,
	quietRms: 0.003, activeRms: 0.01, pitchClarity: 0.9,
	maxFrameGapSeconds: 0.1, pitchHoldSeconds: 0.06, reattackRestSeconds: 0.12,
	activityContinuationSeconds: 0.15, minTrustedShare: 0.5,
	minCoverage: 0.8, minConfidence: 0.7, attacksPerBeatForFullDensity: 2
});

type Evidence = 'pitched' | 'quiet' | 'input_unavailable' | 'backing_ambiguity' | 'uncertain_signal';
interface ObservedFrame {
	time: number; kind: Evidence; midi: number | null; rms: number; clarity: number;
	/** Strong nonmatching pitch; a transient mask alone does not break continuity. */
	pitchCandidate: number | null;
}
interface BarAccumulator {
	covered: number; trusted: number; quality: number; pitched: number;
	rmsTotal: number; attacks: number; register: number[];
	missing: boolean; unavailable: boolean; backing: boolean; uncertain: boolean;
}
const EMPTY: readonly SoloObservationWindow[] = Object.freeze([]);
const EPSILON = 1e-9;

function barAccumulator(): BarAccumulator {
	return { covered: 0, trusted: 0, quality: 0, pitched: 0, rmsTotal: 0,
		attacks: 0, register: new Array<number>(128).fill(0),
		missing: false, unavailable: false, backing: false, uncertain: false };
}

/** Octave aliases and the first eight harmonic partials, in either direction. */
function matchesBacking(midi: number, backing: readonly number[]): boolean {
	return backing.some((note) => {
		const distance = Math.abs(midi - note);
		for (let harmonic = 1; harmonic <= 8; harmonic++) {
			if (Math.abs(distance - 12 * Math.log2(harmonic)) <= 0.5) return true;
		}
		return false;
	});
}

function classify(frame: SoloObservationFrame): ObservedFrame {
	const backingMatch = frame.midi !== null && matchesBacking(frame.midi, frame.backingMidi);
	const pitchCandidate = frame.inputAvailable && frame.rms >= SOLO_OBSERVER_POLICY.activeRms &&
		frame.midi !== null && frame.clarity >= SOLO_OBSERVER_POLICY.pitchClarity && !backingMatch ? Math.round(frame.midi) : null;
	let kind: Evidence;
	if (!frame.inputAvailable) kind = 'input_unavailable';
	else if (frame.rms <= SOLO_OBSERVER_POLICY.quietRms) kind = 'quiet';
	else if (frame.nearBackingTransient || backingMatch) kind = 'backing_ambiguity';
	else if (pitchCandidate !== null) kind = 'pitched';
	else kind = 'uncertain_signal';
	return { time: frame.timeSeconds, kind, midi: frame.midi === null ? null : Math.round(frame.midi), rms: frame.rms, clarity: frame.clarity, pitchCandidate };
}

function validateConfig(config: SoloObserverConfig): void {
	if (typeof config.sessionId !== 'string' || config.sessionId.trim().length === 0 || config.sessionId.length > 128 ||
		!Number.isFinite(config.tempo) || config.tempo < SOLO_OBSERVER_POLICY.minTempo || config.tempo > SOLO_OBSERVER_POLICY.maxTempo ||
		config.beatsPerBar !== 4 || !Number.isSafeInteger(config.totalBars) || config.totalBars < 1 || config.totalBars > SOLO_OBSERVER_POLICY.maxBars) {
		throw new RangeError(`Solo observer requires a session id, tempo 30–320, four beats and 1–${SOLO_OBSERVER_POLICY.maxBars} bars`);
	}
}

function validateFrame(frame: SoloObservationFrame): void {
	if (!Number.isFinite(frame.timeSeconds) || frame.timeSeconds < 0 ||
		!Number.isFinite(frame.availableAtSeconds) || frame.availableAtSeconds < frame.timeSeconds ||
		!Number.isFinite(frame.rms) || frame.rms < 0 || frame.rms > 1 ||
		!Number.isFinite(frame.clarity) || frame.clarity < 0 || frame.clarity > 1 ||
		(frame.midi !== null && (!Number.isFinite(frame.midi) || frame.midi < 0 || frame.midi > 127)) ||
		typeof frame.inputAvailable !== 'boolean' || typeof frame.nearBackingTransient !== 'boolean' ||
		!Array.isArray(frame.backingMidi) || frame.backingMidi.length > 128 ||
		frame.backingMidi.some((midi) => !Number.isFinite(midi) || midi < 0 || midi > 127)) {
		throw new RangeError('Solo observation frame must contain finite causal times and valid measured input');
	}
}

function percentile(weights: readonly number[], total: number, fraction: number): number {
	let sum = 0;
	for (let midi = 0; midi < weights.length; midi++) {
		sum += weights[midi];
		if (sum >= total * fraction) return midi;
	}
	return weights.length - 1;
}

/**
 * One deterministic session; no browser/audio state or scoring dependencies.
 * Frames only support time after their observation, for at most 100 ms. A
 * later frame can close a window but cannot rewrite its evidence. Storage is
 * one scalar bar accumulator, one 128-bin register histogram, and ≤512 windows.
 */
export function createSoloObserver(input: SoloObserverConfig): SoloObserver {
	validateConfig(input);
	const config = { ...input };
	const beatSeconds = 60 / config.tempo;
	const barSeconds = beatSeconds * config.beatsPerBar;
	const duration = barSeconds * config.totalBars;
	const windows: SoloObservationWindow[] = [];
	let bar = barAccumulator();
	let cursor = 0;
	let previous: ObservedFrame | null = null;
	let lastAvailability = 0;
	let quietRun = 0;
	let lastPitch: number | null = null;
	let lastTrustedPitchTime: number | null = null;
	let candidate: { midi: number; start: number } | null = null;
	let finished = false;

	function integrate(seconds: number, observed: ObservedFrame | null): void {
		if (seconds <= 0) return;
		if (!observed) {
			bar.missing = true; quietRun = 0; candidate = null; lastTrustedPitchTime = null;
			return;
		}
		if (observed.kind === 'input_unavailable') {
			bar.unavailable = true; quietRun = 0; candidate = null; lastTrustedPitchTime = null;
			return;
		}
		bar.covered += seconds;
		if (observed.kind === 'quiet') {
			bar.trusted += seconds;
			bar.quality += seconds * 0.95;
			quietRun = Math.min(8 * beatSeconds, quietRun + seconds);
			if (quietRun >= SOLO_OBSERVER_POLICY.reattackRestSeconds) { lastPitch = null; lastTrustedPitchTime = null; }
		} else {
			quietRun = 0;
			if (observed.kind === 'pitched') {
				bar.trusted += seconds;
				bar.quality += seconds * observed.clarity;
				bar.pitched += seconds;
				bar.rmsTotal += seconds * observed.rms;
				bar.register[observed.midi!] += seconds;
			} else {
				if (observed.kind === 'backing_ambiguity') bar.backing = true;
				else bar.uncertain = true;
				if (observed.pitchCandidate === null) candidate = null;
			}
		}
	}

	function close(availableAtSeconds: number): void {
		const barIndex = windows.length;
		const coverage = Math.min(1, bar.covered / barSeconds);
		const trustedShare = bar.covered > 0 ? bar.trusted / bar.covered : 0;
		let confidence = bar.trusted > 0 ? Math.min(1, coverage * bar.quality / bar.trusted) : 0;
		const noteDensity = Math.min(1, bar.attacks / (config.beatsPerBar * SOLO_OBSERVER_POLICY.attacksPerBeatForFullDensity));
		// Availability is deliberately separate from observation time. Never
		// make an old, delayed bar seem fresh merely by stamping its receipt.
		const stale = availableAtSeconds - (barIndex + 1) * barSeconds > barSeconds + EPSILON;
		let reason = stale ? 'stale_observation' : bar.unavailable ? 'input_unavailable' : bar.missing ? 'missing_frames'
			: coverage + EPSILON < SOLO_OBSERVER_POLICY.minCoverage ? 'insufficient_coverage'
				: trustedShare + EPSILON < SOLO_OBSERVER_POLICY.minTrustedShare ? (bar.backing ? 'backing_ambiguity' : 'uncertain_signal')
					: confidence + EPSILON < SOLO_OBSERVER_POLICY.minConfidence ? 'low_confidence' : '';
		let status: SoloObservationWindow['status'] = 'unknown';
		// Supported activity may survive some warmup or masked spans. Rest is
		// stricter: none of those ambiguous intervals may invite a response.
		const restSafe = !bar.backing && !bar.uncertain;
		if (reason) confidence = Math.min(confidence, 0.69);
		else if (restSafe && quietRun + EPSILON >= beatSeconds && noteDensity < 0.5) { status = 'resting'; reason = 'observed_rest'; }
		else if (bar.pitched + EPSILON >= SOLO_OBSERVER_POLICY.pitchHoldSeconds * 2) { status = 'active'; reason = 'observed_activity'; }
		else { reason = bar.backing ? 'backing_ambiguity' : bar.uncertain ? 'uncertain_signal' : 'insufficient_pitch_evidence'; confidence = Math.min(confidence, 0.69); }
		const restBeats = status === 'unknown' || !restSafe ? 0 : quietRun / beatSeconds;
		const registerKnown = status !== 'unknown' && bar.pitched >= SOLO_OBSERVER_POLICY.pitchHoldSeconds * 2;
		const decisionBar = Math.ceil(availableAtSeconds / barSeconds);
		const observedAtBar = Math.floor(availableAtSeconds / barSeconds);
		const feature: SoloFeature | undefined = status !== 'unknown' && decisionBar < config.totalBars ? Object.freeze({
			barIndex: decisionBar, observedAtBar, source: 'microphone', confidence, noteDensity, restBeats
		}) : undefined;
		windows.push(Object.freeze({
			version: 1, sessionId: config.sessionId, source: 'microphone', barIndex,
			startSeconds: barIndex * barSeconds, endSeconds: (barIndex + 1) * barSeconds, availableAtSeconds,
			coverage, confidence, status, reason, attackCount: bar.attacks, noteDensity, restBeats,
			registerCenter: registerKnown ? percentile(bar.register, bar.pitched, 0.5) : null,
			registerWidth: registerKnown ? percentile(bar.register, bar.pitched, 0.9) - percentile(bar.register, bar.pitched, 0.1) : null,
			dynamicLevel: registerKnown ? bar.rmsTotal / bar.pitched : null,
			...(feature ? { feature } : {})
		}));
		bar = barAccumulator();
	}

	function advance(time: number, availableAtSeconds: number): readonly SoloObservationWindow[] {
		const initialCount = windows.length;
		const until = Math.min(time, duration);
		while (cursor < until && windows.length < config.totalBars) {
			const boundary = (windows.length + 1) * barSeconds;
			const freshUntil = previous ? previous.time + SOLO_OBSERVER_POLICY.maxFrameGapSeconds : 0;
			const fresh = previous !== null && cursor < freshUntil - EPSILON;
			const end = Math.min(until, boundary, fresh ? freshUntil : Infinity);
			integrate(end - cursor, fresh ? previous : null);
			cursor = end;
			if (cursor >= boundary - EPSILON) { cursor = boundary; close(availableAtSeconds); }
		}
		return windows.length === initialCount ? EMPTY : Object.freeze(windows.slice(initialCount));
	}

	return {
		push(frame) {
			if (finished) throw new Error('Solo observation session has finished');
			validateFrame(frame);
			if ((previous && frame.timeSeconds < previous.time) || frame.availableAtSeconds < lastAvailability) {
				throw new RangeError('Solo observation frames and availability must be ordered');
			}
			const completed = advance(frame.timeSeconds, frame.availableAtSeconds);
			const observed = classify(frame);
			const independentPitch = observed.kind === 'pitched';
			lastAvailability = frame.availableAtSeconds;
			if (frame.timeSeconds < duration && observed.pitchCandidate !== null) {
				if (!candidate || candidate.midi !== observed.pitchCandidate) candidate = { midi: observed.pitchCandidate, start: frame.timeSeconds };
				const stable = frame.timeSeconds - candidate.start + EPSILON >= SOLO_OBSERVER_POLICY.pitchHoldSeconds;
				// A transient cannot establish the player. After independent
				// nonmatching pitch evidence, a coherent played stream can continue
				// through normal ride/bass masks. Pitch matches stay ambiguous.
				if (observed.kind === 'backing_ambiguity' && stable && lastTrustedPitchTime !== null &&
					frame.timeSeconds - lastTrustedPitchTime <= SOLO_OBSERVER_POLICY.activityContinuationSeconds + EPSILON) observed.kind = 'pitched';
				// A promoted masked frame is support, never a new independent
				// anchor: otherwise an uninterrupted mask could renew forever.
				if (independentPitch) lastTrustedPitchTime = frame.timeSeconds;
				if (observed.kind === 'pitched' && stable && lastPitch !== candidate.midi) {
					bar.attacks = Math.min(128, bar.attacks + 1);
					lastPitch = candidate.midi;
				}
			} else candidate = null;
			previous = observed;
			return completed;
		},
		finish(availableAtSeconds) {
			if (!Number.isFinite(availableAtSeconds) || availableAtSeconds < lastAvailability || availableAtSeconds < 0) {
				throw new RangeError('Solo observation finish must use a finite current availability time');
			}
			if (finished) return EMPTY;
			const completed = advance(availableAtSeconds, availableAtSeconds);
			finished = true;
			return completed;
		},
		snapshot: () => Object.freeze([...windows])
	};
}
