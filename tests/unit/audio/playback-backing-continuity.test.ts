import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Phrase } from '$lib/types/music';
import type { PlaybackOptions } from '$lib/types/audio';
import { createHeadlessTransport } from '../../helpers/headless-tone';
import { guardTickRedelivery } from '$lib/audio/tick-redelivery';

// Real Tone clock and real backing generation; only sample rendering is inert.
const hits: { voice: string; note: unknown; time: number }[] = [];
beforeAll(() => vi.stubGlobal('cancelAnimationFrame', () => {}));
afterAll(() => vi.unstubAllGlobals());
vi.mock('smplr', () => {
	class Instrument {
		load = Promise.resolve();
		output = { addInsert() {} };
		start(hit: { note: unknown; time: number }) {
			hits.push({ voice: this.constructor.name, note: hit.note, time: hit.time });
		}
		stop() {}
		disconnect() {}
	}
	return {
		Soundfont: class Soundfont extends Instrument {},
		Smolken: class Smolken extends Instrument {},
		SplendidGrandPiano: class SplendidGrandPiano extends Instrument {},
		Sampler: class Sampler extends Instrument {},
		CacheStorage: class {}
	};
});
vi.mock('$lib/audio/metronome', () => ({
	warmUpMetronome() {}, disposeMetronome() {}
}));
vi.mock('$lib/audio/audio-context', async () => {
	const { fakeAudioContext } = await import('../../helpers/fake-audio-context');
	const param = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} });
	const node = () => ({ connect() {}, disconnect() {} });
	const ctx = {
		...fakeAudioContext(),
		createGain: () => ({ ...node(), gain: param() }),
		createBiquadFilter: () => ({ ...node(), frequency: param(), Q: param() }),
		createDelay: () => ({ ...node(), delayTime: param() }),
		createOscillator: () => ({ ...node(), frequency: param(), start() {}, stop() {} })
	};
	return { initAudio: async () => ctx, getAudioContext: () => ctx, getMasterGain: node, setMasterVolume() {} };
});

const phrase: Phrase = {
	id: 'ear-training-continuity', name: 'One-bar call', timeSignature: [4, 4], key: 'C',
	notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }],
	harmony: [{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }],
	difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
	category: 'bebop-lines', tags: [], source: 'curated'
};
const options: PlaybackOptions = {
	tempo: 120, swing: 0.5, countInBeats: 0, metronomeEnabled: false,
	metronomeVolume: 0.5, backingTrackEnabled: true, backingInstrument: 'piano'
};

/** Compare a retry's band against the same vamp left running without a handoff. */
async function runSession(continuation: 'none' | 'retry' | 'stop' | 'disabled') {
	const h = await createHeadlessTransport({ sampleRate: 48000, bpm: 120, startQuantum: 1 });
	h.Tone.setContext(h.context);
	guardTickRedelivery(h.transport);
	const playback = await import('$lib/audio/playback');
	const backing = await import('$lib/audio/backing-track');
	try {
		await playback.loadInstrument('trumpet', 1, 'piano');
		const started = vi.fn();
		const first = playback.playPhrase(phrase, options, true, { resolveAtMelodyEnd: true, onStarted: started });
		await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
		hits.length = 0;
		h.run(3.3); // Call has ended; band is still playing during the response.
		await first;
		let next: Promise<void> | undefined;
		if (continuation !== 'none') {
			started.mockClear();
			next = playback.scheduleNextPhrase(phrase, {
				...options, backingTrackEnabled: continuation !== 'disabled'
			}, { resolveAtMelodyEnd: true, onStarted: started });
			await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
		}
		const beforeStop = hits.length;
		if (continuation === 'stop') await playback.stopPlayback();
		h.run(4);
		await next;
		if (continuation === 'retry') {
			// A later retry also reclaims the first outgoing band. It must not
			// cut the currently playing one or leave an older loop sounding.
			started.mockClear();
			next = playback.scheduleNextPhrase(phrase, options, { resolveAtMelodyEnd: true, onStarted: started });
			await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
		}
		h.run(3);
		await next;
		const after = hits.slice(beforeStop).filter(hit => hit.voice !== 'Soundfont');
		const band = hits.filter(hit => hit.voice !== 'Soundfont').map(hit => ({
			...hit, time: Math.round(hit.time * 1e6) / 1e6
		}));
		return { band, after };
	} finally {
		await playback.stopPlayback();
		backing.disposeBackingTrack();
		h.context.dispose();
	}
}

describe('ear-training backing continuity', () => {
	it('keeps every bass, comp and drum attack through successive retry downbeats', async () => {
		const uninterrupted = await runSession('none');
		const retry = await runSession('retry');
		expect(uninterrupted.band.length).toBeGreaterThan(30);
		expect(retry.band).toEqual(uninterrupted.band);
	});

	it('stops both the outgoing vamp and the queued band when stopped before the downbeat', async () => {
		expect((await runSession('stop')).after).toEqual([]);
	});

	it('removes the previous band when the next phrase disables backing', async () => {
		expect((await runSession('disabled')).after).toEqual([]);
	});
});
