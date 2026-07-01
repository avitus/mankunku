/**
 * Musical expression pass (Tier 1: dynamics + articulation).
 *
 * Pure functions that turn a phrase's bare notes into per-note performance
 * parameters following standard jazz practice — a dynamic arch, metric/agogic
 * accents, ghosted passing tones, and articulation (legato runs vs. detached
 * swing quarters vs. staccato). No audio or side effects; consumed by
 * `audio/playback.ts` at the `phraseToEvents` choke point.
 *
 * Design notes:
 * - Loudness (`velocity`) is the only per-note gain lever and also selects the
 *   piano/forte sample layer at velocitySplit=100, so the dynamic scale is
 *   built to span 100: ghosts ~55-70 (dark piano), normal ~85-100, accents
 *   ~110-120 (bright forte). `layerVelocity` is the *intended* (pre-jitter)
 *   value so timbre tracks intent deterministically — humanization jitters
 *   only gain, never the layer.
 * - Articulation is realized via note-length (`durationScale`) and note-ending
 *   crispness (`release` → smplr `ampRelease`); attack is uncontrollable in the
 *   current engine, so tonguing is approximated by trimming length.
 * - `cutoffHz` darkens soft/ghost notes only (a per-note lowpass beneath the
 *   global warmth filter); accent brightness comes from the forte sample layer.
 * - Timing is deliberately NOT touched here — the swung grid is shared with the
 *   scorer, so onset timing must stay exactly as `phraseToEvents` computes it.
 */

import type { Note, Phrase, Fraction, Articulation } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import { fractionToFloat, addFractions, midiToPitchClass } from './intervals';
import { CHORD_DEFINITIONS } from './chords';
import { getScale } from './scales';
import { realizeScale } from './keys';
import { findHarmonyAt } from './harmony';

export type ExpressionIntensity = 'subtle' | 'moderate' | 'pronounced';

export interface ExpressionOptions {
	/** Overall strength of the shaping. Defaults to 'moderate'. */
	intensity?: ExpressionIntensity;
}

/**
 * A single sounding note after rest-skipping and tie-chain merging — the same
 * sequence `phraseToEvents` iterates, so an aligned expression array can be
 * zipped straight onto the played events.
 */
export interface SoundingNote {
	/** MIDI note number (concert pitch) */
	pitch: number;
	/** Offset of the first note of the (possibly tied) chain, whole-note fraction */
	offset: Fraction;
	/** Combined (tie-merged) duration, whole-note fraction */
	duration: Fraction;
	/** Authored velocity from the chain's first note, if any */
	velocity?: number;
	/** Authored articulation from the chain's first note, if any */
	articulation?: Articulation;
	/** 0-based position within the sounding-note sequence */
	index: number;
}

export interface NoteExpression {
	/** Intended loudness (MIDI 1-127), before gain humanization */
	velocity: number;
	/** Intended velocity used ONLY for deterministic piano/forte layer selection */
	layerVelocity: number;
	/** Multiplier on the notated duration (articulation length) */
	durationScale: number;
	/** Amplitude release tail in seconds (smplr `ampRelease`) */
	release: number;
	/** Per-note lowpass cutoff in Hz (smplr `lpfCutoffHz`); 20000 = no filter */
	cutoffHz: number;
}

const BASE_VELOCITY = 88;
const VELOCITY_MIN = 45;
const VELOCITY_MAX = 122;
/** smplr only inserts a per-voice lowpass when cutoff < this sentinel */
const NO_FILTER_HZ = 20000;

const EPS = 1e-6;

function clamp(x: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, x));
}

/** Velocity-delta scaling by intensity (how dramatic the dynamics are). */
function velocityFactor(intensity: ExpressionIntensity): number {
	return intensity === 'subtle' ? 0.55 : intensity === 'pronounced' ? 1.5 : 1;
}

/** Articulation scaling by intensity (how detached/staccato notes get). */
function articulationFactor(intensity: ExpressionIntensity): number {
	return intensity === 'subtle' ? 0.6 : intensity === 'pronounced' ? 1.3 : 1;
}

/**
 * Ghost-note profile — a "swallowed" saxophone ghost: quiet, very short, and
 * heavily muffled. Attack shaping isn't available in the engine, so the heavy
 * lowpass (see `ghostCutoff`) carries the muffled character. Base note-length
 * is scaled by the articulation factor in `computeArticulation`.
 */
