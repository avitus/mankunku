/**
 * Backing track style definitions.
 *
 * Each style specifies drum, comping, and bass behavior patterns
 * that the backing track engine dispatches on.
 *
 * Velocity scales differ by destination instrument:
 *   - Drum velocities (DrumHit.*Velocity) are 0–1 because drum hits are
 *     triggered through Tone.js synths (triggerAttackRelease) which expect
 *     normalized gain.
 *   - Comp and bass velocities are MIDI 0–127 because those notes are
 *     played through smplr samplers which follow the MIDI convention.
 *     This matches the scale used by walking-bass events and melody notes.
 */

import type { BackingStyle } from '$lib/types/instruments';

export interface DrumHit {
	kick?: boolean;
	ride?: boolean;
	hihat?: boolean;
	/** Ride velocity override (0-1, Tone.Synth gain) */
	rideVelocity?: number;
	/** Hi-hat velocity override (0-1, Tone.Synth gain) */
	hihatVelocity?: number;
	/** Kick velocity override (0-1, Tone.Synth gain) */
	kickVelocity?: number;
}

export interface StyleDefinition {
	name: string;
	/** Default swing ratio for this style */
	defaultSwing: number;
	/** Drum pattern: maps beat index (0-based within bar) to drum hits */
	drumPattern: (beat: number, beatsPerBar: number) => DrumHit;
	/**
	 * Comping pattern: decides whether this beat gets a comp hit.
	 *
	 * `velocity` is a MIDI value in the range 0–127 (smplr convention —
	 * do NOT confuse with DrumHit's 0–1 normalized velocities).  Duration
	 * is a [numerator, denominator] tuple representing a fraction of one
	 * beat (quarter note); converted to seconds at scheduling time.
	 */
	compPattern: (beat: number, beatsPerBar: number) => { hit: boolean; velocity: number; duration: [number, number] };
	/** Bass style: 'walking' = chord-tone walking, 'pedal' = root pedal, 'pattern' = rhythmic pattern */
	bassStyle: 'walking' | 'pedal' | 'pattern';
}

const swing: StyleDefinition = {
	name: 'Swing',
	defaultSwing: 0.67,
	drumPattern: (beat: number) => ({
		kick: beat === 0,
		ride: true,
		hihat: beat === 1 || beat === 3,
		rideVelocity: 0.4,
		hihatVelocity: 0.5,
		kickVelocity: 0.5
	}),
	compPattern: (beat: number) => {
		const isCompBeat = beat % 4 === 1 || beat % 4 === 3;
		const extraHit = (beat % 4 === 0 || beat % 4 === 2) && Math.random() < 0.25;
		if (isCompBeat) return { hit: true, velocity: 60 + Math.round(Math.random() * 10), duration: [2, 5] };
		if (extraHit) return { hit: true, velocity: 50, duration: [3, 5] };
		return { hit: false, velocity: 0, duration: [0, 1] };
	},
	bassStyle: 'walking'
};

const bossaNova: StyleDefinition = {
	name: 'Bossa Nova',
	defaultSwing: 0.5,
	drumPattern: (beat: number, beatsPerBar: number) => {
		// Cross-stick rim on 2 and 4, hi-hat on every beat with syncopation
		const isRimBeat = beat === 1 || beat === 3;
		return {
			kick: beat === 0 || beat === 2,
			ride: false,
			hihat: true,
			hihatVelocity: isRimBeat ? 0.6 : 0.3,
			kickVelocity: beat === 0 ? 0.4 : 0.3
		};
	},
	compPattern: (beat: number) => {
		// Syncopated guitar-style pattern: hits on 1, off of 2, 3, off of 4
		const bossaHits = [true, false, true, true];
		const hit = bossaHits[beat % 4] ?? false;
		return { hit, velocity: hit ? 55 + Math.round(Math.random() * 8) : 0, duration: [1, 2] };
	},
	bassStyle: 'pattern'
};

const ballad: StyleDefinition = {
	name: 'Ballad',
	defaultSwing: 0.55,
	drumPattern: (beat: number) => ({
		// Sparse: soft ride on every beat, minimal kick on 1 only
		kick: beat === 0,
		ride: true,
		hihat: false,
		rideVelocity: 0.25,
		kickVelocity: 0.3
	}),
	compPattern: (beat: number) => {
		// Whole-note / half-note sustains: hit on beat 1, occasionally on 3
		if (beat % 4 === 0) return { hit: true, velocity: 45 + Math.round(Math.random() * 8), duration: [3, 2] };
		if (beat % 4 === 2 && Math.random() < 0.3) return { hit: true, velocity: 40, duration: [1, 1] };
		return { hit: false, velocity: 0, duration: [0, 1] };
	},
	bassStyle: 'walking'
};

const straight: StyleDefinition = {
	name: 'Straight',
	defaultSwing: 0.5,
	drumPattern: (beat: number) => ({
		// Even 8th-note feel: ride every beat, hi-hat on 2 and 4, kick on 1 and 3
		kick: beat === 0 || beat === 2,
		ride: true,
		hihat: beat === 1 || beat === 3,
		rideVelocity: 0.35,
		hihatVelocity: 0.4,
		kickVelocity: 0.4
	}),
	compPattern: (beat: number) => {
		// Even quarter-note comping
		return { hit: true, velocity: 55 + Math.round(Math.random() * 8), duration: [1, 3] };
	},
	bassStyle: 'walking'
};

export const BACKING_STYLES: Record<BackingStyle, StyleDefinition> = {
	swing,
	'bossa-nova': bossaNova,
	ballad,
	straight
};

export const BACKING_STYLE_NAMES: Record<BackingStyle, string> = {
	swing: 'Swing',
	'bossa-nova': 'Bossa Nova',
	ballad: 'Ballad',
	straight: 'Straight'
};
