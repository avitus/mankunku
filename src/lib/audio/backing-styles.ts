/**
 * Backing track style definitions.
 *
 * Each style specifies drum, comping, and bass behavior patterns
 * that the backing track engine dispatches on. Patterns are generated
 * one BAR at a time from a `GenerationContext`: bar-level granularity is
 * what lets a style state figures (Charleston, spang-a-lang, anticipations)
 * that individual per-beat callbacks cannot express, and the seeded RNG in
 * the context is what makes every choice replayable.
 *
 * Velocity scales differ by destination instrument:
 *   - Drum velocities (DrumHitSpec.velocity) are 0–1 because drum hits are
 *     triggered through the sampler with normalized gain at the call site.
 *   - Comp and bass velocities are MIDI 0–127 because those notes are
 *     played through smplr samplers which follow the MIDI convention.
 *     This matches the scale used by walking-bass events and melody notes.
 */

import type { BackingStyle } from '$lib/types/instruments';
import type { SeededRng } from './generation-rng';

export type DrumVoice = 'kick' | 'ride' | 'hihat';

/**
 * Everything a pattern function may condition on for one bar. Section and
 * chorus fields are populated from `Phrase.sectionMap` when the phrase came
 * from a tune; lick practice and ear training (no sections) leave them
 * undefined and patterns fall back to position-free choices.
 */
export interface GenerationContext {
	/** 0-based bar index on the phrase timeline. */
	barIndex: number;
	beatsPerBar: number;
	/** Emitted-section index (timeline order), when the phrase has a sectionMap. */
	sectionIndex?: number;
	/** 0-based pass through the form, derived from sectionMap form restarts. */
	chorusIndex?: number;
	/** True when this bar is the last bar of a section (incl. the form's last bar). */
	isSectionFinalBar: boolean;
	/** True on the phrase's very last bar — nothing follows to anticipate. */
	isFinalBar: boolean;
	/** Effective swing ratio used for placement math (0.5 straight … 0.8 heavy). */
	swing: number;
	/** Per-bar seeded stream — same phrase, tempo and bar → same choices. */
	rng: SeededRng;
	/** Comp onsets this bar (beat offsets), so drums can align accents. */
	compOnsets?: number[];
}

export interface CompHitSpec {
	/** Offset within the bar in beats; x.5 offsets are eighth off-beats (swung late). */
	beatOffset: number;
	/** MIDI velocity 0–127 (smplr convention). */
	velocity: number;
	/** Length in beats. */
	durationBeats: number;
}

export interface DrumHitSpec {
	drum: DrumVoice;
	/** Offset within the bar in beats; x.5 offsets are eighth off-beats (swung late). */
	beatOffset: number;
	/** Normalized velocity 0–1. */
	velocity: number;
}

export interface StyleDefinition {
	name: string;
	/** Swing ratio used when the session swing is straight (0.5). */
	defaultSwing: number;
	/** Generate one bar of drum hits. */
	drumPattern: (ctx: GenerationContext) => DrumHitSpec[];
	/** Generate one bar of comp hits. */
	compPattern: (ctx: GenerationContext) => CompHitSpec[];
	/** Bass style: 'walking' = chord-tone walking, 'pedal' = root pedal, 'pattern' = rhythmic pattern */
	bassStyle: 'walking' | 'pedal' | 'pattern';
}

// ── Swing ────────────────────────────────────────────────────

/**
 * One-bar comp figures for 4/4 swing. `busy` ranks density so section
 * position can bias the choice: section-final bars lean busy (setting up
 * the arrival), ordinary bars keep space in the rotation.
 */
const SWING_COMP_FIGURES: Array<{ hits: Array<{ b: number; d: number }>; weight: number; busy: number }> = [
	{ hits: [{ b: 0, d: 2 }, { b: 1.5, d: 0.5 }], weight: 3, busy: 2 }, // Charleston
	{ hits: [{ b: 2, d: 1 }, { b: 3.5, d: 1 }], weight: 2, busy: 2 }, // late Charleston, pushing on
	{ hits: [{ b: 1, d: 0.6 }, { b: 3, d: 0.6 }], weight: 3, busy: 2 }, // 2 and 4
	{ hits: [{ b: 1.5, d: 1 }], weight: 2, busy: 1 }, // and-of-2 alone
	{ hits: [{ b: 0.5, d: 0.5 }, { b: 2.5, d: 0.6 }], weight: 2, busy: 2 }, // off-beat pair
	{ hits: [{ b: 3.5, d: 1.2 }], weight: 2, busy: 1 }, // anticipation across the bar line
	{ hits: [{ b: 1, d: 0.6 }, { b: 2.5, d: 0.5 }], weight: 2, busy: 2 },
	{ hits: [], weight: 2, busy: 0 } // deliberate space
];

