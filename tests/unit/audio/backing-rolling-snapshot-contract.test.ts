import { describe, expect, it, vi } from 'vitest';
import { createRollingBacking, advanceRollingBacking, type RollingBackingBar, type RollingBackingCheckpoint, type RollingBackingDefinition } from '$lib/audio/backing-rolling';
import { createRollingBackingRenderer } from '$lib/audio/backing-rolling-renderer';
import { aggregateRollingBacking } from '$lib/audio/backing-rolling-take';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES, RHYTHM_CHANGES } from '$lib/data/tunes';
import type { BackingStyle } from '$lib/types/instruments';

function definition(style: BackingStyle, bars: 52 | 128) {
	const { phrase } = buildListeningTuneSession({ tuneId: bars === 52 ? MANKUNKU_BLUES.id : RHYTHM_CHANGES.id, soloChoruses: 2 });
	const tempo = style === 'ballad' ? 80 : 140;
	return createRollingBacking(phrase.harmony, BACKING_STYLES[style], {
		phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4,
		swing: resolveBackingSwing(0.67, BACKING_STYLES[style], tempo),
		performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {}
	});
}

function harness(score: RollingBackingDefinition) {
	let now = 99.7;
	let id = 0;
	const callbacks = new Map<number, { tick: number; callback: (audioTime: number) => void }>();
	const schedule = vi.fn((callback: (audioTime: number) => void, ticks: string) => {
		callbacks.set(++id, { tick: Number.parseInt(ticks), callback }); return id;
	});
	const play = vi.fn(() => () => {});
	const renderer = createRollingBackingRenderer({ sessionId: score.sessionId, tempo: score.tempo,
		ppq: score.ppq, totalBars: score.totalBars, startAudioTime: 100 }, {
		audioNow: () => now, lookAhead: () => 0.1, updateInterval: () => 0.025, isCurrent: () => true,
		scheduleOnce: schedule, clear: eventId => { callbacks.delete(eventId); }, play, publishSchedule: () => {}
	});
	const generate = vi.fn(advanceRollingBacking);
	return { renderer, schedule, play, generate,
		beforeBar(bar: number) { now = 100 + bar * 240 / score.tempo - 0.3; },
		dispatch() {
			for (const [eventId, event] of callbacks) {
				const target = 100 + event.tick * 60 / score.tempo / score.ppq;
				now = target - 0.02; event.callback(target); callbacks.delete(eventId);
			}
		}
	};
}

describe('full-performance rolling snapshot contract', () => {
	it('reuses unchanged frozen dispatch evidence without scheduling or playing during polling', () => {
		const score = definition('swing', 52); const h = harness(score);
		expect(h.renderer.commit(h.generate(score)).accepted).toBe(true);
		const prior = h.renderer.snapshot();
		const scheduled = h.schedule.mock.calls.length;
		for (let poll = 0; poll < 20; poll++) {
			expect(h.renderer.snapshot().dispatches).toBe(prior.dispatches);
		}
		expect(Object.isFrozen(prior.dispatches)).toBe(true);
		expect(h.generate).toHaveBeenCalledTimes(1);
		expect(h.schedule).toHaveBeenCalledTimes(scheduled);
		expect(h.play).not.toHaveBeenCalled();
	});

	for (const style of ['swing', 'straight', 'bossa-nova', 'ballad'] as const) {
		for (const bars of [52, 128] as const) {
			it(`${style}: repeated polls preserve the complete ${bars}-bar performance and checkpoint replay`, () => {
				const score = definition(style, bars); const h = harness(score);
				expect(score.totalBars).toBe(bars);
				let checkpoint: RollingBackingCheckpoint | undefined;
				let replayCheckpoint: RollingBackingCheckpoint | undefined;
				const replay: RollingBackingBar[] = [];
				let first: ReturnType<typeof h.renderer.snapshot> | undefined;
				let firstJson = '';
				for (let bar = 0; bar < bars; bar++) {
					h.beforeBar(bar);
					const generated = h.generate(score, checkpoint);
					// Independent JSON restoration exercises the persisted causal state,
					// without using a renderer snapshot to generate the oracle.
					const restored = advanceRollingBacking(score, replayCheckpoint && JSON.parse(JSON.stringify(replayCheckpoint)));
					replay.push(restored); replayCheckpoint = restored.checkpoint;
					expect(generated).toEqual(restored);
					expect(h.renderer.commit(generated).accepted).toBe(true);
					checkpoint = generated.checkpoint;
					const before = h.renderer.snapshot();
					if (!first) { first = before; firstJson = JSON.stringify(before); }
					const scheduled = h.schedule.mock.calls.length;
					const played = h.play.mock.calls.length;
					for (let poll = 0; poll < 10; poll++) {
						expect(h.renderer.snapshot().dispatches).toBe(before.dispatches);
					}
					expect(h.generate).toHaveBeenCalledTimes(bar + 1);
					expect(h.schedule).toHaveBeenCalledTimes(scheduled);
					expect(h.play).toHaveBeenCalledTimes(played);
					expect(before.windows.at(-1)).toEqual(restored);
					const pending = before.dispatches.filter(event => event.status === 'scheduled');
					expect(pending.length).toBeGreaterThan(0);
					h.dispatch();
					const after = h.renderer.snapshot();
					expect(after.dispatches.every(event => event.status === 'played')).toBe(true);
					expect(before.dispatches.filter(event => event.status === 'scheduled')).toEqual(pending);
					expect(h.play).toHaveBeenCalledTimes(played + pending.length);
					if (bar === 0 || bar === Math.floor(bars / 2) || bar === bars - 1) {
						const oracle = aggregateRollingBacking({ ...after, windows: replay,
							generated: { bassEvents: replay.flatMap(window => window.bassEvents),
								compEvents: replay.flatMap(window => window.compEvents), drumEvents: replay.flatMap(window => window.drumEvents) } });
						expect(aggregateRollingBacking(before)).toEqual(oracle);
						expect(aggregateRollingBacking(after)).toEqual(oracle);
					}
				}
				const completed = h.renderer.snapshot();
				const finalTake = aggregateRollingBacking(completed);
				expect(completed.checkpointId).toBe(replayCheckpoint!.checkpointId);
				expect(completed.committedThroughTick).toBe(bars * 4 * score.ppq);
				h.renderer.stop();
				expect(h.renderer.snapshot().status).toBe('stopped');
				expect(completed.status).toBe('active');
				expect(aggregateRollingBacking(h.renderer.snapshot())).toEqual(finalTake);
				expect(JSON.stringify(first)).toBe(firstJson);
			});
		}
	}

	it('stopping a partial take cancels pending evidence without rewriting its historical snapshot', () => {
		const score = definition('ballad', 52); const h = harness(score);
		h.renderer.commit(h.generate(score));
		const before = h.renderer.snapshot();
		const musicalEvidence = aggregateRollingBacking(before);
		h.renderer.stop();
		const stopped = h.renderer.snapshot();
		expect(before.dispatches.every(event => event.status === 'scheduled')).toBe(true);
		expect(stopped.dispatches.every(event => event.status === 'cancelled')).toBe(true);
		expect(stopped.dispatches.length).toBeGreaterThan(0);
		expect(h.renderer.snapshot().dispatches).toBe(stopped.dispatches);
		expect(aggregateRollingBacking(stopped)).toEqual(musicalEvidence);
		h.dispatch(); expect(h.play).not.toHaveBeenCalled();
	});

});
