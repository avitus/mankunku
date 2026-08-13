/**
 * Trick example generator: realize a device's slot spec as a concrete Phrase.
 *
 * Device modules (enclosures, triad pairs) describe a figure as TrickSlotSpec[]
 * — where each note lands and which pitch class it should be. This module turns
 * that spec into a playable preview Phrase by walking the slots and choosing a
 * concrete MIDI instance for each pitch class: the first note seeds nearest
 * middle C, each subsequent note takes the instance nearest the previous choice
 * (bounded by the level profile's maxInterval when possible). The walk is fully
 * deterministic — same spec, same context, same pitches.
 *
 * Generated examples are disposable; progress is keyed by the trick variant
 * key, never by the ids minted here.
 */

import type { HarmonicSegment, Note, Phrase, PhraseCategory } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import type { TrickContext, TrickParameters, TrickSlotSpec } from '$lib/types/tricks';
import { trickVariantKey } from '$lib/types/tricks';
import { chordSymbol, chordTones } from '$lib/music/chords';
import { getScale, getScalesForChord } from '$lib/music/scales';
import { realizeScaleMidi } from '$lib/music/keys';
import {
	addFractions,
	compareFractions,
	fractionToFloat,
	subtractFractions
} from '$lib/music/intervals';
import { getProfileForLevel } from '$lib/difficulty/params';
import { calculateDifficulty } from '$lib/difficulty/calculate';
import { validatePhrase } from '$lib/phrases/validator';

/** Default realization range: tenor sax (concert Ab2–Eb5), as in the validator. */
const DEFAULT_RANGE_LOW = 44;
const DEFAULT_RANGE_HIGH = 75;

export interface TrickExampleArgs {
	trickId: string;
	name: string;
	category: PhraseCategory;
	tags: string[];
	slots: TrickSlotSpec[];
	parameters: TrickParameters;
	context: TrickContext;
	rangeLow?: number; // default 44
	rangeHigh?: number; // default 75
	/**
	 * Whole leading bars of anacrusis before the figure's first full bar,
	 * stamped onto `difficulty.pickupBars` (calculateDifficulty never sets it).
	 * Explicit rather than detected: `detectPickupBars` keys on integer-offset
	 * downbeat notes, which offbeat figures may not have.
	 */
	pickupBars?: number;
}

/**
 * Rhythm subdivisions available at a player level (1-100). Device modules use
 * this to choose slot rhythms (e.g. quarters when a tier lacks eighths).
 */
export function allowedSubdivisions(
	level: number
): ('whole' | 'half' | 'quarter' | 'eighth' | 'triplet' | 'sixteenth')[] {
	return [...getProfileForLevel(level).rhythmTypes];
}

/**
 * Build the in-scale MIDI pool for the context: the context scale when known,
 * else the first catalog scale for the chord quality, else chord-tone pitch
 * classes realized across the range.
 */
function buildScalePool(context: TrickContext, low: number, high: number): number[] {
	const scale = getScale(context.scaleId) ?? getScalesForChord(context.chordQuality)[0];
	if (scale) {
		return realizeScaleMidi(context.chordRoot, scale.intervals, low, high);
	}
	const rootPc = PITCH_CLASSES.indexOf(context.chordRoot);
	const tonePcs = new Set(chordTones(rootPc + 60, context.chordQuality).map((m) => m % 12));
	const pool: number[] = [];
	for (let midi = low; midi <= high; midi++) {
		if (tonePcs.has(midi % 12)) pool.push(midi);
	}
	return pool;
}

/** All in-range MIDI instances of a pitch class, ascending. */
function pcInstances(pc: number, low: number, high: number): number[] {
	const first = low + ((((pc - low) % 12) + 12) % 12);
	const instances: number[] = [];
	for (let midi = first; midi <= high; midi += 12) {
		instances.push(midi);
	}
	return instances;
}

/** Candidate nearest the anchor; ties break toward the lower pitch. */
function nearestTo(candidates: number[], anchor: number): number {
	let best = candidates[0];
	let bestDist = Math.abs(best - anchor);
	for (const candidate of candidates) {
		const dist = Math.abs(candidate - anchor);
		if (dist < bestDist) {
			best = candidate;
			bestDist = dist;
		}
	}
	return best;
}

/**
 * Nearest-instance realization walk. Mirrors realizeScalePattern's seeding
 * (nearest MIDI 60) in the degrees→MIDI direction, but keyed by absolute
 * pitch class instead of scale degree. Returns null when any slot's pitch
 * class has no in-range instance.
 */
