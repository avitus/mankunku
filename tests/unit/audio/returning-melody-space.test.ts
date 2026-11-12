import { describe, expect, it } from 'vitest';
import { createRollingBacking, advanceRollingBacking } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildPerformanceForm, type PerformanceRole } from '$lib/audio/performance-form';
import { planEnsemble, planEnsembleWindow, type EnsembleBarContext, type SoloFeature } from '$lib/audio/ensemble-plan';
import type { BackingStyle } from '$lib/types/instruments';
import type { HarmonicSegment } from '$lib/types/music';

function source(passes: Array<[PerformanceRole, number]> = [['head', 8], ['solo', 8], ['head', 8]], firstHeadSection = 8) {
	let totalBars = 0;
	const choruses = passes.map(([role, length]) => {
		const startBar = totalBars; totalBars += length;
		return { role, startBar, endBarExclusive: totalBars };
	});
	const sectionMap = choruses.flatMap((pass, index) => [{ sourceSection: index * 2, barOffset: pass.startBar },
		...(pass.role === 'head' && firstHeadSection < pass.endBarExclusive - pass.startBar
			? [{ sourceSection: index * 2 + 1, barOffset: pass.startBar + firstHeadSection }] : [])]);
	const form = buildPerformanceForm({ totalBars, choruses, sectionMap });
	const harmony: HarmonicSegment[] = [{ chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [0, 1], duration: [totalBars, 1] }];
	return { form, harmony };
}
function definition(style: BackingStyle = 'swing', input = source(), explicit = true, loopCount = 1, returningMelodySpace: boolean | 'default' = true) {
	return createRollingBacking(input.harmony, BACKING_STYLES[style], {
		phraseId: 'returning-melody', tempo: 140, ppq: 192, beatsPerBar: 4,
		swing: BACKING_STYLES[style].defaultSwing, ensemble: {},
		...(explicit ? { performanceForm: input.form } : {})
	}, { loopCount, ...(returningMelodySpace === 'default' ? {} : { returningMelodySpace }) });
}
const withoutPolicy = (bars: readonly EnsembleBarContext[]) => bars.map(({ returningMelodySpace: _, ...bar }) => bar);
const plan = (bars: readonly EnsembleBarContext[], seed = 'returning-melody', soloFeatures?: SoloFeature[]) =>
	planEnsemble({ phraseId: seed, tempo: 140, bars, soloFeatures });

