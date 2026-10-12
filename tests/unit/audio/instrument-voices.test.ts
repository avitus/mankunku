import { describe, expect, it } from 'vitest';
import { INSTRUMENTS } from '$lib/types/instruments';
import {
	INSTRUMENT_VOICES,
	instrumentVoice,
	vibratoDelaySwingSeconds,
	vibratoEnvelope,
	type VibratoProfile
} from '$lib/audio/instrument-voices';

describe('instrument voices', () => {
	it('gives every instrument a voice, and no voice to an unknown instrument', () => {
		expect(Object.keys(INSTRUMENT_VOICES).sort()).toEqual(Object.keys(INSTRUMENTS).sort());
	});

	it('opens the warmth ceiling with the sax register: tenor < alto < soprano', () => {
		// One shared 4.5 kHz ceiling cut a soprano's upper harmonics far harder
		// than a tenor's, since its notes sit an octave higher.
		const cutoff = (id: keyof typeof INSTRUMENT_VOICES) => INSTRUMENT_VOICES[id].warmthCutoffHz;
		expect(cutoff('tenor-sax')).toBeLessThan(cutoff('alto-sax'));
		expect(cutoff('alto-sax')).toBeLessThan(cutoff('soprano-sax'));
	});

	it('plays every sax from its own samples, with its own SoundFont as fallback', () => {
		for (const id of ['tenor-sax', 'alto-sax', 'soprano-sax'] as const) {
			const voice = INSTRUMENT_VOICES[id];
			expect(voice.samples, id).toBeDefined();
			expect(voice.soundfont, id).toBe(id.replace('-', '_'));
		}
	});

	it('falls back to the tenor voice for an unknown instrument id', () => {
		expect(instrumentVoice('kazoo')).toBe(INSTRUMENT_VOICES['tenor-sax']);
		// Inherited Object members are not instruments.
		expect(instrumentVoice('constructor')).toBe(INSTRUMENT_VOICES['tenor-sax']);
		expect(instrumentVoice('toString')).toBe(INSTRUMENT_VOICES['tenor-sax']);
		expect(instrumentVoice('alto-sax')).toBe(INSTRUMENT_VOICES['alto-sax']);
	});
});

describe('vibratoDelaySwingSeconds', () => {
	it('bends pitch by exactly the requested depth at the delay line peak slope', () => {
		for (const [rate, cents] of [
			[4.8, 12],
			[5.5, 6],
			[6, 25]
		]) {
			const swing = vibratoDelaySwingSeconds(rate, cents);
			// d(t) = A sin(2πft) → playback rate 1 − d′(t), peak 1 + 2πfA.
			const peakRatio = 1 + 2 * Math.PI * rate * swing;
			expect(1200 * Math.log2(peakRatio)).toBeCloseTo(cents, 9);
		}
	});

	it('is zero when the voice has no vibrato', () => {
		expect(vibratoDelaySwingSeconds(4.8, 0)).toBe(0);
		expect(vibratoDelaySwingSeconds(0, 12)).toBe(0);
	});

	it('stays under the 2 ms resting delay for every voice', () => {
		// playback.ts clamps to it; a voice that needs the clamp would be silently shallower.
		for (const [id, voice] of Object.entries(INSTRUMENT_VOICES)) {
			expect(
				vibratoDelaySwingSeconds(voice.vibrato.rateHz, voice.vibrato.depthCents),
				id
			).toBeLessThan(0.002);
		}
	});
});

describe('vibratoEnvelope', () => {
	const profile: VibratoProfile = {
		rateHz: 4.8,
		depthCents: 12,
		minNoteSeconds: 0.6,
		onsetDelaySeconds: 0.18,
		bloomSeconds: 0.22,
		fadeSeconds: 0.05
	};

	it('plays a short note straight', () => {
		expect(vibratoEnvelope(profile, 0.59)).toEqual([{ at: 0, depth: 0, ramp: false }]);
	});

	it('blooms a held note after the onset delay and fades it out by the end', () => {
		expect(vibratoEnvelope(profile, 1)).toEqual([
			{ at: 0, depth: 0, ramp: false },
			{ at: 0.18, depth: 0, ramp: false },
			{ at: 0.4, depth: 1, ramp: true },
			{ at: 0.95, depth: 1, ramp: false },
			{ at: 1, depth: 0, ramp: true }
		]);
	});

	it('stays straight when the bloom would not finish before the fade', () => {
		const late = { ...profile, minNoteSeconds: 0.1 };
		expect(vibratoEnvelope(late, 0.44)).toEqual([{ at: 0, depth: 0, ramp: false }]);
	});

	it('stays straight on a voice with no depth', () => {
		expect(vibratoEnvelope({ ...profile, depthCents: 0 }, 2)).toHaveLength(1);
	});

	it('emits breakpoints in time order, so automation never schedules backwards', () => {
		for (const duration of [0.6, 0.8, 1.5, 4]) {
			const times = vibratoEnvelope(profile, duration).map((p) => p.at);
			expect(times).toEqual([...times].sort((a, b) => a - b));
		}
	});
});
