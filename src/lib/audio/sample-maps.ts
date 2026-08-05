/**
 * Sample maps for custom multi-sampled instruments.
 *
 * Maps MIDI note numbers to sample URLs with per-note tuning corrections
 * derived from SFZ region definitions. Supports velocity layers (piano/forte)
 * for dynamic expression.
 *
 * Samples: MTG Solo Sax by Music Technology Group, Universitat Pompeu Fabra.
 * License: CC-BY 4.0. https://github.com/sfzinstruments/MTG.SoloSax
 */

export interface SampleRegion {
	/** URL path relative to app root (served from /static) */
	url: string;
	/** Tuning correction in cents (from SFZ mapping, compensates for A=442 recording) */
	tune: number;
}

export interface SampleMap {
	/** Soft dynamic samples (velocity ≤ split) */
	piano: Record<number, SampleRegion>;
	/** Loud dynamic samples (velocity > split) */
	forte: Record<number, SampleRegion>;
	/** Velocity boundary: ≤ this uses piano, > this uses forte */
	velocitySplit: number;
}

/**
 * Tenor saxophone sample map.
 *
 * 33 chromatic samples (MIDI 44–76, Ab2–E5 concert pitch) at 2 velocity layers.
 * Tuning corrections from the MTG SFZ mappings compensate for the original
 * A=442 Hz recording pitch and per-note intonation variance.
 */