const swing: StyleDefinition = {
	name: 'Swing',
	defaultSwing: 0.67,
	drumPattern: (ctx: GenerationContext): DrumHitSpec[] => {
		const { rng, beatsPerBar } = ctx;
		const hits: DrumHitSpec[] = [];

		// Ride "spang-a-lang": a quarter on every beat, with the swung skip
		// eighth after the backbeats (2 and 4 in 4/4). Backbeats sit a shade
		// stronger — that's where the time lives.
		for (let b = 0; b < beatsPerBar; b++) {
			const backbeat = b % 2 === 1;
			hits.push({
				drum: 'ride',
				beatOffset: b,
				velocity: (backbeat ? 0.44 : 0.38) + rng.float() * 0.06
			});
			if (backbeat && b + 0.5 < beatsPerBar) {
				hits.push({ drum: 'ride', beatOffset: b + 0.5, velocity: 0.28 + rng.float() * 0.08 });
			}
		}

		// Hi-hat (foot) on the backbeats.
		for (let b = 1; b < beatsPerBar; b += 2) {
			hits.push({ drum: 'hihat', beatOffset: b, velocity: 0.45 + rng.float() * 0.1 });
		}

		// Feathered kick: barely-there quarters, some bars only.
		if (rng.chance(0.7)) {
			for (let b = 0; b < beatsPerBar; b++) {
				hits.push({ drum: 'kick', beatOffset: b, velocity: 0.1 + rng.float() * 0.06 });
			}
		}

		// Catch a strong comp push now and then: a kick under an off-beat
		// comp hit reads as the drummer hearing the piano.
		for (const onset of ctx.compOnsets ?? []) {
			if (onset % 1 !== 0 && rng.chance(0.35)) {
				hits.push({ drum: 'kick', beatOffset: onset, velocity: 0.26 + rng.float() * 0.08 });
			}
		}

		// Section-final setup: a small additive figure into the next section,
		// varied per chorus through the seeded RNG. Built only from the kit's
		// three voices — a CC0 snare/brush sample under static/samples/drums/
		// would allow fuller fills here later.
		if (ctx.isSectionFinalBar && !ctx.isFinalBar && beatsPerBar >= 3) {
			const last = beatsPerBar - 1;
			const setup = rng.int(0, 2);
			if (setup === 0) {
				hits.push({ drum: 'kick', beatOffset: last + 0.5, velocity: 0.4 + rng.float() * 0.1 });
			} else if (setup === 1) {
				hits.push({ drum: 'hihat', beatOffset: last - 0.5, velocity: 0.35 });
				hits.push({ drum: 'hihat', beatOffset: last + 0.5, velocity: 0.55 });
				hits.push({ drum: 'kick', beatOffset: last, velocity: 0.35 });
			} else {
				hits.push({ drum: 'ride', beatOffset: last - 0.5, velocity: 0.5 });
				hits.push({ drum: 'kick', beatOffset: last + 0.5, velocity: 0.38 });
			}
		}

		return hits;
	},
	compPattern: (ctx: GenerationContext): CompHitSpec[] => {
		const { rng, beatsPerBar } = ctx;

		// Non-4/4 fallback: downbeat plus an occasional backbeat nudge.
		if (beatsPerBar !== 4) {
			const hits: CompHitSpec[] = [{ beatOffset: 0, velocity: rng.int(56, 66), durationBeats: 1.5 }];
			if (rng.chance(0.4)) {
				hits.push({ beatOffset: beatsPerBar - 1, velocity: rng.int(50, 60), durationBeats: 0.6 });
			}
			return hits;
		}

		// Bias the figure choice by position: set up section arrivals with a
		// busier figure, keep later choruses a touch more active than the first.
		const busyBias = (ctx.isSectionFinalBar ? 1.5 : 1) * ((ctx.chorusIndex ?? 0) > 0 ? 1.2 : 1);
		let figure = rng.weighted(
			SWING_COMP_FIGURES.map((f) => ({ value: f, weight: f.busy >= 2 ? f.weight * busyBias : f.weight }))
		);

		// The very first bar states the harmony: guarantee an early hit.
		if (ctx.barIndex === 0 && !figure.hits.some((h) => h.b <= 1)) {
			figure = SWING_COMP_FIGURES[0];
		}

		const hits: CompHitSpec[] = [];
		for (const h of figure.hits) {
			// Nothing follows the final bar — an anticipation there would hang.
			if (ctx.isFinalBar && h.b >= beatsPerBar - 0.5) continue;
			const offBeat = h.b % 1 !== 0;
			hits.push({
				beatOffset: h.b,
				velocity: rng.int(56, 68) + (offBeat ? 6 : 0),
				durationBeats: h.d
			});
		}
		// A final bar whose figure was pure anticipation resolves instead.
		if (ctx.isFinalBar && hits.length === 0 && figure.hits.length > 0) {
			hits.push({ beatOffset: 0, velocity: rng.int(56, 66), durationBeats: 2 });
		}
		return hits;
	},
	bassStyle: 'walking'
};

