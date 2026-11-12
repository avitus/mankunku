import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
	planEnsemble,
	freezeEnsemblePlan,
	planEnsembleWindow,
	freezeEnsembleMemory,
	type EnsembleBarContext,
	type EnsembleMemory,
	type SoloFeature
} from '$lib/audio/ensemble-plan';

function bars(count = 32): EnsembleBarContext[] {
	return Array.from({ length: count }, (_, barIndex) => ({
		barIndex,
		intensity: 0.55,
		isSectionFirstBar: barIndex % 8 === 0,
		isSectionFinalBar: barIndex % 8 === 7,
		isChorusFirstBar: barIndex === 0,
		isChorusFinalBar: barIndex === count - 1,
		isFinalBar: barIndex === count - 1
	}));
}

function solo(count: number, noteDensity: number, restBeats: number): SoloFeature[] {
	return Array.from({ length: count }, (_, barIndex) => ({
		barIndex,
		observedAtBar: barIndex,
		source: 'scripted',
		confidence: 1,
		noteDensity,
		restBeats,
		phraseEnded: restBeats > 0
	}));
}

const input = { phraseId: 'ensemble-test', tempo: 140, bars: bars() };

describe('ensemble phrase planning', () => {
	it('replays deterministically without mutating caller state or retaining hidden memory', () => {
		const before = JSON.stringify(input);
		const first = planEnsemble(input);
		planEnsemble({ ...input, phraseId: 'unrelated-performance' });
		expect(planEnsemble(input)).toEqual(first);
		expect(JSON.stringify(input)).toBe(before);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.bars[0].piano)).toBe(true);
		expect(Object.isFrozen(first.trace)).toBe(true);
	});

	it('restores deep immutability after JSON replay, including accent and diagnostic metadata', () => {
		const original = planEnsemble({ ...input, phraseId: 'arrivals-0', bars: bars(64) });
		const replay = freezeEnsemblePlan(JSON.parse(JSON.stringify(original)));
		expect(replay).toEqual(original);
		expect(Object.isFrozen(replay)).toBe(true);
		expect(Object.isFrozen(replay.bars)).toBe(true);
		for (const bar of replay.bars) {
			expect(Object.isFrozen(bar)).toBe(true);
			expect(Object.isFrozen(bar.piano)).toBe(true);
			expect(Object.isFrozen(bar.drums)).toBe(true);
			expect(Object.isFrozen(bar.bass)).toBe(true);
			for (const accent of [bar.coordinatedAccent, bar.setupFor]) {
				if (!accent) continue;
				expect(Object.isFrozen(accent)).toBe(true);
				expect(Object.isFrozen(accent.participants)).toBe(true);
			}
		}
		expect(replay.bars.some((bar) => bar.coordinatedAccent)).toBe(true);
		expect(Object.isFrozen(replay.trace)).toBe(true);
		for (const entry of replay.trace) {
			expect(Object.isFrozen(entry)).toBe(true);
			expect(Object.isFrozen(entry.reasons)).toBe(true);
		}
	});

	it('gives dense soloing more space while retaining the bass pulse and drum time', () => {
		const ordinary = planEnsemble(input);
		const dense = planEnsemble({ ...input, soloFeatures: solo(32, 0.95, 0) });
		const pianoBudget = (p: typeof ordinary) => p.bars.reduce((n, b) => n + b.piano.maxAttacks, 0);
		const drumBudget = (p: typeof ordinary) =>
			p.bars.reduce((n, b) => n + b.drums.maxCommentaryHits, 0);
		expect(pianoBudget(dense)).toBeLessThan(pianoBudget(ordinary));
		expect(drumBudget(dense)).toBeLessThan(drumBudget(ordinary));
		for (const bar of dense.bars) {
			expect(bar.bass.keepPulse).toBe(true);
			expect(bar.drums.keepTime).toBe(true);
			expect(bar.bass.ornamentScale).toBeLessThanOrEqual(ordinary.bars[bar.barIndex].bass.ornamentScale);
			expect(bar.responseOwner).toBe('nobody');
			expect(bar.drums.allowFill).toBe(false);
		}
	});

	it('allocates one response owner, observes cooldown, and leaves many solo gaps empty', () => {
		const plan = planEnsemble({ ...input, bars: bars(64), soloFeatures: solo(64, 0.1, 2) });
		const answers = plan.bars.filter((bar) => bar.responseOwner !== 'nobody');
		expect(answers.length).toBeGreaterThan(0);
		expect(answers.length).toBeLessThan(32);
		for (let i = 0; i < answers.length; i++) {
			const answer = answers[i];
			const responders = [answer.piano.role, answer.drums.role, answer.bass.role].filter(
				(role) => role === 'respond'
			);
			expect(responders).toHaveLength(1);
			if (i > 0) expect(answer.barIndex - answers[i - 1].barIndex).toBeGreaterThanOrEqual(3);
			if (answer.responseOwner === 'piano') expect(answer.drums.maxCommentaryHits).toBe(0);
			if (answer.responseOwner === 'drums') expect(answer.piano.maxAttacks).toBe(0);
			if (answer.responseOwner === 'bass') {
				expect(answer.piano.maxAttacks).toBe(0);
				expect(answer.drums.maxCommentaryHits).toBe(0);
			}
		}
	});

	it('never interprets a missing, uncertain, stale, or future microphone observation as silence', () => {
		const baseline = planEnsemble(input);
		const unreliable = solo(32, 0, 4).map((feature, i) => ({
			...feature,
			source: 'microphone' as const,
			confidence: i % 3 === 0 ? 0.2 : 1,
			observedAtBar: i % 3 === 1 ? i - 3 : i % 3 === 2 ? i + 1 : i
		}));
		const plan = planEnsemble({ ...input, soloFeatures: unreliable });
		expect(plan.bars.map((b) => [b.intent, b.responseOwner, b.piano, b.drums, b.bass])).toEqual(
			baseline.bars.map((b) => [b.intent, b.responseOwner, b.piano, b.drums, b.bass])
		);
		expect(plan.trace.some((entry) => entry.responseWindow === 'solo_rest')).toBe(false);
	});

	it('rejects observations from before the performance instead of opening a false response window', () => {
		const plan = planEnsemble({
			...input,
			soloFeatures: [{ ...solo(1, 0, 4)[0], source: 'microphone', observedAtBar: -1 }]
		});
		expect(plan.trace[0].soloEvidence).toBe('invalid');
		expect(plan.trace[0].responseWindow).toBe('none');
	});

	it('keeps earlier decisions unchanged when later solo observations arrive or change', () => {
		const baseline = planEnsemble(input);
		for (const features of [solo(32, 0.95, 0), solo(32, 0.1, 3)]) {
			const later = planEnsemble({
				...input,
				soloFeatures: features.filter((feature) => feature.barIndex >= 16)
			});
			expect(later.bars.slice(0, 16)).toEqual(baseline.bars.slice(0, 16));
			expect(later.trace.slice(0, 16)).toEqual(baseline.trace.slice(0, 16));
		}
	});

	it('leaves a reserved ensemble arrival clear of independent responses or commentary', () => {
		let arrivals = 0;
		for (let seed = 0; seed < 24; seed++) {
			const plan = planEnsemble({
				...input,
				phraseId: `arrival-response-${seed}`,
				soloFeatures: solo(32, 0.1, 3)
			});
			for (const arrival of plan.bars.filter((bar) => bar.coordinatedAccent)) {
				arrivals++;
				expect(arrival.responseOwner, `response over arrival at ${seed}:${arrival.barIndex}`).toBe('nobody');
				expect(arrival.piano.maxAttacks).toBe(0);
				expect(arrival.drums.maxCommentaryHits).toBe(0);
				expect(arrival.piano.silenceReason).toBe('avoid_overlap');
				expect(arrival.drums.role).toBe('mark_form');
			}
		}
		expect(arrivals).toBeGreaterThan(0);
	});

	it('plans complementary commentary without trading away the timekeeping foundation', () => {
		for (let seed = 0; seed < 8; seed++) {
			const plan = planEnsemble({ ...input, phraseId: `ensemble-${seed}` });
			for (const bar of plan.bars) {
				expect(bar.piano.maxAttacks > 1 && bar.drums.maxCommentaryHits > 1).toBe(false);
				expect(bar.drums.keepTime).toBe(true);
				expect(bar.bass.keepPulse).toBe(true);
				if (bar.piano.maxAttacks === 0) expect(bar.piano.silenceReason).toBeTruthy();
				if (bar.drums.maxCommentaryHits === 0) expect(bar.drums.silenceReason).toBeTruthy();
			}
		}
	});

	it('prepares form-marking phrases with space instead of merely naming ordinary support', () => {
		let markedBars = 0;
		for (let seed = 0; seed < 16; seed++) {
			const plan = planEnsemble({ ...input, phraseId: `mark-form-${seed}` });
			for (const bar of plan.bars) {
				if (bar.phraseIntent !== 'mark_form' || bar.responseOwner !== 'nobody' || bar.coordinatedAccent) continue;
				markedBars++;
				expect(bar.piano.maxAttacks).toBeLessThanOrEqual(1);
				if (bar.barIndex - bar.phraseStartBar < 3) expect(bar.drums.maxCommentaryHits).toBe(0);
			}
		}
		expect(markedBars).toBeGreaterThan(0);
	});

	it('marks selected formal arrivals with a preceding setup and prevents repeated fills', () => {
		let accentCount = 0;
		for (let seed = 0; seed < 8; seed++) {
			const plan = planEnsemble({ ...input, phraseId: `arrivals-${seed}`, bars: bars(64) });
			const fills = plan.bars.filter((bar) => bar.drums.allowFill);
			for (let i = 0; i < fills.length; i++) {
				if (i > 0) expect(fills[i].barIndex - fills[i - 1].barIndex).toBeGreaterThanOrEqual(4);
				expect(fills[i].boundaryStrength).toBeGreaterThanOrEqual(0.5);
				expect(fills[i].barIndex).toBeLessThan(63);
			}
			for (const arrival of plan.bars.filter((bar) => bar.coordinatedAccent)) {
				accentCount++;
				const accent = arrival.coordinatedAccent!;
				expect(accent.targetBarIndex).toBe(arrival.barIndex);
				expect(accent.beatOffset).toBe(0);
				expect(plan.bars[arrival.barIndex - 1].setupFor).toEqual(accent);
				expect(plan.bars[arrival.barIndex - 1].drums.allowFill).toBe(true);
			}
		}
		expect(accentCount).toBeGreaterThan(0);
	});

	it('honors section-relative phrase groups instead of silently realigning them to bar zero', () => {
		const shifted = bars(7).map((bar, i) => ({
			...bar,
			phrase4: {
				index: i < 3 ? 0 : 1,
				barIndex: i < 3 ? i : i - 3,
				lengthBars: i < 3 ? 3 : 4,
				position: i < 3 ? i / 2 : (i - 3) / 3,
				barsRemaining: i < 3 ? 3 - i : 7 - i,
				isFinalBar: i === 2 || i === 6
			}
		}));
		const plan = planEnsemble({ ...input, bars: shifted });
		expect(plan.bars.map((bar) => bar.phraseStartBar)).toEqual([0, 0, 0, 3, 3, 3, 3]);
		expect(new Set(plan.bars.slice(3).map((bar) => bar.phraseIntent)).size).toBe(1);
	});
});