const GHOST = {
	/** Base fraction of the notated length actually sounded (before intensity). */
	durationScale: 0.5,
	/** Crisp, short release so the ghost cuts off cleanly. */
	release: 0.05
};

/**
 * Ghost loudness (MIDI). Clearly under the ~88 mp melody but still audible
 * ("noticeable but de-emphasized"). Intensity-scaled: higher intensity ⇒
 * quieter (more de-emphasized) ghost.
 */
function ghostVelocity(vf: number): number {
	return clamp(Math.round(72 - 12 * vf), VELOCITY_MIN, VELOCITY_MAX);
}

/**
 * Ghost brightness (Hz). A heavy per-note lowpass is the key perceptual cue
 * for "swallowed"; lightly darker at higher intensity.
 */
function ghostCutoff(vf: number): number {
	return Math.round(2500 - 200 * vf);
}

/**
 * Rest-skip + tie-merge walk producing the sounding-note sequence.
 * Mirrors the walk in `phraseToEvents` exactly so the two stay aligned.
 */
export function extractSoundingNotes(notes: Note[]): SoundingNote[] {
	const out: SoundingNote[] = [];
	let index = 0;
	for (let i = 0; i < notes.length; i++) {
		const note = notes[i];
		if (note.pitch === null) continue;
		let combined: Fraction = note.duration;
		while (notes[i].tied && i + 1 < notes.length && notes[i + 1].pitch === note.pitch) {
			i++;
			combined = addFractions(combined, notes[i].duration);
		}
		out.push({
			pitch: note.pitch,
			offset: note.offset,
			duration: combined,
			velocity: note.velocity,
			articulation: note.articulation,
			index: index++
		});
	}
	return out;
}

type Role = 'chordTone' | 'scaleTone' | 'chromatic' | 'unknown';

interface NoteContext {
	beat: number;
	barPos: number;
	frac: number;
	onBeat: boolean;
	offBeat8: boolean;
	strongBeat: boolean;
	durBeats: number;
	isEighthOrShorter: boolean;
	isQuarter: boolean;
	isLong: boolean;
	role: Role;
	downwardLeapNext: boolean;
	longerThanNeighbors: boolean;
	isAccentTarget: boolean;
}

function isNear(x: number, target: number, tol = 0.05): boolean {
	return Math.abs(x - target) <= tol;
}

/** Classify a note's harmonic role against the active chord/scale segment. */
function classifyRole(phrase: Phrase, pitch: number, wholePos: number): Role {
	const seg = findHarmonyAt(phrase.harmony, wholePos);
	if (!seg) return 'unknown';
	const rootPc = PITCH_CLASSES.indexOf(seg.chord.root);
	if (rootPc < 0) return 'unknown';
	const notePc = midiToPitchClass(pitch);
	const chordPcs = CHORD_DEFINITIONS[seg.chord.quality].intervals.map((iv) => (rootPc + iv) % 12);
	if (chordPcs.includes(notePc)) return 'chordTone';
	const scale = getScale(seg.scaleId);
	if (scale) {
		const scalePcs = realizeScale(seg.chord.root, scale.intervals);
		if (scalePcs.includes(notePc)) return 'scaleTone';
		return 'chromatic';
	}
	return 'scaleTone';
}

function buildContext(phrase: Phrase, sounding: SoundingNote[], k: number): NoteContext {
	const beatsPerBar = phrase.timeSignature[0];
	const n = sounding.length;
	const cur = sounding[k];
	const prev = k > 0 ? sounding[k - 1] : null;
	const next = k < n - 1 ? sounding[k + 1] : null;

	const wholePos = fractionToFloat(cur.offset);
	const beat = wholePos * 4;
	const barPos = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
	const frac = beat - Math.floor(beat);
	const onBeat = isNear(frac, 0) || isNear(frac, 1);
	const offBeat8 = isNear(frac, 0.5);
	const strongBeat = onBeat && Math.round(barPos) % 2 === 0;

	const durBeats = fractionToFloat(cur.duration) * 4;
	const isEighthOrShorter = durBeats <= 0.5 + EPS;
	const isQuarter = durBeats > 0.5 + EPS && durBeats < 1.5 - EPS;
	const isLong = durBeats >= 1.5 - EPS;

	const role = classifyRole(phrase, cur.pitch, wholePos);
	const toNext = next ? next.pitch - cur.pitch : 0;
	const downwardLeapNext = next != null && toNext <= -3;

	const prevDur = prev ? fractionToFloat(prev.duration) * 4 : Infinity;
	const nextDur = next ? fractionToFloat(next.duration) * 4 : Infinity;
	const longerThanNeighbors =
		prev != null && next != null && durBeats > prevDur + EPS && durBeats > nextDur + EPS;

	const isAccentTarget = role === 'chordTone' && strongBeat;

	return {
		beat, barPos, frac, onBeat, offBeat8, strongBeat,
		durBeats, isEighthOrShorter, isQuarter, isLong,
		role, downwardLeapNext, longerThanNeighbors, isAccentTarget
	};
}

