import { describe, expect, it } from 'vitest';
import { generateBacking } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';

const preset = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
const styles = ['bossa-nova', 'ballad', 'straight'] as const;
const params = { phraseId: 'style-coordination', tempo: 120, ppq: 192, beatsPerBar: 4, swing: 0.5,
	performanceForm: preset.phrase.performanceForm, sectionMap: preset.phrase.sectionMap, ensemble: {} };

describe.each(styles)('%s coordination', (id) => {
	const style = BACKING_STYLES[id];
	it('coordinates space without sacrificing the native pulse, and leaves Original independent', () => {
		const original = generateBacking(preset.phrase.harmony, style, { ...params, ensemble: undefined });
		const result = generateBacking(preset.phrase.harmony, style, params);
		expect(result.ensemblePlan).toBeDefined();
		expect(result).toEqual(generateBacking(preset.phrase.harmony, style, params));
		expect(original).toEqual(generateBacking(preset.phrase.harmony, style, { ...params, ensemble: undefined }));
		for (const bar of result.ensemblePlan!.bars) {
			const at = (event: { absBeat: number }) => Math.floor(event.absBeat / 4) === bar.barIndex;
			expect(result.compEvents.filter(at).length).toBeLessThanOrEqual(bar.piano.maxAttacks);
			expect(result.bassEvents.filter(at).length).toBeGreaterThan(0);
			expect(result.drumEvents.filter(at).filter((hit) => hit.role === 'commentary').length).toBeLessThanOrEqual(bar.drums.maxCommentaryHits);
			if (id === 'ballad') {
				expect(bar.energy).toBeLessThanOrEqual(0.6);
				expect(result.bassEvents.filter(at).every((hit) => hit.absBeat % 2 === 0)).toBe(true);
			}
			if (id === 'bossa-nova') {
				expect(result.drumEvents.filter(at).filter((hit) => hit.drum === 'crossstick').map((hit) => hit.absBeat))
     .toEqual(original.drumEvents.filter(at).filter((hit) => hit.drum === 'crossstick').map((hit) => hit.absBeat));
				expect(result.drumEvents.filter(at).filter((hit) => hit.drum === 'hihat')).toHaveLength(8);
				expect(result.bassEvents.filter(at).every((hit) => [0, 1.5, 2, 3.5].includes(hit.absBeat % 4))).toBe(true);
			}
		}
	});
	it('restores causal instrument state across a loop boundary and owns every release', () => {
		// A short real harmonic form, repeated twice; no future audio is generated at construction.
		const harmony = preset.phrase.harmony.filter((s) => s.startOffset[0] / s.startOffset[1] < 8);
		const score = createRollingBacking(harmony, style, { ...params, performanceForm: undefined, sectionMap: undefined }, { loopCount: 2 });
		let checkpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const features = [{ barIndex: bar, observedAtBar: bar, source: 'scripted' as const, confidence: 1, noteDensity: 1, restBeats: 0 }];
			const step = advanceRollingBacking(score, checkpoint, features);
			expect(step).toEqual(advanceRollingBacking(JSON.parse(JSON.stringify(score)), checkpoint && JSON.parse(JSON.stringify(checkpoint)), features));
			expect(step.compEvents.length).toBeLessThanOrEqual(step.ensemblePlan.bars[0].piano.maxAttacks);
			for (const event of [...step.compEvents, ...step.bassEvents]) {
				const tick = parseInt(event.time);
				expect(tick).toBeGreaterThanOrEqual(step.startTick);
				expect(tick + event.duration * score.tempo / 60 * score.ppq).toBeLessThanOrEqual(step.committedThroughTick + 1e-8);
			}
			if (id === 'ballad') {
				expect(step.checkpoint.bass.feel).toBe('two');
				expect(step.ensemblePlan.bars[0].energy).toBeLessThanOrEqual(0.6);
			}
			if (id === 'bossa-nova') expect(step.bassEvents.every((hit) => [0, 1.5, 2, 3.5].includes(hit.absBeat % 4))).toBe(true);
			expect(step.drumEvents.length).toBeGreaterThan(0);
			checkpoint = step.checkpoint;
		}
	});
});

