import { describe, expect, it } from 'vitest';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import type { SoloFeature } from '$lib/audio/ensemble-plan';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { createEnsembleTiming } from '$lib/audio/ensemble-timing';
import { createSoloObserver } from '$lib/audio/solo-observer';

const preset = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
const definition = (seed = 'rolling') => createRollingBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
	phraseId: seed, tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67,
	performanceForm: preset.phrase.performanceForm, sectionMap: preset.phrase.sectionMap, ensemble: {}
});
const dense = (bar: number): SoloFeature => ({ barIndex: bar, observedAtBar: bar - 1, source: 'microphone', confidence: 0.95, noteDensity: 1, restBeats: 0 });

describe('causal rolling backing', () => {
	it('commits sounding bass, piano and drums in complete owned bars', () => {
		const score = definition();
		let checkpoint: RollingBackingCheckpoint | undefined;
		let piano = 0;
		for (let bar = 0; bar < 12; bar++) {
			const result = advanceRollingBacking(score, checkpoint);
			expect(result.fromBar).toBe(bar);
			expect(result.toBarExclusive).toBe(bar + 1);
			expect(result.previousCheckpointId).toBe(checkpoint?.checkpointId ?? null);
			expect(result.bassEvents.length).toBeGreaterThanOrEqual(2);
			expect(result.drumEvents.filter((event) => ['ride', 'ride-bell', 'crash'].includes(event.drum)).length).toBeGreaterThanOrEqual(4);
			for (const event of [...result.bassEvents, ...result.compEvents, ...result.drumEvents]) {
				const tick = parseInt(event.time, 10);
				expect(tick).toBeGreaterThanOrEqual(result.startTick);
				expect(tick).toBeLessThan(result.committedThroughTick);
				if ('duration' in event) expect(tick + event.duration * score.tempo / 60 * score.ppq).toBeLessThanOrEqual(result.committedThroughTick + 1e-8);
			}
			piano += result.compEvents.length;
			checkpoint = result.checkpoint;
		}
		expect(piano).toBeGreaterThan(0);
	});

	it('responds to new dense evidence without rewriting any committed event or release', () => {
		const score = definition();
		const first = advanceRollingBacking(score);
		const snapshot = JSON.stringify(first);
		const ordinary = advanceRollingBacking(score, first.checkpoint);
		const reduced = advanceRollingBacking(score, first.checkpoint, [dense(1)]);
		expect(reduced.ensemblePlan.bars[0].piano.maxAttacks).toBe(0);
		expect(reduced.compEvents).toHaveLength(0);
		expect(reduced.drumEvents.some((event) => event.role === 'commentary')).toBe(false);
		expect(reduced.bassEvents.length).toBeGreaterThan(0);
		expect(reduced.ensemblePlan.trace[0].soloEvidence).toBe('active');
		expect(reduced).not.toEqual(ordinary);
		expect(JSON.stringify(first)).toBe(snapshot);
		expect(advanceRollingBacking(score, undefined, [dense(1)])).toEqual(first);
	});

	it('restores instrument and planner continuity from JSON at every bar', () => {
		const score = definition('restore');
		let checkpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const features = bar % 7 === 2 ? [dense(bar)] : [];
			const direct = advanceRollingBacking(score, checkpoint, features);
			const restored = advanceRollingBacking(score, checkpoint ? JSON.parse(JSON.stringify(checkpoint)) : undefined, features);
			expect(restored).toEqual(direct);
			expect(Object.isFrozen(restored.checkpoint)).toBe(true);
			expect(Object.isFrozen(restored.compEvents)).toBe(true);
			checkpoint = direct.checkpoint;
		}
		expect(() => advanceRollingBacking(score, checkpoint)).toThrow(/complete/i);
	});

	it('never freezes or aliases the caller\'s restored checkpoint', () => {
		const score = definition('owned-checkpoint');
		const first = advanceRollingBacking(score);
		const restored: RollingBackingCheckpoint = JSON.parse(JSON.stringify(first.checkpoint));
		const before = JSON.stringify(restored);
		const next = advanceRollingBacking(score, restored);
		expect(JSON.stringify(restored)).toBe(before);
		expect(Object.isFrozen(restored)).toBe(false);
		expect(Object.isFrozen(restored.timing)).toBe(false);
		expect(Object.isFrozen(restored.piano.motif)).toBe(false);
		expect(next.checkpoint.timing).not.toBe(restored.timing);
		expect(next.checkpoint.piano.motif).not.toBe(restored.piano.motif);
	});

	it('rejects foreign or malformed state and incomplete forms', () => {
		const score = definition();
		const first = advanceRollingBacking(score);
		expect(() => advanceRollingBacking(definition('foreign'), first.checkpoint)).toThrow(/checkpoint/i);
		expect(() => advanceRollingBacking(score, { ...first.checkpoint, nextBar: 9 })).toThrow(/checkpoint/i);
		expect(() => advanceRollingBacking(score, { ...first.checkpoint, version: 99 } as never)).toThrow(/checkpoint/i);
		const harmony = [{ ...preset.phrase.harmony[0], startOffset: [0, 1] as [number, number], duration: [9, 8] as [number, number] }];
		expect(() => createRollingBacking(harmony, BACKING_STYLES.swing, {
			phraseId: 'partial', tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67, ensemble: {}
		})).toThrow(/complete/i);
	});

	it('keeps long-held harmony causal across changed future observations and sounding silence', () => {
		const harmony = [{ ...preset.phrase.harmony[0], startOffset: [0, 1] as [number, number], duration: [8, 1] as [number, number] }];
		const score = createRollingBacking(harmony, BACKING_STYLES.swing, {
			phraseId: 'held-causal', tempo: 160, ppq: 192, beatsPerBar: 4, swing: 0.78, ensemble: {},
			performanceForm: buildPerformanceForm({ totalBars: 8, sectionMap: [], choruses: [{ role: 'solo', startBar: 0, endBarExclusive: 8 }] })
		});
		let checkpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < 4; bar++) checkpoint = advanceRollingBacking(score, checkpoint).checkpoint;
		const stored = JSON.stringify(checkpoint);
		const future = Array.from({ length: 4 }, (_, index) => dense(index + 4));
		const silent = advanceRollingBacking(score, checkpoint, future);
		expect(silent.ensemblePlan.trace[0].soloEvidence).toBe('active');
		expect(silent.compEvents).toHaveLength(0);
		expect(silent.bassEvents.filter((event) => Number.isInteger(event.absBeat)).length).toBeGreaterThanOrEqual(2);
		expect(JSON.stringify(checkpoint)).toBe(stored);
		let earlier: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < 4; bar++) earlier = advanceRollingBacking(score, earlier, future).checkpoint;
		expect(earlier).toEqual(checkpoint);
	});

	it('does not freshen old microphone evidence or consume impossible future evidence', () => {
		const score = definition();
		let checkpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < 4; bar++) checkpoint = advanceRollingBacking(score, checkpoint).checkpoint;
		expect(advanceRollingBacking(score, checkpoint, [dense(1)]).ensemblePlan.trace[0].soloEvidence).toBe('stale');
		const impossible = { ...dense(1), observedAtBar: 4 };
		expect(advanceRollingBacking(score, checkpoint, [impossible])).toEqual(advanceRollingBacking(score, checkpoint));
		expect(advanceRollingBacking(score, checkpoint, [{ ...dense(4), confidence: 0.1 }]).ensemblePlan.trace[0].soloEvidence).toBe('low_confidence');
	});

	it('uses completed observer windows to reduce the next uncommitted accompaniment during a pass', () => {
		const score = definition('observer-to-rolling');
		const observer = createSoloObserver({ sessionId: score.sessionId, tempo: score.tempo, beatsPerBar: 4, totalBars: score.totalBars });
		const first = advanceRollingBacking(score);
		const second = advanceRollingBacking(score, first.checkpoint);
		const committed = JSON.stringify([first, second]);
		let liveCheckpoint = second.checkpoint;
		let referenceCheckpoint = second.checkpoint;
		let frameIndex = 0;
		let ordinaryAttacks = 0;
		let observedAttacks = 0;
		for (let bar = 2; bar < 16; bar++) {
			// At least one full completed source bar is available; the next
			// already-committed bar is immutable while this new bar adapts.
			const availableSeconds = (bar - 1) * 4 * 60 / score.tempo + 0.03;
			for (; frameIndex / 60 <= availableSeconds; frameIndex++) {
				const time = frameIndex / 60;
				observer.push({ timeSeconds: time, availableAtSeconds: time, rms: 0.08, midi: 72 + Math.floor(time / (30 / score.tempo)) % 2,
					clarity: 0.97, inputAvailable: true, backingMidi: [], nearBackingTransient: false });
			}
			const features = observer.snapshot().flatMap((window) => window.feature ? [window.feature] : []);
			expect(features.length).toBeGreaterThan(0);
			expect(features.at(-1)!.source).toBe('microphone');
			const live = advanceRollingBacking(score, liveCheckpoint, features);
			const reference = advanceRollingBacking(score, referenceCheckpoint);
			expect(live.ensemblePlan.trace[0].soloEvidence, JSON.stringify({ bar, latest: features.at(-1), windows: observer.snapshot().slice(-2) })).toBe('active');
			expect(live.drumEvents.some((event) => event.role === 'commentary')).toBe(false);
			expect(live.bassEvents.filter((event) => Number.isInteger(event.absBeat)).map((event) => event.absBeat))
				.toEqual(reference.bassEvents.filter((event) => Number.isInteger(event.absBeat)).map((event) => event.absBeat));
			observedAttacks += live.compEvents.length + live.drumEvents.filter((event) => event.role === 'commentary').length;
			ordinaryAttacks += reference.compEvents.length + reference.drumEvents.filter((event) => event.role === 'commentary').length;
			liveCheckpoint = live.checkpoint;
			referenceCheckpoint = reference.checkpoint;
		}
		expect(observedAttacks).toBeLessThan(ordinaryAttacks);
		expect(JSON.stringify([first, second])).toBe(committed);
	});

	it('retains the same phrase timing across commits and matches known full-form placement', () => {
		const score = definition();
		let checkpoint: RollingBackingCheckpoint | undefined;
		const bars = [];
		for (let bar = 0; bar < 4; bar++) {
			const result = advanceRollingBacking(score, checkpoint);
			if (checkpoint) expect(result.checkpoint.timing).toEqual(checkpoint.timing);
			bars.push(result.ensemblePlan.bars[0]);
			checkpoint = result.checkpoint;
		}
		const whole = createEnsembleTiming({ phraseId: score.phraseId, tempo: score.tempo, ppq: score.ppq, swing: score.swing,
			plan: { version: 1, bars, trace: [] }, timingProfiles: score.timingProfiles });
		expect(checkpoint!.timing).toEqual(whole.trace[0]);
	});

	it('keeps drum replies tied to previous emitted piano and honors actual budgets', () => {
		let replies = 0;
		let motifs = 0;
		for (let seed = 0; seed < 8; seed++) {
			const score = definition(`dialogue-${seed}`);
			let checkpoint: RollingBackingCheckpoint | undefined;
			let priorPiano: number[] = [];
			for (let bar = 0; bar < 16; bar++) {
				const result = advanceRollingBacking(score, checkpoint);
				const plan = result.ensemblePlan.bars[0];
				expect(result.compEvents.length).toBeLessThanOrEqual(plan.piano.maxAttacks);
				expect(result.drumEvents.filter((event) => event.role === 'commentary').length).toBeLessThanOrEqual(plan.drums.maxCommentaryHits);
				const drum = result.ensembleDevelopment.drumPhrases[0];
				expect(drum.hits.map((hit) => [hit.drum, bar * 4 + hit.beatOffset, hit.velocity]).sort()).toEqual(result.drumEvents.map((event) => [event.drum, event.absBeat, event.velocity]).sort());
				if (drum.commentary.transform === 'answer') {
					replies++;
					expect(drum.commentary.sourceBar).toBe(bar - 1);
					expect(drum.commentary.sourceOffsets).toEqual(priorPiano);
				}
				const piano = result.ensembleDevelopment.pianoMotifs[0];
				if (['repeat', 'displace', 'shorten'].includes(piano.transform) && result.compEvents.length) motifs++;
				expect(piano.hits.map((hit) => hit.b)).toEqual(result.compEvents.map((event) => event.absBeat - bar * 4));
				priorPiano = result.compEvents.map((event) => event.absBeat - bar * 4);
				checkpoint = result.checkpoint;
			}
		}
		expect(replies).toBeGreaterThan(0);
		expect(motifs).toBeGreaterThan(0);
	});

	it('carries accepted two-bar bass launches and exact root arrivals through later dense evidence', () => {
		let launches = 0;
		for (let seed = 0; seed < 12; seed++) {
			const score = definition(`launch-${seed}`);
			let checkpoint: RollingBackingCheckpoint | undefined;
			for (let bar = 0; bar < score.totalBars; bar++) {
				const result = advanceRollingBacking(score, checkpoint);
				const launch = result.ensembleDevelopment.bassTurnarounds.find((entry) => entry.status === 'planned');
				if (launch) {
					launches++;
					const continuation = advanceRollingBacking(score, result.checkpoint, [dense(bar + 1)]);
					const arrival = advanceRollingBacking(score, continuation.checkpoint, [dense(bar + 2)]);
					const pulse = [...result.bassEvents, ...continuation.bassEvents, ...arrival.bassEvents].filter((event) => event.absBeat <= launch.arrivalBar * 4 && Number.isInteger(event.absBeat));
					expect(pulse.map((event) => ({ absBeat: event.absBeat, midi: event.midi }))).toEqual(launch.notes);
					expect(arrival.bassEvents.find((event) => event.absBeat === launch.arrivalBar * 4)?.midi).toBe(launch.targetMidi);
				}
				checkpoint = result.checkpoint;
			}
		}
		expect(launches).toBeGreaterThan(0);
	});

	it('never launches across an intervening one-bar chorus', () => {
		const form = buildPerformanceForm({ totalBars: 7, sectionMap: [], choruses: [
			{ role: 'solo', startBar: 0, endBarExclusive: 2 }, { role: 'solo', startBar: 2, endBarExclusive: 3 }, { role: 'solo', startBar: 3, endBarExclusive: 7 }
		] });
		const harmony = Array.from({ length: 7 }, (_, bar) => ({ ...preset.phrase.harmony[0], startOffset: [bar, 1] as [number, number], duration: [1, 1] as [number, number] }));
		const score = createRollingBacking(harmony, BACKING_STYLES.swing, { phraseId: 'short-chorus', tempo: 140, ppq: 192, swing: 0.67,
			beatsPerBar: 4, performanceForm: form, ensemble: {} });
		let checkpoint: RollingBackingCheckpoint | undefined;
		const traces = [];
		for (let bar = 0; bar < 4; bar++) {
			const result = advanceRollingBacking(score, checkpoint);
			traces.push(...result.ensembleDevelopment.bassTurnarounds);
			checkpoint = result.checkpoint;
		}
		expect(traces.find((entry) => entry.arrivalBar === 3)).toMatchObject({ status: 'skipped', reason: 'short_chorus', startBar: 2 });
	});
});
