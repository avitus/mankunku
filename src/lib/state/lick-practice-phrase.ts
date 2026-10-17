/**
 * A lick placed in a chord progression, in a key — the ONE builder behind the
 * session's phrase (`buildPhraseFor` in lick-practice.svelte.ts) and the lick
 * detail page's chart, so what the page shows is what Deep Practice drills.
 * Pure: no runes, no stores, Node-testable (`lick-in-progression.test.ts`).
 *
 * Placement is three decisions, each a `data/progressions.ts` rule:
 * - WHERE in the cycle the melody starts: the category's alignment in the
 *   template (a V-I line inside the long ii-V-I opens on bar 1), pulled back
 *   by the lick's pickup bars so its downbeat still lands on its chord.
 * - WHAT ROOT the notes move to: the key for a line that runs the whole
 *   cadence; the slot chord's root for a chord-quality lick (a minor-chord
 *   line on the ii of an F ii-V-I is played in G, not F), shifted by the
 *   active substitution rule when the session enables them.
 * - WHICH chords sound: the template transposed to the key, its last chord
 *   held through any bars the line runs past the cycle.
 * The lick's own stored harmony is replaced: user licks are saved with none
 * (the editor and record-a-lick both write `harmony: []`), and a curated
 * lick's harmony is what `progressionFitsLick` matched the template against.
 */

import type { Fraction, HarmonicSegment, Note, Phrase, PitchClass } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import {
	PROGRESSION_TEMPLATES,
	applyPickupBarShift,
	detectPickupBars,
	extendHarmonyTail,
	progressionMode,
	resolveLickAlignmentOffset,
	resolveTransposeTarget,
	transposeProgression
} from '$lib/data/progressions';
import { transposeLick } from '$lib/phrases/library-loader';
import {
	addFractions,
	compareFractions,
	fractionToFloat,
	subtractFractions
} from '$lib/music/intervals';

export interface LickPlacementOptions {
	/**
	 * The session's substitution knob: a rule may move a chord-quality lick
	 * off its slot root (Abm7 over G7). Off by default — the detail page
	 * shows the native placement.
	 */
	enableSubstitutions?: boolean;
	/** Instrument fit for `transposeLick` (`bestOctaveShift`): concert MIDI range. */
	rangeLow?: number;
	rangeHigh?: number;
	/** Concert → written semitones, so the fit can count notes on the written stave. */
	transposition?: number;
}

/**
 * Where the lick's melody starts in the progression's cycle: the category's
 * base alignment shifted left by the lick's pickup bars (clamped at the
 * start of the cycle). Falls back to inferring the pickup from the note
 * positions when the field is absent, so user and community licks authored
 * before it existed place correctly without a re-save.
 */
export function alignedLickOffset(
	lick: Phrase,
	progressionType: ChordProgressionType,
	enableSubstitutions = false
): Fraction {
	const base = resolveLickAlignmentOffset(progressionType, lick.category, enableSubstitutions);
	const pickupBars = lick.difficulty.pickupBars ?? detectPickupBars(lick.notes);
	return applyPickupBarShift(base, pickupBars);
}

/**
 * Bars one cycle of this lick occupies in the progression: the template's
 * bars when the line fits inside them, else alignment + length so its
 * resolution fits. The session stretches each key's window by this and the
 * harmony's last chord is held through the difference.
 */
export function lickBarsInProgression(
	lick: Phrase,
	progressionType: ChordProgressionType,
	enableSubstitutions = false
): number {
	const template = PROGRESSION_TEMPLATES[progressionType];
	const alignment = alignedLickOffset(lick, progressionType, enableSubstitutions);
	const alignmentBars = Math.ceil(alignment[0] / alignment[1]);
	return Math.max(template.bars, alignmentBars + lick.difficulty.lengthBars);
}

/**
 * The progression's chords in `key`, the final chord sustained through any
 * bars the lick needs past the cycle.
 */
export function progressionHarmonyForLick(
	lick: Phrase,
	key: PitchClass,
	progressionType: ChordProgressionType,
	enableSubstitutions = false
): HarmonicSegment[] {
	const template = PROGRESSION_TEMPLATES[progressionType];
	const lickBars = lickBarsInProgression(lick, progressionType, enableSubstitutions);
	const extended = extendHarmonyTail(template.harmony, lickBars - template.bars);
	return transposeProgression(extended, key);
}

