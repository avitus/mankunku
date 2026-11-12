/** Scripted observation fixtures for the listening lab; no solo audio or live input. */
import type { SoloFeature } from './ensemble-plan';

export type LabSoloScenario = 'unavailable' | 'dense' | 'sparse';

export const LAB_SOLO_SCENARIOS: readonly {
	readonly id: LabSoloScenario;
	readonly label: string;
	readonly hint: string;
}[] = Object.freeze([
	Object.freeze({
		id: 'unavailable' as const,
		label: 'No soloist input',
		hint: 'The band uses form and its own roles; missing input is not treated as a soloist rest.'
	}),
	Object.freeze({
		id: 'dense' as const,
		label: 'Dense soloist (scripted)',
		hint: 'Fixed dense-solo features test accompaniment restraint. No solo audio or microphone listening.'
	}),
	Object.freeze({
		id: 'sparse' as const,
		label: 'Sparse soloist (scripted)',
		hint: 'Four-bar feature phrases end in a rest to test selective responses. No solo audio or microphone listening.'
	})
]);

/** Validate the known lab timeline before allocating one feature record per bar. */
export function validateLabScenarioBars(totalBars: number): number {
	if (!Number.isSafeInteger(totalBars) || totalBars <= 0) {
		throw new RangeError('A lab scenario needs a positive whole number of bars');
	}
	return totalBars;
}

/** Produce causal, immutable observation fixtures, or no evidence at all. */
export function scriptedSoloFeatures(
	scenario: LabSoloScenario,
	totalBars: number
): readonly SoloFeature[] | undefined {
	validateLabScenarioBars(totalBars);
	if (scenario === 'unavailable') return undefined;
	return Object.freeze(Array.from({ length: totalBars }, (_, barIndex) => {
		const resting = scenario === 'sparse' && barIndex % 4 === 3;
		return Object.freeze({
			barIndex,
			observedAtBar: barIndex,
			source: 'scripted' as const,
			confidence: 1,
			noteDensity: scenario === 'dense' ? 0.9 : resting ? 0 : [0.25, 0.35, 0.15][barIndex % 4],
			restBeats: resting ? 4 : 0,
			phraseEnded: resting
		});
	}));
}
