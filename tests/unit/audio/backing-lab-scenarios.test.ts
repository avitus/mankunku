import { describe, expect, it } from 'vitest';
import {
	LAB_SOLO_SCENARIOS,
	scriptedSoloFeatures,
	validateLabScenarioBars,
	type LabSoloScenario
} from '$lib/audio/backing-lab-scenarios';
import { generateBacking } from '$lib/audio/backing-generation';
import { BACKING_LAB_PRESETS, labPhraseWithSeed } from '$lib/audio/backing-lab-presets';
import { BACKING_STYLES } from '$lib/audio/backing-styles';

const preset = BACKING_LAB_PRESETS.find((item) => item.id === 'lab-aaba-c')!;

function generate(scenario: LabSoloScenario, seed: number) {
	const phrase = labPhraseWithSeed(preset, seed);
	return generateBacking(phrase.harmony, BACKING_STYLES.swing, {
		phraseId: phrase.id,
		tempo: 140,
		ppq: 192,
		beatsPerBar: 4,
		swing: 0.67,
		sectionMap: phrase.sectionMap,
		performanceForm: phrase.performanceForm,
		ensemble: { soloFeatures: scriptedSoloFeatures(scenario, preset.bars) }
	});
}

describe('scripted listening-lab solo scenarios', () => {
	it('keeps unavailable input absent and identifies the other scenarios as scripted', () => {
		expect(scriptedSoloFeatures('unavailable', 16)).toBeUndefined();
		expect(LAB_SOLO_SCENARIOS.map((scenario) => scenario.id)).toEqual(['unavailable', 'dense', 'sparse']);
		for (const scenario of ['dense', 'sparse'] as const) {
			const features = scriptedSoloFeatures(scenario, 16)!;
			expect(features).toHaveLength(16);
			expect(Object.isFrozen(features)).toBe(true);
			for (const [barIndex, feature] of features.entries()) {
				expect(feature.barIndex).toBe(barIndex);
				expect(feature.observedAtBar).toBe(barIndex);
				expect(feature.source).toBe('scripted');
				expect(feature.confidence).toBe(1);
				expect(Object.isFrozen(feature)).toBe(true);
			}
		}
	});

	it('rejects invalid bar counts before generating any scenario', () => {
		for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			expect(() => validateLabScenarioBars(value)).toThrow(RangeError);
			expect(() => scriptedSoloFeatures('unavailable', value)).toThrow(RangeError);
		}
		expect(validateLabScenarioBars(12)).toBe(12);
	});

	it('reduces actual piano and drum commentary for the dense scenario while retaining pulse', () => {
		for (const seed of [0, 1, 2, 3]) {
			const ordinary = generate('unavailable', seed);
			const dense = generate('dense', seed);
			expect(dense.compEvents.length).toBeLessThan(ordinary.compEvents.length);
			expect(dense.drumEvents.filter((event) => event.role === 'commentary').length).toBeLessThan(
				ordinary.drumEvents.filter((event) => event.role === 'commentary').length
			);
			for (const bar of dense.ensemblePlan!.bars) {
				expect(dense.bassEvents.some((event) => event.absBeat === bar.barIndex * 4)).toBe(true);
				for (let beat = 0; beat < 4; beat++) {
					expect(dense.drumEvents.some((event) =>
						event.absBeat === bar.barIndex * 4 + beat && ['ride', 'ride-bell', 'crash'].includes(event.drum)
					)).toBe(true);
				}
			}
		}
	});

	it('provides real sparse-solo gaps but reserves a response for only some of them', () => {
		const features = scriptedSoloFeatures('sparse', preset.bars)!;
		const gaps = features.filter((feature) => feature.restBeats >= 1).map((feature) => feature.barIndex);
		expect(gaps.length).toBeGreaterThan(0);
		expect(gaps.length).toBeLessThan(features.length);
		let actualResponses = 0;
		for (const seed of [0, 1, 2, 3]) {
			const generated = generate('sparse', seed);
			const responses = generated.ensemblePlan!.bars.filter((bar) => bar.responseOwner !== 'nobody');
			expect(responses.length).toBeGreaterThan(0);
			expect(responses.length).toBeLessThan(gaps.length);
			for (const bar of responses) {
				expect(gaps).toContain(bar.barIndex);
				const inBar = (event: { absBeat: number }) => Math.floor(event.absBeat / 4) === bar.barIndex;
				const piano = generated.compEvents.filter(inBar);
				const commentary = generated.drumEvents.filter((event) => inBar(event) && event.role === 'commentary');
				if (bar.responseOwner === 'piano') {
					expect(commentary).toHaveLength(0);
					actualResponses += piano.length;
				} else if (bar.responseOwner === 'drums') {
					expect(piano).toHaveLength(0);
					actualResponses += commentary.length;
				} else {
					expect(piano).toHaveLength(0);
					expect(commentary).toHaveLength(0);
				}
			}
		}
		expect(actualResponses).toBeGreaterThan(0);
	});
});