describe('returning melody piano space policy', () => {
	it.each(['swing', 'straight', 'bossa-nova', 'ballad'] as const)('marks only offsets one and two of eligible explicit %s returning heads', style => {
		const score = definition(style);
		expect(score.returningMelodySpaceVersion).toBe(1);
		expect(score.bars.filter(bar => bar.returningMelodySpace).map(bar => [bar.barIndex, bar.returningMelodySpace]))
			.toEqual([[17, { version: 1, headStartBar: 16, offset: 1 }], [18, { version: 1, headStartBar: 16, offset: 2 }]]);
		expect(Object.isFrozen(score.bars[17].returningMelodySpace)).toBe(true);
		expect(score.fingerprint).toContain('"returningMelodySpaceVersion":1');
	});

	it.each(['swing', 'straight', 'bossa-nova', 'ballad'] as const)('keeps default and explicitly disabled %s rolling output identical, with separate opt-in checkpoints', style => {
		const ordinary = definition(style, source(), true, 1, 'default');
		const disabled = definition(style, source(), true, 1, false);
		const optedIn = definition(style);
		expect(ordinary).toEqual(disabled);
		expect(ordinary).not.toHaveProperty('returningMelodySpaceVersion');
		expect(ordinary.bars.every(bar => !bar.returningMelodySpace)).toBe(true);
		expect(ordinary.fingerprint).not.toContain('returningMelodySpaceVersion');
		expect(optedIn.fingerprint).not.toBe(ordinary.fingerprint);
		let checkpoint: ReturnType<typeof advanceRollingBacking>['checkpoint'] | undefined;
		for (let bar = 0; bar < ordinary.totalBars; bar++) {
			const previous = checkpoint;
			const current = advanceRollingBacking(ordinary, previous);
			expect(advanceRollingBacking(disabled, previous)).toEqual(current);
			checkpoint = current.checkpoint;
		}
		const originalFirst = advanceRollingBacking(disabled);
		const newFirst = advanceRollingBacking(optedIn);
		expect(() => advanceRollingBacking(optedIn, originalFirst.checkpoint)).toThrow(/checkpoint/);
		expect(() => advanceRollingBacking(disabled, newFirst.checkpoint)).toThrow(/checkpoint/);
	});

	it('leaves implicit, opening/head-only, consecutive-head, short-head and short-opening-section forms unmarked', () => {
		const scores = [definition('swing', source(), false),
			definition('swing', source([['head', 16]])),
			definition('swing', source([['head', 8], ['head', 8]])),
			definition('swing', source([['solo', 8], ['head', 7]])),
			definition('swing', source([['solo', 8], ['head', 8]], 3))];
		for (const score of scores) {
			expect(score).not.toHaveProperty('returningMelodySpaceVersion');
			expect(score.bars.every(bar => !bar.returningMelodySpace)).toBe(true);
			expect(score.fingerprint).not.toContain('returningMelodySpaceVersion');
		}
	});

	it('admits any declared preceding solo and binds eligible absolute windows across explicit loops', () => {
		const shortSolo = definition('swing', source([['solo', 1], ['head', 8]], 4));
		expect(shortSolo.bars.filter(bar => bar.returningMelodySpace).map(bar => bar.barIndex)).toEqual([2, 3]);
		const repeated = definition('swing', source(), true, 2);
		expect(repeated.bars.filter(bar => bar.returningMelodySpace).map(bar => bar.barIndex)).toEqual([17, 18, 41, 42]);
	});

	it('reduces only eligible positive piano budgets and preserves arrival, native return, bass and drum instructions', () => {
		const bars = definition().bars;
		let changed = 0;
		for (let seed = 0; seed < 32; seed++) {
			const baseline = plan(withoutPolicy(bars), `return-space-${seed}`);
			const current = plan(bars, `return-space-${seed}`);
			expect(current.bars.slice(0, 17)).toEqual(baseline.bars.slice(0, 17));
			expect(current.bars.slice(19)).toEqual(baseline.bars.slice(19));
			for (const index of [17, 18]) {
				const before = baseline.bars[index], after = current.bars[index];
				expect(after.drums).toEqual(before.drums);
				expect(after.bass).toEqual(before.bass);
				if (before.piano.maxAttacks > 0 && before.responseOwner === 'nobody' && !before.coordinatedAccent && !before.drums.allowFill && !before.terminalArrangement) {
					changed++;
					expect(after.piano).toMatchObject({ maxAttacks: 0, densityScale: 0, role: 'leave_space', silenceReason: 'returning_melody' });
					expect(current.trace[index].reasons).toContain('returning_melody');
				} else expect(after).toEqual(before);
			}
		}
		expect(changed).toBeGreaterThan(0);
	});

	it('does not override dense evidence, response reservations, incoming arrivals or formal setup reservations', () => {
		const contexts = definition().bars;
		const dense: SoloFeature[] = [17, 18].map(barIndex => ({ barIndex, observedAtBar: barIndex, source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }));
		const resting: SoloFeature[] = [17, 18].map(barIndex => ({ barIndex, observedAtBar: barIndex, source: 'scripted', confidence: 1, noteDensity: 0, restBeats: 4 }));
		const seen = new Set<string>();
		for (let seed = 0; seed < 128; seed++) {
			for (const [kind, features, bars] of [
				['dense', dense, contexts], ['response', resting, contexts],
				['accent', undefined, contexts.map(bar => bar.barIndex === 16 ? { ...bar, boundaryStrength: 1, isSectionFinalBar: true } : bar)],
				['setup', undefined, contexts.map(bar => bar.barIndex === 17 ? { ...bar, boundaryStrength: 1, isSectionFinalBar: true } : bar)]
			] as const) {
				const baseline = plan(withoutPolicy(bars), `priority-${seed}`, features);
				const current = plan(bars, `priority-${seed}`, features);
				for (const index of [17, 18]) {
					const before = baseline.bars[index];
					const reserved = kind === 'dense' ? before.piano.silenceReason === 'soloist_dense'
						: kind === 'response' ? before.responseOwner !== 'nobody'
						: kind === 'accent' ? !!before.coordinatedAccent : before.drums.allowFill;
					if (reserved) { seen.add(kind); expect(current.bars[index]).toEqual(before); }
				}
			}
		}
		expect([...seen].sort()).toEqual(['accent', 'dense', 'response', 'setup']);
	});

	it('retains the declared terminal reservation beyond the two-bar melody space', () => {
		const contexts = definition().bars;
		const terminal = { version: 1 as const, id: 'terminal:returning-melody', barIndex: 23,
			absBeat: 92, releaseBeat: 94, holdBeats: 2,
			participants: ['bass', 'piano', 'drums'] as const, chord: { root: 'C' as const, quality: '7' as const } };
		const bars = contexts.map(bar => bar.isFinalBar ? { ...bar, terminalArrangement: terminal } : bar);
		const baseline = plan(withoutPolicy(bars));
		const current = plan(bars);
		expect(current.bars.at(-1)).toEqual(baseline.bars.at(-1));
		expect(current.bars.at(-1)!.terminalArrangement).toEqual(terminal);
		expect(current.bars.at(-1)!.piano.silenceReason).not.toBe('returning_melody');
	});

	it('rejects malformed policy metadata instead of applying silence at an unrelated position', () => {
		for (const cue of [{ version: 2, headStartBar: 16, offset: 1 },
			{ version: 1, headStartBar: 16, offset: 0 }, { version: 1, headStartBar: 16, offset: 3 },
			{ version: 1, headStartBar: 0, offset: 1 }, { version: 1, headStartBar: 16, offset: 1, extra: true }]) {
			const bars = definition().bars.map(bar => bar.barIndex === 17 ? { ...bar, returningMelodySpace: cue } : bar);
			expect(() => plan(bars as unknown as EnsembleBarContext[])).toThrow(/returning melody space/);
		}
	});

	it('binds planner replay to the policy even before the returning head is reached', () => {
		const score = definition();
		const oldMemory = planEnsembleWindow({ phraseId: score.phraseId, tempo: score.tempo, bars: withoutPolicy(score.bars), endBarExclusive: 1 }).memory;
		expect(() => planEnsembleWindow({ phraseId: score.phraseId, tempo: score.tempo, bars: score.bars, memory: oldMemory, endBarExclusive: 2 })).toThrow(/same explicit full form/);
		const current = planEnsembleWindow({ phraseId: score.phraseId, tempo: score.tempo, bars: score.bars, endBarExclusive: 1 });
		expect(planEnsembleWindow({ phraseId: score.phraseId, tempo: score.tempo, bars: score.bars, memory: JSON.parse(JSON.stringify(current.memory)), endBarExclusive: 2 }).plan.bars).toHaveLength(1);
		const first = advanceRollingBacking(score);
		const legacyFingerprint = score.fingerprint.replace(',{"returningMelodySpaceVersion":1}', '');
		expect(legacyFingerprint).not.toBe(score.fingerprint);
		expect(() => advanceRollingBacking(score, { ...first.checkpoint, fingerprint: legacyFingerprint })).toThrow(/checkpoint/);
	});
});
