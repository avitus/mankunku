import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackEvent } from '$lib/audio/playback';
import { instrumentVoice, vibratoDelaySwingSeconds } from '$lib/audio/instrument-voices';
import { makePhrase } from '../../helpers/lick-builders';

const audio = vi.hoisted(() => {
	const depth = {
		value: 0,
		cancelScheduledValues: vi.fn(),
		setValueAtTime: vi.fn(),
		linearRampToValueAtTime: vi.fn()
	};
	const node = () => ({ connect() {}, disconnect() {} });
	return {
		depth,
		noteStart: vi.fn(),
		part: null as { callback: (time: number, event: PlaybackEvent) => void; events: PlaybackEvent[] } | null,
		context: {
			createGain: () => ({ ...node(), gain: depth }),
			createDelay: () => ({ ...node(), delayTime: { value: 0 } }),
			createBiquadFilter: () => ({ ...node(), frequency: {}, Q: {} }),
			createOscillator: () => ({ ...node(), frequency: {}, start() {}, stop() {} })
		},
		transport: {
			bpm: { value: 120 }, timeSignature: 4, swing: 0, PPQ: 192, position: 0,
			start() {}, stop() {}, cancel() {}, clear() {}, scheduleOnce: () => 1
		}
	};
});

vi.mock('tone', () => ({
	start: async () => {},
	getTransport: () => audio.transport,
	Part: class {
		constructor(callback: (time: number, event: PlaybackEvent) => void, events: PlaybackEvent[]) {
			audio.part = { callback, events };
		}
		start() {}
		dispose() {}
	}
}));
vi.mock('smplr', () => {
	class Instrument {
		load = Promise.resolve();
		output = { addInsert() {} };
		start = audio.noteStart;
		stop() {}
		disconnect() {}
	}
	return { Sampler: Instrument, Soundfont: Instrument };
});
vi.mock('$lib/audio/audio-context', () => ({
	initAudio: async () => audio.context,
	getMasterGain: () => ({}), setMasterVolume: vi.fn()
}));
vi.mock('$lib/audio/metronome', () => ({
	warmUpMetronome: vi.fn(), disposeMetronome: vi.fn(),
	setMetronomeVolume: vi.fn(), scheduleMetronome: vi.fn()
}));
vi.mock('$lib/audio/backing-track', () => ({
	loadBackingInstruments: vi.fn(), startBackingTrack: vi.fn(),
	scheduleBackingTrack: vi.fn(), disposeBackingParts: vi.fn(),
	disposeBackingTrack: vi.fn(), isBackingLoaded: () => false
}));

afterEach(() => vi.restoreAllMocks());

describe('per-note vibrato playback', () => {
	it.each(['tenor-sax', 'trumpet'])('selects all four shapes on %s, with one draw per tied sounding note', async (instrumentId) => {
		const { loadInstrument, playPhrase, stopPlayback } = await import('$lib/audio/playback');
		await loadInstrument(instrumentId);
		audio.part = null;
		const phrase = makePhrase({
			notes: [
				{ pitch: 60, duration: [1, 2], offset: [0, 1], tied: true },
				{ pitch: 60, duration: [1, 2], offset: [1, 2] }
			]
		});
		const playing = playPhrase(phrase, { tempo: 60, swing: 0.5, countInBeats: 4, metronomeEnabled: false, metronomeVolume: 0 });
		try {
			await vi.waitFor(() => expect(audio.part).not.toBeNull());
			const part = audio.part!;
			expect(part.events).toHaveLength(1);
			const event = part.events[0];
			const voice = instrumentVoice(instrumentId).vibrato;
			const swing = vibratoDelaySwingSeconds(voice.rateHz, voice.depthCents);
			const random = vi.spyOn(Math, 'random');

			for (const [index, draw] of [0.1, 0.3, 0.6, 0.8].entries()) {
				vi.clearAllMocks();
				random.mockReturnValue(draw);
				const time = 10 + index * 10;
				part.callback(time, event);
				expect(random).toHaveBeenCalledOnce();
				expect(audio.noteStart).toHaveBeenCalledOnce();
				expect(audio.depth.cancelScheduledValues).toHaveBeenCalledWith(time);
				if (index === 0) {
					expect(audio.depth.setValueAtTime).toHaveBeenCalledExactlyOnceWith(0, time);
					expect(audio.depth.linearRampToValueAtTime).not.toHaveBeenCalled();
				} else if (index === 1) {
					expect(audio.depth.setValueAtTime).toHaveBeenCalledWith(0, time + 2);
					expect(audio.depth.linearRampToValueAtTime).toHaveBeenCalledWith(expect.closeTo(swing * 0.4, 10), time + 2.22);
				} else if (index === 2) {
					expect(audio.depth.linearRampToValueAtTime).toHaveBeenCalledWith(expect.any(Number), time + event.duration + event.release);
				} else {
					expect(audio.depth.setValueAtTime).toHaveBeenCalledWith(swing * 0.5, time);
					expect(audio.depth.linearRampToValueAtTime).toHaveBeenCalledWith(0, time + event.duration * 0.65);
				}
			}

			// A new straight note interrupts a widening release. Keep the old
			// ramp audible up to that attack, then clear it for the new note.
			random.mockReturnValue(0.6);
			part.callback(50, event);
			vi.clearAllMocks();
			random.mockReturnValue(0.1);
			const nextTime = 50 + event.duration;
			part.callback(nextTime, event);
			expect(audio.depth.linearRampToValueAtTime).toHaveBeenCalledExactlyOnceWith(expect.any(Number), nextTime);
			expect(audio.depth.linearRampToValueAtTime.mock.calls[0][0]).toBeGreaterThan(0);
			expect(audio.depth.setValueAtTime).toHaveBeenCalledExactlyOnceWith(0, nextTime);
		} finally {
			await stopPlayback();
			await playing;
		}
	});
});
