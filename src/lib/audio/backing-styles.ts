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
import { lerp } from './backing-intensity';
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
	/** Ensemble intensity for this bar (backing-intensity.ts), in [0.2, 0.9]. */
	intensity: number;
	/** True when this bar is the last bar of a section (incl. the form's last bar). */
	isSectionFinalBar: boolean;
	/** True on the first bar of a chorus pass (bar 0 of a mapped phrase included). */
	isChorusFirstBar?: boolean;
	/** True on the last bar of a chorus when another chorus follows — the long fill's home. */
	isChorusFinalBar?: boolean;
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
	/**
	 * Which clave side even-indexed bars carry — drawn ONCE per phrase from
	 * the `clave` stream, constant across bars (a clave that flips
	 * mid-phrase is simply wrong). '32' = even bars take the 3-side.
	 * Only the bossa pattern reads it.
	 */
	clavePhase?: '32' | '23';
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
	/**
	 * Which bass engine the style uses: 'auto' = the walking planner
	 * (two-feel first chorus latching open to four); 'two' = the planner
	 * pinned to permanent two-feel (ballad — half notes all night, no walk
	 * escapes); 'pattern' = the bossa root–fifth ostinato
	 * (`generateBossaBass`; non-4/4 falls back to the walking planner).
	 * Values are added WITH their implementation, never speculatively.
	 */
	bass: 'auto' | 'two' | 'pattern';
	/**
	 * Ceiling on the per-bar ensemble intensity (backing-intensity.ts),
	 * applied to the whole BarInfo timeline before any generator reads it:
	 * a ballad never digs in past 0.6 no matter how deep the form runs.
	 */
	intensityCap?: number;
	/**
	 * Multipliers over the comp voicing-choice weights (rootless A/B,
	 * shell, drop-2, quartal) — how a style colors its harmony: the ballad
	 * leans into drop-2 spread and quartal openness.
	 */
	voicingBias?: Partial<
		Record<'rootlessA' | 'rootlessB' | 'shell' | 'drop2' | 'quartal', number>
	>;
	/**
	 * Multipliers over the comp figure-planner weights, keyed by figure id
	 * (backing-comp-figures.ts) — how a `compPlanning` style leans the
	 * shared library: straight rests more (`rest: 1.3`).
	 */
	compFigureBias?: Partial<Record<string, number>>;
}

// ── Swing ────────────────────────────────────────────────────

/**
 * The composed swing-vocabulary drum bar (backing-drum-vocab.ts): the
 * ostinato (ride mode + hats + feather) is the fabric; snare comping and
 * bass/comp coupling are ADDITIONS capped at one voice per offset; fills/
 * setups/crash draw from the separate `drum-fill` stream so a vocabulary
 * change can never reshuffle the timekeeping. Shared by swing and — at
 * ratio 0.5 with `extraColor` (the cross-stick) — the straight style.
 * `extraColor` joins the additions LAST, so it never displaces
 * form-marking fills, coupling kicks, or the snare's chatter.
 */
function swingVocabularyBar(ctx: GenerationContext, extraColor: DrumHitSpec[] = []): DrumHitSpec[] {
	const { rng, beatsPerBar } = ctx;
	const mode = chooseRideMode(rng, ctx.intensity);
	const ride = rideBar(mode, ctx.barIndex, beatsPerBar, rng);
	const fillRng = ctx.fillRng ?? rng;
	const { hits: fills, suppressDownbeatRide, anticipated } = fillBar(ctx, fillRng);
	const ostinato = [
		// A crash (or bell) on the section downbeat replaces that beat's ride.
		...(suppressDownbeatRide ? ride.filter((h) => h.beatOffset !== 0) : ride),
		...hihatBar(beatsPerBar, rng),
		...featherBar(beatsPerBar, rng, ctx.intensity),
		// Anticipated hits live at negative offsets (the previous bar's
		// and-of-4) — ostinato-bound so the one-per-offset ledger can't
		// drop the push's kick under its crash.
		...anticipated
	];
	// Call order (snare → coupling) is the `drums` stream draw order and
	// must not change; the ARRAY order is occupancy priority — form-marking
	// fills first, then coupling kicks, then ghost chatter.
	const snare = snareBar(ctx, rng);
	const coupling = couplingBar(ctx, rng);
	return capAdditionsPerOffset(ostinato, [...fills, ...coupling, ...snare, ...extraColor]);
}

