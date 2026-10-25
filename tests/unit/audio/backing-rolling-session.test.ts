import { describe, expect, it, vi } from 'vitest';
import { createRollingSession } from '$lib/audio/backing-rolling-session';
import type { RollingBackingBar, RollingBackingDefinition } from '$lib/audio/backing-rolling';
import { createSoloObserver, type SoloObservationWindow } from '$lib/audio/solo-observer';

function harness(releaseTailSeconds?: number) {
	let audioNow = 10;
	let measured = 0;
	const definition = { sessionId: 'score', tempo: 240, ppq: 192, beatsPerBar: 4, totalBars: 8 } as RollingBackingDefinition;
	const renderer = { horizon: () => ({ audioNow, dispatchThrough: audioNow + 0.14, renderSafeFrom: audioNow + 0.165 }), commit: vi.fn((_bar: RollingBackingBar) => ({ accepted: true })), snapshot: vi.fn(() => ({ status: 'active', dispatches: [{ status: 'played' }] })), stop: vi.fn() };
	const generate = vi.fn((_definition, checkpoint, _features) => {
		const fromBar = checkpoint?.nextBar ?? 0;
		return { fromBar, toBarExclusive: fromBar + 1, checkpoint: { nextBar: fromBar + 1 } } as RollingBackingBar;
	});
	const onError = vi.fn(); const onComplete = vi.fn();
	const session = createRollingSession({ definition, renderer, generate, startAudioTime: 10.5, observationSessionId: 'take',
		releaseTailSeconds, measureNow: () => measured += 0.001, onError, onComplete });
	return { session, renderer, generate, onError, onComplete, time(value: number) { audioNow = value; } };
}
function observation(barIndex = 0, availableAtSeconds = 1.02): SoloObservationWindow {
	return { version: 1, sessionId: 'take', source: 'microphone', barIndex, startSeconds: barIndex, endSeconds: barIndex + 1, availableAtSeconds,
		feature: { barIndex: Math.ceil(availableAtSeconds), observedAtBar: Math.floor(availableAtSeconds), source: 'microphone', confidence: 1, noteDensity: 0.9, restBeats: 0 } } as SoloObservationWindow;
}