function realizePitches(
	slots: TrickSlotSpec[],
	context: TrickContext,
	low: number,
	high: number
): number[] | null {
	const pool = buildScalePool(context, low, high);
	const poolPcs = new Set(pool.map((m) => m % 12));
	const maxInterval = getProfileForLevel(context.level).maxInterval;

	const pitches: number[] = [];
	let prev: number | null = null;

	for (const slot of slots) {
		const rawPc = slot.generatePc ?? slot.exactPcs.at(0);
		if (rawPc === undefined) return null;
		const pc = ((rawPc % 12) + 12) % 12;

		// In-scale pcs draw from the scale pool; chromatic (out-of-scale) pcs
		// are placed by nearest-octave math over their raw instances.
		const candidates = poolPcs.has(pc)
			? pool.filter((m) => m % 12 === pc)
			: pcInstances(pc, low, high);
		if (candidates.length === 0) return null;

		let chosen: number;
		if (prev === null) {
			chosen = nearestTo(candidates, 60);
		} else {
			// Prefer instances within the level profile's max interval; when the
			// range window forces a wider move, fall back to nearest-in-range.
			const anchor = prev;
			const bounded = candidates.filter((c) => Math.abs(c - anchor) <= maxInterval);
			chosen = nearestTo(bounded.length > 0 ? bounded : candidates, anchor);
		}

		pitches.push(chosen);
		prev = chosen;
	}

	return pitches;
}

/** Monotonic suffix so repeated generations of the same variant get distinct ids. */
let exampleCounter = 0;

/**
 * Realize a trick slot spec as a preview Phrase, or null when realization
 * (a pitch class with no in-range instance) or validation fails.
 */
export function realizeTrickExample(args: TrickExampleArgs): Phrase | null {
	const { slots, context } = args;
	const low = args.rangeLow ?? DEFAULT_RANGE_LOW;
	const high = args.rangeHigh ?? DEFAULT_RANGE_HIGH;
	if (slots.length === 0) return null;

	const pitches = realizePitches(slots, context, low, high);
	if (!pitches) return null;

	// Bridge internal gaps between slots with explicit rests: notation emits
	// tokens purely by offset and does NOT synthesize rests for gaps, so a
	// gapped bar would render underfull. Never pad before the first note —
	// a leading rest would defeat the partial-bar anacrusis rendering — and
	// never after the last (nothing follows to misalign).
	const notes: Note[] = [];
	slots.forEach((slot, i) => {
		if (i > 0) {
			const prev = slots[i - 1];
			const prevEnd = addFractions(prev.offset, prev.duration);
			if (compareFractions(slot.offset, prevEnd) > 0) {
				notes.push({
					pitch: null,
					duration: subtractFractions(slot.offset, prevEnd),
					offset: prevEnd
				});
			}
		}
		notes.push({ pitch: pitches[i], duration: slot.duration, offset: slot.offset });
	});

	// One harmonic segment spans the whole example, rounded up to whole notes
	const totalWholeNotes = Math.max(
		...slots.map((s) => fractionToFloat(s.offset) + fractionToFloat(s.duration))
	);
	const harmony: HarmonicSegment[] = [
		{
			chord: { root: context.chordRoot, quality: context.chordQuality },
			scaleId: context.scaleId,
			startOffset: [0, 1],
			duration: [Math.max(1, Math.ceil(totalWholeNotes)), 1],
			symbol: chordSymbol(context.chordRoot, context.chordQuality)
		}
	];

	exampleCounter++;
	const phrase: Phrase = {
		id: `trick-${trickVariantKey(args.trickId, args.parameters)}-${context.key}-${exampleCounter}`,
		name: args.name,
		timeSignature: context.timeSignature,
		key: context.key,
		notes,
		harmony,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: args.category,
		tags: [...args.tags],
		source: 'generated'
	};
	phrase.difficulty = calculateDifficulty(phrase);
	if (args.pickupBars !== undefined) {
		phrase.difficulty = { ...phrase.difficulty, pickupBars: args.pickupBars };
	}

	// Tricks are legitimately leapy and chromatic: a triad-pair cell is
	// wall-to-wall leaps and an enclosure leans on chromatic neighbours, so
	// the scalar contour rules (step ratio, leap recovery, direction changes)
	// that keep generated LICKS idiomatic would reject well-formed trick
	// examples by design. Keep only the safety rails: instrument range and a
	// sane cap on any single interval. The consecutive-leap cap sits at 12
	// because the longest device shape — the 12-note alternating-triplet
	// triad-pair spec — is wall-to-wall leaps (11 in a row); the rail guards
	// runaway generation, not legitimate device shapes.
	const profile = getProfileForLevel(context.level);
	const validation = validatePhrase(phrase, {
		maxInterval: Math.max(profile.maxInterval, 9),
		maxConsecutiveLeaps: 12,
		minStepRatio: 0,
		leapRecovery: false,
		minDirectionChanges: 0,
		range: [low, high]
	});
	if (!validation.valid) return null;

	return phrase;
}
