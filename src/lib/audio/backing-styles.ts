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
import {
	SWING_TIMING,
	BALLAD_TIMING,
	BOSSA_TIMING,
	STRAIGHT_TIMING,
	type TimingProfile,
	type TimingRole
} from './backing-timing';
import {
	chooseRideMode,
	rideBar,
	hihatBar,
	featherBar,
	snareBar,
	couplingBar,
	fillBar,
	capAdditionsPerOffset
} from './backing-drum-vocab';

export type DrumVoice =
	| 'kick'
	| 'ride'
	| 'hihat'
	| 'hihat-pedal'
	| 'snare'
	| 'crossstick'
	| 'ride-bell'
	| 'crash';

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
	/** True on a section's first bar (a form arrival — the crash's home). */
	isSectionFirstBar: boolean;
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
	/** Bass onsets this bar (beat offsets), for kick/bass pickup coupling. */
	bassOnsets?: number[];
	/**
	 * Dedicated per-bar stream for fills/setups/crashes (`drum-fill` role),
	 * so form punctuation can never reshuffle the timekeeping draws.
	 */
	fillRng?: SeededRng;
	/**
	 * Planned comp figure for this bar (styles with `compPlanning`), already
	 * resolved to concrete hits by the planner: the pattern function only
	 * realizes velocity/articulation.
	 */
	plannedComp?: { hits: Array<{ b: number; d: number }>; tags: string[]; guideTones: boolean };
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
	/**
	 * How the effective backing swing resolves when the session swing sits
	 * straight: 'tempo' follows the Friberg–Sundström tempo curve
	 * (`swingForTempo`); 'fixed' always uses `defaultSwing` — a 60 BPM
	 * ballad must not inherit a 3.5:1 grid.
	 */
	swingModel: 'tempo' | 'fixed';
	/** Per-role ensemble microtiming profiles (see backing-timing.ts). */
	timing: Record<TimingRole, TimingProfile>;
	/**
	 * When true, `generateComping` plans figures across the whole phrase
	 * (backing-comp-figures.ts: anti-repetition memory, phrase-position
	 * rules) and hands each bar's hits in via `ctx.plannedComp`.
	 */
	compPlanning?: boolean;
	/** Generate one bar of drum hits. */
	drumPattern: (ctx: GenerationContext) => DrumHitSpec[];
	/** Generate one bar of comp hits. */
	compPattern: (ctx: GenerationContext) => CompHitSpec[];
	/** Bass style: 'walking' = chord-tone walking, 'pedal' = root pedal, 'pattern' = rhythmic pattern */
	bassStyle: 'walking' | 'pedal' | 'pattern';
}

// ── Swing ────────────────────────────────────────────────────

const swing: StyleDefinition = {
	name: 'Swing',
	defaultSwing: 0.67,
	swingModel: 'tempo',
	timing: SWING_TIMING,
	drumPattern: (ctx: GenerationContext): DrumHitSpec[] => {
		const { rng, beatsPerBar } = ctx;

		// Composed vocabulary passes (backing-drum-vocab.ts): the ostinato
		// (ride mode + hats + feather) is the fabric; snare comping and
		// bass/comp coupling are ADDITIONS capped at one voice per offset;
		// fills/setups/crash draw from the separate `drum-fill` stream so a
		// vocabulary change can never reshuffle the timekeeping.
		const mode = chooseRideMode(rng);
		const ride = rideBar(mode, ctx.barIndex, beatsPerBar, rng);
		const fillRng = ctx.fillRng ?? rng;
		const { hits: fills, crashOnOne } = fillBar(ctx, fillRng);
		const ostinato = [
			// A crash on the section downbeat replaces that beat's ride.
			...(crashOnOne ? ride.filter((h) => h.beatOffset !== 0) : ride),
			...hihatBar(beatsPerBar, rng),
			...featherBar(beatsPerBar, rng)
		];
		// Call order (snare → coupling) is the `drums` stream draw order and
		// must not change; the ARRAY order is occupancy priority — form-marking
		// fills first, then coupling kicks, then ghost chatter.
		const snare = snareBar(ctx, rng);
		const coupling = couplingBar(ctx, rng);
		return capAdditionsPerOffset(ostinato, [...fills, ...coupling, ...snare]);
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

		// Planned path: the figure planner already chose this bar's rhythm
		// (with anti-repetition memory and phrase-position rules); realize
		// velocity and articulation here.
		const planned = ctx.plannedComp;
		if (planned) {
			const isPush = planned.tags.includes('push');
			const isPad = planned.tags.includes('pad');
			return planned.hits.map((h) => {
				const offBeat = h.b % 1 !== 0;
				const cadencePush =
					ctx.isSectionFinalBar && !ctx.isFinalBar && offBeat && isPush ? 6 : 0;
				// Articulation: pads sustain as written, pushes keep enough
				// length to audibly tie across the barline, everything else
				// stabs short.
				let d = h.d * (0.9 + rng.float() * 0.2);
				if (!isPad && offBeat && !isPush) d = Math.min(d, 0.7);
				if (isPush && h.b >= beatsPerBar - 0.5) d = Math.max(d, 1.1);
				return {
					beatOffset: h.b,
					velocity: rng.int(56, 68) + (offBeat ? 6 : 0) + cadencePush,
					durationBeats: d
				};
			});
		}

		// Planned hits always arrive for 4/4 swing (generateComping gates the
		// planner); reaching here without them means a non-4/4 meter, which
		// returned from the early fallback above, or a caller outside the
		// engine — state the harmony simply rather than guessing.
		return [{ beatOffset: 0, velocity: rng.int(56, 66), durationBeats: 1.5 }];
	},
	compPlanning: true,
	bassStyle: 'walking'
};

// ── Bossa Nova ───────────────────────────────────────────────

const bossaNova: StyleDefinition = {
	name: 'Bossa Nova',
	defaultSwing: 0.5,
	swingModel: 'fixed',
	timing: BOSSA_TIMING,
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
	swingModel: 'fixed',
	timing: BALLAD_TIMING,
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
	swingModel: 'fixed',
	timing: STRAIGHT_TIMING,
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
