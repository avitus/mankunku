import { planPerformanceEnergy, type PerformanceEnergy } from '$lib/audio/performance-energy';
import type { PerformanceForm } from '$lib/types/performance-form';

export interface ListeningArcPass {
	readonly index: number;
	readonly label: string;
	readonly startBar: number;
	readonly endBarExclusive: number;
}

export interface ListeningArcPoint {
	readonly barIndex: number;
	readonly phase: PerformanceEnergy['phase'];
	readonly targetEnergy: number;
}

export interface ListeningArc {
	readonly totalBars: number;
	readonly passes: readonly ListeningArcPass[];
	readonly points: readonly ListeningArcPoint[];
}

/**
 * Present the engine's nominal structural intention, not measured loudness or
 * future played notes. Original keeps the form but has no shared energy plan.
 */
export function buildListeningArc(form: PerformanceForm, orchestration: 'original' | 'coordinated'): ListeningArc {
	// Validate the same declared form in both modes. Do not repair gaps or
	// normalize unequal pass lengths merely to draw a convenient chart.
	const energy = planPerformanceEnergy(form);
	const hasSolo = form.choruses.some(pass => pass.role === 'solo');
	let soloCount = 0;
	let headCount = 0;
	const passes = form.choruses.map(pass => {
		let label: string;
		if (pass.role === 'solo') label = `Solo ${++soloCount}`;
		else {
			headCount++;
			if (!hasSolo) label = form.choruses.length === 1 ? 'Head' : `Head ${headCount}`;
			else if (pass.index === 0) label = 'Head in';
			else if (soloCount === 0) label = 'Head';
			else label = pass.index === form.choruses.length - 1 ? 'Head out' : 'Head return';
		}
		return Object.freeze({ index: pass.index, label, startBar: pass.startBar, endBarExclusive: pass.endBarExclusive });
	});
	const points = orchestration === 'coordinated'
		? energy.map(({ phase, targetEnergy }, barIndex) => Object.freeze({ barIndex, phase, targetEnergy }))
		: [];
	return Object.freeze({ totalBars: form.totalBars, passes: Object.freeze(passes), points: Object.freeze(points) });
}
