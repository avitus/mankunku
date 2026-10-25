import type { PerformanceForm } from '$lib/types/performance-form';

export const PERFORMANCE_ENERGY_PHASES = ['head_in', 'solo_build', 'solo_peak', 'solo_release', 'head_return', 'ending'] as const;
export interface PerformanceEnergy {
	readonly phase: typeof PERFORMANCE_ENERGY_PHASES[number];
	readonly chorusIndex: number;
	/** Nominal structural target; realization applies local motion and the style ceiling. */
	readonly targetEnergy: number;
}

/** A smooth rise and release within a declared pass, independent of note RNG. */
function contour(position: number, start: number, peak: number, end: number): number {
	const pivot = 0.6;
	const progress = position <= pivot ? position / pivot : (position - pivot) / (1 - pivot);
	const eased = progress * progress * (3 - 2 * progress);
	return position <= pivot ? start + (peak - start) * eased : peak + (end - peak) * eased;
}

/**
 * Shape only an explicitly declared finite performance. Section repetitions do
 * not imply new choruses. This is a structural intention, not audible evidence.
 */
export function planPerformanceEnergy(form: PerformanceForm): readonly PerformanceEnergy[] {
	if (form.version !== 1 || !Number.isInteger(form.totalBars) || form.totalBars < 0) throw new Error('Invalid performance energy form');
	let next = 0;
	for (const [index, chorus] of form.choruses.entries()) {
		if (chorus.index !== index || chorus.startBar !== next || !Number.isInteger(chorus.endBarExclusive) ||
			chorus.endBarExclusive <= next || chorus.endBarExclusive > form.totalBars || !['head', 'solo'].includes(chorus.role)) {
			throw new Error('Performance energy requires complete contiguous declared choruses');
		}
		next = chorus.endBarExclusive;
	}
	if (next !== form.totalBars) throw new Error('Performance energy requires complete contiguous declared choruses');
	let soloIndex = 0;
	let heardSolo = false;
	const result: PerformanceEnergy[] = [];
	for (const chorus of form.choruses) {
		const isSolo = chorus.role === 'solo';
		const returning = !isSolo && heardSolo;
		// Earlier music must not change when another chorus is appended. Reach
		// a bounded plateau from elapsed solos, never normalize by future count.
		const development = Math.min(soloIndex / 3, 1);
		const start = isSolo ? 0.46 + 0.1 * development : returning ? 0.52 : 0.38;
		const peak = isSolo ? 0.66 + 0.16 * development : returning ? 0.64 : 0.5;
		const end = isSolo ? 0.5 + 0.08 * development : returning ? 0.4 : 0.43;
		const length = chorus.endBarExclusive - chorus.startBar;
		const finalChorus = chorus.index === form.choruses.length - 1;
		const closingSection = finalChorus ? form.sections.find((section) =>
			section.chorusIndex === chorus.index && section.endBarExclusive === chorus.endBarExclusive) : undefined;
		if (finalChorus && !closingSection) throw new Error('Performance energy requires the closing section');
		const endingStart = closingSection ? closingSection.startBar - chorus.startBar
			+ Math.floor((closingSection.endBarExclusive - closingSection.startBar - 1) / 4) * 4 : length;
		for (let offset = 0; offset < length; offset++) {
			// A one-bar pass is an arrival, not a compressed multi-bar build.
			const position = length === 1 ? 1 : offset / (length - 1);
			const ending = finalChorus && offset >= endingStart;
			const phase: PerformanceEnergy['phase'] = ending ? 'ending'
				: !isSolo ? returning ? 'head_return' : 'head_in'
				: position < 0.45 ? 'solo_build' : position < 0.75 ? 'solo_peak' : 'solo_release';
			let targetEnergy = contour(position, start, peak, end);
			if (ending) {
				// Only the known closing phrase may differ when a continuation is
				// declared. Join the unchanged contour continuously at its start.
				const initial = length === 1 ? end : contour(endingStart / (length - 1), start, peak, end);
				const progress = length - endingStart === 1 ? 1 : (offset - endingStart) / (length - endingStart - 1);
				targetEnergy = initial + (Math.min(end, 0.4) - initial) * progress * progress * (3 - 2 * progress);
			}
			result.push(Object.freeze({ phase, chorusIndex: chorus.index, targetEnergy }));
		}
		if (isSolo) { soloIndex++; heardSolo = true; }
	}
	return Object.freeze(result);
}