const swing: StyleDefinition = {
	name: 'Swing',
	defaultSwing: 0.67,
	swingModel: 'tempo',
	timing: SWING_TIMING,
	drumPattern: (ctx: GenerationContext): DrumHitSpec[] => swingVocabularyBar(ctx),
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
					velocity:
						rng.int(56, 68) + (offBeat ? 6 : 0) + cadencePush + Math.round(lerp(-4, 6, ctx.intensity)),
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
	bass: 'auto'
};

// ── Bossa Nova ───────────────────────────────────────────────

/** Bossa rim-click clave, per side. The 3-side is 1, and-of-2, 4; the
 *  2-side is the Brazilian variant 2, and-of-3 (not son clave's 2-3). */
const BOSSA_CLAVE: Record<'three' | 'two', number[]> = {
	three: [0, 1.5, 3],
	two: [1, 2.5]
};

/** Which clave side a bar carries, given the phrase's drawn phase. */
function bossaClaveSide(barIndex: number, phase: '32' | '23'): 'three' | 'two' {
	const evenIsThree = phase === '32';
	return barIndex % 2 === 0 ? (evenIsThree ? 'three' : 'two') : evenIsThree ? 'two' : 'three';
}

const bossaNova: StyleDefinition = {
	name: 'Bossa Nova',
	defaultSwing: 0.5,
	swingModel: 'fixed',
	timing: BOSSA_TIMING,
	drumPattern: (ctx: GenerationContext): DrumHitSpec[] => {
		const { rng, beatsPerBar } = ctx;

		// Non-4/4 fallback: the clave is a 4/4 statement — keep simple time.
		if (beatsPerBar !== 4) {
			const hits: DrumHitSpec[] = [{ drum: 'kick', beatOffset: 0, velocity: 0.35 }];
			for (let b = 0; b < beatsPerBar; b++) {
				hits.push({ drum: 'hihat', beatOffset: b, velocity: 0.28 + rng.float() * 0.04 });
			}
			return hits;
		}

		const hits: DrumHitSpec[] = [];
		// Surdo-derived kick: the dotted root–fifth foundation the bass rides
		// (1, and-of-2, 3, and-of-4), felt more than heard.
		hits.push({ drum: 'kick', beatOffset: 0, velocity: 0.3 + rng.float() * 0.04 });
		hits.push({ drum: 'kick', beatOffset: 1.5, velocity: 0.2 + rng.float() * 0.03 });
		hits.push({ drum: 'kick', beatOffset: 2, velocity: 0.27 + rng.float() * 0.04 });
		hits.push({ drum: 'kick', beatOffset: 3.5, velocity: 0.2 + rng.float() * 0.03 });
		// Steady eighth hats — the ride of this style — quarters lightly
		// accented so the pulse stays legible under the syncopation.
		for (let e = 0; e < beatsPerBar * 2; e++) {
			const off = e / 2;
			hits.push({
				drum: 'hihat',
				beatOffset: off,
				velocity: (off % 1 === 0 ? 0.26 : 0.19) + rng.float() * 0.04
			});
		}
		// Rim-click clave: side chosen by the phrase-level phase draw —
		// steady, hypnotic, NEVER varied per bar (a wandering clave is the
		// one unforgivable bossa mistake).
		const side = bossaClaveSide(ctx.barIndex, ctx.clavePhase ?? '32');
		for (const off of BOSSA_CLAVE[side]) {
			hits.push({ drum: 'crossstick', beatOffset: off, velocity: 0.38 + rng.float() * 0.05 });
		}
		return hits;
	},
	compPattern: (ctx: GenerationContext): CompHitSpec[] => {
		const { rng, beatsPerBar } = ctx;

		// Non-4/4 fallback: state the harmony on the downbeat.
		if (beatsPerBar !== 4) {
			return [{ beatOffset: 0, velocity: rng.int(50, 60), durationBeats: 1.2 }];
		}

		// João-style comp: short syncopated chords tracking the clave side,
		// so guitar-hand and rim speak the same sentence. The and-of-3 push
		// on the 2-side rides the engine's next-beat anticipation voicing.
		const side = bossaClaveSide(ctx.barIndex, ctx.clavePhase ?? '32');
		const figure =
			side === 'three'
				? [
						{ b: 0, d: 0.8 },
						{ b: 1.5, d: 0.9 },
						{ b: 3, d: 0.7 }
					]
				: [
						{ b: 1, d: 0.8 },
						{ b: 2.5, d: 1.1 }
					];
		const hits: CompHitSpec[] = [];
		for (const { b, d } of figure) {
			// Breathe: occasionally thin a non-anchor hit.
			if (b !== figure[0].b && rng.chance(0.12)) continue;
			hits.push({
				beatOffset: b,
				velocity: rng.int(50, 60) + (b % 1 !== 0 ? 4 : 0),
				durationBeats: d * (0.9 + rng.float() * 0.2)
			});
		}
		return hits;
	},
	bass: 'pattern'
};

