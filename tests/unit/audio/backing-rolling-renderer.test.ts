import { describe, expect, it, vi } from 'vitest';
import { createRollingBackingRenderer, type RollingBackingRuntime } from '$lib/audio/backing-rolling-renderer';
import type { RollingBackingBar } from '$lib/audio/backing-rolling';
import type { BackingTrackSchedule } from '$lib/audio/backing-track-schedule';

function bar(index: number): RollingBackingBar {
	const startTick = index * 768;
	return {
		version: 1, sessionId: 'take', fromBar: index, toBarExclusive: index + 1,
		startTick, earliestTick: startTick, committedThroughTick: startTick + 768,
		previousCheckpointId: index ? `checkpoint-${index}` : null,
		checkpoint: { version: 1, sessionId: 'take', fingerprint: 'score', checkpointId: `checkpoint-${index + 1}`, nextBar: index + 1 },
		bassEvents: [{ time: `${startTick}i`, midi: 48 + index, velocity: 80, duration: 0.4, absBeat: index * 4 }],
		compEvents: [{ time: `${startTick}i`, notes: [60, 64, 67], velocity: 60, duration: 1 }],
		drumEvents: [{ time: `${startTick}i`, drum: 'ride', velocity: 0.6 }],
		ensemblePlan: [], ensembleTiming: [], ensembleDevelopment: { pianoMotifs: [], bassTurnarounds: [], drumPhrases: [] }
	} as unknown as RollingBackingBar;
}

function harness() {
	let now = 10;
	let lookAhead = 0.1;
	let updateInterval = 0.025;
	let current = true;
	let published: BackingTrackSchedule | null = null;
	let id = 0;
	const pending = new Map<number, { callback: (time: number) => void; tick: number }>();
	const voiceStops: ReturnType<typeof vi.fn>[] = [];
	const runtime: RollingBackingRuntime = {
		audioNow: () => now, lookAhead: () => lookAhead, updateInterval: () => updateInterval,
		isCurrent: () => current,
		scheduleOnce: vi.fn((callback, ticks) => {
			const eventId = ++id; pending.set(eventId, { callback, tick: Number.parseInt(ticks) }); return eventId;
		}),
		clear: vi.fn((eventId) => { pending.delete(eventId); }),
		play: vi.fn(() => { const stop = vi.fn(); voiceStops.push(stop); return stop; }),
		publishSchedule: vi.fn((value) => { published = value; })
	};
	const onUnderrun = vi.fn();
	const renderer = createRollingBackingRenderer({ sessionId: 'take', tempo: 120, ppq: 192,
		totalBars: 4, startAudioTime: 11, maxComputeSeconds: 0.025, safetySeconds: 0.01, onUnderrun }, runtime);
	return { renderer, runtime, pending, voiceStops, onUnderrun,
		now(value: number) { now = value; }, clocks(la: number, interval: number) { lookAhead = la; updateInterval = interval; },
		current(value: boolean) { current = value; }, published: () => published };
}

