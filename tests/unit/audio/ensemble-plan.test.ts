import { describe, expect, it } from 'vitest';
import {
	planEnsemble,
	freezeEnsemblePlan,
	type EnsembleBarContext,
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