it('binds rolling checkpoints to style even when timing overrides match', () => {
	const input = { ...params, timing: BACKING_STYLES.swing.timing };
	const straight = createRollingBacking(preset.phrase.harmony, BACKING_STYLES.straight, input);
	const bossa = createRollingBacking(preset.phrase.harmony, BACKING_STYLES['bossa-nova'], input);
	expect(() => advanceRollingBacking(bossa, advanceRollingBacking(straight).checkpoint)).toThrow(/checkpoint/);
});

it('retains style-owned grids even when the user swing knob differs', () => {
	for (const id of styles) {
		const style = BACKING_STYLES[id];
		const score = createRollingBacking(preset.phrase.harmony, style, { ...params, swing: 0.78 });
		expect(score.swing).toBe(style.defaultSwing);
		expect(generateBacking(preset.phrase.harmony, style, { ...params, swing: 0.78 }))
			.toEqual(generateBacking(preset.phrase.harmony, style, { ...params, swing: style.defaultSwing }));
	}
});

it('does not silently enable a custom vocabulary or unsupported meter', () => {
	const custom = { ...BACKING_STYLES.swing, name: 'Custom', coordinatedStyle: undefined };
	const input = { ...params, swing: 0.67 };
	expect(generateBacking(preset.phrase.harmony, custom, input).ensemblePlan).toBeUndefined();
	expect(() => createRollingBacking(preset.phrase.harmony, custom, input)).toThrow(/supported/);
	expect(() => createRollingBacking(preset.phrase.harmony, BACKING_STYLES.ballad, { ...input, beatsPerBar: 3 })).toThrow(/4\/4/);
});

it('native drum traces and piano decisions describe exactly the accepted events', () => {
	for (const id of ['bossa-nova', 'ballad'] as const) {
		const result = generateBacking(preset.phrase.harmony, BACKING_STYLES[id], params);
		for (const decision of result.ensembleDevelopment!.drumPhrases) {
			expect(decision.hits.map((hit) => [hit.drum, decision.barIndex * 4 + hit.beatOffset, hit.velocity, hit.role]).sort())
				.toEqual(result.drumEvents.filter((hit) => Math.floor(hit.absBeat / 4) === decision.barIndex).map((hit) => [hit.drum, hit.absBeat, hit.velocity, hit.role]).sort());
			expect(decision.commentary.motifId).toBeNull();
		}
		for (const decision of result.ensembleDevelopment!.pianoMotifs) {
			expect(decision.hits.map((hit) => decision.barIndex * 4 + hit.b))
				.toEqual(result.compEvents.filter((hit) => Math.floor(hit.absBeat / 4) === decision.barIndex).map((hit) => hit.absBeat));
			expect(decision.motifId).toBeNull();
		}
	}
});

it.each(styles)('%s uses new observations after a seam without rewriting the committed prefix', (id) => {
	const harmony = preset.phrase.harmony.filter((segment) => segment.startOffset[0] / segment.startOffset[1] < 8);
	const score = createRollingBacking(harmony, BACKING_STYLES[id], { ...params, performanceForm: undefined, sectionMap: undefined }, { loopCount: 2 });
	let checkpoint: RollingBackingCheckpoint | undefined;
	for (let bar = 0; bar <= score.sourceBars; bar++) checkpoint = advanceRollingBacking(score, checkpoint).checkpoint;
	const before = JSON.stringify(checkpoint);
	const bar = checkpoint!.nextBar;
	const features = [{ barIndex: bar, observedAtBar: bar - 1, source: 'microphone' as const, confidence: 0.95, noteDensity: 1, restBeats: 0 }];
	const dense = advanceRollingBacking(score, checkpoint, features);
	expect(dense.ensemblePlan.trace[0].soloEvidence).toBe('active');
	expect(dense.compEvents).toHaveLength(0);
	expect(dense.drumEvents.some((event) => event.role === 'commentary')).toBe(false);
	expect(dense.bassEvents.length).toBeGreaterThan(0);
	expect(JSON.stringify(checkpoint)).toBe(before);
	expect(advanceRollingBacking(score, checkpoint, [{ ...features[0], barIndex: bar + 2 }]))
		.toEqual(advanceRollingBacking(score, checkpoint));
});