export const TENOR_SAX_SAMPLES: SampleMap = {
	velocitySplit: 100,
	piano: {
		44: { url: '/samples/tenor-sax/p_44.ogg', tune: -15 },
		45: { url: '/samples/tenor-sax/p_45.ogg', tune: -13 },
		46: { url: '/samples/tenor-sax/p_46.ogg', tune: -13 },
		47: { url: '/samples/tenor-sax/p_47.ogg', tune: -16 },
		48: { url: '/samples/tenor-sax/p_48.ogg', tune: -9 },
		49: { url: '/samples/tenor-sax/p_49.ogg', tune: 2 },
		50: { url: '/samples/tenor-sax/p_50.ogg', tune: -7 },
		51: { url: '/samples/tenor-sax/p_51.ogg', tune: -11 },
		52: { url: '/samples/tenor-sax/p_52.ogg', tune: -14 },
		53: { url: '/samples/tenor-sax/p_53.ogg', tune: -17 },
		54: { url: '/samples/tenor-sax/p_54.ogg', tune: -13 },
		55: { url: '/samples/tenor-sax/p_55.ogg', tune: -15 },
		56: { url: '/samples/tenor-sax/p_56.ogg', tune: -10 },
		57: { url: '/samples/tenor-sax/p_57.ogg', tune: -10 },
		58: { url: '/samples/tenor-sax/p_58.ogg', tune: -17 },
		59: { url: '/samples/tenor-sax/p_59.ogg', tune: -10 },
		60: { url: '/samples/tenor-sax/p_60.ogg', tune: -15 },
		61: { url: '/samples/tenor-sax/p_61.ogg', tune: -7 },
		62: { url: '/samples/tenor-sax/p_62.ogg', tune: -15 },
		63: { url: '/samples/tenor-sax/p_63.ogg', tune: -17 },
		64: { url: '/samples/tenor-sax/p_64.ogg', tune: -17 },
		65: { url: '/samples/tenor-sax/p_65.ogg', tune: -20 },
		66: { url: '/samples/tenor-sax/p_66.ogg', tune: -18 },
		67: { url: '/samples/tenor-sax/p_67.ogg', tune: -21 },
		68: { url: '/samples/tenor-sax/p_68.ogg', tune: -17 },
		69: { url: '/samples/tenor-sax/p_69.ogg', tune: -12 },
		70: { url: '/samples/tenor-sax/p_70.ogg', tune: -12 },
		71: { url: '/samples/tenor-sax/p_71.ogg', tune: -20 },
		72: { url: '/samples/tenor-sax/p_72.ogg', tune: -15 },
		73: { url: '/samples/tenor-sax/p_73.ogg', tune: -18 },
		74: { url: '/samples/tenor-sax/p_74.ogg', tune: -24 },
		75: { url: '/samples/tenor-sax/p_75.ogg', tune: -27 },
		76: { url: '/samples/tenor-sax/p_76.ogg', tune: -36 }
	},
	forte: {
		44: { url: '/samples/tenor-sax/f_44.ogg', tune: -12 },
		45: { url: '/samples/tenor-sax/f_45.ogg', tune: -8 },
		46: { url: '/samples/tenor-sax/f_46.ogg', tune: -8 },
		47: { url: '/samples/tenor-sax/f_47.ogg', tune: -13 },
		48: { url: '/samples/tenor-sax/f_48.ogg', tune: -7 },
		49: { url: '/samples/tenor-sax/f_49.ogg', tune: 3 },
		50: { url: '/samples/tenor-sax/f_50.ogg', tune: -7 },
		51: { url: '/samples/tenor-sax/f_51.ogg', tune: -9 },
		52: { url: '/samples/tenor-sax/f_52.ogg', tune: -14 },
		53: { url: '/samples/tenor-sax/f_53.ogg', tune: -20 },
		54: { url: '/samples/tenor-sax/f_54.ogg', tune: -15 },
		55: { url: '/samples/tenor-sax/f_55.ogg', tune: -15 },
		56: { url: '/samples/tenor-sax/f_56.ogg', tune: -12 },
		57: { url: '/samples/tenor-sax/f_57.ogg', tune: -7 },
		58: { url: '/samples/tenor-sax/f_58.ogg', tune: -19 },
		59: { url: '/samples/tenor-sax/f_59.ogg', tune: -18 },
		60: { url: '/samples/tenor-sax/f_60.ogg', tune: -12 },
		61: { url: '/samples/tenor-sax/f_61.ogg', tune: -9 },
		62: { url: '/samples/tenor-sax/f_62.ogg', tune: -18 },
		63: { url: '/samples/tenor-sax/f_63.ogg', tune: -12 },
		64: { url: '/samples/tenor-sax/f_64.ogg', tune: -10 },
		65: { url: '/samples/tenor-sax/f_65.ogg', tune: -22 },
		66: { url: '/samples/tenor-sax/f_66.ogg', tune: -17 },
		67: { url: '/samples/tenor-sax/f_67.ogg', tune: -23 },
		68: { url: '/samples/tenor-sax/f_68.ogg', tune: -13 },
		69: { url: '/samples/tenor-sax/f_69.ogg', tune: -4 },
		70: { url: '/samples/tenor-sax/f_70.ogg', tune: -9 },
		71: { url: '/samples/tenor-sax/f_71.ogg', tune: -16 },
		72: { url: '/samples/tenor-sax/f_72.ogg', tune: -16 },
		73: { url: '/samples/tenor-sax/f_73.ogg', tune: -21 },
		74: { url: '/samples/tenor-sax/f_74.ogg', tune: -29 },
		75: { url: '/samples/tenor-sax/f_75.ogg', tune: -32 },
		76: { url: '/samples/tenor-sax/f_76.ogg', tune: -40 }
	}
};

/**
 * Alto saxophone sample map.
 *
 * 32 chromatic samples (MIDI 49–80, Db3–G#5 concert pitch) at 2 velocity layers.
 * Tuning corrections from the MTG SFZ mappings compensate for the original
 * A=442 Hz recording pitch and per-note intonation variance.
 */
