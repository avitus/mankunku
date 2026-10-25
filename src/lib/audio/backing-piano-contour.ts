/** Causal phrase targets; only accepted piano attacks latch or advance state. */
import type { PerformanceEnergy } from './performance-energy';

export interface PianoContourContext {
	readonly barIndex: number;
	readonly phraseStartBar: number;
	readonly chorusIndex: number;
	readonly phase: PerformanceEnergy['phase'];
}
export interface PianoContourMemory {
	readonly version: 1;
	readonly phraseStartBar: number;
	readonly chorusIndex: number;
	readonly targetMidi: number;
	readonly direction: 'rise' | 'hold' | 'settle';
	readonly lastTopMidi: number;
	readonly lastBarIndex: number;
}
export interface PianoContourProposal {
	readonly targetMidi?: number;
	readonly direction: PianoContourMemory['direction'];
}

/** The first accepted phase chooses the phrase target; later phase changes do not relatch it. */
export function preparePianoContour(context: PianoContourContext, previous?: PianoContourMemory): PianoContourProposal {
	if (previous?.phraseStartBar === context.phraseStartBar && previous.chorusIndex === context.chorusIndex) {
		return { targetMidi: previous.targetMidi, direction: previous.direction };
	}
	const direction = context.phase === 'solo_build' ? 'rise'
		: ['head_return', 'solo_release', 'ending'].includes(context.phase) ? 'settle' : 'hold';
	if (!previous) return { direction };
	const offset = direction === 'rise' ? 2 : direction === 'settle' ? -2 : 0;
	return { targetMidi: Math.max(48, Math.min(84, previous.lastTopMidi + offset)), direction };
}

export function commitPianoContour(context: PianoContourContext, proposal: PianoContourProposal, notes: readonly number[]): PianoContourMemory {
	const top = notes.at(-1)!;
	if (!Number.isInteger(top) || top < 48 || top > 84) throw new Error('Invalid accepted piano top');
	return Object.freeze({ version: 1, phraseStartBar: context.phraseStartBar, chorusIndex: context.chorusIndex,
		targetMidi: proposal.targetMidi ?? top, direction: proposal.direction, lastTopMidi: top, lastBarIndex: context.barIndex });
}

/** Validate bounded actual history, not authenticity of externally supplied musical evidence. */
export function validatePianoContourMemory(memory: PianoContourMemory, nextBar: number, lastNotes: readonly number[]): void {
	if (!memory || memory.version !== 1 || Object.keys(memory).length !== 7 ||
		![memory.phraseStartBar, memory.chorusIndex, memory.lastBarIndex].every((value) => Number.isSafeInteger(value) && value >= 0) ||
		memory.phraseStartBar > memory.lastBarIndex || memory.lastBarIndex >= nextBar ||
		![memory.targetMidi, memory.lastTopMidi].every((value) => Number.isInteger(value) && value >= 48 && value <= 84) ||
		!['rise', 'hold', 'settle'].includes(memory.direction) || memory.lastTopMidi !== lastNotes.at(-1)) {
		throw new Error('Invalid rolling piano contour checkpoint');
	}
}
