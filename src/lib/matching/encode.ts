/**
 * Encode a Phrase (or raw note list) into a transposition-invariant feature
 * vector used for melodic matching. Concert pitch in, concert pitch out.
 */
import type { Note, Phrase, PitchClass } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import { addFractions, fractionToFloat, subtractFractions } from '$lib/music/intervals';
import type { LickFeature } from './index-format';

const SIXTEENTHS_PER_WHOLE = 16;
const BEATS_PER_WHOLE = 4;

/** Encode a full Phrase into a LickFeature. */
export function encodePhrase(phrase: Phrase): LickFeature {
	const feature = encodeNotes(phrase.notes);
	feature.keyPc = pitchClassIndex(phrase.key);
	return feature;
}

/** Encode a note list. `keyPc` is left at 0; callers that know the key should override. */
export function encodeNotes(notes: Note[]): LickFeature {
	const pitched = notes.filter((n): n is Note & { pitch: number } => n.pitch !== null);

	const intervals: number[] = [];
	const iois: number[] = [];

	for (let i = 1; i < pitched.length; i++) {
		intervals.push(pitched[i].pitch - pitched[i - 1].pitch);
		const delta = subtractFractions(pitched[i].offset, pitched[i - 1].offset);
		iois.push(quantizeIoi(delta));
	}

	const totalBeats = computeTotalBeats(pitched);

	return {
		intervals,
		iois,
		noteCount: pitched.length,
		totalBeats,
		keyPc: 0
	};
}

function quantizeIoi(delta: [number, number]): number {
	const value = fractionToFloat(delta) * SIXTEENTHS_PER_WHOLE;
	return Math.max(1, Math.round(value));
}

function computeTotalBeats(pitched: Array<Note & { pitch: number }>): number {
	if (pitched.length === 0) return 0;
	const last = pitched[pitched.length - 1];
	const end = addFractions(last.offset, last.duration);
	return fractionToFloat(end) * BEATS_PER_WHOLE;
}

function pitchClassIndex(key: PitchClass): number {
	return PITCH_CLASSES.indexOf(key);
}
