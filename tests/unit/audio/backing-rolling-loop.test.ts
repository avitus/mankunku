import { describe, expect, it } from 'vitest';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { MAX_ADAPTIVE_BARS, MAX_ADAPTIVE_LOOPS } from '$lib/audio/backing-performance-limits';
import type { HarmonicSegment } from '$lib/types/music';
import type { SoloFeature } from '$lib/audio/ensemble-plan';

const source: HarmonicSegment[] = [
	{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 1] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 1], duration: [1, 1] },
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [2, 1], duration: [3, 2] },
	{ chord: { root: 'A', quality: '7b9' }, scaleId: 'harmonic-minor.phrygian-dominant', startOffset: [7, 2], duration: [1, 2] }
];
const form = buildPerformanceForm({ totalBars: 4, sectionMap: [{ sourceSection: 5, barOffset: 0 }], choruses: [{ role: 'solo', startBar: 0, endBarExclusive: 4 }] });
const params = { phraseId: 'rolling-loops', tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67, performanceForm: form, ensemble: {} };
const dense = (bar: number): SoloFeature => ({ barIndex: bar, observedAtBar: bar - 1, source: 'microphone', confidence: 0.95, noteDensity: 1, restBeats: 0 });

describe('declared repeated rolling performance', () => {
	it('prepares absolute harmony/form and source identity for each declared loop', () => {
		const score = createRollingBacking(source, BACKING_STYLES.swing, params, { loopCount: 3 });
		expect(score.totalBars).toBe(12);
		expect(score.sourceBars).toBe(4);
		expect(score.loopCount).toBe(3);
		expect(score.loops).toEqual([{ loopIndex: 0, startBar: 0, endBarExclusive: 4 }, { loopIndex: 1, startBar: 4, endBarExclusive: 8 }, { loopIndex: 2, startBar: 8, endBarExclusive: 12 }]);
		expect(score.harmony).toHaveLength(12);
		expect(score.harmony[7].startOffset).toEqual([15, 2]);
		expect(score.harmony[7].duration).toEqual([1, 2]);
		expect(score.bars[4]).toMatchObject({ barIndex: 4, loopIndex: 1, sourceBarIndex: 0, sourceChorusIndex: 0, sourceSectionIndex: 0, chorusIndex: 1, sectionIndex: 1, sectionOccurrence: 1, sourceSection: 5, isChorusFirstBar: true });
		expect(score.bars[3]).toMatchObject({ isChorusFinalBar: true, isFinalBar: false });
		expect(score.bars[11].isFinalBar).toBe(true);
		expect(score.bars.filter((bar) => bar.isFinalBar)).toHaveLength(1);
		expect(Object.isFrozen(score.loops[0])).toBe(true);
		expect(Object.isFrozen(score.harmony[4].chord)).toBe(true);
		expect(source[0].startOffset).toEqual([0, 1]);
		expect(Object.isFrozen(source[0])).toBe(false);
	});

	it('continues absolute checkpoints and actual instrument history through a seam', () => {
		const score = createRollingBacking(source, BACKING_STYLES.swing, params, { loopCount: 2 });
		let checkpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < 4; bar++) checkpoint = advanceRollingBacking(score, checkpoint).checkpoint;
		const prefix = JSON.stringify(checkpoint);
		const resumed = advanceRollingBacking(score, JSON.parse(prefix));
		expect(resumed).toEqual(advanceRollingBacking(score, checkpoint));
		expect(resumed).toMatchObject({ fromBar: 4, toBarExclusive: 5, loopIndex: 1, sourceBarIndex: 0, previousCheckpointId: checkpoint!.checkpointId });
		expect(resumed.checkpoint.ensemble.performance.barsPlanned).toBe(5);
		expect(resumed.checkpoint.ensemble.recentBars.map((bar) => bar.barIndex)).toEqual([3, 4]);
		expect(resumed.checkpoint.bass.segmentIndex).toBeGreaterThanOrEqual(source.length);
		expect(resumed.checkpoint.drums.nextBar).toBe(5);
		expect(resumed.checkpoint.timing.phraseStartBar).toBe(4);
		expect(resumed.checkpoint.piano.recentFigures.length).toBe(3);
		expect(JSON.stringify(checkpoint)).toBe(prefix);
		expect(resumed.bassEvents.every((event) => parseInt(event.time, 10) >= 4 * 4 * score.ppq)).toBe(true);
	});

	it('adapts later loops without changing prior events or making old observations fresh', () => {
		const score = createRollingBacking(source, BACKING_STYLES.swing, params, { loopCount: 3 });
		let checkpoint: RollingBackingCheckpoint | undefined;
		const committed = [];
		for (let bar = 0; bar < 4; bar++) {
			const result = advanceRollingBacking(score, checkpoint);
			committed.push(result);
			checkpoint = result.checkpoint;
		}
		const before = JSON.stringify(committed);
		const active = advanceRollingBacking(score, checkpoint, [dense(4)]);
		expect(active.ensemblePlan.trace[0].soloEvidence).toBe('active');
		expect(active.compEvents).toHaveLength(0);
		expect(active.drumEvents.some((event) => event.role === 'commentary')).toBe(false);
		expect(active.bassEvents.length).toBeGreaterThan(0);
		expect(advanceRollingBacking(score, checkpoint, [dense(1)]).ensemblePlan.trace[0].soloEvidence).toBe('stale');
		expect(advanceRollingBacking(score, checkpoint, [dense(8)])).toEqual(advanceRollingBacking(score, checkpoint));
		expect(JSON.stringify(committed)).toBe(before);
	});

	it('keeps one-pass behavior compatible and rejects foreign repeat identities', () => {
		const ordinary = createRollingBacking(source, BACKING_STYLES.swing, params);
		const explicit = createRollingBacking(source, BACKING_STYLES.swing, params, { loopCount: 1 });
		expect(explicit).toEqual(ordinary);
		expect(advanceRollingBacking(explicit)).toEqual(advanceRollingBacking(ordinary));
		const two = createRollingBacking(source, BACKING_STYLES.swing, params, { loopCount: 2 });
		const three = createRollingBacking(source, BACKING_STYLES.swing, params, { loopCount: 3 });
		expect(two.sessionId).not.toBe(three.sessionId);
		expect(() => advanceRollingBacking(three, advanceRollingBacking(two).checkpoint)).toThrow(/checkpoint/);
	});

	it('enforces finite loop and total-bar limits without dropping a declared pass', () => {
		for (const loopCount of [0, -1, 1.5, MAX_ADAPTIVE_LOOPS + 1, Infinity, NaN]) {
			expect(() => createRollingBacking(source, BACKING_STYLES.swing, params, { loopCount })).toThrow(/loop/i);
		}
		const aaba = BACKING_LAB_PRESETS.find((preset) => preset.id === 'lab-aaba-c')!;
		const aabaParams = { ...params, performanceForm: aaba.phrase.performanceForm };
		expect(createRollingBacking(aaba.phrase.harmony, BACKING_STYLES.swing, aabaParams, { loopCount: 4 }).totalBars).toBe(384);
		expect(() => createRollingBacking(aaba.phrase.harmony, BACKING_STYLES.swing, aabaParams, { loopCount: 8 })).toThrow(/512|performance|limit/i);
		const large = [{ ...source[0], startOffset: [0, 1] as [number, number], duration: [128, 1] as [number, number] }];
		const score = createRollingBacking(large, BACKING_STYLES.swing, { ...params, performanceForm: undefined }, { loopCount: 4 });
		expect(score.totalBars).toBe(MAX_ADAPTIVE_BARS);
	});

	it('ends only after the last declared loop and never invents a further arrival', () => {
		const score = createRollingBacking(source, BACKING_STYLES.swing, params, { loopCount: 2 });
		let checkpoint: RollingBackingCheckpoint | undefined;
		const traces = [];
		for (let bar = 0; bar < 8; bar++) {
			const result = advanceRollingBacking(score, checkpoint);
			expect(result.fromBar).toBe(bar);
			traces.push(...result.ensembleDevelopment.bassTurnarounds);
			for (const event of [...result.compEvents, ...result.bassEvents]) expect(parseInt(event.time, 10) + event.duration * score.tempo / 60 * score.ppq).toBeLessThanOrEqual((bar + 1) * 4 * score.ppq + 1e-8);
			checkpoint = result.checkpoint;
		}
		expect(traces.some((trace) => trace.arrivalBar === 4)).toBe(true);
		expect(traces.some((trace) => trace.arrivalBar >= 8)).toBe(false);
		expect(checkpoint!.ensemble.pendingArrival).toBeNull();
		expect(checkpoint!.bass.pendingLaunch).toBeNull();
		expect(() => advanceRollingBacking(score, checkpoint)).toThrow(/complete/);
	});

	it('preserves the shared musical prefix across different declared endings', () => {
		const eightBars = [...source, ...source.map((segment) => ({ ...segment, startOffset: [segment.startOffset[0] + 4 * segment.startOffset[1], segment.startOffset[1]] as [number, number] }))];
		const eightForm = buildPerformanceForm({ totalBars: 8, sectionMap: [{ sourceSection: 5, barOffset: 0 }, { sourceSection: 6, barOffset: 4 }],
			choruses: [{ role: 'solo', startBar: 0, endBarExclusive: 8 }] });
		const two = createRollingBacking(eightBars, BACKING_STYLES.swing, { ...params, performanceForm: eightForm }, { loopCount: 2 });
		const three = createRollingBacking(eightBars, BACKING_STYLES.swing, { ...params, performanceForm: eightForm }, { loopCount: 3 });
		let left: RollingBackingCheckpoint | undefined;
		let right: RollingBackingCheckpoint | undefined;
		let attacks = 0;
		// Include the loop seam, but stop before the shorter performance's
		// final closing phrase, whose known ending legitimately changes choices.
		for (let bar = 0; bar < 12; bar++) {
			const evidence = bar === 9 ? [dense(bar)] : [];
			const a = advanceRollingBacking(two, left, evidence);
			const b = advanceRollingBacking(three, right, evidence);
			for (const key of ['bassEvents', 'compEvents', 'drumEvents', 'ensemblePlan', 'ensembleTiming', 'ensembleDevelopment'] as const) expect(a[key]).toEqual(b[key]);
			attacks += a.compEvents.length;
			left = a.checkpoint;
			right = b.checkpoint;
		}
		expect(attacks).toBeGreaterThan(0);
		expect(left!.nextBar).toBe(12);
	});

	it('carries selected setups into an actual next-loop arrival', () => {
		let setups = 0;
		for (let seed = 0; seed < 24; seed++) {
			const score = createRollingBacking(source, BACKING_STYLES.swing, { ...params, phraseId: `loop-seam-${seed}` }, { loopCount: 3 });
			let checkpoint: RollingBackingCheckpoint | undefined;
			const windows = [];
			for (let bar = 0; bar < score.totalBars; bar++) {
				const result = advanceRollingBacking(score, checkpoint);
				windows.push(result);
				checkpoint = result.checkpoint;
				if (bar === 4 || bar === 8) expect(result.checkpoint.bass.feel).toBe('four');
			}
			for (const seam of [4, 8]) {
				const before = windows[seam - 1];
				const arrival = windows[seam];
				if (before.ensemblePlan.bars[0].setupFor) {
					setups++;
					expect(before.checkpoint.ensemble.pendingArrival?.targetBarIndex).toBe(seam);
					expect(arrival.ensemblePlan.bars[0].coordinatedAccent?.targetBarIndex).toBe(seam);
					const bass = arrival.bassEvents.find((event) => event.absBeat === seam * 4)!;
					const hits = arrival.drumEvents.filter((event) => event.absBeat === seam * 4 && event.role === 'accent');
					expect(hits.length).toBeGreaterThan(0);
					for (const hit of hits) expect(hit.time).toBe(bass.time);
				}
			}
		}
		expect(setups).toBeGreaterThan(0);
	});

	it('retains a selected two-bar bass path through the next-loop root under later dense evidence', () => {
		const aaba = BACKING_LAB_PRESETS.find((preset) => preset.id === 'lab-aaba-c')!;
		let launches = 0;
		for (let seed = 0; seed < 12 && launches === 0; seed++) {
			const score = createRollingBacking(aaba.phrase.harmony, BACKING_STYLES.swing,
				{ ...params, phraseId: `launch-${seed}`, performanceForm: aaba.phrase.performanceForm }, { loopCount: 2 });
			let checkpoint: RollingBackingCheckpoint | undefined;
			for (let bar = 0; bar <= score.sourceBars - 2; bar++) {
				const result = advanceRollingBacking(score, checkpoint);
				checkpoint = result.checkpoint;
				if (bar !== score.sourceBars - 2) continue;
				const launch = result.ensembleDevelopment.bassTurnarounds.find((entry) => entry.status === 'planned');
				if (!launch) continue;
				launches++;
				const continuation = advanceRollingBacking(score, result.checkpoint, [dense(bar + 1)]);
				const arrival = advanceRollingBacking(score, continuation.checkpoint, [dense(bar + 2)]);
				expect(continuation.checkpoint.bass.pendingLaunch).toEqual(launch);
				expect(arrival).toMatchObject({ loopIndex: 1, sourceBarIndex: 0 });
				const pulse = [...result.bassEvents, ...continuation.bassEvents, ...arrival.bassEvents]
					.filter((event) => event.absBeat <= score.sourceBars * 4 && Number.isInteger(event.absBeat));
				expect(pulse.map((event) => ({ absBeat: event.absBeat, midi: event.midi }))).toEqual(launch.notes);
				expect(arrival.bassEvents[0].midi).toBe(launch.targetMidi);
				expect(arrival.checkpoint.bass.pendingLaunch).toBeNull();
			}
		}
		expect(launches).toBeGreaterThan(0);
	});

	it('keeps large prepared performances bounded and records generation cost without timing assertions', () => {
		const aaba = BACKING_LAB_PRESETS.find((preset) => preset.id === 'lab-aaba-c')!;
		const quarterChanges = Array.from({ length: 128 * 4 }, (_, beat) => ({ ...source[beat % source.length],
			startOffset: [beat, 4] as [number, number], duration: [1, 4] as [number, number] }));
		const cases = [
			createRollingBacking(aaba.phrase.harmony, BACKING_STYLES.swing, { ...params, performanceForm: aaba.phrase.performanceForm }, { loopCount: 4 }),
			createRollingBacking(quarterChanges, BACKING_STYLES.swing, { ...params, performanceForm: undefined }, { loopCount: 4 })
		];
		for (const score of cases) {
			const durations: number[] = [];
			const windows = [];
			let checkpoint: RollingBackingCheckpoint | undefined;
			for (let bar = 0; bar < score.totalBars; bar++) {
				const start = performance.now();
				const result = advanceRollingBacking(score, checkpoint);
				durations.push(performance.now() - start);
				windows.push(result);
				expect(result.checkpoint.fingerprint.length).toBeLessThan(100);
				for (const event of [...result.bassEvents, ...result.compEvents, ...result.drumEvents]) {
					const tick = parseInt(event.time, 10);
					expect(tick).toBeGreaterThanOrEqual(bar * 4 * score.ppq);
					expect(tick).toBeLessThan((bar + 1) * 4 * score.ppq);
					if ('duration' in event) expect(tick + event.duration * score.tempo / 60 * score.ppq).toBeLessThanOrEqual((bar + 1) * 4 * score.ppq + 1e-8);
				}
				checkpoint = result.checkpoint;
			}
			expect(checkpoint!.nextBar).toBe(score.totalBars);
			if (process.env.MEASURE_ROLLING_LOOPS === '1') {
				const percentile = (values: number[], quantile: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * quantile)];
				process.stdout.write('rolling-loop-measurement ' + JSON.stringify({ bars: score.totalBars, segments: score.harmony.length,
					p95Ms: percentile(durations, 0.95), maxMs: Math.max(...durations), lateP95Ms: percentile(durations.slice(-64), 0.95),
					definitionBytes: Buffer.byteLength(JSON.stringify(score)), retainedWindowsBytes: Buffer.byteLength(JSON.stringify(windows)), fingerprintChars: score.fingerprint.length }) + '\n');
			}
		}
	});
});