export const ALTO_SAX_SAMPLES: SampleMap = {
	velocitySplit: 100,
	piano: {
		49: { url: '/samples/alto-sax/p_49.ogg', tune: -16 },
		50: { url: '/samples/alto-sax/p_50.ogg', tune: -5 },
		51: { url: '/samples/alto-sax/p_51.ogg', tune: 3 },
		52: { url: '/samples/alto-sax/p_52.ogg', tune: 7 },
		53: { url: '/samples/alto-sax/p_53.ogg', tune: 11 },
		54: { url: '/samples/alto-sax/p_54.ogg', tune: 11 },
		55: { url: '/samples/alto-sax/p_55.ogg', tune: 3 },
		56: { url: '/samples/alto-sax/p_56.ogg', tune: 6 },
		57: { url: '/samples/alto-sax/p_57.ogg', tune: 3 },
		58: { url: '/samples/alto-sax/p_58.ogg', tune: 2 },
		59: { url: '/samples/alto-sax/p_59.ogg', tune: 2 },
		60: { url: '/samples/alto-sax/p_60.ogg', tune: -2 },
		61: { url: '/samples/alto-sax/p_61.ogg', tune: 2 },
		62: { url: '/samples/alto-sax/p_62.ogg', tune: 6 },
		63: { url: '/samples/alto-sax/p_63.ogg', tune: 3 },
		64: { url: '/samples/alto-sax/p_64.ogg', tune: 11 },
		65: { url: '/samples/alto-sax/p_65.ogg', tune: -17 },
		66: { url: '/samples/alto-sax/p_66.ogg', tune: -7 },
		67: { url: '/samples/alto-sax/p_67.ogg', tune: -11 },
		68: { url: '/samples/alto-sax/p_68.ogg', tune: -8 },
		69: { url: '/samples/alto-sax/p_69.ogg', tune: -3 },
		70: { url: '/samples/alto-sax/p_70.ogg', tune: 0 },
		71: { url: '/samples/alto-sax/p_71.ogg', tune: -4 },
		72: { url: '/samples/alto-sax/p_72.ogg', tune: -10 },
		73: { url: '/samples/alto-sax/p_73.ogg', tune: -14 },
		74: { url: '/samples/alto-sax/p_74.ogg', tune: -12 },
		75: { url: '/samples/alto-sax/p_75.ogg', tune: -16 },
		76: { url: '/samples/alto-sax/p_76.ogg', tune: -25 },
		77: { url: '/samples/alto-sax/p_77.ogg', tune: -24 },
		78: { url: '/samples/alto-sax/p_78.ogg', tune: -22 },
		79: { url: '/samples/alto-sax/p_79.ogg', tune: -27 },
		80: { url: '/samples/alto-sax/p_80.ogg', tune: -22 }
	},
	forte: {
		49: { url: '/samples/alto-sax/f_49.ogg', tune: -21 },
		50: { url: '/samples/alto-sax/f_50.ogg', tune: -11 },
		51: { url: '/samples/alto-sax/f_51.ogg', tune: -2 },
		52: { url: '/samples/alto-sax/f_52.ogg', tune: 0 },
		53: { url: '/samples/alto-sax/f_53.ogg', tune: 7 },
		54: { url: '/samples/alto-sax/f_54.ogg', tune: 5 },
		55: { url: '/samples/alto-sax/f_55.ogg', tune: -2 },
		56: { url: '/samples/alto-sax/f_56.ogg', tune: -3 },
		57: { url: '/samples/alto-sax/f_57.ogg', tune: -5 },
		58: { url: '/samples/alto-sax/f_58.ogg', tune: -5 },
		59: { url: '/samples/alto-sax/f_59.ogg', tune: -6 },
		60: { url: '/samples/alto-sax/f_60.ogg', tune: -13 },
		61: { url: '/samples/alto-sax/f_61.ogg', tune: -11 },
		62: { url: '/samples/alto-sax/f_62.ogg', tune: -7 },
		63: { url: '/samples/alto-sax/f_63.ogg', tune: -13 },
		64: { url: '/samples/alto-sax/f_64.ogg', tune: -8 },
		65: { url: '/samples/alto-sax/f_65.ogg', tune: -25 },
		66: { url: '/samples/alto-sax/f_66.ogg', tune: -21 },
		67: { url: '/samples/alto-sax/f_67.ogg', tune: -22 },
		68: { url: '/samples/alto-sax/f_68.ogg', tune: -21 },
		69: { url: '/samples/alto-sax/f_69.ogg', tune: -15 },
		70: { url: '/samples/alto-sax/f_70.ogg', tune: -17 },
		71: { url: '/samples/alto-sax/f_71.ogg', tune: -15 },
		72: { url: '/samples/alto-sax/f_72.ogg', tune: -19 },
		73: { url: '/samples/alto-sax/f_73.ogg', tune: -23 },
		74: { url: '/samples/alto-sax/f_74.ogg', tune: -23 },
		75: { url: '/samples/alto-sax/f_75.ogg', tune: -26 },
		76: { url: '/samples/alto-sax/f_76.ogg', tune: -40 },
		77: { url: '/samples/alto-sax/f_77.ogg', tune: -32 },
		78: { url: '/samples/alto-sax/f_78.ogg', tune: -33 },
		79: { url: '/samples/alto-sax/f_79.ogg', tune: -34 },
		80: { url: '/samples/alto-sax/f_80.ogg', tune: -25 }
	}
};

