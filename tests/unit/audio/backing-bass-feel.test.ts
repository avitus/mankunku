import { describe, expect, it } from 'vitest';
import { generateBacking } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import type { HarmonicSegment } from '$lib/types/music';
import { planStructuralBassFeel } from '$lib/audio/backing-bass-feel';
import { planPerformanceEnergy } from '$lib/audio/performance-energy';

const harmony: HarmonicSegment[] = Array.from({ length: 24 }, (_, bar) => ({
	chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [bar, 1], duration: [1, 1]
}));
const form = buildPerformanceForm({ totalBars: 24, sectionMap: [], choruses: [
	{ role: 'head', startBar: 0, endBarExclusive: 8 }, { role: 'solo', startBar: 8, endBarExclusive: 16 }, { role: 'head', startBar: 16, endBarExclusive: 24 }
] });
const params = { phraseId: 'bass-structural-feel', tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67, performanceForm: form, ensemble: {} };
const offsets = (events: readonly { absBeat: number }[], bar: number) => events.filter((event) => Math.floor(event.absBeat / 4) === bar && Number.isInteger(event.absBeat)).map((event) => event.absBeat % 4);

describe.each(['swing', 'straight'] as const)('%s structural bass feel', (style) => {
	it('returns to deliberate two-feel under the melody after a walking solo in emitted fixed and rolling music', () => {
		const generated = generateBacking(harmony, BACKING_STYLES[style], params);
		for (const bar of [0, 1, 2, 3, 16, 17, 18, 19, 22, 23]) expect(offsets(generated.bassEvents, bar)).toEqual([0, 2]);
		for (const bar of [8, 9, 10, 11, 12, 13]) expect(offsets(generated.bassEvents, bar)).toEqual([0, 1, 2, 3]);
		const score = createRollingBacking(harmony, BACKING_STYLES[style], params);
		let checkpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < 24; bar++) {
			const step = advanceRollingBacking(score, checkpoint);
			if (bar < 4 || bar >= 16) {
				expect(offsets(step.bassEvents, bar)).toEqual([0, 2]);
				expect(step.checkpoint.bass.feel).toBe('two');
			}
			checkpoint = step.checkpoint;
		}
	});
	it('announces odd-beat harmonic changes without sustaining a structural half note into the new harmony', () => {
		const changes = Array.from({ length: 96 }, (_, beat) => ({ ...harmony[0], startOffset: [beat, 4] as [number, number], duration: [1, 4] as [number, number] }));
		const fixed = generateBacking(changes, BACKING_STYLES[style], params);
		const score = createRollingBacking(changes, BACKING_STYLES[style], params);
		const rolling = advanceRollingBacking(score);
		for (const events of [fixed.bassEvents.filter((event) => event.absBeat < 4), rolling.bassEvents]) {
			expect(offsets(events, 0)).toEqual([0, 1, 2, 3]);
			expect(events.every((event) => event.duration <= 60 / params.tempo + 1e-9)).toBe(true);
		}
	});
});

describe('structural bass policy', () => {
	it('selects a complete two-bar transition at a declared head-to-solo boundary and preserves stable surrounding textures', () => {
		const arcs = planPerformanceEnergy(form);
		let selected = 0;
		for (let seed = 0; seed < 24; seed++) {
			const plan = planStructuralBassFeel(form, arcs, `feel-${seed}`, 140)!;
			expect(plan.slice(0, 6).every((bar) => bar.feel === 'two' && bar.reason === 'head_support')).toBe(true);
			expect(plan[6].feel).toBe(plan[7].feel);
			if (plan[6].reason === 'transition_walk') selected++;
			expect(plan.slice(8, 16).every((bar) => bar.feel === 'four')).toBe(true);
			expect(plan.slice(16).every((bar) => bar.feel === 'two')).toBe(true);
			expect(Object.isFrozen(plan) && plan.every(Object.isFrozen)).toBe(true);
		}
		expect(selected).toBeGreaterThan(0); expect(selected).toBeLessThan(24);
	});
	it('requires explicit structural evidence and never infers a chorus from missing metadata', () => {
		expect(planStructuralBassFeel(undefined, [], 'none', 140)).toBeUndefined();
		expect(planStructuralBassFeel(form, Array.from({ length: 24 }), 'none', 140)).toBeUndefined();
	});
	it('releases a quiet final phrase while keeping a one-phrase solo walking at its arrival', () => {
		const solo = (length: number) => buildPerformanceForm({ totalBars: length, sectionMap: [], choruses: [{ role: 'solo', startBar: 0, endBarExclusive: length }] });
		const long = solo(16); const short = solo(4);
		const longPlan = planStructuralBassFeel(long, planPerformanceEnergy(long), 'final-solo', 140)!;
		expect(longPlan.slice(0, 12).every((bar) => bar.feel === 'four')).toBe(true);
		expect(longPlan.slice(12).every((bar) => bar.feel === 'two' && bar.reason === 'ending_release')).toBe(true);
		expect(planStructuralBassFeel(short, planPerformanceEnergy(short), 'short-solo', 140)!.every((bar) => bar.feel === 'four')).toBe(true);
	});
});
