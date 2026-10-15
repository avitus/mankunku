import { describe, expect, it } from 'vitest';
import { buildBarInfos, generateBacking, generateComping, type BackingGenerationParams } from '$lib/audio/backing-generation';
import { BACKING_STYLES, type StyleDefinition } from '$lib/audio/backing-styles';
import { SWING_TIMING } from '$lib/audio/backing-timing';
import { planEnsemble } from '$lib/audio/ensemble-plan';
import type { HarmonicSegment } from '$lib/types/music';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';

const harmony: HarmonicSegment[] = [{ chord: { root: 'C', quality: 'maj7' },
	scaleId: 'major.ionian', startOffset: [0, 1], duration: [3, 1] }];
const infos = buildBarInfos(3);
const roles = planEnsemble({ phraseId: 'comp-silence', tempo: 140,
	bars: infos.map((info, barIndex) => ({ ...info, barIndex })) }).bars;
const reserved = infos.map((info, bar) => ({ ...info,
	ensemble: { ...roles[bar], piano: { ...roles[bar].piano, maxAttacks: bar === 1 ? 0 as const : 1 as const } } }));

// A complete pushed chord before a rest, then a new chord after it. The
// reservation must govern sounding duration, including player placement.
const style: StyleDefinition = { ...BACKING_STYLES.swing, compPlanning: false,
	compPattern: (ctx) => ctx.barIndex === 0
		? [{ beatOffset: 3.5, durationBeats: 2, velocity: 70 }]
		: ctx.barIndex === 2 ? [{ beatOffset: 0, durationBeats: 1, velocity: 65 }] : [] };

describe('scheduled piano silence', () => {
	it('reports only emitted piano attacks to coordinated drums on a partial final bar', () => {
		const partial: HarmonicSegment[] = [{ ...harmony[0], duration: [5, 8] }];
		const partialStyle: StyleDefinition = { ...BACKING_STYLES.swing, compPlanning: false,
			compPattern: () => [
				{ beatOffset: 0, durationBeats: 0, velocity: 70 },
				{ beatOffset: 1.5, durationBeats: 0.5, velocity: 70 },
				{ beatOffset: 3.5, durationBeats: 1, velocity: 70 }
			] };
		const result = generateComping(partial, 4, partialStyle, {
			phraseId: 'partial-onsets', tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67, ensemble: {}
		}, reserved.slice(0, 1));
		expect(result.events.map((event) => event.absBeat)).toEqual([1.5]);
		expect(result.onsetsByBar.get(0)).toEqual([1.5]);
	});

	it('reserves sounding space in the real AABA performance, not only zero new attacks', () => {
		const preset = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
		const tempo = 140;
		const ppq = 192;
		const generated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
			phraseId: preset.phrase.id, tempo, ppq, beatsPerBar: 4, swing: 0.67,
			sectionMap: preset.phrase.sectionMap, performanceForm: preset.phrase.performanceForm, ensemble: {}
		});
		const silentBars = generated.ensemblePlan!.bars.filter((bar) => bar.piano.maxAttacks === 0);
		expect(silentBars.length).toBeGreaterThan(0);
		for (const bar of silentBars) {
			const start = bar.barIndex * 4 * 60 / tempo;
			const end = (bar.barIndex + 1) * 4 * 60 / tempo;
			for (const event of generated.compEvents) {
				const attack = parseInt(event.time) / ppq * 60 / tempo;
				expect(attack >= end - 1e-9 || attack + event.duration <= start + 1e-9).toBe(true);
			}
		}
	});

	it.each([90, 140, 240])('ends preceding sustain at the reserved boundary at %i BPM', (tempo) => {
		const params: BackingGenerationParams = { phraseId: 'comp-silence', tempo, ppq: 192,
			beatsPerBar: 4, swing: 0.67, timing: { ...SWING_TIMING, comp: { offsetMs: 12, jitterMs: 8 } } };
		const original = generateComping(harmony, 4, style, params, infos).events[0];
		const events = generateComping(harmony, 4, style, params, reserved).events;
		expect(events).toHaveLength(2);
		const first = events[0];
		const startSeconds = parseInt(first.time) / params.ppq * 60 / tempo;
		const silenceStarts = 4 * 60 / tempo;
		expect(first.time).toBe(original.time);
		expect(startSeconds).toBeLessThan(silenceStarts);
		expect(first.duration).toBeGreaterThan(0);
		expect(startSeconds + first.duration).toBeCloseTo(silenceStarts, 10);
		expect(first.duration).toBeLessThan(original.duration);
	});

	it('does not let an early player offset resume inside the reserved bar', () => {
		const params: BackingGenerationParams = { phraseId: 'comp-early-resume', tempo: 140, ppq: 480,
			beatsPerBar: 4, swing: 0.67, timing: { ...SWING_TIMING, comp: { offsetMs: -12, jitterMs: 0 } } };
		const events = generateComping(harmony, 4, style, params, reserved).events;
		const resumed = events[1];
		expect(parseInt(resumed.time)).toBeGreaterThanOrEqual(8 * params.ppq);
		expect(events.every((e) => Number.isFinite(e.duration) && e.duration > 0)).toBe(true);
	});
});