/**
 * Soprano saxophone sample map.
 *
 * 33 chromatic samples (MIDI 56–88, Ab3–E6 concert pitch) at 2 velocity layers.
 * Tuning corrections from the MTG SFZ mappings compensate for the original
 * A=442 Hz recording pitch and per-note intonation variance.
 */
export const SOPRANO_SAX_SAMPLES: SampleMap = {
	velocitySplit: 100,
	piano: {
		56: { url: '/samples/soprano-sax/p_56.ogg', tune: -13 },
		57: { url: '/samples/soprano-sax/p_57.ogg', tune: -11 },
		58: { url: '/samples/soprano-sax/p_58.ogg', tune: -13 },
		59: { url: '/samples/soprano-sax/p_59.ogg', tune: -10 },
		60: { url: '/samples/soprano-sax/p_60.ogg', tune: 2 },
		61: { url: '/samples/soprano-sax/p_61.ogg', tune: -2 },
		62: { url: '/samples/soprano-sax/p_62.ogg', tune: -6 },
		63: { url: '/samples/soprano-sax/p_63.ogg', tune: -8 },
		64: { url: '/samples/soprano-sax/p_64.ogg', tune: -6 },
		65: { url: '/samples/soprano-sax/p_65.ogg', tune: -9 },
		66: { url: '/samples/soprano-sax/p_66.ogg', tune: -3 },
		67: { url: '/samples/soprano-sax/p_67.ogg', tune: -7 },
		68: { url: '/samples/soprano-sax/p_68.ogg', tune: -14 },
		69: { url: '/samples/soprano-sax/p_69.ogg', tune: -12 },
		70: { url: '/samples/soprano-sax/p_70.ogg', tune: -16 },
		71: { url: '/samples/soprano-sax/p_71.ogg', tune: -8 },
		72: { url: '/samples/soprano-sax/p_72.ogg', tune: -21 },
		73: { url: '/samples/soprano-sax/p_73.ogg', tune: -21 },
		74: { url: '/samples/soprano-sax/p_74.ogg', tune: -18 },
		75: { url: '/samples/soprano-sax/p_75.ogg', tune: -18 },
		76: { url: '/samples/soprano-sax/p_76.ogg', tune: -17 },
		77: { url: '/samples/soprano-sax/p_77.ogg', tune: -24 },
		78: { url: '/samples/soprano-sax/p_78.ogg', tune: -17 },
		79: { url: '/samples/soprano-sax/p_79.ogg', tune: -21 },
		80: { url: '/samples/soprano-sax/p_80.ogg', tune: -16 },
		81: { url: '/samples/soprano-sax/p_81.ogg', tune: -28 },
		82: { url: '/samples/soprano-sax/p_82.ogg', tune: -26 },
		83: { url: '/samples/soprano-sax/p_83.ogg', tune: -37 },
		84: { url: '/samples/soprano-sax/p_84.ogg', tune: -39 },
		85: { url: '/samples/soprano-sax/p_85.ogg', tune: -32 },
		86: { url: '/samples/soprano-sax/p_86.ogg', tune: -34 },
		87: { url: '/samples/soprano-sax/p_87.ogg', tune: -35 },
		88: { url: '/samples/soprano-sax/p_88.ogg', tune: -15 }
	},
	forte: {
		56: { url: '/samples/soprano-sax/f_56.ogg', tune: -13 },
		57: { url: '/samples/soprano-sax/f_57.ogg', tune: -11 },
		58: { url: '/samples/soprano-sax/f_58.ogg', tune: -12 },
		59: { url: '/samples/soprano-sax/f_59.ogg', tune: -10 },
		60: { url: '/samples/soprano-sax/f_60.ogg', tune: 4 },
		61: { url: '/samples/soprano-sax/f_61.ogg', tune: -2 },
		62: { url: '/samples/soprano-sax/f_62.ogg', tune: -5 },
		63: { url: '/samples/soprano-sax/f_63.ogg', tune: -5 },
		64: { url: '/samples/soprano-sax/f_64.ogg', tune: -7 },
		65: { url: '/samples/soprano-sax/f_65.ogg', tune: -9 },
		66: { url: '/samples/soprano-sax/f_66.ogg', tune: -3 },
		67: { url: '/samples/soprano-sax/f_67.ogg', tune: -10 },
		68: { url: '/samples/soprano-sax/f_68.ogg', tune: -11 },
		69: { url: '/samples/soprano-sax/f_69.ogg', tune: -10 },
		70: { url: '/samples/soprano-sax/f_70.ogg', tune: -14 },
		71: { url: '/samples/soprano-sax/f_71.ogg', tune: -13 },
		72: { url: '/samples/soprano-sax/f_72.ogg', tune: -18 },
		73: { url: '/samples/soprano-sax/f_73.ogg', tune: -20 },
		74: { url: '/samples/soprano-sax/f_74.ogg', tune: -20 },
		75: { url: '/samples/soprano-sax/f_75.ogg', tune: -23 },
		76: { url: '/samples/soprano-sax/f_76.ogg', tune: -14 },
		77: { url: '/samples/soprano-sax/f_77.ogg', tune: -19 },
		78: { url: '/samples/soprano-sax/f_78.ogg', tune: -15 },
		79: { url: '/samples/soprano-sax/f_79.ogg', tune: -21 },
		80: { url: '/samples/soprano-sax/f_80.ogg', tune: -25 },
		81: { url: '/samples/soprano-sax/f_81.ogg', tune: -21 },
		82: { url: '/samples/soprano-sax/f_82.ogg', tune: -21 },
		83: { url: '/samples/soprano-sax/f_83.ogg', tune: -45 },
		84: { url: '/samples/soprano-sax/f_84.ogg', tune: -37 },
		85: { url: '/samples/soprano-sax/f_85.ogg', tune: -35 },
		86: { url: '/samples/soprano-sax/f_86.ogg', tune: -41 },
		87: { url: '/samples/soprano-sax/f_87.ogg', tune: -38 },
		88: { url: '/samples/soprano-sax/f_88.ogg', tune: -32 }
	}
};