/**
 * Decide whether a note is a ghost, using neighbor context. An explicit
 * `articulation:'ghost'` always wins (over any authored velocity too); other
 * explicit articulations opt out. Otherwise a note ghosts only if it is a weak,
 * fast, non-structural connective note — idiomatic ghost placement:
 *  - a chromatic passing/approach tone,
 *  - a stepwise approach into an accent target,
 *  - a repeated-note weak upbeat, or
 *  - a stepwise passing tone (approached and left by step).
 * Structural notes (apex, strong-beat / chord-tone / accent, first, last, and
 * quarter-or-longer notes) never ghost, so the line stays intelligible.
 * Deterministic — no randomness, so replays are consistent.
 */
function decideGhost(
	contexts: NoteContext[],
	sounding: SoundingNote[],
	k: number,
	apex: number
): boolean {
	const authored = sounding[k].articulation;
	if (authored === 'ghost') return true;
	if (authored === 'accent' || authored === 'staccato' || authored === 'legato') return false;

	const ctx = contexts[k];
	const n = contexts.length;
	// Guards: keep structural notes voiced.
	if (k === 0 || k === n - 1 || k === apex) return false;
	if (!ctx.isEighthOrShorter || ctx.strongBeat || ctx.isAccentTarget) return false;

	// Chromatic connective notes always ghost.
	if (ctx.role === 'chromatic') return true;
	// Chord tones carry the line — never ghost them via the broadened rules.
	if (ctx.role === 'chordTone') return false;

	const toPrev = sounding[k].pitch - sounding[k - 1].pitch;
	const toNext = sounding[k + 1].pitch - sounding[k].pitch;
	if (toPrev === 0) return true; // repeated-note weak upbeat
	if (Math.abs(toNext) <= 2 && contexts[k + 1].isAccentTarget) return true; // stepwise approach into accent
	if (Math.abs(toPrev) <= 2 && Math.abs(toNext) <= 2) return true; // stepwise passing tone
	return false;
}

/** 0 at the phrase ends, rising to 1 at the melodic apex. */
function archShape(i: number, apex: number, n: number): number {
	if (n <= 1) return 1;
	if (i <= apex) return apex === 0 ? 1 : i / apex;
	return apex >= n - 1 ? 1 : (n - 1 - i) / (n - 1 - apex);
}

function computeVelocity(
	ctx: NoteContext,
	k: number,
	n: number,
	apex: number,
	vf: number
): number {
	let v = BASE_VELOCITY;

	// Phrase arch: swell toward the apex, softer at the extremes.
	v += (archShape(k, apex, n) - 0.35) * 12 * vf;

	// Accents.
	if (ctx.isAccentTarget) {
		v += 15 * vf; // chord-tone target on a strong beat → crosses 100 into forte
	} else if (ctx.offBeat8 && ctx.downwardLeapNext) {
		v += 9 * vf; // bebop tongued off-beat before a downward leap
	} else if (ctx.strongBeat) {
		v += 4 * vf; // mild metric weight
	}

	// Agogic accent: a note noticeably longer than its neighbors.
	if (ctx.longerThanNeighbors) v += 6 * vf;

	// Mild de-emphasis of weak fast off-beat notes that aren't full ghosts.
	// (Full ghosts bypass this function — see `computeExpression`.)
	if (ctx.role === 'scaleTone' && ctx.isEighthOrShorter && ctx.offBeat8 && !ctx.strongBeat) {
		v -= 10 * vf;
	}

	// Phrase-shape endpoints.
	if (k === 0) v += 2; // slight lift on the entrance (breath scoop handled elsewhere)
	if (k === n - 1) v -= 11 * vf; // final note release
	else if (k === n - 2 && n >= 4) v -= 5 * vf;

	return clamp(Math.round(v), VELOCITY_MIN, VELOCITY_MAX);
}