/**
 * The lick as it is played over `progressionType` in `key`: notes moved to
 * their root and aligned into the cycle, the progression's chords in place
 * of the lick's own, the key and the progression's mode stamped (a minor
 * cadence prints K:Dm even under a major lick).
 */
export function placeLickInProgression(
	lick: Phrase,
	key: PitchClass,
	progressionType: ChordProgressionType,
	opts: LickPlacementOptions = {}
): Phrase {
	const enableSubstitutions = opts.enableSubstitutions ?? false;
	// Two alignment offsets, both needed:
	// - `alignmentOffset` (pickup-shifted) places the melody's notes inside the
	//   cycle so the pickup falls on the V where applicable.
	// - `bodyAlignment` (un-shifted) is what `resolveTransposeTarget` reads to
	//   pick the lick's body chord — the shifted one would transpose the lick
	//   to the pickup chord (G7) instead of its target (Cmaj7).
	const alignmentOffset = alignedLickOffset(lick, progressionType, enableSubstitutions);
	const bodyAlignment = resolveLickAlignmentOffset(progressionType, lick.category, enableSubstitutions);
	const transposeTarget = resolveTransposeTarget(
		key,
		lick.category,
		progressionType,
		bodyAlignment,
		enableSubstitutions
	);
	const transposed = transposeLick(lick, transposeTarget, opts.rangeLow, opts.rangeHigh, opts.transposition);
	const harmony = progressionHarmonyForLick(lick, key, progressionType, enableSubstitutions);
	const notes: Note[] =
		alignmentOffset[0] === 0
			? transposed.notes
			: transposed.notes.map((n) => ({ ...n, offset: addFractions(n.offset, alignmentOffset) }));
	// The key is the progression's, not a chord-quality lick's transposition
	// target, and it is read in the progression's mode.
	return { ...transposed, key, mode: progressionMode(progressionType), notes, harmony };
}

/**
 * The bars the melody occupies, re-origined on the first sounding bar, with
 * only the chords under them — what a preview without a band should play.
 * A placed lick can open two bars into its cycle (a major-chord line on the
 * I of the long ii-V-I) under a four-bar harmony, and `playPhrase` sizes
 * the preview by the harmony extent: played as placed, Listen would sit
 * silent through the ii and the V and run on after the line. A line that
 * already opens the cycle and fills it comes back as the same object.
 */
export function melodyWindow(phrase: Phrase): Phrase {
	const [beatsPerBar, beatUnit] = phrase.timeSignature;
	const barLength = fractionToFloat([beatsPerBar, beatUnit]);
	const sounding = phrase.notes.filter((n) => n.pitch !== null);
	if (sounding.length === 0) return phrase;

	const firstBar = Math.min(...sounding.map((n) => Math.floor(fractionToFloat(n.offset) / barLength + 1e-9)));
	const lastBar = Math.max(
		...sounding.map((n) =>
			Math.floor((fractionToFloat(n.offset) + fractionToFloat(n.duration)) / barLength - 1e-9)
		)
	);
	const windowStart: Fraction = [firstBar * beatsPerBar, beatUnit];
	const windowEnd: Fraction = [(lastBar + 1) * beatsPerBar, beatUnit];

/** Where an element that starts at `start` and lasts `duration` ends. */
	const endOf = (start: Fraction, duration: Fraction): Fraction => addFractions(start, duration);
	const harmonyRunsPast = phrase.harmony.some(
		(h) => compareFractions(endOf(h.startOffset, h.duration), windowEnd) > 0
	);
	if (firstBar === 0 && !harmonyRunsPast) return phrase;

	const notes = phrase.notes
		.filter((n) => compareFractions(n.offset, windowStart) >= 0)
		.map((n) => ({ ...n, offset: subtractFractions(n.offset, windowStart) }));
	const harmony = phrase.harmony.flatMap((h) => {
		const segEnd = endOf(h.startOffset, h.duration);
		if (compareFractions(segEnd, windowStart) <= 0 || compareFractions(h.startOffset, windowEnd) >= 0) return [];
		const from = compareFractions(h.startOffset, windowStart) < 0 ? windowStart : h.startOffset;
		const to = compareFractions(segEnd, windowEnd) > 0 ? windowEnd : segEnd;
		return [{ ...h, startOffset: subtractFractions(from, windowStart), duration: subtractFractions(to, from) }];
	});
	return { ...phrase, notes, harmony };
}
