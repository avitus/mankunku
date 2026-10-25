/** One causal scalar step between an accepted chord arrival and a reserved approach. */
import type { EnsembleBarPlan } from './ensemble-plan';
import { createRng, seedFrom } from './generation-rng';

export interface BassPulse {
	readonly absBeat: number;
	readonly time: string;
	readonly midi: number;
}
export interface BassScalarContinuation {
	readonly barIndex: number;
	readonly boundaryAbsBeat: number;
	readonly direction: 'up' | 'down';
	readonly notes: readonly [BassPulse, BassPulse, BassPulse];
}
export interface BassScalarHistory {
	readonly pulse: BassPulse;
	readonly ornamentAfterPulse: boolean;
}

export function allowsBassScalarContinuation(plan: EnsembleBarPlan | undefined): boolean {
	return !!plan?.performanceEnergy && plan.bass.ornamentScale >= 0.75 &&
		!['head_in', 'head_return', 'solo_release', 'ending'].includes(plan.performanceEnergy.phase) &&
		!['leave_space', 'release'].includes(plan.phraseIntent) && plan.responseOwner === 'nobody' &&
		!plan.coordinatedAccent && !plan.setupFor;
}

/** Candidates already satisfy the caller's native walk/device constraints. */
export function selectBassScalarContinuation(input: {
	phraseId: string; tempo: number; boundaryAbsBeat: number;
	previousMidi: number; arrivalMidi: number; ordinaryMidi: number;
	candidates: readonly number[]; scalePcs: readonly number[]; deviceEntryMidi: number;
}): number {
	const { previousMidi, arrivalMidi, ordinaryMidi } = input;
	const motion = arrivalMidi - previousMidi;
	if (![previousMidi, arrivalMidi, ordinaryMidi, input.deviceEntryMidi].every(Number.isInteger) ||
		Math.abs(motion) < 1 || Math.abs(motion) > 2) return ordinaryMidi;
	const direction = Math.sign(motion);
	const legal = input.candidates.filter(midi => Number.isInteger(midi) && midi >= 28 && midi <= 55 &&
		Math.sign(midi - arrivalMidi) === direction && Math.abs(midi - arrivalMidi) <= 2 &&
		input.scalePcs.includes((midi % 12 + 12) % 12) && Math.abs(midi - input.deviceEntryMidi) <= 5);
	if (legal.length === 0 || legal.includes(ordinaryMidi)) return ordinaryMidi;
	if (!createRng(seedFrom(input.phraseId, input.tempo, 'bass-scalar-continuation', input.boundaryAbsBeat)).chance(0.5)) return ordinaryMidi;
	return legal.sort((a, b) => Math.abs(a - arrivalMidi) - Math.abs(b - arrivalMidi) || a - b)[0];
}

export function bassScalarTrace(previous: BassPulse, arrival: BassPulse, continuation: BassPulse): BassScalarContinuation {
	const pulse = ({ absBeat, time, midi }: BassPulse): BassPulse => Object.freeze({ absBeat, time, midi });
	return Object.freeze({ barIndex: arrival.absBeat / 4, boundaryAbsBeat: arrival.absBeat,
		direction: continuation.midi > arrival.midi ? 'up' : 'down',
		notes: Object.freeze([pulse(previous), pulse(arrival), pulse(continuation)]) as readonly [BassPulse, BassPulse, BassPulse] });
}