// ── Ballad ───────────────────────────────────────────────────

const ballad: StyleDefinition = {
	name: 'Ballad',
	defaultSwing: 0.55,
	swingModel: 'fixed',
	timing: BALLAD_TIMING,
	intensityCap: 0.6,
	voicingBias: { drop2: 2.5, quartal: 2.2, rootlessA: 0.7 },
	drumPattern: (ctx: GenerationContext): DrumHitSpec[] => {
		const { rng, beatsPerBar } = ctx;
		const hits: DrumHitSpec[] = [];

		// The library has no brushes (sticks only — see ATTRIBUTION.md), so
		// the ballad kit speaks in the quietest stick voices instead: soft
		// ride quarters, the hi-hat FOOT on 2 & 4, a barely-there kick, and
		// cross-stick / ghost-snare color in place of brush taps.
		for (let b = 0; b < beatsPerBar; b++) {
			const backbeat = b % 2 === 1;
			hits.push({
				drum: 'ride',
				beatOffset: b,
				velocity: (backbeat ? 0.24 : 0.2) + rng.float() * 0.04
			});
		}
		for (let b = 1; b < beatsPerBar; b += 2) {
			hits.push({ drum: 'hihat-pedal', beatOffset: b, velocity: 0.24 + rng.float() * 0.04 });
		}
		if (rng.chance(0.8)) {
			hits.push({ drum: 'kick', beatOffset: 0, velocity: 0.13 + rng.float() * 0.04 });
		}
		if (beatsPerBar === 4 && rng.chance(0.25)) {
			hits.push({ drum: 'kick', beatOffset: 2, velocity: 0.11 + rng.float() * 0.03 });
		}

		if (beatsPerBar === 4) {
			// Color, sparse: a cross-stick on 4 or a ghost tap on a soft spot —
			// never both, never loud.
			if (rng.chance(0.22)) {
				hits.push({ drum: 'crossstick', beatOffset: 3, velocity: 0.26 + rng.float() * 0.05 });
			} else if (rng.chance(0.18)) {
				hits.push({
					drum: 'snare',
					beatOffset: rng.pick([1.5, 2.5]),
					velocity: 0.12 + rng.float() * 0.04
				});
			}
			// Gentle section marking from the fill stream: a cross-stick lean
			// into the barline — a ballad "setup" whispers.
			const fillRng = ctx.fillRng ?? rng;
			if (ctx.isSectionFinalBar && !ctx.isFinalBar && fillRng.chance(0.55)) {
				hits.push({ drum: 'crossstick', beatOffset: 3.5, velocity: 0.28 + fillRng.float() * 0.04 });
			}
		}
		return hits;
	},
	compPattern: (ctx: GenerationContext): CompHitSpec[] => {
		const { rng, beatsPerBar } = ctx;

		// Non-4/4 fallback: one sustained statement.
		if (beatsPerBar !== 4) {
			return [{ beatOffset: 0, velocity: rng.int(42, 52), durationBeats: beatsPerBar * 0.9 }];
		}

		// Pads and space: whole-bar sustains, half pads, a late pad answering
		// the bar, or silence — the pianist breathes with the singer. Section
		// and phrase downbeats always sound (the harmony must arrive).
		type Figure = 'pad-whole' | 'pads-halves' | 'late-pad' | 'rest';
		const anchor = ctx.barIndex === 0 || ctx.isSectionFirstBar;
		const figure = rng.weighted<Figure>([
			{ value: 'pad-whole', weight: 3 },
			{ value: 'pads-halves', weight: 2 },
			{ value: 'late-pad', weight: anchor ? 0 : 1 },
			{ value: 'rest', weight: anchor ? 0 : 1.2 }
		]);
		const vel = (): number => rng.int(42, 54) + Math.round(lerp(-2, 4, ctx.intensity));
		const hits: CompHitSpec[] = [];
		if (figure === 'pad-whole') {
			hits.push({ beatOffset: 0, velocity: vel(), durationBeats: 3.6 });
		} else if (figure === 'pads-halves') {
			hits.push({ beatOffset: 0, velocity: vel(), durationBeats: 1.8 });
			hits.push({ beatOffset: 2, velocity: vel() - 3, durationBeats: 1.7 });
		} else if (figure === 'late-pad') {
			hits.push({ beatOffset: 2, velocity: vel() - 2, durationBeats: 1.8 });
		}
		// Cadence lean: a soft SHORT pickup into the section boundary. The
		// x.5 anticipation voices the coming chord, and the next bar's
		// anchor pad re-attacks it on the downbeat — so the lean must
		// release before the barline (a tied push would flam against that
		// re-attack at ballad tempi).
		if (ctx.isSectionFinalBar && !ctx.isFinalBar && rng.chance(0.35)) {
			hits.push({ beatOffset: 3.5, velocity: vel() - 4, durationBeats: 0.45 });
		}
		return hits;
	},
	bass: 'two'
};

