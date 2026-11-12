import { describe, expect, it, vi } from 'vitest';
import { createRollingBacking, advanceRollingBacking } from '$lib/audio/backing-rolling';
import { createRollingBackingRenderer, type RollingBackingRuntime } from '$lib/audio/backing-rolling-renderer';
import { createRollingSession } from '$lib/audio/backing-rolling-session';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import type { BackingTrackSchedule } from '$lib/audio/backing-track-schedule';
import { createSoloObserver, type SoloObservationWindow } from '$lib/audio/solo-observer';

interface AudioSurface { owner: symbol | null; schedule: BackingTrackSchedule | null }

function harness(surface: AudioSurface = { owner: null, schedule: null }) {
	const preset = BACKING_LAB_PRESETS.find((value) => value.bars === 4)!;
	const definition = createRollingBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
		phraseId: 'loop-session', tempo: 240, ppq: 192, beatsPerBar: 4, swing: 0.67,
		performanceForm: preset.phrase.performanceForm, ensemble: {}
	}, { loopCount: 2 });
	const startAudioTime = 10.5;
	let now = 10;
	let measured = 0;
	let id = 0;
	const owner = Symbol('playback-owner');
	surface.owner = owner;
	const pending = new Map<number, { callback: (time: number) => void; audioTime: number }>();
	const voiceStops: ReturnType<typeof vi.fn>[] = [];
	const runtime: RollingBackingRuntime = {
		audioNow: () => now, lookAhead: () => 0.1, updateInterval: () => 0.025, isCurrent: () => surface.owner === owner,
		scheduleOnce: vi.fn((callback, ticks) => {
			const eventId = ++id;
			pending.set(eventId, { callback, audioTime: startAudioTime + parseInt(ticks, 10) / 768 });
			return eventId;
		}),
		clear: vi.fn((eventId) => { pending.delete(eventId); }),
		play: vi.fn(() => { const release = vi.fn(); voiceStops.push(release); return release; }),
		publishSchedule: vi.fn((value) => { surface.schedule = value; })
	};
	const renderer = createRollingBackingRenderer({ sessionId: definition.sessionId, tempo: definition.tempo,
		ppq: definition.ppq, totalBars: definition.totalBars, startAudioTime }, runtime);
	const onError = vi.fn();
	const onComplete = vi.fn();
	const generate = vi.fn(advanceRollingBacking);
	const session = createRollingSession({ definition, renderer, startAudioTime, observationSessionId: 'microphone-take',
		generate, measureNow: () => measured += 0.001, onError, onComplete });
	function advanceTo(relativeTime: number): void {
		const target = startAudioTime + relativeTime;
		while (now < target - 1e-9) {
			now = Math.min(target, now + 0.02);
			for (const [eventId, event] of [...pending].sort(([, a], [, b]) => a.audioTime - b.audioTime)) {
				if (event.audioTime > now + 0.1) break;
				pending.delete(eventId);
				event.callback(event.audioTime);
			}
			session.pump();
		}
	}
	return { definition, session, renderer, runtime, pending, voiceStops, generate, onError, onComplete, surface,
		advanceTo, jumpTo(relativeTime: number) { now = startAudioTime + relativeTime; }, published: () => surface.schedule };
}

function observation(barIndex: number, availableAtSeconds: number): SoloObservationWindow {
	return { version: 1, sessionId: 'microphone-take', source: 'microphone', barIndex,
		startSeconds: barIndex, endSeconds: barIndex + 1, availableAtSeconds,
		feature: { barIndex: Math.ceil(availableAtSeconds), observedAtBar: Math.floor(availableAtSeconds),
			source: 'microphone', confidence: 1, noteDensity: 1, restBeats: 0 } } as SoloObservationWindow;
}

