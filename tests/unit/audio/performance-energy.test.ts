import { describe, expect, it } from 'vitest';
import { planEnsembleWindow, type EnsembleBarContext } from '$lib/audio/ensemble-plan';
import { planPerformanceEnergy } from '$lib/audio/performance-energy';
import { buildPerformanceForm, performanceBarContext } from '$lib/audio/performance-form';

const form = buildPerformanceForm({ totalBars: 64, sectionMap: [{ sourceSection: 0, barOffset: 0 }],
	choruses: ['head', 'solo', 'solo', 'head'].map((role, index) => ({ role: role as 'head' | 'solo', startBar: index * 16, endBarExclusive: (index + 1) * 16 })) });

function context() {
	return Array.from({ length: 16 }, (_, barIndex) => ({
		barIndex, intensity: 0.8, isSectionFirstBar: barIndex % 4 === 0,
		isSectionFinalBar: barIndex % 4 === 3, isFinalBar: barIndex === 15,
		performanceEnergy: { phase: barIndex < 8 ? 'head_in' : 'ending', chorusIndex: Math.floor(barIndex / 8), targetEnergy: barIndex < 8 ? 0.4 : 0.3 }
	} as EnsembleBarContext));
}

describe('performance energy in ensemble planning', () => {
	it('restrains heads and releases without letting the legacy rising intensity overwhelm the arrangement', () => {
		const { plan } = planEnsembleWindow({ phraseId: 'structural-energy', tempo: 140, bars: context() });
		expect(Math.max(...plan.bars.map((bar) => bar.energy))).toBeLessThan(0.5);
		expect(plan.bars.slice(8).every((bar) => bar.drums.maxCommentaryHits === 0 && !bar.drums.allowFill)).toBe(true);
		expect(plan.bars.every((bar) => bar.bass.keepPulse && bar.drums.keepTime)).toBe(true);
	});
	it('shapes distinct head, developing solo and returning-head contours with bounded smooth release', () => {
		const before = JSON.stringify(form);
		const arc = planPerformanceEnergy(form);
		expect(arc).toHaveLength(64);
		expect(arc[0].phase).toBe('head_in');
		expect(arc[16].phase).toBe('solo_build');
		expect(arc[24].phase).toBe('solo_peak');
		expect(arc[30].phase).toBe('solo_release');
		expect(arc[48].phase).toBe('head_return');
		expect(arc[63].phase).toBe('ending');
		const peak = (start: number, end: number) => Math.max(...arc.slice(start, end).map((bar) => bar.targetEnergy));
		expect(peak(0, 16)).toBeLessThan(peak(16, 32));
		expect(peak(16, 32)).toBeLessThan(peak(32, 48));
		expect(peak(48, 64)).toBeLessThan(peak(32, 48));
		expect(arc[63].targetEnergy).toBeLessThan(arc[48].targetEnergy);
		for (let index = 1; index < arc.length; index++) {
			if (arc[index].chorusIndex === arc[index - 1].chorusIndex) expect(Math.abs(arc[index].targetEnergy - arc[index - 1].targetEnergy)).toBeLessThan(0.1);
		}
		expect(JSON.stringify(form)).toBe(before);
		expect(Object.isFrozen(arc) && arc.every(Object.isFrozen)).toBe(true);
	});
	it('handles a single short pass without inventing a solo or a following chorus', () => {
		const short = buildPerformanceForm({ totalBars: 1, sectionMap: [], choruses: [{ role: 'head', startBar: 0, endBarExclusive: 1 }] });
		expect(planPerformanceEnergy(short)).toEqual([{ phase: 'ending', chorusIndex: 0, targetEnergy: 0.4 }]);
		expect(planPerformanceEnergy(buildPerformanceForm({ totalBars: 0, sectionMap: [], choruses: [] }))).toEqual([]);
		expect(() => planPerformanceEnergy({ ...form, totalBars: 65 })).toThrow('complete contiguous');
	});
	it('keeps an extended performance prefix identical until its formerly final closing phrase', () => {
		const soloForm = (count: number) => buildPerformanceForm({ totalBars: count * 32, sectionMap: [],
			choruses: Array.from({ length: count }, (_, index) => ({ role: 'solo' as const, startBar: index * 32, endBarExclusive: (index + 1) * 32 })) });
		const short = planPerformanceEnergy(soloForm(2));
		const long = planPerformanceEnergy(soloForm(3));
		expect(short.slice(0, 60)).toEqual(long.slice(0, 60));
		expect(short[60].targetEnergy).toBe(long[60].targetEnergy);
		expect(short[63].targetEnergy).toBeLessThan(long[63].targetEnergy);
		expect(short.slice(60).every((bar) => bar.phase === 'ending')).toBe(true);
	});
	it('starts the terminal release at the actual short closing phrase rather than four bars back', () => {
		const short = buildPerformanceForm({ totalBars: 10, sectionMap: [], choruses: [{ role: 'solo', startBar: 0, endBarExclusive: 10 }] });
		const extended = buildPerformanceForm({ totalBars: 20, sectionMap: [], choruses: [
			{ role: 'solo', startBar: 0, endBarExclusive: 10 }, { role: 'solo', startBar: 10, endBarExclusive: 20 }
		] });
		const a = planPerformanceEnergy(short); const b = planPerformanceEnergy(extended);
		expect(a.slice(0, 8)).toEqual(b.slice(0, 8));
		expect(a[8].phase).toBe('ending');
		expect(a[8].targetEnergy).toBe(b[8].targetEnergy);
	});
	it('replays exactly across partial windows and binds checkpoints to the structural plan', () => {
		const arc = planPerformanceEnergy(form);
		const bars = arc.map((performanceEnergy, barIndex) => ({ ...performanceBarContext(form, barIndex)!, intensity: 0.7, performanceEnergy }));
		const input = { phraseId: 'arc-window', tempo: 140, bars };
		const whole = planEnsembleWindow(input);
		const a = planEnsembleWindow({ ...input, endBarExclusive: 19 });
		const b = planEnsembleWindow({ ...input, memory: JSON.parse(JSON.stringify(a.memory)), endBarExclusive: 53 });
		const c = planEnsembleWindow({ ...input, memory: JSON.parse(JSON.stringify(b.memory)) });
		expect([...a.plan.bars, ...b.plan.bars, ...c.plan.bars]).toEqual(whole.plan.bars);
		expect(c.memory).toEqual(whole.memory);
		const changed = bars.map((bar, index) => index === 62 ? { ...bar, performanceEnergy: { ...bar.performanceEnergy, targetEnergy: 0.65 } } : bar);
		expect(() => planEnsembleWindow({ ...input, bars: changed, memory: a.memory })).toThrow('same explicit full form');
		expect(whole.plan.bars.every((bar) => Object.isFrozen(bar.performanceEnergy))).toBe(true);
	});
	it('rejects malformed arc values instead of propagating NaN into instrument generation', () => {
		const bars = context();
		bars[3] = { ...bars[3], performanceEnergy: { phase: 'ending', chorusIndex: 0, targetEnergy: NaN } };
		expect(() => planEnsembleWindow({ phraseId: 'bad-arc', tempo: 140, bars })).toThrow('Invalid performance energy');
	});
	it('leaves legacy context unannotated and scales a ballad contour within its native ceiling', () => {
		const legacy = context().map(({ performanceEnergy: _arc, ...bar }) => bar);
		expect(planEnsembleWindow({ phraseId: 'legacy', tempo: 140, bars: legacy }).plan.bars.every((bar) => bar.performanceEnergy === undefined)).toBe(true);
		const arc = planPerformanceEnergy(form);
		const bars = arc.map((performanceEnergy, barIndex) => ({ ...performanceBarContext(form, barIndex)!, intensity: 0.6, energyCeiling: 0.6, performanceEnergy }));
		const plan = planEnsembleWindow({ phraseId: 'quiet-arc', tempo: 60, bars }).plan;
		expect(plan.bars.every((bar) => bar.energy <= 0.6 && bar.energy >= 0.2)).toBe(true);
		expect(plan.bars[63].energy).toBeLessThan(plan.bars[48].energy);
		expect(new Set(plan.bars.slice(32, 48).map((bar) => bar.energy)).size).toBeGreaterThan(8);
	});
});