// ── Bossa Nova ───────────────────────────────────────────────

const bossaNova: StyleDefinition = {
	name: 'Bossa Nova',
	defaultSwing: 0.5,
	drumPattern: (ctx: GenerationContext): DrumHitSpec[] => {
		const { rng, beatsPerBar } = ctx;
		const hits: DrumHitSpec[] = [];
		// Cross-stick rim feel on 2 and 4, hi-hat on every beat with syncopation
		for (let b = 0; b < beatsPerBar; b++) {
			const isRimBeat = b === 1 || b === 3;
			if (b === 0 || b === 2) {
				hits.push({ drum: 'kick', beatOffset: b, velocity: b === 0 ? 0.4 : 0.3 });
			}
			hits.push({ drum: 'hihat', beatOffset: b, velocity: (isRimBeat ? 0.6 : 0.3) + rng.float() * 0.04 });
		}
		return hits;
	},
	compPattern: (ctx: GenerationContext): CompHitSpec[] => {
		const { rng, beatsPerBar } = ctx;
		// Syncopated guitar-style pattern: hits on 1, 3, and 4
		const bossaHits = [true, false, true, true];
		const hits: CompHitSpec[] = [];
		for (let b = 0; b < beatsPerBar; b++) {
			if (bossaHits[b % 4]) {
				hits.push({ beatOffset: b, velocity: 55 + rng.int(0, 8), durationBeats: 0.5 });
			}
		}
		return hits;
	},
	bassStyle: 'pattern'
};

// ── Ballad ───────────────────────────────────────────────────

const ballad: StyleDefinition = {
	name: 'Ballad',
	defaultSwing: 0.55,
	drumPattern: (ctx: GenerationContext): DrumHitSpec[] => {
		const { beatsPerBar } = ctx;
		// Sparse: soft ride on every beat, minimal kick on 1 only
		const hits: DrumHitSpec[] = [{ drum: 'kick', beatOffset: 0, velocity: 0.3 }];
		for (let b = 0; b < beatsPerBar; b++) {
			hits.push({ drum: 'ride', beatOffset: b, velocity: 0.25 });
		}
		return hits;
	},
	compPattern: (ctx: GenerationContext): CompHitSpec[] => {
		const { rng } = ctx;
		// Whole-note / half-note sustains: hit on beat 1, occasionally on 3
		const hits: CompHitSpec[] = [{ beatOffset: 0, velocity: 45 + rng.int(0, 8), durationBeats: 1.5 }];
		if (ctx.beatsPerBar >= 3 && rng.chance(0.3)) {
			hits.push({ beatOffset: 2, velocity: 40, durationBeats: 1 });
		}
		return hits;
	},
	bassStyle: 'walking'
};

// ── Straight ─────────────────────────────────────────────────

const straight: StyleDefinition = {
	name: 'Straight',
	defaultSwing: 0.5,
	drumPattern: (ctx: GenerationContext): DrumHitSpec[] => {
		const { beatsPerBar } = ctx;
		// Even feel: ride every beat, hi-hat on 2 and 4, kick on 1 and 3
		const hits: DrumHitSpec[] = [];
		for (let b = 0; b < beatsPerBar; b++) {
			hits.push({ drum: 'ride', beatOffset: b, velocity: 0.35 });
			if (b === 0 || b === 2) hits.push({ drum: 'kick', beatOffset: b, velocity: 0.4 });
			if (b === 1 || b === 3) hits.push({ drum: 'hihat', beatOffset: b, velocity: 0.4 });
		}
		return hits;
	},
	compPattern: (ctx: GenerationContext): CompHitSpec[] => {
		const { rng, beatsPerBar } = ctx;
		// Even quarter-note comping
		const hits: CompHitSpec[] = [];
		for (let b = 0; b < beatsPerBar; b++) {
			hits.push({ beatOffset: b, velocity: 55 + rng.int(0, 8), durationBeats: 1 / 3 });
		}
		return hits;
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
