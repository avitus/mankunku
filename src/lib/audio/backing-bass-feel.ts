import type { PerformanceForm } from '$lib/types/performance-form';
import type { PerformanceEnergy } from './performance-energy';
import { createRng, seedFrom } from './generation-rng';

export interface StructuralBassFeel {
	readonly barIndex: number;
	readonly feel: 'two' | 'four';
	readonly reason: 'head_support' | 'solo_walk' | 'transition_walk' | 'ending_release';
}

/**
 * Shared fixed/rolling pulse policy. Only explicit coordinated structure opts
 * in. A selected transition belongs to a declared arrival, never a bar draw.
 * Static form/arc data is safe to inspect before future solo evidence exists.
 */
export function planStructuralBassFeel(form: PerformanceForm | undefined,
	arcs: readonly (PerformanceEnergy | undefined)[], phraseId: string, tempo: number): readonly StructuralBassFeel[] | undefined {
	if (!form || form.totalBars !== arcs.length || !arcs.length || arcs.some((arc) => !arc)) return undefined;
	const result: StructuralBassFeel[] = [];
	for (const [index, chorus] of form.choruses.entries()) {
		const next = form.choruses[index + 1];
		const transition = chorus.role === 'head' && next?.role === 'solo' && chorus.endBarExclusive - chorus.startBar >= 8 &&
			createRng(seedFrom(phraseId, tempo, 'bass-structural-transition', next.startBar)).chance(0.5);
		const endingStart = arcs.findIndex((arc, bar) => bar >= chorus.startBar && bar < chorus.endBarExclusive && arc?.phase === 'ending');
		// A short solo pass must still establish walking at its arrival. Do
		// not turn an entire one-phrase solo into an ending texture.
		const quietEnding = endingStart > chorus.startBar && arcs[endingStart]!.targetEnergy <= 0.6;
		for (let barIndex = chorus.startBar; barIndex < chorus.endBarExclusive; barIndex++) {
			const reason: StructuralBassFeel['reason'] = quietEnding && barIndex >= endingStart ? 'ending_release'
				: transition && barIndex >= chorus.endBarExclusive - 2 ? 'transition_walk'
				: chorus.role === 'head' ? 'head_support' : 'solo_walk';
			result.push(Object.freeze({ barIndex, feel: reason === 'solo_walk' || reason === 'transition_walk' ? 'four' : 'two', reason }));
		}
	}
	return Object.freeze(result);
}