describe('finite cross-loop rolling lifecycle', () => {
	it('keeps one clock, checkpoint chain and exact non-wrapped schedule through the seam', () => {
		const h = harness();
		expect(h.definition.totalBars).toBe(8);
		h.session.start();
		h.advanceTo(4.02);
		expect(h.session.snapshot().status).toBe('running');
		expect(h.renderer.snapshot().status).toBe('active');
		expect(h.onComplete).not.toHaveBeenCalled();
		expect(h.runtime.clear).not.toHaveBeenCalled();
		expect(h.voiceStops.every((release) => release.mock.calls.length === 0)).toBe(true);
		const seam = h.renderer.snapshot();
		expect(seam.windows.map((window) => window.fromBar)).toEqual([0, 1, 2, 3, 4]);
		for (let bar = 1; bar < seam.windows.length; bar++) {
			expect(seam.windows[bar].previousCheckpointId).toBe(seam.windows[bar - 1].checkpoint.checkpointId);
		}
		expect(seam.windows[4].checkpoint.ensemble.performance.barsPlanned).toBe(5);
		expect(seam.windows[4].startTick).toBe(4 * 768);
		expect(h.published()!.loopSeconds).toBeNull();
		expect(h.published()!.notes).toEqual([
			...seam.generated.bassEvents.map((event) => ({ midi: event.midi, startSeconds: parseInt(event.time, 10) * (1 / 768), durationSeconds: event.duration, source: 'bass' })),
			...seam.generated.compEvents.flatMap((event) => event.notes.map((midi) => ({ midi, startSeconds: parseInt(event.time, 10) * (1 / 768), durationSeconds: event.duration, source: 'comp' })))
		].sort((a, b) => a.startSeconds - b.startSeconds));
		expect(h.published()!.activeMidiAt(8.2, 0)).toEqual([]);
		h.advanceTo(8.02);
		expect(h.session.snapshot().status).toBe('complete');
		expect(h.onComplete).toHaveBeenCalledOnce();
		expect(h.onError).not.toHaveBeenCalled();
		expect(h.generate).toHaveBeenCalledTimes(8);
		expect(h.renderer.snapshot().dispatches.every((entry) => entry.status === 'played')).toBe(true);
		expect(h.voiceStops.every((release) => release.mock.calls.length === 1)).toBe(true);
		expect(h.pending.size).toBe(0);
		expect(h.published()).toBeNull();
		expect(seam.windows).toHaveLength(5);
	});

	it('uses absolute observation coordinates across loops without rewriting the committed prefix', () => {
		const h = harness();
		expect(h.definition.totalBars).toBe(8);
		h.session.start(); h.advanceTo(3.02);
		const prefix = JSON.stringify(h.renderer.snapshot().windows);
		const lastLoopEvidence = observation(2, 3.02);
		expect(h.session.observe(lastLoopEvidence)).toBe(true);
		h.advanceTo(4.02);
		const arrival = h.renderer.snapshot().windows[4];
		expect(arrival.ensemblePlan.trace[0].soloEvidence).toBe('active');
		expect(arrival.compEvents).toHaveLength(0);
		expect(arrival.drumEvents.some((event) => event.role === 'commentary')).toBe(false);
		expect(arrival.bassEvents.length).toBeGreaterThan(0);
		expect(JSON.stringify(h.renderer.snapshot().windows.slice(0, 4))).toBe(prefix);
		// A later missing-input window must not masquerade as a rest or
		// renew the availability of the preceding loop's activity.
		const missing = { ...observation(3, 4.02), feature: undefined };
		expect(h.session.observe(missing)).toBe(false);
		h.advanceTo(4.82);
		expect(h.renderer.snapshot().windows[5].ensemblePlan.trace[0].soloEvidence).toBe('stale');
		h.advanceTo(5.02);
		expect(h.session.observe(lastLoopEvidence)).toBe(false);
		expect(h.session.observe(observation(4, 5.02))).toBe(true);
		h.advanceTo(5.82);
		expect(h.renderer.snapshot().windows[6].ensemblePlan.trace[0].soloEvidence).toBe('active');
		expect(h.session.snapshot().receipts.map((receipt) => [receipt.windowBar, receipt.feature.barIndex, receipt.feature.observedAtBar]))
			.toEqual([[2, 4, 3], [4, 6, 5]]);
		h.session.stop();
	});

	it('keeps the first loop\'s final observed bar available for an uncommitted second-loop response', () => {
		const h = harness();
		expect(h.definition.totalBars).toBe(8);
		h.session.start(); h.advanceTo(4.02);
		const prefix = JSON.stringify(h.renderer.snapshot().windows);
		const observer = createSoloObserver({ sessionId: 'microphone-take', tempo: 240, beatsPerBar: 4, totalBars: h.definition.totalBars });
		for (let frame = 0; frame <= 201; frame++) {
			// Animation frames do not arrive on exact bar boundaries.
			const time = frame / 50 + 0.007;
			observer.push({ timeSeconds: time, availableAtSeconds: time, rms: 0, midi: null, clarity: 0,
				inputAvailable: true, backingMidi: [], nearBackingTransient: false });
		}
		const completed = observer.snapshot().at(-1)!;
		expect(completed.barIndex).toBe(3);
		expect(completed.feature).toMatchObject({ barIndex: 5, observedAtBar: 4 });
		expect(completed.feature!.restBeats).toBeGreaterThan(4);
		expect(h.session.observe(completed)).toBe(true);
		h.advanceTo(4.82);
		expect(h.renderer.snapshot().windows[5].ensemblePlan.trace[0].soloEvidence).toBe('resting');
		expect(JSON.stringify(h.renderer.snapshot().windows.slice(0, 5))).toBe(prefix);
		expect(h.session.observe(completed)).toBe(false);
		h.session.stop();
	});

	it('cancels seam callbacks and releases owned voices when stopped before the next loop', () => {
		const h = harness();
		expect(h.definition.totalBars).toBe(8);
		h.session.start(); h.advanceTo(3.82);
		const stale = [...h.pending.values()];
		expect(stale.some((event) => event.audioTime >= 14.5)).toBe(true);
		const played = vi.mocked(h.runtime.play).mock.calls.length;
		h.session.stop(); h.session.stop();
		const stopped = h.renderer.snapshot();
		expect(stopped.dispatches.some((entry) => entry.status === 'cancelled')).toBe(true);
		expect(h.voiceStops.every((release) => release.mock.calls.length === 1)).toBe(true);
		expect(h.pending.size).toBe(0);
		const restarted = harness(h.surface); restarted.session.start();
		const nextSchedule = restarted.published();
		for (const event of stale) event.callback(event.audioTime);
		h.session.start(); h.session.pump();
		expect(h.session.observe(observation(3, 4.02))).toBe(false);
		expect(h.session.snapshot().status).toBe('stopped');
		expect(h.runtime.play).toHaveBeenCalledTimes(played);
		expect(restarted.published()).toBe(nextSchedule);
		expect(restarted.renderer.snapshot().status).toBe('active');
		expect(restarted.renderer.snapshot().windows[0].previousCheckpointId).toBeNull();
		restarted.session.stop();
	});

	it('fails a missed loop-boundary deadline instead of restarting or filling the gap', () => {
		const h = harness();
		expect(h.definition.totalBars).toBe(8);
		h.session.start(); h.advanceTo(3.02);
		expect(h.renderer.snapshot().nextBar).toBe(4);
		h.jumpTo(4.02); h.session.pump();
		expect(h.session.snapshot()).toMatchObject({ status: 'failed', nextBar: 4, error: 'deadline' });
		expect(h.generate).toHaveBeenCalledTimes(4);
		expect(h.onComplete).not.toHaveBeenCalled();
		expect(h.onError).toHaveBeenCalledWith('deadline');
		expect(h.pending.size).toBe(0);
		expect(h.published()).toBeNull();
	});
});
