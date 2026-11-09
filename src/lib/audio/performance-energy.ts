import type { PerformanceForm } from '$lib/types/performance-form';
import { createRng, seedFrom } from './generation-rng';

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
export function planPerformanceEnergy(form: PerformanceForm, options: { seed?: number } = {}): readonly PerformanceEnergy[] {
	if (options.seed !== undefined && (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff)) {
		throw new Error('Performance energy seed must be an unsigned 32-bit integer');
	}
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
	if (options.seed !== undefined) applySoloWaves(form, result, options.seed);
	return Object.freeze(result);
}

/**
 * A separate arrangement stream: note RNG and historical callers do not move.
 * Each contiguous solo run carries its wave across chorus boundaries. Durations
 * depend on the first declared solo and elapsed music, never the future number
 * of passes, so extending the form cannot rewrite an earlier target.
 */
function applySoloWaves(form: PerformanceForm, result: PerformanceEnergy[], seed: number): void {
	let run = 0;
	for (let index = 0; index < form.choruses.length; index++) {
		const first = form.choruses[index];
		if (first.role !== 'solo') continue;
		let last = first;
		while (form.choruses[index + 1]?.role === 'solo') last = form.choruses[++index];
		const rng = createRng(seedFrom('performance-energy-waves-v1', seed, run++));
		// 12-bar blues uses four-bar gestures; a 32-bar chorus can sustain
		// eight-bar gestures. Neither resets the contour at the next chorus.
		const unit = Math.max(4, Math.min(8, Math.ceil((first.endBarExclusive - first.startBar) / 4)));
		let cursor = first.startBar;
		let level = .42 + rng.float() * .08;
		const span = (target: number, length: number, phase: PerformanceEnergy['phase']) => {
			const start = level;
			for (let offset = 0; offset < length && cursor < last.endBarExclusive; offset++, cursor++) {
				const p = offset / length;
				const targetEnergy = start + (target - start) * p * p * (3 - 2 * p);
				result[cursor] = Object.freeze({ ...result[cursor], phase, targetEnergy });
			}
			level = target;
		};
		// Recompute only the declared terminal phrase after the wave is known.
		const endingStart = result.findIndex((bar, barIndex) => barIndex >= first.startBar && barIndex < last.endBarExclusive && bar.phase === 'ending');
		// Some takes stay relaxed before developing; a replay keeps that choice.
		span(level, unit * rng.int(0, 2), 'solo_release');
		while (cursor < last.endBarExclusive) {
			span(.74 + rng.float() * .1, unit * rng.int(3, 6), 'solo_build');
			span(level, unit * rng.int(0, 2), 'solo_peak');
			span(.36 + rng.float() * .14, unit * rng.int(2, 4), 'solo_release');
			span(level, unit * rng.int(0, 2), 'solo_release');
		}
		if (endingStart >= 0) {
			const initial = result[endingStart].targetEnergy;
			const length = last.endBarExclusive - endingStart;
			for (let offset = 0; offset < length; offset++) {
				const p = length === 1 ? 1 : offset / (length - 1);
				result[endingStart + offset] = Object.freeze({ ...result[endingStart + offset], phase: 'ending',
					targetEnergy: initial + (Math.min(initial, .4) - initial) * p * p * (3 - 2 * p) });
			}
		}
	}
}