describe('append-only rolling audio renderer', () => {
	it('accepts the bounded repeated-form extent and rejects an unbounded session', () => {
		const h = harness();
		expect(() => createRollingBackingRenderer({ sessionId: 'long-take', tempo: 120, ppq: 192,
			totalBars: 512, startAudioTime: 11 }, h.runtime)).not.toThrow();
		expect(() => createRollingBackingRenderer({ sessionId: 'too-long', tempo: 120, ppq: 192,
			totalBars: 513, startAudioTime: 11 }, h.runtime)).toThrow(/configuration/);
	});

	it('derives preparation and dispatch horizons from the live audio clock settings', () => {
		const h = harness();
		expect(h.renderer.horizon()).toEqual({ audioNow: 10, dispatchThrough: 10.135, renderSafeFrom: 10.16 });
		h.now(12); h.clocks(0.2, 0.05);
		expect(h.renderer.horizon().dispatchThrough).toBeCloseTo(12.26, 10);
		expect(h.renderer.horizon().renderSafeFrom).toBeCloseTo(12.285, 10);
	});

	it('commits one complete shared-tick batch and publishes the identical actual event ledger', () => {
		const h = harness(); const input = bar(0);
		expect(h.renderer.commit(input)).toMatchObject({ accepted: true, nextBar: 1, committedThroughTick: 768 });
		expect(h.pending.size).toBe(1);
		expect(h.published()!.activeMidiAt(0.2, 0)).toEqual([48, 60, 64, 67]);
		const snapshot = h.renderer.snapshot();
		expect(snapshot.generated.bassEvents).toEqual(input.bassEvents);
		expect(snapshot.schedule).toBe(h.published());
		expect(snapshot.schedule!.transientOnsets).toEqual([0]);
		h.now(10.9); const event = [...h.pending.values()][0]; event.callback(11); event.callback(11);
		expect(h.runtime.play).toHaveBeenCalledTimes(1);
		expect(h.runtime.play).toHaveBeenCalledWith([
			{ kind: 'bass', midi: 48, velocity: 80, duration: 0.4 },
			{ kind: 'comp', notes: [60, 64, 67], velocity: 60, duration: 1 },
			{ kind: 'drum', drum: 'ride', velocity: 0.6 }
		], 11, expect.any(String));
		expect(h.renderer.snapshot().dispatches[0].status).toBe('played');
		expect(snapshot.dispatches[0].status).toBe('scheduled');
	});

	it('freezes copied inputs and prior snapshots while later bars append without stopping ringing notes', () => {
		const h = harness(); const first = bar(0); h.renderer.commit(first);
		const previous = h.renderer.snapshot();
		(first.compEvents[0].notes as number[])[0] = 72;
		expect(previous.generated.compEvents[0].notes[0]).toBe(60);
		[...h.pending.values()][0].callback(11);
		expect(h.renderer.commit(bar(1)).accepted).toBe(true);
		expect(h.voiceStops[0]).not.toHaveBeenCalled();
		expect(previous.generated.bassEvents).toHaveLength(1);
		expect(h.renderer.snapshot().generated.bassEvents).toHaveLength(2);
		expect(Object.isFrozen(previous.generated.compEvents[0].notes)).toBe(true);
		expect(Object.isFrozen(previous.schedule!.notes)).toBe(true);
	});

	it('rejects stale owners, noncontiguous checkpoints and expired or overbudget batches without mutation', () => {
		const h = harness();
		expect(h.renderer.commit(bar(1))).toEqual({ accepted: false, reason: 'out_of_order' });
		h.current(false);
		expect(h.renderer.commit(bar(0))).toEqual({ accepted: false, reason: 'stale_session' });
		h.current(true);
		expect(h.renderer.commit(bar(0), { renderStartedAt: 10, renderElapsedSeconds: 0.03 })).toEqual({ accepted: false, reason: 'compute_budget' });
		h.now(10.9);
		expect(h.renderer.commit(bar(0))).toEqual({ accepted: false, reason: 'deadline' });
		expect(h.pending.size).toBe(0);
		expect(h.published()).toBeNull();
		expect(h.renderer.snapshot().nextBar).toBe(0);
	});

	it('rejects malformed tick strings, future gates and invalid events as complete batches', () => {
		for (const mutate of [
			(b: RollingBackingBar) => { b.bassEvents[0].time = '0garbage'; },
			(b: RollingBackingBar) => { b.compEvents[0].duration = 2.01; },
			(b: RollingBackingBar) => { b.drumEvents[0].velocity = Number.NaN; },
			(b: RollingBackingBar) => { b.bassEvents[0].midi = 130; }
		]) {
			const h = harness(); const input = bar(0); mutate(input);
			expect(h.renderer.commit(input)).toEqual({ accepted: false, reason: 'invalid_window' });
			expect(h.pending.size).toBe(0); expect(h.published()).toBeNull();
		}
	});

	it('rolls back every newly registered callback when scheduleOnce fails mid-batch', () => {
		const h = harness(); const input = bar(0);
		input.drumEvents[0].time = '192i';
		vi.mocked(h.runtime.scheduleOnce).mockImplementationOnce((callback, tick) => {
			h.pending.set(1, { callback, tick: Number.parseInt(tick) }); return 1;
		}).mockImplementationOnce(() => { throw new Error('transport failure'); });
		expect(h.renderer.commit(input)).toEqual({ accepted: false, reason: 'schedule_failure' });
		expect(h.pending.size).toBe(0); expect(h.published()).toBeNull();
		expect(h.renderer.snapshot().nextBar).toBe(0);
	});

	it('rechecks the horizon after registration and keeps callbacks inactive on rollback', () => {
		const h = harness(); let stale!: (time: number) => void;
		vi.mocked(h.runtime.scheduleOnce).mockImplementationOnce((callback) => {
			stale = callback; h.pending.set(1, { callback, tick: 0 }); h.now(10.9); return 1;
		});
		expect(h.renderer.commit(bar(0))).toEqual({ accepted: false, reason: 'deadline' });
		stale(11);
		expect(h.runtime.play).not.toHaveBeenCalled();
		expect(h.pending.size).toBe(0); expect(h.published()).toBeNull();
	});

	it('stop clears only owned events and owned note handles; stale callbacks cannot revive audio', () => {
		const h = harness(); h.renderer.commit(bar(0));
		const first = [...h.pending.values()][0]; first.callback(11);
		h.renderer.commit(bar(1)); const queued = [...h.pending.values()].at(-1)!;
		h.renderer.stop(); h.renderer.stop(); queued.callback(13);
		expect(h.voiceStops[0]).toHaveBeenCalledOnce();
		expect(h.runtime.play).toHaveBeenCalledOnce();
		expect(h.published()).toBeNull();
		expect(h.renderer.snapshot().status).toBe('stopped');
		expect(h.renderer.commit(bar(2))).toEqual({ accepted: false, reason: 'stopped' });
	});

	it('late callbacks produce an underrun rather than an audible burst, removing future evidence', () => {
		const h = harness(); h.renderer.commit(bar(0)); h.renderer.commit(bar(1));
		h.now(11.01); [...h.pending.values()][0].callback(11);
		expect(h.runtime.play).not.toHaveBeenCalled();
		expect(h.renderer.snapshot().status).toBe('underrun');
		expect(h.renderer.snapshot().dispatches.map((d) => d.status)).toEqual(['late', 'cancelled']);
		expect(h.onUnderrun).toHaveBeenCalledOnce();
		expect(h.published()).toBeNull();
	});

	it('rejects foreign checkpoint lineage even when the outer session id matches', () => {
		const h = harness(); const candidate = bar(0);
		(candidate.checkpoint as { sessionId: string }).sessionId = 'another-take';
		expect(h.renderer.commit(candidate)).toEqual({ accepted: false, reason: 'invalid_window' });
		expect(h.pending.size).toBe(0);
	});

	it('restores the previous schedule and callback set if publication throws after assignment', () => {
		const h = harness(); h.renderer.commit(bar(0));
		const previous = h.renderer.snapshot();
		const publish = h.runtime.publishSchedule;
		h.runtime.publishSchedule = vi.fn((schedule) => { publish(schedule); if (schedule !== previous.schedule) throw new Error('publisher failure'); });
		expect(h.renderer.commit(bar(1))).toEqual({ accepted: false, reason: 'schedule_failure' });
		expect(h.published()).toBe(previous.schedule);
		expect(h.renderer.snapshot().nextBar).toBe(1);
		expect(h.pending.size).toBe(1);
	});

	it('rechecks deadline after schedule publication before making callbacks audible', () => {
		const h = harness(); const publish = h.runtime.publishSchedule;
		h.runtime.publishSchedule = vi.fn((schedule) => { publish(schedule); h.now(10.9); });
		expect(h.renderer.commit(bar(0))).toEqual({ accepted: false, reason: 'deadline' });
		expect(h.pending.size).toBe(0); expect(h.published()).toBeNull();
	});

	it('releases a voice returned after a synchronous stop during its trigger', () => {
		const h = harness(); const stopVoice = vi.fn();
		h.runtime.play = vi.fn(() => { h.renderer.stop(); return stopVoice; });
		h.renderer.commit(bar(0)); [...h.pending.values()][0].callback(11);
		expect(stopVoice).toHaveBeenCalledOnce();
		expect(h.renderer.snapshot().dispatches[0].status).toBe('cancelled');
	});
});
