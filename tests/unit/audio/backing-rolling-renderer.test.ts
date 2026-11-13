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
 it('forgets naturally completed native handles while retaining cancellation of future batches', () => {
  const h = harness(), stops: ReturnType<typeof vi.fn>[] = [], ends: (() => void)[] = [];
  h.runtime.arm = vi.fn((_hits, _time, _key, onEnded) => {
   const stop = vi.fn(); stops.push(stop); ends.push(onEnded!); return stop;
  });
  expect(h.renderer.commit(bar(0)).accepted).toBe(true);
  expect(h.renderer.commit(bar(1)).accepted).toBe(true);
  const played = h.renderer.snapshot();
  h.now(11.5); ends[0]();
  expect(h.renderer.snapshot()).toBe(played);
  h.renderer.stop();
  expect(stops[0]).not.toHaveBeenCalled();
  expect(stops[1]).toHaveBeenCalledOnce();
  expect(h.renderer.snapshot().dispatches.map(d => d.status)).toEqual(['played', 'cancelled']);
  expect(played.dispatches.map(d => d.status)).toEqual(['played', 'played']);
 });

 it('does not retain a native batch that completes during arming', () => {
  const h = harness(), stop = vi.fn();
  h.runtime.arm = vi.fn((_hits, _time, _key, onEnded) => { onEnded!(); return stop; });
  expect(h.renderer.commit(bar(0)).accepted).toBe(true);
  h.renderer.stop();
  expect(stop).not.toHaveBeenCalled();
 });

	it('reuses immutable snapshots between changes and unchanged rows across later dispatch transitions', () => {
		const h = harness();
		const empty = h.renderer.snapshot();
		expect(h.renderer.snapshot()).toBe(empty);
		h.renderer.commit(bar(0)); h.renderer.commit(bar(1));
		const scheduled = h.renderer.snapshot();
		expect(scheduled).not.toBe(empty);
		expect(h.renderer.snapshot()).toBe(scheduled);
		const callbacks = [...h.pending.values()];
		callbacks[0].callback(11);
		const played = h.renderer.snapshot();
		expect(played).not.toBe(scheduled);
		expect(played.dispatches[0]).not.toBe(scheduled.dispatches[0]);
		expect(played.dispatches[1]).toBe(scheduled.dispatches[1]);
		expect(scheduled.dispatches.map(entry => entry.status)).toEqual(['scheduled', 'scheduled']);
		expect(played.dispatches.map(entry => entry.status)).toEqual(['played', 'scheduled']);
		expect(played.dispatches.every(entry => !('diagnostic' in entry))).toBe(true);
		expect(Object.isFrozen(played.dispatches[0])).toBe(true);
		h.now(11.5); // The first batch has sounded; the second is still future.
		h.renderer.stop();
		const stopped = h.renderer.snapshot();
		expect(stopped.status).toBe('stopped');
		expect(stopped.schedule).toBeNull();
		expect(stopped.dispatches[0]).toBe(played.dispatches[0]);
		expect(stopped.dispatches[1].status).toBe('cancelled');
		expect(stopped.dispatches[1]).not.toHaveProperty('diagnostic');
		expect(played.dispatches[1].status).toBe('scheduled');
		h.renderer.stop(); callbacks[1].callback(13);
		expect(h.renderer.snapshot()).toBe(stopped);
	});

	it('keeps cached evidence unchanged through rejected commits and publication rollback', () => {
		const h = harness(); h.renderer.commit(bar(0));
		const previous = h.renderer.snapshot();
		expect(h.renderer.commit(bar(2)).accepted).toBe(false);
		expect(h.renderer.snapshot()).toBe(previous);
		const publish = h.runtime.publishSchedule;
		h.runtime.publishSchedule = vi.fn(schedule => {
			publish(schedule);
			expect(h.renderer.snapshot()).toBe(previous);
			if (schedule !== previous.schedule) throw new Error('publisher failure');
		});
		expect(h.renderer.commit(bar(1))).toEqual({ accepted: false, reason: 'schedule_failure' });
		expect(h.renderer.snapshot()).toBe(previous);
		expect(h.published()).toBe(previous.schedule);
	});

	it('invalidates reentrant stop snapshots when the triggering batch is subsequently cancelled', () => {
		const h = harness(); let duringStop: ReturnType<typeof h.renderer.snapshot> | undefined;
		h.runtime.play = vi.fn(() => {
			h.renderer.stop(); duringStop = h.renderer.snapshot(); return vi.fn();
		});
		h.renderer.commit(bar(0)); [...h.pending.values()][0].callback(11);
		expect(duringStop!.dispatches[0].status).toBe('scheduled');
		const after = h.renderer.snapshot();
		expect(after).not.toBe(duringStop);
		expect(after.dispatches[0].status).toBe('cancelled');
		expect(h.renderer.snapshot()).toBe(after);
	});

	it.each([
		{ observed: 11.01, callback: 11, reason: 'late_callback' },
		{ observed: NaN, callback: 11, reason: 'nonfinite_clock' },
		{ observed: 10.9, callback: Infinity, reason: 'nonfinite_callback_time' },
		{ observed: 10.9, callback: 11.1, reason: 'callback_time_mismatch' }
	])('captures finite immutable $reason evidence without playing a rejected callback', ({ observed, callback, reason }) => {
		const h = harness(); h.renderer.commit(bar(0)); h.renderer.commit(bar(1));
		const previous = h.renderer.snapshot();
		h.now(observed); [...h.pending.values()][0].callback(callback);
		const failed = h.renderer.snapshot();
		const diagnostic = failed.dispatches[0].diagnostic!;
		expect(failed.status).toBe('underrun');
		expect(failed.dispatches.map(entry => entry.status)).toEqual(['late', 'cancelled']);
		expect(diagnostic.reason).toBe(reason);
		expect(diagnostic.targetAudioTime).toBe(11);
		if (Number.isFinite(observed)) {
			expect(diagnostic.observedAudioTime).toBe(observed);
			expect(diagnostic.latenessSeconds).toBeCloseTo(Math.max(0, observed - 11), 10);
		} else {
			expect(diagnostic).not.toHaveProperty('observedAudioTime');
			expect(diagnostic).not.toHaveProperty('latenessSeconds');
		}
		if (Number.isFinite(callback)) expect(diagnostic.callbackAudioTime).toBe(callback);
		else expect(diagnostic).not.toHaveProperty('callbackAudioTime');
		expect(JSON.parse(JSON.stringify(diagnostic))).toEqual(diagnostic);
		expect(Object.isFrozen(diagnostic)).toBe(true);
		expect(previous.dispatches[0]).not.toHaveProperty('diagnostic');
		expect(previous.dispatches[0].status).toBe('scheduled');
		expect(failed.dispatches[1]).not.toHaveProperty('diagnostic');
		expect(h.renderer.snapshot()).toBe(failed);
		expect(h.runtime.play).not.toHaveBeenCalled();
		expect(h.published()).toBeNull();
	});

	it.each(['audio_clock_unavailable', 'play_failure'] as const)('records $0 without inventing an unavailable clock', reason => {
		const h = harness(); h.renderer.commit(bar(0));
		if (reason === 'audio_clock_unavailable') h.runtime.audioNow = () => { throw new Error('closed context'); };
		else h.runtime.play = vi.fn(() => { throw new Error('sample failure'); });
		[...h.pending.values()][0].callback(11);
		const row = h.renderer.snapshot().dispatches[0];
		expect(row.status).toBe('failed');
		expect(row.diagnostic).toMatchObject({ reason, targetAudioTime: 11, callbackAudioTime: 11 });
		if (reason === 'audio_clock_unavailable') expect(row.diagnostic).not.toHaveProperty('observedAudioTime');
		else expect(row.diagnostic).toMatchObject({ observedAudioTime: 10, latenessSeconds: 0 });
		expect(Object.isFrozen(row.diagnostic)).toBe(true);
		expect(JSON.parse(JSON.stringify(row.diagnostic))).toEqual(row.diagnostic);
	});

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
		expect(h.renderer.commit(bar(0), { renderStartedAt: 10, renderElapsedSeconds: -0.001 })).toEqual({ accepted: false, reason: 'compute_budget' });
		expect(h.renderer.commit(bar(0), { renderStartedAt: 10.5, renderElapsedSeconds: 0.001 })).toEqual({ accepted: false, reason: 'compute_budget' });
		h.now(10.9);
		expect(h.renderer.commit(bar(0))).toEqual({ accepted: false, reason: 'deadline' });
		expect(h.pending.size).toBe(0);
		expect(h.published()).toBeNull();
		expect(h.renderer.snapshot().nextBar).toBe(0);
	});

	// The harness dispatches 0.135 s ahead (lookahead .1 + interval .025 + safety .01)
	// and bar 0 sounds at 11. These pin the rule that replaced the fixed 25 ms
	// generation cap (2026-11-12): lead decides, on whichever clock saw the time pass.
	describe('a slow bar is judged by the lead it left', () => {
		function native(h: ReturnType<typeof harness>) {
			const armed: number[] = [];
			h.runtime.arm = vi.fn((_hits, time) => { armed.push(time); return vi.fn(); });
			return armed;
		}

		it('accepts a 30 ms generation with a second of lead and arms every note at its written time', () => {
			const h = harness(), armed = native(h);
			expect(h.renderer.commit(bar(0), { renderStartedAt: 10, renderElapsedSeconds: 0.03 }).accepted).toBe(true);
			expect(armed).toEqual([11]);
			expect(h.renderer.snapshot().dispatches).toEqual([{ tick: 0, audioTime: 11, status: 'played' }]);
		});

		it('refuses a bar whose generation used up the lead while the audio clock stood still', () => {
			// 65 ms of lead on the audio clock, which has not moved since generation
			// began; the wall clock says 70 ms passed, so the bar is really 5 ms late.
			const h = harness(), armed = native(h);
			h.now(10.8);
			expect(h.renderer.commit(bar(0), { renderStartedAt: 10.8, renderElapsedSeconds: 0.07 })).toEqual({ accepted: false, reason: 'deadline' });
			expect(armed).toEqual([]);
			expect(h.published()).toBeNull();
			expect(h.renderer.snapshot().nextBar).toBe(0);
			// 60 ms leaves 5 ms to spare.
			expect(h.renderer.commit(bar(0), { renderStartedAt: 10.8, renderElapsedSeconds: 0.06 }).accepted).toBe(true);
			expect(armed).toEqual([11]);
		});

		it('does not charge the generation time twice when the audio clock kept running', () => {
			const h = harness(), armed = native(h);
			h.now(10.8);
			expect(h.renderer.commit(bar(0), { renderStartedAt: 10.7, renderElapsedSeconds: 0.1 }).accepted).toBe(true);
			expect(armed).toEqual([11]);
		});

		it('never arms a note with less than the dispatch lead, however the two clocks disagree', () => {
			let seed = 20261112;
			const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
			let accepted = 0, refused = 0;
			for (let trial = 0; trial < 4000; trial++) {
				const h = harness(), armed = native(h);
				const started = 10 + random() * 0.95;
				const elapsed = random() * 0.4;
				// The audio clock shows anything from none to all of the elapsed time.
				const observed = started + elapsed * (random() < 0.3 ? 0 : random() < 0.5 ? 1 : random());
				h.now(observed);
				const result = h.renderer.commit(bar(0), { renderStartedAt: started, renderElapsedSeconds: elapsed });
				const trueNow = Math.max(observed, started + elapsed);
				if (result.accepted) {
					accepted++;
					expect(armed).toEqual([11]);
					expect(11 - trueNow).toBeGreaterThan(0.135 - 1e-9);
				} else {
					refused++;
					expect(result.reason).toBe('deadline');
					expect(armed).toEqual([]);
					// Nothing with real lead to spare is turned away.
					expect(11 - trueNow).toBeLessThanOrEqual(0.135 + 1e-9);
				}
			}
			expect(accepted).toBeGreaterThan(500);
			expect(refused).toBeGreaterThan(500);
		});
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

it('still reports an underrun when clearing the published schedule throws', () => {
 const h = harness(); h.renderer.commit(bar(0));
 h.runtime.publishSchedule = vi.fn(() => { throw new Error('publisher unavailable'); });
 h.now(11.01);
 expect(() => [...h.pending.values()][0].callback(11)).not.toThrow();
 expect(h.onUnderrun).toHaveBeenCalledOnce();
 expect(h.renderer.snapshot().status).toBe('underrun');
});

it('marks a legacy future dispatch cancelled when stopped before it can sound', () => {
 const h = harness(); h.renderer.commit(bar(0));
 h.now(10.95); [...h.pending.values()][0].callback(11);
 expect(h.renderer.snapshot().dispatches[0].status).toBe('played');
 h.renderer.stop();
 expect(h.voiceStops[0]).toHaveBeenCalledOnce();
 expect(h.renderer.snapshot().dispatches[0].status).toBe('cancelled');
});
