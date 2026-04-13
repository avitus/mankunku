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

/** Instruments that have custom sample maps available */
export const SAMPLE_MAPS: Record<string, SampleMap> = {
	'tenor-sax': TENOR_SAX_SAMPLES
};

/**
 * Jazz drum kit samples for the backing track.
 *
 * Single-velocity-layer sampler with string aliases (smplr maps each
 * non-MIDI key to an internal alias at load time). Source: Karoryfer/
 * Versilian "Virtuosity Drums" v0.924 (CC0). Converted from FLAC to
 * OGG Vorbis q5 for web delivery.
 *
 * - kick:  felt-beater acoustic kick (close mic)
 * - ride:  ride cymbal bow stroke (overhead mic, full sustain)
 * - hihat: closed hi-hat (overhead mic)
 */
export const DRUM_BUFFERS: Record<string, string> = {
	kick: '/samples/drums/kick.ogg',
	ride: '/samples/drums/ride.ogg',
	hihat: '/samples/drums/hihat.ogg'
};

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