interface Articulated {
	durationScale: number;
	release: number;
}

function computeArticulation(
	ctx: NoteContext,
	authored: Articulation | undefined,
	isGhost: boolean,
	k: number,
	n: number,
	beforeAccent: boolean,
	af: number
): Articulated {
	// Scale a target durationScale's deviation-from-1 by the articulation factor.
	const scaleDeviation = (ds: number): number => 1 - (1 - ds) * af;

	let base: Articulated;

	if (isGhost) {
		base = { durationScale: GHOST.durationScale, release: GHOST.release }; // swallowed: short + crisp
	} else if (authored === 'staccato') {
		base = { durationScale: 0.5, release: 0.06 };
	} else if (authored === 'legato') {
		base = { durationScale: 1.0, release: 0.2 };
	} else if (authored === 'accent') {
		base = { durationScale: 0.92, release: 0.1 };
	} else if (k === n - 1) {
		base = ctx.isLong ? { durationScale: 1.0, release: 0.35 } : { durationScale: 0.9, release: 0.1 };
	} else if (ctx.isEighthOrShorter) {
		base = { durationScale: 1.0, release: 0.18 }; // legato scalar run
	} else if (ctx.isQuarter) {
		base = { durationScale: 0.88, release: 0.09 }; // detached swing quarter
	} else if (ctx.isLong) {
		base = { durationScale: 1.0, release: 0.25 }; // sustain
	} else {
		base = { durationScale: 0.95, release: 0.15 };
	}

	let durationScale = scaleDeviation(base.durationScale);

	// A hair of separation before a tongued accent — only ever shortens.
	// Ghosts are already short, so skip.
	if (beforeAccent && !isGhost) {
		durationScale = Math.min(durationScale, scaleDeviation(0.9));
	}

	return { durationScale, release: base.release };
}

function computeCutoff(velocity: number, pitch: number): number {
	let cutoff = NO_FILTER_HZ;
	if (velocity < 72) cutoff = 3000;
	else if (velocity < 88) cutoff = 3900;
	// Low register is naturally darker.
	if (pitch < 55) cutoff = Math.min(cutoff, 3600);
	return cutoff;
}

/**
 * Compute per-note expression for a sounding-note sequence.
 * Authored `velocity` / `articulation` on a note are honored as explicit
 * intent; everything else is derived from metric position, harmonic role,
 * contour, and phrase shape.
 */
export function computeExpression(
	sounding: SoundingNote[],
	phrase: Phrase,
	opts: ExpressionOptions = {}
): NoteExpression[] {
	const intensity = opts.intensity ?? 'moderate';
	const vf = velocityFactor(intensity);
	const af = articulationFactor(intensity);
	const n = sounding.length;
	if (n === 0) return [];

	// Melodic apex = index of the highest pitch (first occurrence).
	let apex = 0;
	for (let k = 1; k < n; k++) {
		if (sounding[k].pitch > sounding[apex].pitch) apex = k;
	}

	const contexts = sounding.map((_, k) => buildContext(phrase, sounding, k));

	return sounding.map((s, k) => {
		const ctx = contexts[k];
		const isGhost = decideGhost(contexts, sounding, k, apex);
		// A ghost forces its swallowed dynamics/timbre — the 'ghost' intent wins
		// over any authored velocity; otherwise honor authored velocity, else compute.
		const intendedVelocity = isGhost ? ghostVelocity(vf) : (s.velocity ?? computeVelocity(ctx, k, n, apex, vf));
		const beforeAccent = k < n - 1 && contexts[k + 1].isAccentTarget;
		const { durationScale, release } = computeArticulation(ctx, s.articulation, isGhost, k, n, beforeAccent, af);
		const cutoffHz = isGhost ? ghostCutoff(vf) : computeCutoff(intendedVelocity, s.pitch);
		return {
			velocity: intendedVelocity,
			layerVelocity: intendedVelocity,
			durationScale,
			release,
			cutoffHz
		};
	});
}

/**
 * Convenience: extract sounding notes and compute their expression in one call.
 */
export function computePhraseExpression(
	phrase: Phrase,
	opts: ExpressionOptions = {}
): { sounding: SoundingNote[]; expression: NoteExpression[] } {
	const sounding = extractSoundingNotes(phrase.notes);
	return { sounding, expression: computeExpression(sounding, phrase, opts) };
}
