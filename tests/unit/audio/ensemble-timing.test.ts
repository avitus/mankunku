import { describe, expect, it } from 'vitest';
import { createEnsembleTiming, freezeEnsembleTimingTrace } from '$lib/audio/ensemble-timing';
import { planEnsemble, type EnsemblePlan, type EnsembleBarContext } from '$lib/audio/ensemble-plan';
import { SWING_TIMING, type TimingRole, type TimingProfile } from '$lib/audio/backing-timing';
import { applySwingToBeats } from '$lib/music/swing';

const roles = Object.keys(SWING_TIMING) as TimingRole[];
const zeroProfiles = Object.fromEntries(roles.map((role) => [role, { offsetMs: 0, jitterMs: 0 }])) as Record<TimingRole, TimingProfile>;

function plan(lengths = [4, 4, 4, 4]): EnsemblePlan {
	const contexts: EnsembleBarContext[] = [];
	for (const length of lengths) {
		for (let bar = 0; bar < length; bar++) {
			contexts.push({ barIndex: contexts.length, intensity: 0.6, isSectionFirstBar: bar === 0,
				isSectionFinalBar: bar === length - 1, isFinalBar: false });
		}
	}
	return planEnsemble({ phraseId: 'timing-plan', tempo: 140, bars: contexts });
}

const input = { phraseId: 'timing-performance', tempo: 140, ppq: 96_000, swing: 0.67, plan: plan() };

function correlation(a: number[], b: number[]): number {
	const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
	const ma = mean(a), mb = mean(b);
	let ab = 0, aa = 0, bb = 0;
	for (let i = 0; i < a.length; i++) {
		ab += (a[i] - ma) * (b[i] - mb);
		aa += (a[i] - ma) ** 2;
		bb += (b[i] - mb) ** 2;
	}
	return ab / Math.sqrt(aa * bb);
}

