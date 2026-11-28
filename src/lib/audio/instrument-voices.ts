/**
 * Melody voice for every selected instrument. Horns carry their samples and
 * expression settings. Concert instruments name their dedicated player or GM preset.
 *
 * Pure data + pure math: Node-testable, no Web Audio.
 */

import { CONCERT_INSTRUMENT_IDS, TRANSPOSING_INSTRUMENT_IDS, isInstrumentId, type InstrumentId } from '$lib/types/instruments';
import {
	ALTO_SAX_SAMPLES,
	SOPRANO_SAX_SAMPLES,
	TENOR_SAX_SAMPLES,
	type SampleMap
} from './sample-maps';

export interface VibratoProfile {
	/** LFO rate in Hz. */
	rateHz: number;
	/** Peak pitch deviation in cents at full depth. */
	depthCents: number;
	/**
	 * Notes shorter than this play straight. Jazz vibrato lives on held notes;
	 * a wobble on every eighth of a line reads as out of tune, not expressive.
	 */
	minNoteSeconds: number;
	/** Straight tone at the head of a held note before the vibrato starts. */
	onsetDelaySeconds: number;
	/** Time for the delayed shape to reach its narrow depth. */
	bloomSeconds: number;
}

export interface InstrumentVoice {
	/** Custom multi-sampled recordings; absent → the SoundFont is the only source. */
	samples?: SampleMap;
	/** smplr GM SoundFont name — the fallback when `samples` is absent or fails to load. */
	soundfont: string;
	/** Sustain boundaries for the encoded MIDI.js recordings, in 44.1 kHz frames. */
	soundfontLoopUrl?: string;
	/**
	 * Lowpass ceiling on the instrument bus, Hz. Tames the harsh top of the
	 * recordings without dulling the horn: a higher-pitched horn needs a higher
	 * ceiling to pass the same number of harmonics, so the saxes scale it with
	 * register (alto sits a 4th above tenor, soprano an octave above).
	 */
	warmthCutoffHz: number;
	vibrato: VibratoProfile;
}

/** The held-note vibrato envelope every horn shares; voices differ in rate and depth. */
const HELD_NOTE_VIBRATO = {
	minNoteSeconds: 0.6,
	onsetDelaySeconds: 0.18,
	bloomSeconds: 0.22
} as const;

const SAX_VIBRATO: VibratoProfile = { ...HELD_NOTE_VIBRATO, rateHz: 4.8, depthCents: 12 };

const CONCERT_VOICES = {
	piano: 'grand',
	concert: 'grand',
	bass: 'upright',
	guitar: 'electric_guitar_jazz',
	trombone: 'trombone',
	flute: 'flute',
	vibraphone: 'vibraphone',
	violin: 'violin',
	voice: 'voice_oohs'
} as const satisfies Record<typeof CONCERT_INSTRUMENT_IDS[number], string>;
export type ConcertVoice = typeof CONCERT_VOICES[keyof typeof CONCERT_VOICES];

export const HORN_VOICES: Record<typeof TRANSPOSING_INSTRUMENT_IDS[number], InstrumentVoice> = {
	'tenor-sax': {
		samples: TENOR_SAX_SAMPLES,
		soundfont: 'tenor_sax',
		warmthCutoffHz: 4500,
		vibrato: SAX_VIBRATO
	},
	'alto-sax': {
		samples: ALTO_SAX_SAMPLES,
		soundfont: 'alto_sax',
		warmthCutoffHz: 6000,
		vibrato: SAX_VIBRATO
	},
	'soprano-sax': {
		samples: SOPRANO_SAX_SAMPLES,
		soundfont: 'soprano_sax',
		warmthCutoffHz: 9000,
		vibrato: SAX_VIBRATO
	},
	trumpet: {
		soundfont: 'trumpet',
		// The upstream C4 loop repeats 147 frames and turns the held C into a 300 Hz buzz.
		soundfontLoopUrl: '/samples/musyngkite-trumpet-loops.json',
		warmthCutoffHz: 6000,
		// Trumpet vibrato is narrower than a sax's.
		vibrato: { ...HELD_NOTE_VIBRATO, rateHz: 4.8, depthCents: 6 }
	}
};

export const INSTRUMENT_VOICES = { ...HORN_VOICES, ...CONCERT_VOICES } satisfies Record<InstrumentId, InstrumentVoice | ConcertVoice>;

// Fixed amplitude trims relative to the recorded tenor sax. Measured by
// integrated loudness across the four calls in docs/maintenance/audio-mixer/ear-training-levels.md.
const trimDb = {
	'tenor-sax': 0, 'alto-sax': -2.5, 'soprano-sax': -6.3, trumpet: -4,
	piano: -13.4, concert: -13.4, bass: -16.3, guitar: -9.2, trombone: -3,
	flute: -4.7, vibraphone: -4.4, violin: -10.5, voice: -9.4
} satisfies Record<InstrumentId, number>;

