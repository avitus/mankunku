/**
 * Combinatorial lick generator — pairs scale patterns with rhythm templates
 * to produce standard Phrase objects.
 *
 * N scale patterns × M rhythm patterns (where note counts match) yields
 * hundreds of valid licks from ~35 pattern definitions. Output is standard
 * Phrase objects that work with all existing infrastructure unchanged.
 */

import type { Phrase, PhraseCategory, PitchClass, ChordQuality, HarmonicSegment, Note } from '$lib/types/music';
import type { ScalePattern, RhythmPattern } from '$lib/types/combinatorial';
import { SCALE_PATTERNS, RHYTHM_PATTERNS } from '$lib/data/patterns/index';
import { getScale } from '$lib/music/scales';
import { realizeScaleMidi } from '$lib/music/keys';
import { PITCH_CLASSES } from '$lib/types/music';
import { calculateDifficulty } from '$lib/difficulty/calculate';

/** Maps each category to the scale and harmony context used for realization */
const CATEGORY_CONTEXT: Record<string, {
	scaleId: string;
	chord: { root: PitchClass; quality: ChordQuality };
}> = {
	'pentatonic': { scaleId: 'pentatonic.major', chord: { root: 'C', quality: 'maj7' } },
	'blues': { scaleId: 'blues.minor', chord: { root: 'C', quality: '7' } },
	'ii-V-I-major': { scaleId: 'major.ionian', chord: { root: 'C', quality: 'maj7' } },
	'ii-V-I-minor': { scaleId: 'major.aeolian', chord: { root: 'C', quality: 'min7' } },
	'short-ii-V-I-major': { scaleId: 'major.ionian', chord: { root: 'C', quality: 'maj7' } },
	'short-ii-V-I-minor': { scaleId: 'major.aeolian', chord: { root: 'C', quality: 'min7' } },
	'digital-patterns': { scaleId: 'major.ionian', chord: { root: 'C', quality: 'maj7' } },
	'enclosures': { scaleId: 'major.ionian', chord: { root: 'C', quality: 'maj7' } },
	'modal': { scaleId: 'major.dorian', chord: { root: 'C', quality: 'min7' } },
	'bebop-lines': { scaleId: 'bebop.dominant', chord: { root: 'C', quality: '7' } }
};

/**
 * Realize scale-degree indices to MIDI pitches against a given scale.
 * Returns null if the scale is unknown or degrees fall outside the pool range.
 */
export function realizeScalePattern(
	degrees: number[],
	scaleId: string,
	key: PitchClass
): number[] | null {
	const scale = getScale(scaleId);
	if (!scale) return null;

	// Build a wide MIDI pool for this scale
	const pool = realizeScaleMidi(key, scale.intervals, 36, 96);
	if (pool.length === 0) return null;

	// Find the root note in the pool closest to C4 (MIDI 60)
	const rootPc = PITCH_CLASSES.indexOf(key);
	let rootIdx = -1;
	let bestDist = Infinity;
	for (let i = 0; i < pool.length; i++) {
		if (pool[i] % 12 === rootPc) {
			const dist = Math.abs(pool[i] - 60);
			if (dist < bestDist) {
				bestDist = dist;
				rootIdx = i;
			}
		}
	}
	if (rootIdx === -1) return null;

	// Map each degree to a MIDI pitch via pool indexing
	const pitches: number[] = [];
	for (const degree of degrees) {
		const idx = rootIdx + degree;
		if (idx < 0 || idx >= pool.length) return null;
		pitches.push(pool[idx]);
	}

	return pitches;
}

/**
 * Combine a scale pattern with a rhythm pattern to produce a Phrase.
 * Returns null if note counts don't match or realization fails.
 */
export interface CombineOptions {
	/**
	 * How many times the melodic shape is laid end-to-end to fill the rhythm.
	 * 1 (the default) is the exact-match case.
	 */
	repeat?: number;
	/**
	 * Scale steps each successive repetition is displaced by. 0 repeats the
	 * cell literally; 1 walks it up the scale, which is the ordinary jazz
	 * sequence — "1-2-3, 2-3-4" — and the reason repetition is worth having at
	 * all. Ignored when `repeat` is 1.
	 */
	step?: number;
}