describe('resumable ensemble planning', () => {
	it('preserves the full-form output captured independently from committed planner dfa5421a', () => {
		const plans = [90, 140, 240].flatMap((tempo) => ['unavailable', 'dense', 'sparse'].map((scenario) =>
			planEnsemble({
				phraseId: `compat-${scenario}`, tempo,
				bars: Array.from({ length: 64 }, (_, barIndex) => ({
					barIndex, intensity: 0.35 + 0.2 * Math.floor(barIndex / 32),
					isSectionFirstBar: barIndex % 8 === 0, isSectionFinalBar: barIndex % 8 === 7,
					isChorusFirstBar: barIndex % 32 === 0, isChorusFinalBar: barIndex % 32 === 31,
					isFinalBar: barIndex === 63
				})),
				soloFeatures: scenario === 'unavailable' ? undefined : Array.from({ length: 64 }, (_, barIndex) => ({
					barIndex, observedAtBar: barIndex, source: 'scripted' as const, confidence: 1,
					noteDensity: scenario === 'dense' ? 0.9 : 0.1, restBeats: scenario === 'dense' ? 0 : 2
				}))
			})
		));
		expect(createHash('sha256').update(JSON.stringify(plans)).digest('hex')).toBe(
			'bece94c15ce9e916b80aff76a3e856586940aa9f84c4ab2a0e5901c3e55079fd'
		);
	});

	it('concatenates arbitrary consecutive windows into the unchanged full plan', () => {
		for (const features of [undefined, solo(32, 0.1, 2)]) {
			const base = { ...input, soloFeatures: features };
			const full = planEnsemble(base);
			const cuts = [0, 1, 3, 4, 7, 8, 9, 15, 17, 31, 32];
			let memory: EnsembleMemory | undefined;
			const planned: typeof full.bars[number][] = [];
			const traced: typeof full.trace[number][] = [];
			for (let i = 1; i < cuts.length; i++) {
				const result = planEnsembleWindow({ ...base, startBar: cuts[i - 1], endBarExclusive: cuts[i], memory });
				expect(result.plan.bars).toEqual(full.bars.slice(cuts[i - 1], cuts[i]));
				expect(result.plan.trace).toEqual(full.trace.slice(cuts[i - 1], cuts[i]));
				planned.push(...result.plan.bars);
				traced.push(...result.plan.trace);
				expect(result.memory.nextBar).toBe(cuts[i]);
				memory = JSON.parse(JSON.stringify(result.memory));
			}
			expect({ version: 1, bars: planned, trace: traced }).toEqual(full);
			expect(memory!.performance.barsPlanned).toBe(32);
		}
	});

	it('carries the active phrase and an already promised arrival across a checkpoint', () => {
		const base = { ...input, phraseId: 'arrivals-0', bars: bars(64) };
		const full = planEnsemble(base);
		const setup = full.bars.find((bar) => bar.setupFor)!;
		expect(setup).toBeDefined();
		const first = planEnsembleWindow({ ...base, endBarExclusive: setup.barIndex + 1 });
		expect(first.memory.pendingArrival).toEqual(setup.setupFor);
		const resumed = planEnsembleWindow({ ...base, memory: JSON.parse(JSON.stringify(first.memory)), endBarExclusive: setup.barIndex + 3 });
		expect(resumed.plan.bars[0].coordinatedAccent).toEqual(setup.setupFor);
		expect(resumed.plan.bars[0].responseOwner).toBe('nobody');
		const midPhrase = planEnsembleWindow({ ...input, endBarExclusive: 2 });
		expect(midPhrase.memory.activePhrase).toMatchObject({ startBar: 0, intent: midPhrase.plan.bars[0].phraseIntent });
		expect(planEnsembleWindow({ ...input, memory: midPhrase.memory, endBarExclusive: 3 }).plan.bars[0].phraseIntent)
			.toBe(midPhrase.plan.bars[0].phraseIntent);
	});

	it('rejects foreign, changed-form, out-of-order and malformed checkpoints', () => {
		const first = planEnsembleWindow({ ...input, endBarExclusive: 8 });
		const resume = { ...input, memory: first.memory };
		expect(() => planEnsembleWindow({ ...resume, phraseId: 'another-performance' })).toThrow(/phrase|performance/i);
		expect(() => planEnsembleWindow({ ...resume, tempo: 160 })).toThrow(/tempo|performance/i);
		expect(() => planEnsembleWindow({ ...resume, bars: bars(40) })).toThrow(/form|timeline/i);
		expect(() => planEnsembleWindow({ ...resume, bars: input.bars.map((bar, i) => i === 12 ? { ...bar, intensity: 0.6 } : bar) })).toThrow(/form|timeline/i);
		expect(() => planEnsembleWindow({ ...resume, startBar: 7 })).toThrow(/consecutive|next|order/i);
		expect(() => planEnsembleWindow({ ...resume, startBar: 9 })).toThrow(/consecutive|next|order/i);
		expect(() => planEnsembleWindow({ ...input, startBar: 8 })).toThrow(/checkpoint|memory|zero/i);
		expect(() => planEnsembleWindow({ ...resume, memory: { ...first.memory, version: 2 } as unknown as EnsembleMemory })).toThrow(/version|checkpoint/i);
		expect(() => planEnsembleWindow({ ...resume, memory: { ...first.memory, lastFillBar: 9 } })).toThrow(/checkpoint|memory/i);
		expect(() => planEnsembleWindow({ ...resume, memory: {
			...first.memory, performance: { ...first.memory.performance, peakEnergy: Infinity }
		} })).toThrow(/checkpoint|memory|finite/i);
	});

	it('never consumes future solo evidence or mutates the committed prefix when resuming', () => {
		const future = solo(32, 0.9, 0).filter((feature) => feature.barIndex >= 16);
		const first = planEnsembleWindow({ ...input, endBarExclusive: 16 });
		const withFuture = planEnsembleWindow({ ...input, soloFeatures: future, endBarExclusive: 16 });
		expect(withFuture).toEqual(first);
		const serialized = JSON.stringify(first);
		const restored: EnsembleMemory = JSON.parse(JSON.stringify(first.memory));
		const resume = planEnsembleWindow({ ...input, memory: restored, soloFeatures: future });
		expect(resume.plan.bars).toEqual(planEnsemble({ ...input, soloFeatures: future }).bars.slice(16));
		expect(JSON.stringify(first)).toBe(serialized);
		expect(restored).toEqual(first.memory);
		expect(Object.isFrozen(restored)).toBe(false);
	});

	it('rejects cooldown and pending-arrival state that contradicts its recent decisions', () => {
		const responding = { ...input, soloFeatures: solo(32, 0.1, 2) };
		const answer = planEnsemble(responding).bars.find((bar) => bar.barIndex > 1 && bar.responseOwner !== 'nobody')!;
		expect(answer).toBeDefined();
		const responseMemory = planEnsembleWindow({ ...responding, endBarExclusive: answer.barIndex + 1 }).memory;
		expect(() => planEnsembleWindow({ ...responding, memory: { ...responseMemory, lastResponseBar: 0 } })).toThrow(/checkpoint|memory/i);
		const arriving = { ...input, phraseId: 'arrivals-0', bars: bars(64) };
		const setup = planEnsemble(arriving).bars.find((bar) => bar.setupFor)!;
		expect(setup).toBeDefined();
		const setupMemory = planEnsembleWindow({ ...arriving, endBarExclusive: setup.barIndex + 1 }).memory;
		expect(() => planEnsembleWindow({ ...arriving, memory: { ...setupMemory, lastFillBar: 0 } })).toThrow(/checkpoint|memory/i);
		expect(() => planEnsembleWindow({ ...arriving, memory: { ...setupMemory, pendingArrival: null } })).toThrow(/checkpoint|memory/i);
	});

	it('keeps bounded short and medium history plus finite immutable performance aggregates', () => {
		const result = planEnsembleWindow({ ...input, bars: bars(512), soloFeatures: solo(512, 0.1, 2) });
		const memory = result.memory;
		expect(memory.recentBars).toHaveLength(2);
		expect(memory.recentPhrases).toHaveLength(4);
		expect(memory.recentBars.map((bar) => bar.barIndex)).toEqual([510, 511]);
		expect(memory.performance.barsPlanned).toBe(512);
		expect(memory.performance.phrasesPlanned).toBe(128);
		expect(Object.values(memory.performance.intentCounts).reduce((a, b) => a + b, 0)).toBe(128);
		expect(Object.values(memory.performance.responseCounts).reduce((a, b) => a + b, 0)).toBe(512);
		expect(JSON.parse(JSON.stringify(memory))).toEqual(memory);
		expect(JSON.stringify(memory).length).toBeLessThan(10_000);
		const check = (value: unknown): void => {
			if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
			if (!value || typeof value !== 'object') return;
			expect(Object.isFrozen(value)).toBe(true);
			for (const child of Object.values(value)) check(child);
		};
		check(memory);
		check(freezeEnsembleMemory(JSON.parse(JSON.stringify(memory))));
	});

	it('supports empty windows without advancing memory, including an empty or completed form', () => {
		const initial = planEnsembleWindow({ ...input, endBarExclusive: 0 });
		expect(initial.plan.bars).toEqual([]);
		expect(initial.memory.nextBar).toBe(0);
		expect(initial.memory.activePhrase).toBeNull();
		expect(planEnsembleWindow({ ...input, memory: initial.memory })).toEqual(planEnsembleWindow(input));
		const complete = planEnsembleWindow(input);
		const end = planEnsembleWindow({ ...input, memory: JSON.parse(JSON.stringify(complete.memory)) });
		expect(end.plan).toEqual({ version: 1, bars: [], trace: [] });
		expect(end.memory).toEqual(complete.memory);
		expect(planEnsembleWindow({ ...input, bars: [] }).memory).toMatchObject({ nextBar: 0, totalBars: 0, activePhrase: null });
		for (const range of [{ endBarExclusive: -1 }, { endBarExclusive: 33 }, { endBarExclusive: 0.5 }]) {
			expect(() => planEnsembleWindow({ ...input, ...range })).toThrow(/range|timeline/i);
		}
	});

	it('resumes explicit truncated phrases and uneven section boundaries one bar at a time', () => {
		const timeline: EnsembleBarContext[] = [];
		for (const sectionLength of [1, 2, 3, 5, 7, 9]) {
			for (let sectionBar = 0; sectionBar < sectionLength; sectionBar++) {
				const lengthBars = Math.min(4, sectionLength - Math.floor(sectionBar / 4) * 4);
				const barInPhrase = sectionBar % 4;
				timeline.push({
					barIndex: timeline.length, intensity: 0.55, isSectionFirstBar: sectionBar === 0,
					isSectionFinalBar: sectionBar === sectionLength - 1, isFinalBar: false,
					phrase4: {
						index: Math.floor(sectionBar / 4), barIndex: barInPhrase, lengthBars,
						position: lengthBars === 1 ? 1 : barInPhrase / (lengthBars - 1),
						barsRemaining: lengthBars - barInPhrase, isFinalBar: barInPhrase === lengthBars - 1
					}
				});
			}
		}
		timeline[timeline.length - 1] = { ...timeline[timeline.length - 1], isFinalBar: true };
		const fullInput = { ...input, bars: timeline, soloFeatures: solo(timeline.length, 0.1, 2) };
		const complete = planEnsembleWindow(fullInput);
		let memory: EnsembleMemory | undefined;
		const combined: typeof complete.plan.bars[number][] = [];
		const trace: typeof complete.plan.trace[number][] = [];
		for (let endBarExclusive = 1; endBarExclusive <= timeline.length; endBarExclusive++) {
			const window = planEnsembleWindow({ ...fullInput, memory, endBarExclusive });
			combined.push(...window.plan.bars);
			trace.push(...window.plan.trace);
			memory = JSON.parse(JSON.stringify(window.memory));
		}
		expect(combined).toEqual(complete.plan.bars);
		expect(trace).toEqual(complete.plan.trace);
		expect(memory).toEqual(complete.memory);
	});
});