describe('rolling session clock and evidence', () => {
	it('primes two bars, then uses freshly completed evidence only when the next bar becomes due', () => {
		const h = harness(); h.session.start();
		expect(h.generate).toHaveBeenCalledTimes(2);
		h.time(11.53); expect(h.session.observe(observation())).toBe(true);
		h.session.pump(); expect(h.generate).toHaveBeenCalledTimes(2);
		h.time(12.28); h.session.pump();
		expect(h.generate).toHaveBeenCalledTimes(3);
		expect(h.generate.mock.calls[2][2]).toEqual([observation().feature]);
		h.session.pump(); expect(h.generate).toHaveBeenCalledTimes(3);
		expect(h.renderer.commit.mock.calls[0][0].fromBar).toBe(0);
	});
	it('rejects foreign, future and duplicated observations without restamping stale evidence', () => {
		const h = harness(); h.session.start();
		expect(h.session.observe(observation())).toBe(false);
		h.time(11.53);
		expect(h.session.observe({ ...observation(), sessionId: 'old-take' })).toBe(false);
		expect(h.session.observe(observation())).toBe(true);
		expect(h.session.observe(observation())).toBe(false);
		h.time(12.28); h.session.pump(); h.time(13.28); h.session.pump();
		expect(h.generate.mock.calls[3][2][0]).toEqual(observation().feature);
	});
	it('stops on a missed scheduling horizon instead of playing a late catch-up burst', () => {
		const h = harness(); h.session.start(); h.time(12.5); h.session.pump();
		expect(h.generate).toHaveBeenCalledTimes(2);
		expect(h.renderer.stop).toHaveBeenCalledOnce();
		expect(h.onError).toHaveBeenCalledWith('deadline');
		h.session.pump(); expect(h.generate).toHaveBeenCalledTimes(2);
	});
	it('accepts continuous multi-bar rests from the real observer without capping them to one bar', () => {
		const h = harness(); h.session.start();
		const observer = createSoloObserver({ sessionId: 'take', tempo: 240, beatsPerBar: 4, totalBars: 8 });
		for (let frame = 0; frame <= 102; frame++) observer.push({ timeSeconds: frame / 50, availableAtSeconds: frame / 50,
			rms: 0, midi: null, clarity: 0, inputAvailable: true, backingMidi: [], nearBackingTransient: false });
		const second = observer.snapshot()[1];
		expect(second.feature!.restBeats).toBeGreaterThan(4);
		h.time(12.55); expect(h.session.observe(second)).toBe(true);
		expect(h.session.snapshot().receipts[0].feature.restBeats).toBe(second.feature!.restBeats);
	});
	it('releases the take when the audio context clock becomes unavailable', () => {
		const h = harness(); h.session.start();
		h.renderer.horizon = () => { throw new Error('suspended'); };
		expect(() => h.session.pump()).not.toThrow();
		expect(h.onError).toHaveBeenCalledWith('audio_clock');
		expect(h.renderer.stop).toHaveBeenCalledOnce();
		expect(h.session.observe(observation())).toBe(false);
	});
	it('does not advance a rejected batch or restart after stop', () => {
		const h = harness(); h.renderer.commit.mockReturnValueOnce({ accepted: false }); h.session.start();
		expect(h.session.snapshot().nextBar).toBe(0);
		expect(h.generate).toHaveBeenCalledOnce();
		h.session.start(); h.session.pump(); expect(h.generate).toHaveBeenCalledOnce();
	});
	it('never marks a stalled final bar complete while callbacks remain undispatched', () => {
		const h = harness(); h.session.start();
		for (let bar = 2; bar < 8; bar++) { h.time(10.5 + bar - 0.22); h.session.pump(); }
		h.renderer.snapshot.mockReturnValue({ status: 'active', dispatches: [{ status: 'scheduled' }] });
		h.time(18.5); h.session.pump();
		expect(h.onComplete).not.toHaveBeenCalled();
		expect(h.onError).toHaveBeenCalledWith('incomplete_playback');
		expect(h.session.snapshot().status).toBe('failed');
	});
	it('completes at the actual form end and releases ownership exactly once', () => {
		const h = harness(); h.session.start();
		for (let bar = 2; bar < 8; bar++) { h.time(10.5 + bar - 0.22); h.session.pump(); }
		expect(h.generate).toHaveBeenCalledTimes(8);
		expect(h.onComplete).not.toHaveBeenCalled();
		h.time(18.5); h.session.pump(); h.session.pump();
		expect(h.onComplete).toHaveBeenCalledOnce();
		expect(h.renderer.stop).toHaveBeenCalledOnce();
	});
	it('lets a fully dispatched finite take ring through its optional audio-clock release tail', () => {
		const h = harness(2.5); h.session.start();
		for (let bar = 2; bar < 8; bar++) { h.time(10.5 + bar - 0.22); h.session.pump(); }
		h.time(18.5); h.session.pump();
		expect(h.session.snapshot().status).toBe('running');
		expect(h.renderer.stop).not.toHaveBeenCalled();
		expect(h.onComplete).not.toHaveBeenCalled();
		h.time(20.99); h.session.pump(); h.session.pump();
		expect(h.generate).toHaveBeenCalledTimes(8);
		expect(h.renderer.stop).not.toHaveBeenCalled();
		h.time(21); h.session.pump(); h.session.pump();
		expect(h.onComplete).toHaveBeenCalledOnce();
		expect(h.renderer.stop).toHaveBeenCalledOnce();
	});
	it('rejects an incomplete final dispatch immediately rather than hiding it inside the release tail', () => {
		const h = harness(2.5); h.session.start();
		for (let bar = 2; bar < 8; bar++) { h.time(10.5 + bar - 0.22); h.session.pump(); }
		h.renderer.snapshot.mockReturnValue({ status: 'active', dispatches: [{ status: 'scheduled' }] });
		h.time(18.5); h.session.pump();
		expect(h.onError).toHaveBeenCalledWith('incomplete_playback');
		expect(h.renderer.stop).toHaveBeenCalledOnce();
		h.time(21); h.session.pump();
		expect(h.onComplete).not.toHaveBeenCalled();
	});
	it('stops promptly on cancellation or a suspended audio context during the release tail', () => {
		for (const suspend of [false, true]) {
			const h = harness(2.5); h.session.start();
			for (let bar = 2; bar < 8; bar++) { h.time(10.5 + bar - 0.22); h.session.pump(); }
			h.time(18.5); h.session.pump();
			if (suspend) {
				h.renderer.horizon = () => { throw new Error('suspended'); };
				h.session.pump();
				expect(h.onError).toHaveBeenCalledWith('audio_clock');
			} else h.session.stop();
			expect(h.renderer.stop).toHaveBeenCalledOnce();
			h.time(21); h.session.pump(); h.session.stop();
			expect(h.renderer.stop).toHaveBeenCalledOnce();
			expect(h.onComplete).not.toHaveBeenCalled();
		}
	});
	it('bounds the optional release tail without changing the zero-tail diagnostics default', () => {
		for (const seconds of [-1, NaN, Infinity, 5.01]) expect(() => harness(seconds)).toThrow(/release tail/);
		for (const seconds of [0, 2.5, 5]) expect(() => harness(seconds)).not.toThrow();
	});
});