/** Lay a melodic shape end-to-end `repeat` times, displacing each pass by `step`. */
function expandDegrees(degrees: number[], repeat: number, step: number): number[] {
	if (repeat === 1) return degrees;
	const out: number[] = [];
	for (let r = 0; r < repeat; r++) {
		for (const d of degrees) out.push(d + r * step);
	}
	return out;
}

export function combine(
	sp: ScalePattern,
	rp: RhythmPattern,
	scaleId: string,
	key: PitchClass,
	harmony: HarmonicSegment[],
	opts: CombineOptions = {}
): Phrase | null {
	const repeat = opts.repeat ?? 1;
	const step = opts.step ?? 0;

	// Guard: the shape, laid `repeat` times, must fill the rhythm exactly.
	// A partial fit is not a near miss — it would either truncate the melodic
	// idea or pad it arbitrarily, and both read worse than emitting nothing.
	if (!Number.isInteger(repeat) || repeat < 1) return null;
	if (sp.degrees.length * repeat !== rp.noteCount) return null;

	// Guard: check compatible scale families
	if (sp.compatibleFamilies) {
		const scale = getScale(scaleId);
		if (!scale || !sp.compatibleFamilies.includes(scale.family)) return null;
	}

	// Realize pitches. A sequence can walk off the top of the tone pool, in
	// which case realizeScalePattern returns null and this combination is
	// simply not offered.
	const pitches = realizeScalePattern(expandDegrees(sp.degrees, repeat, step), scaleId, key);
	if (!pitches) return null;

	// Zip pitches with rhythm slots
	const notes: Note[] = rp.slots.map((slot, i) => ({
		pitch: pitches[i],
		duration: slot.duration,
		offset: slot.offset
	}));

	const sequenced = repeat > 1 && step !== 0;
	const extraTags = repeat === 1 ? [] : sequenced ? ['sequence'] : ['repeated'];
	const suffix = repeat === 1 ? '' : sequenced ? ` Sequence x${repeat}` : ` x${repeat}`;

	// Build phrase with placeholder difficulty
	const phrase: Phrase = {
		// The repeat spec is part of the identity: the same shape and rhythm
		// yield a different lick repeated than sequenced, and both may exist.
		id: repeat === 1 ? `cmb-${sp.id}_${rp.id}` : `cmb-${sp.id}_${rp.id}_x${repeat}s${step}`,
		name: `${sp.name}${suffix} / ${rp.name}`,
		timeSignature: rp.timeSignature,
		key,
		notes,
		harmony,
		difficulty: { level: 0, pitchComplexity: 0, rhythmComplexity: 0, lengthBars: rp.bars },
		category: sp.category,
		tags: [...new Set([...sp.tags, ...rp.tags, ...extraTags, 'combined'])],
		source: 'combined'
	};

	// Compute real difficulty
	phrase.difficulty = calculateDifficulty(phrase);

	return phrase;
}

/**
 * Displacements tried when a shape is repeated to fill a longer rhythm:
 * the literal repeat, and the sequence a step up and a step down. Larger
 * leaps stop sounding like the same idea restated, which is the only reason
 * a listener hears a repetition as musical rather than as padding.
 */
const REPEAT_STEPS = [0, 1, -1];

/** Generate all valid scale × rhythm combinations */
export function generateAllCombinations(): Phrase[] {
	const phrases: Phrase[] = [];

	for (const sp of SCALE_PATTERNS) {
		const ctx = CATEGORY_CONTEXT[sp.category];
		if (!ctx) continue;

		const harmony: HarmonicSegment[] = [{
			chord: ctx.chord,
			scaleId: ctx.scaleId,
			startOffset: [0, 1],
			duration: [1, 1]
		}];

		for (const rp of RHYTHM_PATTERNS) {
			// Exact fit first.
			const exact = combine(sp, rp, ctx.scaleId, 'C', harmony);
			if (exact) phrases.push(exact);

			// Then the shape laid twice or three times to fill a longer cell.
			// Capped at 3 passes: beyond that the bar is a drill, not a lick.
			const repeat = rp.noteCount / sp.degrees.length;
			if (!Number.isInteger(repeat) || repeat < 2 || repeat > 3) continue;
			for (const step of REPEAT_STEPS) {
				const phrase = combine(sp, rp, ctx.scaleId, 'C', harmony, { repeat, step });
				if (phrase) phrases.push(phrase);
			}
		}
	}

	return phrases;
}

/** Pre-generated combined licks — computed once at import time */
export const COMBINED_LICKS: Phrase[] = generateAllCombinations();
