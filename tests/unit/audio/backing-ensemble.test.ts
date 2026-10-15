import { describe, expect, it } from 'vitest';
import { buildBarInfos, generateBacking, generateBackingCached } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { generateForBounce } from '$lib/audio/backing-bounce';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';

const preset = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
const base = {
	phraseId: preset.phrase.id,
	tempo: 140,
	ppq: 192,
	beatsPerBar: 4,
	swing: 0.67,
	sectionMap: preset.phrase.sectionMap,
	performanceForm: preset.phrase.performanceForm
};

describe('coordinated swing generation', () => {
	it('realizes the ensemble silence and commentary budgets while preserving the pulse', () => {
		const generated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
			...base, ensemble: {}
		});
		expect(generated.ensemblePlan).toBeDefined();
		let silentPianoBars = 0;
		let silentCommentaryBars = 0;
		for (const plan of generated.ensemblePlan!.bars) {
			const inBar = (event: { absBeat: number }) => Math.floor(event.absBeat / 4) === plan.barIndex;
			const piano = generated.compEvents.filter(inBar);
			const drums = generated.drumEvents.filter(inBar);
			expect(piano.length).toBeLessThanOrEqual(plan.piano.maxAttacks);
			expect(drums.filter((e) => e.role === 'commentary').length).toBeLessThanOrEqual(plan.drums.maxCommentaryHits);
			if (plan.piano.maxAttacks === 0) {
				silentPianoBars++;
				expect(piano).toHaveLength(0);
			}
			if (plan.drums.maxCommentaryHits === 0) {
				silentCommentaryBars++;
				expect(drums.some((e) => e.role === 'commentary')).toBe(false);
			}
			for (let beat = 0; beat < 4; beat++) {
				expect(drums.some((e) => e.absBeat === plan.barIndex * 4 + beat &&
					['ride', 'ride-bell', 'crash'].includes(e.drum))).toBe(true);
			}
			expect(generated.bassEvents.some(inBar)).toBe(true);
		}
		expect(silentPianoBars).toBeGreaterThan(0);
		expect(silentCommentaryBars).toBeGreaterThan(0);
	});

	it('uses the foot hi-hat for coordinated swing and preserves original playback as a comparison', () => {
		const original = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, base);
		const coordinated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, { ...base, ensemble: {} });
		expect(original.ensemblePlan).toBeUndefined();
		expect(coordinated.drumEvents.some((e) => e.drum === 'hihat-pedal')).toBe(true);
		expect(coordinated).not.toEqual(original);
		expect(generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, base)).toEqual(original);
	});

	it('caches complete independent plans without contaminating the original generation', () => {
		const params = { ...base, ensemble: {} };
		const first = generateBackingCached(preset.phrase.harmony, BACKING_STYLES.swing, params);
		const second = generateBackingCached(preset.phrase.harmony, BACKING_STYLES.swing, params);
		expect(first.ensemblePlan).toBeDefined();
		expect(second).toEqual(first);
		expect(second.ensemblePlan).not.toBe(first.ensemblePlan);
		expect(Object.isFrozen(second.ensemblePlan!.bars[0].piano)).toBe(true);
		expect(generateBackingCached(preset.phrase.harmony, BACKING_STYLES.swing, base).ensemblePlan).toBeUndefined();
	});

	it('resolves explicit internal repeats as one chorus before instrument generation', () => {
		const sectionMap = [{ sourceSection: 0, barOffset: 0 }, { sourceSection: 0, barOffset: 8 },
			{ sourceSection: 1, barOffset: 16 }, { sourceSection: 0, barOffset: 24 }];
		const form = buildPerformanceForm({ totalBars: 32, sectionMap,
			choruses: [{ role: 'head', startBar: 0, endBarExclusive: 32 }] });
		const infos = buildBarInfos(32, sectionMap, form);
		expect(infos.every((bar) => bar.chorusIndex === 0)).toBe(true);
		expect(infos[8].isChorusFirstBar).toBe(false);
		expect(infos[8].isSectionFirstBar).toBe(true);
	});

	it('retains explicit chorus identity when harmony extends beyond or ends before the form', () => {
		const sectionMap = [{ sourceSection: 0, barOffset: 0 }, { sourceSection: 0, barOffset: 4 }];
		const form = buildPerformanceForm({ totalBars: 8, sectionMap,
			choruses: [{ role: 'head', startBar: 0, endBarExclusive: 8 }] });
		for (const length of [6, 10]) {
			const infos = buildBarInfos(length, sectionMap, form);
			expect(infos.every((bar) => bar.chorusIndex === 0)).toBe(true);
			expect(infos[length - 1].isSectionFinalBar).toBe(true);
			expect(infos[4].isChorusFirstBar).toBe(false);
		}
		expect(form.totalBars).toBe(8);
		expect(form.choruses[0].endBarExclusive).toBe(8);
	});

	it('puts reserved bass and drum arrivals on the same tick across seeds and tempi', () => {
		let arrivals = 0;
		for (const tempo of [90, 160, 240]) for (const seed of [0, 1, 2]) {
			const generated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
				...base, tempo, phraseId: `${base.phraseId}#${seed}`, ensemble: {}
			});
			for (const bar of generated.ensemblePlan!.bars) {
				if (!bar.coordinatedAccent) continue;
				arrivals++;
				const beat = bar.barIndex * 4;
				const bass = generated.bassEvents.find((e) => e.absBeat === beat);
				const accents = generated.drumEvents.filter((e) => e.absBeat === beat && e.role === 'accent');
				expect(bass).toBeDefined();
				expect(accents.length).toBeGreaterThan(0);
				expect(accents.every((e) => e.time === bass!.time)).toBe(true);
				expect(generated.compEvents.filter((e) => Math.floor(e.absBeat / 4) === bar.barIndex)).toHaveLength(0);
			}
		}
		expect(arrivals).toBeGreaterThan(0);
	});

	it('reduces actual commentary under dense observed activity without losing timekeeping', () => {
		const generated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
			...base, ensemble: { soloFeatures: Array.from({ length: preset.bars }, (_, barIndex) => ({
				barIndex, observedAtBar: barIndex, source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0
			})) }
		});
		expect(generated.drumEvents.filter((e) => e.role === 'commentary')).toHaveLength(0);
		for (const bar of generated.ensemblePlan!.bars) {
			const piano = generated.compEvents.filter((e) => Math.floor(e.absBeat / 4) === bar.barIndex);
			expect(piano.length).toBeLessThanOrEqual(bar.boundaryStrength >= 0.85 ? 1 : 0);
			expect(generated.bassEvents.some((e) => e.absBeat === bar.barIndex * 4)).toBe(true);
		}
	});

	it('bounces the same coordinated events as playback generation, with original as the default', () => {
		const params = { phrase: preset.phrase, style: 'swing' as const, tempo: 140, swing: 0.67,
			instrument: 'piano' as const, volume: 0.6, mix: DEFAULT_BACKING_MIX };
		expect(generateForBounce(params).ensemblePlan).toBeUndefined();
		expect(generateForBounce({ ...params, orchestration: 'coordinated' })).toEqual(
			generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, { ...base, ensemble: {} })
		);
	});

	it('keeps the existing non-swing vocabulary untouched', () => {
		for (const style of [BACKING_STYLES['bossa-nova'], BACKING_STYLES.ballad, BACKING_STYLES.straight]) {
			expect(generateBacking(preset.phrase.harmony, style, { ...base, ensemble: {} }))
				.toEqual(generateBacking(preset.phrase.harmony, style, base));
		}
	});
});
