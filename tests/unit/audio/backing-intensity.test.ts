import { describe, it, expect } from 'vitest';
import { barIntensity, lerp } from '$lib/audio/backing-intensity';
import { generateBacking, buildBarInfos } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS, labPhraseWithSeed } from '$lib/audio/backing-lab-presets';
import type { BackingGenerationParams } from '$lib/audio/backing-generation';

describe('lerp', () => {
	it('interpolates linearly between the endpoints', () => {
		expect(lerp(0, 1, 0.5)).toBe(0.5);
		expect(lerp(2, 4, 0)).toBe(2);
		expect(lerp(2, 4, 1)).toBe(4);
		expect(lerp(6, 2.5, 0.35)).toBeCloseTo(4.775);
	});
});

describe('barIntensity', () => {
	it('builds by chorus with a cadence lean, capped at the third chorus', () => {
		const base = { isSectionFinalBar: false, barIndex: 0, totalBars: 96 };
		expect(barIntensity({ ...base, chorusIndex: 0 })).toBeCloseTo(0.35);
		expect(barIntensity({ ...base, chorusIndex: 1 })).toBeCloseTo(0.55);
		expect(barIntensity({ ...base, chorusIndex: 2 })).toBeCloseTo(0.75);
		expect(barIntensity({ ...base, chorusIndex: 7 })).toBeCloseTo(0.75); // capped
		expect(barIntensity({ ...base, chorusIndex: 2, isSectionFinalBar: true })).toBeCloseTo(0.83);
	});

	it('stays inside [0.2, 0.9] for any chorus/cadence combination', () => {
		for (let chorus = 0; chorus < 10; chorus++) {
			for (const cadence of [false, true]) {
				const v = barIntensity({
					chorusIndex: chorus,
					isSectionFinalBar: cadence,
					barIndex: 0,
					totalBars: 96
				});
				expect(v).toBeGreaterThanOrEqual(0.2);
				expect(v).toBeLessThanOrEqual(0.9);
			}
		}
	});

	it('ramps gently across sectionless phrases, capped at 0.7', () => {
		expect(barIntensity({ isSectionFinalBar: false, barIndex: 0, totalBars: 8 })).toBeCloseTo(0.45);
		expect(barIntensity({ isSectionFinalBar: false, barIndex: 7, totalBars: 8 })).toBeCloseTo(
			0.45 + (0.25 * 7) / 8
		);
		expect(barIntensity({ isSectionFinalBar: false, barIndex: 63, totalBars: 64 })).toBeCloseTo(
			0.7
		); // long loop hits the cap
		expect(barIntensity({ isSectionFinalBar: false, barIndex: 0, totalBars: 0 })).toBeCloseTo(
			0.45
		); // degenerate guard
	});

	it('is what buildBarInfos stamps on every bar', () => {
		const aaba = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
		const infos = buildBarInfos(aaba.bars, aaba.phrase.sectionMap);
		for (const [b, info] of infos.entries()) {
			expect(info.intensity).toBe(
				barIntensity({
					chorusIndex: info.chorusIndex,
					isSectionFinalBar: info.isSectionFinalBar,
					barIndex: b,
					totalBars: aaba.bars
				})
			);
		}
	});
});

describe('the arc is audible: the band goes somewhere', () => {
	const aaba = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
	const infos = buildBarInfos(aaba.bars, aaba.phrase.sectionMap);

	function eventsPerChorus(seed: number): number[] {
		const phrase = labPhraseWithSeed(aaba, seed);
		const params: BackingGenerationParams = {
			phraseId: phrase.id,
			tempo: 160,
			ppq: 192,
			beatsPerBar: 4,
			swing: 0.733,
			sectionMap: phrase.sectionMap
		};
		const { bassEvents, compEvents, drumEvents } = generateBacking(
			phrase.harmony,
			BACKING_STYLES.swing,
			params
		);
		const counts = [0, 0, 0];
		for (const e of [...bassEvents, ...compEvents, ...drumEvents]) {
			const bar = Math.min(Math.floor(e.absBeat / 4), infos.length - 1);
			counts[infos[bar].chorusIndex ?? 0]++;
		}
		return counts;
	}

	it('chorus 2 carries more events than chorus 0 at every seed', () => {
		for (const seed of [0, 1, 2, 3, 4]) {
			const [c0, , c2] = eventsPerChorus(seed);
			expect(c2, `seed ${seed}: chorus 0 ${c0} vs chorus 2 ${c2}`).toBeGreaterThan(c0);
		}
	});

	it('mean bar intensity rises strictly chorus over chorus', () => {
		const mean = (chorus: number): number => {
			const bars = infos.filter((i) => i.chorusIndex === chorus);
			return bars.reduce((s, i) => s + i.intensity, 0) / bars.length;
		};
		expect(mean(1)).toBeGreaterThan(mean(0));
		expect(mean(2)).toBeGreaterThan(mean(1));
	});
});