/** Instruments that have custom sample maps available */
export const SAMPLE_MAPS: Record<string, SampleMap> = {
	'tenor-sax': TENOR_SAX_SAMPLES,
	'alto-sax': ALTO_SAX_SAMPLES,
	'soprano-sax': SOPRANO_SAX_SAMPLES
};

/**
 * Jazz drum kit samples for the backing track.
 *
 * One Sampler with string aliases (smplr maps each non-MIDI key to an
 * internal alias at load time). Source: Karoryfer/Versilian "Virtuosity
 * Drums" v0.924 (CC0) — see static/samples/drums/ATTRIBUTION.md for the
 * exact source file of every buffer and the offline normalization (all
 * peaks at −3 dBFS, Ogg Opus VBR 128k). Ride and snare carry velocity
 * layers; the rest are single hits.
 */
export type DrumBufferName =
	| 'kick'
	| 'ride'
	| 'ride_soft'
	| 'ride_acc'
	| 'ride_bell'
	| 'hihat'
	| 'hihat_pedal'
	| 'snare_ghost'
	| 'snare_med'
	| 'snare_acc'
	| 'crossstick'
	| 'crash';

export const DRUM_BUFFERS: Record<DrumBufferName, string> = {
	kick: '/samples/drums/kick.ogg',
	ride: '/samples/drums/ride.ogg',
	ride_soft: '/samples/drums/ride_soft.ogg',
	ride_acc: '/samples/drums/ride_acc.ogg',
	ride_bell: '/samples/drums/ride_bell.ogg',
	hihat: '/samples/drums/hihat.ogg',
	hihat_pedal: '/samples/drums/hihat_pedal.ogg',
	snare_ghost: '/samples/drums/snare_ghost.ogg',
	snare_med: '/samples/drums/snare_med.ogg',
	snare_acc: '/samples/drums/snare_acc.ogg',
	crossstick: '/samples/drums/crossstick.ogg',
	crash: '/samples/drums/crash.ogg'
};