describe('coordinated phrase timing', () => {
	it('replays each exact event independently of call order, added notes, and other performances', () => {
		const first = createEnsembleTiming(input);
		const events = roles.flatMap((role) => [0, 1.5, 9, 16, 17.5, 43].map((beat) => ({ role, beat })));
		const expected = events.map(({ role, beat }) => first.place(beat, role));
		for (let i = 0; i < 200; i++) first.place(i / 4, 'snare');
		createEnsembleTiming({ ...input, phraseId: 'unrelated' }).place(10, 'comp');
		expect(events.map(({ role, beat }) => first.place(beat, role))).toEqual(expected);
		const replay = createEnsembleTiming({ ...input, plan: JSON.parse(JSON.stringify(input.plan)) });
		expect(events.toReversed().map(({ role, beat }) => replay.place(beat, role))).toEqual(expected.toReversed());
		expect(replay.trace).toEqual(first.trace);
		expect(createEnsembleTiming({ ...input, phraseId: 'different' }).trace).not.toEqual(first.trace);
		expect(createEnsembleTiming({ ...input, tempo: 141 }).trace).not.toEqual(first.trace);
	});

	it('moves all players along one smooth phrase curve while retaining their own stable placement', () => {
		const timing = createEnsembleTiming({ ...input, timingProfiles: zeroProfiles });
		const phrase = timing.trace[0];
		const msPerTick = (60_000 / input.tempo) / input.ppq;
		const movement = (role: TimingRole, player: 'bass' | 'comp' | 'drums', beat: number) =>
			(timing.place(beat, role) - beat * input.ppq) * msPerTick - phrase.playerPlacementMs[player];
		for (const beat of [1, 2, 4, 8, 12, 14, 15]) {
			const common = movement('ride', 'drums', beat);
			expect(Math.abs(movement('bass', 'bass', beat) - common)).toBeLessThanOrEqual(msPerTick);
			expect(Math.abs(movement('comp', 'comp', beat) - common)).toBeLessThanOrEqual(msPerTick);
		}
		expect(Math.abs(movement('ride', 'drums', 8))).toBeGreaterThan(msPerTick);
		expect(movement('ride', 'drums', 1)).toBeCloseTo(movement('ride', 'drums', 15), 2);
		expect(movement('ride', 'drums', 2)).toBeCloseTo(movement('ride', 'drums', 14), 2);
		expect(new Set(Object.values(phrase.playerPlacementMs)).size).toBe(3);
	});

	it('gives every drum limb the same drummer phrase motion rather than a separate player', () => {
		const timing = createEnsembleTiming({ ...input, timingProfiles: zeroProfiles });
		const drums = roles.filter((role) => role !== 'bass' && role !== 'comp');
		for (const beat of [2, 4.5, 9, 20, 39.5]) {
			expect(new Set(drums.map((role) => timing.place(beat, role))).size).toBe(1);
		}
	});

	it('has correlated player motion with the default small event residuals', () => {
		const timing = createEnsembleTiming({ ...input, plan: plan(Array(80).fill(4)) });
		const deviations: Record<string, number[]> = { bass: [], comp: [], ride: [] };
		for (const phrase of timing.trace) {
			for (const localBeat of [2, 4, 6, 8, 10, 12, 14]) {
				const beat = phrase.phraseStartBar * 4 + localBeat;
				for (const role of ['bass', 'comp', 'ride'] as const) {
					deviations[role].push((timing.place(beat, role) - beat * input.ppq) * (60_000 / input.tempo) / input.ppq - phrase.roleOffsetMs[role]);
				}
			}
		}
		expect(correlation(deviations.bass, deviations.ride)).toBeGreaterThan(0.5);
		expect(correlation(deviations.comp, deviations.ride)).toBeGreaterThan(0.5);
	});

	it('keeps the existing swing grid and leaves triplet positions unchanged by swing', () => {
		const straight = createEnsembleTiming({ ...input, swing: 0.5 });
		const swung = createEnsembleTiming(input);
		for (const role of roles) {
			expect(Math.abs(swung.place(5.5, role) - straight.place(5.5, role) - 0.17 * input.ppq)).toBeLessThanOrEqual(1);
			expect(swung.place(5 + 1 / 3, role)).toBe(straight.place(5 + 1 / 3, role));
			expect(swung.place(5 + 2 / 3, role)).toBe(straight.place(5 + 2 / 3, role));
		}
	});

	it('bounds deviations even for extreme profiles and preserves swung eighth-note pulse ordering', () => {
		const exaggerated = Object.fromEntries(roles.map((role, i) => [role, { offsetMs: i % 2 ? -200 : 200, jitterMs: 999 }])) as Record<TimingRole, TimingProfile>;
		for (const tempo of [60, 140, 320, 1_000]) {
			const ppq = 192;
			const timing = createEnsembleTiming({ ...input, tempo, ppq, swing: 0.8, timingProfiles: exaggerated });
			for (const role of roles) {
				let previous = -1;
				for (let beat = 0; beat < 64; beat += 0.5) {
					const tick = timing.place(beat, role);
					const grid = applySwingToBeats(beat, 0.8) * ppq;
					expect(Math.abs(tick - grid)).toBeLessThanOrEqual(0.0675 * ppq + 0.5);
					expect(tick).toBeGreaterThan(previous);
					previous = tick;
				}
			}
		}
	});

	it('resets shared drift at actual shortened phrase boundaries without accumulating tempo displacement', () => {
		const timing = createEnsembleTiming({ ...input, plan: plan([3, 4, 3]) });
		expect(timing.trace.map((phrase) => [phrase.phraseStartBar, phrase.endBarExclusive])).toEqual([[0, 3], [3, 7], [7, 10]]);
		for (const boundary of [0, 3, 7, 10]) {
			expect(timing.arrivalTick(boundary)).toBe(boundary * 4 * input.ppq);
		}
		const long = createEnsembleTiming({ ...input, plan: plan(Array(120).fill(4)) });
		for (let bar = 0; bar <= 480; bar += 4) expect(long.arrivalTick(bar)).toBe(bar * 4 * input.ppq);
	});

	it('uses intent and boundary strength gently, and exposes one deterministic arrival for every participant', () => {
		const withIntent = (intent: 'build' | 'release', boundaryStrength: number) => ({
			...input.plan, bars: input.plan.bars.map((bar) => ({ ...bar, phraseIntent: intent, boundaryStrength }))
		});
		const build = createEnsembleTiming({ ...input, plan: withIntent('build', 0) });
		const release = createEnsembleTiming({ ...input, plan: withIntent('release', 0) });
		const boundary = createEnsembleTiming({ ...input, plan: withIntent('build', 1) });
		for (let i = 0; i < build.trace.length; i++) {
			expect(release.trace[i].commonAmplitudeMs).toBeGreaterThan(build.trace[i].commonAmplitudeMs);
			expect(release.trace[i].commonAmplitudeMs - build.trace[i].commonAmplitudeMs).toBeLessThanOrEqual(3);
			expect(Math.abs(boundary.trace[i].commonAmplitudeMs)).toBeLessThanOrEqual(Math.abs(build.trace[i].commonAmplitudeMs));
		}
		const arrival = build.arrivalTick(2);
		for (const role of roles) build.place(8, role);
		expect(build.arrivalTick(2)).toBe(arrival);
		expect(arrival).not.toBe(build.place(8, 'comp'));
	});

	it('provides serializable immutable phrase diagnostics and snapshots the supplied profiles', () => {
		const profiles = { bass: { offsetMs: -3, jitterMs: 5 } };
		const before = JSON.stringify(input.plan);
		const timing = createEnsembleTiming({ ...input, timingProfiles: profiles });
		const originalTick = timing.place(5, 'bass');
		profiles.bass.offsetMs = 500;
		expect(timing.place(5, 'bass')).toBe(originalTick);
		expect(JSON.stringify(input.plan)).toBe(before);
		const replay = freezeEnsembleTimingTrace(JSON.parse(JSON.stringify(timing.trace)));
		expect(replay).toEqual(timing.trace);
		for (const value of [timing.trace, replay]) {
			expect(Object.isFrozen(value)).toBe(true);
			for (const phrase of value) {
				expect(Object.isFrozen(phrase)).toBe(true);
				expect(Object.isFrozen(phrase.playerPlacementMs)).toBe(true);
				expect(Object.isFrozen(phrase.roleOffsetMs)).toBe(true);
				expect(Object.isFrozen(phrase.residualLimitMs)).toBe(true);
			}
		}
	});
});
