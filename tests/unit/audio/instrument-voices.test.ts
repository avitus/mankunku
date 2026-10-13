import { describe, expect, it, vi } from 'vitest';
import { INSTRUMENTS } from '$lib/types/instruments';
import {
	INSTRUMENT_VOICES,
	VIBRATO_STYLES,
	chooseVibratoStyle,
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
		bloomSeconds: 0.22
	};

	it('plays a short note straight', () => {
		for (const style of VIBRATO_STYLES) {
			expect(vibratoEnvelope(profile, 0.59, style)).toEqual([{ at: 0, depth: 0, ramp: false }]);
		}
	});

	it('uses the opening straight-tone delay before a gradual widening', () => {
		const envelope = vibratoEnvelope(profile, 0.6, 'widening');
		expect(envelope.slice(0, 2)).toEqual([
			{ at: 0, depth: 0, ramp: false },
			{ at: 0.18, depth: 0, ramp: false }
		]);
		expect(envelope.at(-1)?.ramp).toBe(true);
	});

	it('stays straight when the widening onset would fall beyond the note and release', () => {
		const late = { ...profile, onsetDelaySeconds: 2 };
		expect(vibratoEnvelope(late, 1, 'widening', 0.2)).toEqual([{ at: 0, depth: 0, ramp: false }]);
	});

	it('stays straight on a voice with no depth', () => {
		for (const style of VIBRATO_STYLES) {
			expect(vibratoEnvelope({ ...profile, depthCents: 0 }, 4, style)).toEqual([{ at: 0, depth: 0, ramp: false }]);
			expect(vibratoEnvelope({ ...profile, rateHz: 0 }, 4, style)).toEqual([{ at: 0, depth: 0, ramp: false }]);
		}
	});

	it('emits breakpoints in time order, so automation never schedules backwards', () => {
		for (const duration of [0.6, 0.8, 1.5, 4]) {
			for (const style of VIBRATO_STYLES) {
				const times = vibratoEnvelope(profile, duration, style).map((p) => p.at);
				expect(times).toEqual([...times].sort((a, b) => a - b));
			}
		}
	});

	it('can leave a held note entirely straight', () => {
		expect(vibratoEnvelope(profile, 4, 'straight', 0.25)).toEqual([
			{ at: 0, depth: 0, ramp: false }
		]);
	});

	it('waits two full seconds before introducing narrow vibrato', () => {
		const envelope = vibratoEnvelope(profile, 4, 'delayed', 0.25);
		expect(envelope.filter((point) => point.at <= 2).every((point) => point.depth === 0)).toBe(true);
		expect(envelope).toContainEqual({ at: 2, depth: 0, ramp: false });
		expect(Math.max(...envelope.map((point) => point.depth))).toBeCloseTo(0.4);
		expect(vibratoEnvelope(profile, 2, 'delayed', 0.25)).toEqual([
			{ at: 0, depth: 0, ramp: false }
		]);
	});

	it('widens gradually through the amplitude release instead of flattening before it', () => {
		const envelope = vibratoEnvelope(profile, 1, 'widening', 0.35);
		expect(envelope[0]).toEqual({ at: 0, depth: 0, ramp: false });
		expect(envelope.at(-1)?.at).toBeCloseTo(1.35);
		expect(envelope.at(-1)?.depth).toBeGreaterThan(0.9);
		for (let i = 1; i < envelope.length; i++) {
			expect(envelope[i].depth).toBeGreaterThanOrEqual(envelope[i - 1].depth);
		}
	});

	it('starts with narrower vibrato and leaves the final third straight', () => {
		const envelope = vibratoEnvelope(profile, 1, 'opening', 0.35);
		expect(envelope[0]).toEqual({ at: 0, depth: 0.5, ramp: false });
		expect(envelope.at(-1)?.depth).toBe(0);
		expect(envelope.at(-1)?.at).toBeLessThanOrEqual(2 / 3);
		expect(Math.max(...envelope.map((point) => point.depth))).toBe(0.5);
	});

	it('does not rush a full delayed bloom into the last few milliseconds', () => {
		const envelope = vibratoEnvelope(profile, 2.01, 'delayed');
		expect(envelope.at(-1)?.at).toBe(2.01);
		expect(envelope.at(-1)?.depth).toBeGreaterThan(0);
		expect(envelope.at(-1)?.depth).toBeLessThan(0.02);
	});

	it('caps the pitch swing including the extra bend caused by ramping delay depth', () => {
		for (const voice of Object.values(INSTRUMENT_VOICES)) {
			for (const duration of [0.6, 1, 2.001, 2.1, 3, 8]) {
				for (const style of VIBRATO_STYLES) {
					const envelope = vibratoEnvelope(voice.vibrato, duration, style, 0.35);
					for (let i = 0; i < envelope.length; i++) {
						const point = envelope[i];
						expect(point.depth).toBeGreaterThanOrEqual(0);
						expect(point.depth).toBeLessThanOrEqual(1);
						if (!point.ramp) continue;
						const previous = envelope[i - 1];
						const slope = (point.depth - previous.depth) / (point.at - previous.at);
						const peak = Math.hypot(Math.max(point.depth, previous.depth), slope / (2 * Math.PI * voice.vibrato.rateHz));
						expect(peak).toBeLessThanOrEqual(1 + 1e-12);
					}
				}
			}
		}
	});
});

describe('vibrato selection', () => {
	it.each([
		[0, 'straight'], [0.2499, 'straight'], [0.25, 'delayed'], [0.4999, 'delayed'],
		[0.5, 'widening'], [0.7499, 'widening'], [0.75, 'opening'], [0.9999, 'opening']
	] as const)('maps random draw %s to %s with one draw and equal-sized ranges', (draw, style) => {
		const random = vi.fn(() => draw);
		expect(chooseVibratoStyle(random)).toBe(style);
		expect(random).toHaveBeenCalledOnce();
	});
});
