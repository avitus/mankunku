/**
 * Per-instrument playback voices: everything that makes the demo horn sound
 * like THIS horn, in one registry.
 *
 * A voice names its sample source (custom multi-samples, else a GM
 * SoundFont), the bus "warmth" lowpass ceiling, and its pitch vibrato.
 * `playback.ts` reads only `instrumentVoice(id)` — it holds no per-instrument
 * branches — so adding an instrument is one `InstrumentId` member, one
 * `INSTRUMENTS` entry and one entry here (the Record type refuses to compile
 * without it).
 *
 * Pure data + pure math: Node-testable, no Web Audio.
 */

import type { InstrumentId } from '$lib/types/instruments';
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
	/** Time from the vibrato's start to full depth. */
	bloomSeconds: number;
	/** Fade back to straight before the note ends, so the next attack starts clean. */
	fadeSeconds: number;
}

export interface InstrumentVoice {
	/** Custom multi-sampled recordings; absent → the SoundFont is the only source. */
	samples?: SampleMap;
	/** smplr GM SoundFont name — the fallback when `samples` is absent or fails to load. */
	soundfont: string;
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
	bloomSeconds: 0.22,
	fadeSeconds: 0.05
} as const;

const SAX_VIBRATO: VibratoProfile = { ...HELD_NOTE_VIBRATO, rateHz: 4.8, depthCents: 12 };

const CONCERT_VOICE: InstrumentVoice = {
	soundfont: 'tenor_sax',
	warmthCutoffHz: 6000,
	vibrato: { ...HELD_NOTE_VIBRATO, rateHz: 4.8, depthCents: 6 }
};

export const INSTRUMENT_VOICES: Record<InstrumentId, InstrumentVoice> = {
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
		warmthCutoffHz: 6000,
		// Trumpet vibrato is narrower than a sax's.
		vibrato: { ...HELD_NOTE_VIBRATO, rateHz: 4.8, depthCents: 6 }
	},
	// Concert pitch has always played the GM tenor SoundFont, never the
	// tenor samples, with the non-sax tone settings.
	concert: CONCERT_VOICE,
	// The C instruments behind the "which C instrument?" follow-up keep the
	// concert demo voice; none has a voice of its own yet.
	piano: CONCERT_VOICE,
	guitar: CONCERT_VOICE,
	bass: CONCERT_VOICE,
	trombone: CONCERT_VOICE,
	flute: CONCERT_VOICE,
	vibraphone: CONCERT_VOICE,
	violin: CONCERT_VOICE,
	voice: CONCERT_VOICE
};

/** The voice for an instrument id; an unknown id (a stale setting) gets the tenor's. */
export function instrumentVoice(instrumentId: string): InstrumentVoice {
	return (
		(INSTRUMENT_VOICES as Record<string, InstrumentVoice | undefined>)[instrumentId] ??
		INSTRUMENT_VOICES['tenor-sax']
	);
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

/**
 * The vibrato depth envelope for one note of `durationSeconds`. Always opens
 * with depth 0 at the attack; a note long enough blooms to full depth after
 * the onset delay, holds, and fades out by its end.
 */
export function vibratoEnvelope(
	profile: VibratoProfile,
	durationSeconds: number
): VibratoBreakpoint[] {
	const straight: VibratoBreakpoint[] = [{ at: 0, depth: 0, ramp: false }];
	if (profile.depthCents <= 0 || durationSeconds < profile.minNoteSeconds) return straight;

	const bloomStart = profile.onsetDelaySeconds;
	const full = bloomStart + profile.bloomSeconds;
	const fadeStart = durationSeconds - profile.fadeSeconds;
	if (fadeStart <= full) return straight;

	return [
		...straight,
		{ at: bloomStart, depth: 0, ramp: false },
		{ at: full, depth: 1, ramp: true },
		{ at: fadeStart, depth: 1, ramp: false },
		{ at: durationSeconds, depth: 0, ramp: true }
	];
}