// ── Straight ─────────────────────────────────────────────────

const straight: StyleDefinition = {
	name: 'Straight',
	defaultSwing: 0.5,
	swingModel: 'fixed',
	timing: STRAIGHT_TIMING,
	// The straight style IS the swing library played at ratio 0.5 with the
	// halved timing profile: the whole vocabulary — ride modes, snare
	// dialogue, fills, the planner's phrase memory — lands on even eighths.
	// Two leans distinguish it: the planner rests a little more (even
	// eighths clutter faster than swung ones), and a cross-stick on beat 4
	// colors the even feel.
	compPlanning: true,
	compFigureBias: { rest: 1.3 },
	drumPattern: (ctx: GenerationContext): DrumHitSpec[] => {
		// The color draw comes FIRST from the drums stream (documented draw
		// order for this style), then the shared vocabulary body runs.
		const color: DrumHitSpec[] = [];
		if (ctx.beatsPerBar === 4 && ctx.rng.chance(0.35)) {
			color.push({ drum: 'crossstick', beatOffset: 3, velocity: 0.28 + ctx.rng.float() * 0.05 });
		}
		return swingVocabularyBar(ctx, color);
	},
	compPattern: swing.compPattern,
	bass: 'auto'
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

/** The style ids, in display order — the one list every style picker and
 *  validator should consume instead of hand-copying the union. */
export const BACKING_STYLE_IDS = Object.keys(BACKING_STYLES) as BackingStyle[];