/**
 * Velocity-layer selection per semantic drum voice: generation emits a
 * voice + a musical velocity; the trigger picks the buffer whose layer
 * band the velocity falls in (same idea as the sax `velocitySplit`).
 * Layers exist where a soft and a hard stroke differ in TIMBRE, not just
 * level — a ghosted snare is a different sound from a quiet accent, and a
 * feathered ride stroke from a dug-in one. All buffers are peak-normalized
 * to −3 dBFS offline, so velocity (scaled by the mix trims) is the only
 * level control.
 */
export interface DrumLayer {
	buffer: DrumBufferName;
	/** Upper velocity bound (inclusive) for this layer, 0–1. */
	maxVelocity: number;
}

export const DRUM_ARTICULATIONS: Record<import('./backing-styles').DrumVoice, DrumLayer[]> = {
	kick: [{ buffer: 'kick', maxVelocity: 1 }],
	ride: [
		{ buffer: 'ride_soft', maxVelocity: 0.38 },
		{ buffer: 'ride', maxVelocity: 0.72 },
		{ buffer: 'ride_acc', maxVelocity: 1 }
	],
	hihat: [{ buffer: 'hihat', maxVelocity: 1 }],
	'hihat-pedal': [{ buffer: 'hihat_pedal', maxVelocity: 1 }],
	snare: [
		{ buffer: 'snare_ghost', maxVelocity: 0.3 },
		{ buffer: 'snare_med', maxVelocity: 0.62 },
		{ buffer: 'snare_acc', maxVelocity: 1 }
	],
	crossstick: [{ buffer: 'crossstick', maxVelocity: 1 }],
	'ride-bell': [{ buffer: 'ride_bell', maxVelocity: 1 }],
	crash: [{ buffer: 'crash', maxVelocity: 1 }]
};

/** Buffer for a voice at a generated (pre-trim) velocity. */
export function drumBufferForVelocity(
	voice: import('./backing-styles').DrumVoice,
	velocity: number
): DrumBufferName {
	const layers = DRUM_ARTICULATIONS[voice];
	for (const layer of layers) {
		if (velocity <= layer.maxVelocity) return layer.buffer;
	}
	return layers[layers.length - 1].buffer;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Convert MIDI number to note name (e.g. 60 → "C4", 44 → "G#2"). */
function midiToNoteName(midi: number): string {
	return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

/**
 * Build a flat buffers record for smplr Sampler from a velocity layer.
 * Uses note name strings as keys (e.g. "C4") because smplr's Sampler
 * parses keys via noteNameToMidi which requires letter-based note names.
 */
export function layerToBuffers(layer: Record<number, SampleRegion>): Record<string, string> {
	const buffers: Record<string, string> = {};
	for (const [midi, region] of Object.entries(layer)) {
		buffers[midiToNoteName(Number(midi))] = region.url;
	}
	return buffers;
}

/**
 * Get the tuning correction for a note at a given velocity.
 */
export function getTuneCorrection(map: SampleMap, midi: number, velocity: number): number {
	const layer = velocity > map.velocitySplit ? map.forte : map.piano;
	return layer[midi]?.tune ?? 0;
}