const fallbackTrimDb = { 'tenor-sax': -8.4, 'alto-sax': -10.1, 'soprano-sax': -6.1 };

/** Linear gain that matches the selected voice to the tenor reference level. */
export function melodyGainAdjustment(id: string, usingSaxSoundfont: boolean): number {
	const key = isInstrumentId(id) ? id : 'tenor-sax';
	const db = usingSaxSoundfont && (key === 'tenor-sax' || key === 'alto-sax' || key === 'soprano-sax')
		? fallbackTrimDb[key] : trimDb[key];
	return 10 ** (db / 20);
}

/** The voice for an instrument id; an unknown id (a stale setting) gets the tenor's. */
export function instrumentVoice(instrumentId: string): InstrumentVoice | ConcertVoice {
	// The same own-key guard as getInstrument: a bare index would resolve
	// `constructor` or `toString` to an inherited Object member.
	return isInstrumentId(instrumentId)
		? INSTRUMENT_VOICES[instrumentId]
		: INSTRUMENT_VOICES['tenor-sax'];
}

/**
 * Peak swing of a modulated delay line, in seconds, that bends pitch by
 * `depthCents` at `rateHz`. A delay d(t) = A·sin(2πft) plays back at rate
 * 1 − d′(t), whose extreme is 1 ± 2πfA, so A = (2^(c/1200) − 1) / (2πf).
 */
export function vibratoDelaySwingSeconds(rateHz: number, depthCents: number): number {
	if (rateHz <= 0 || depthCents <= 0) return 0;
	return (Math.pow(2, depthCents / 1200) - 1) / (2 * Math.PI * rateHz);
}

/** One automation breakpoint, relative to the note's start. */
export interface VibratoBreakpoint {
	/** Seconds after the note starts. */
	at: number;
	/** Fraction of full depth, 0–1. */
	depth: number;
	/** Ramp linearly from the previous breakpoint (false = jump). */
	ramp: boolean;
}

/** The four note shapes, each with an equal chance at a sounding note's attack. */
export const VIBRATO_STYLES = ['straight', 'delayed', 'widening', 'opening'] as const;
export type VibratoStyle = (typeof VIBRATO_STYLES)[number];

/** Draw once per sounding note; an injected random source makes selection testable. */
export function chooseVibratoStyle(random: () => number = Math.random): VibratoStyle {
	return VIBRATO_STYLES[Math.floor(random() * VIBRATO_STYLES.length)];
}

/**
 * Shape one note's vibrato without changing its amplitude or duration. Short
 * notes stay straight. Delayed notes wait two seconds, then use 40% depth;
 * opening notes use 50% immediately and finish straight. Widening notes grow
 * through the sample's amplitude release, approaching the existing ceiling.
 * The next attack replaces this envelope, including any unfinished release.
 */
export function vibratoEnvelope(
	profile: VibratoProfile,
	durationSeconds: number,
	style: VibratoStyle,
	releaseSeconds = 0
): VibratoBreakpoint[] {
	const straight: VibratoBreakpoint[] = [{ at: 0, depth: 0, ramp: false }];
	if (
		style === 'straight' || profile.depthCents <= 0 || profile.rateHz <= 0 ||
		durationSeconds < profile.minNoteSeconds
	) return straight;

	switch (style) {
		case 'delayed': {
			if (durationSeconds <= 2) return straight;
			const bloom = Math.min(profile.bloomSeconds, durationSeconds - 2);
			return [
				...straight,
				{ at: 2, depth: 0, ramp: false },
				{ at: 2 + bloom, depth: 0.4 * bloom / profile.bloomSeconds, ramp: true }
			];
		}
		case 'widening': {
			const start = Math.max(profile.onsetDelaySeconds, durationSeconds * 0.25);
			const end = durationSeconds + Math.max(0, releaseSeconds);
			if (end <= start) return straight;
			// A modulated delay changes pitch through BOTH the LFO and the
			// envelope's slope. Reserve that slope's contribution so even a
			// rising envelope cannot exceed the old full-depth pitch swing.
			const slopeRatio = 1 / (2 * Math.PI * profile.rateHz * (end - start));
			const peak = 1 / Math.hypot(1, slopeRatio);
			return [...straight, { at: start, depth: 0, ramp: false }, { at: end, depth: peak, ramp: true }];
		}
		case 'opening':
			return [
				{ at: 0, depth: 0.5, ramp: false },
				{ at: Math.min(profile.bloomSeconds, durationSeconds * 0.2), depth: 0.5, ramp: false },
				{ at: durationSeconds * 0.65, depth: 0, ramp: true }
			];
	}
}
