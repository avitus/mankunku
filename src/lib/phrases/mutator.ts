/**
 * Lick mutation system — transforms curated licks for variety.
 *
 * Mutations:
 *   1. Rhythmic displacement — shift all notes by a beat subdivision
 *   2. Octave displacement — shift individual notes up/down an octave
 *   3. Approach modification — add/remove chromatic approach notes
 *   4. Truncation/extension — shorten or lengthen the phrase
 */

import type { Phrase, Note, Fraction } from '$lib/types/music.ts';
import { addFractions, fractionToFloat } from '$lib/music/intervals.ts';
import { validatePhrase, rulesForDifficulty } from './validator.ts';

/**
 * Apply a random mutation to a lick.
 * Returns null if the mutation produces an invalid phrase.
 */
export function mutateLick(lick: Phrase): Phrase | null {
	const mutations = [
		rhythmicDisplacement,
		octaveDisplacement,
		truncate,
		retrograde
	];

	const mutation = mutations[Math.floor(Math.random() * mutations.length)];
	const result = mutation(lick);

	// Validate the mutation
	const rules = rulesForDifficulty(lick.difficulty.level);
	const validation = validatePhrase(result, rules);

	return validation.valid ? result : null;
}

/**
 * Shift all note onsets forward by an 8th note.
 * Creates a syncopated variation.
 */
export function rhythmicDisplacement(lick: Phrase): Phrase {
	const shift: Fraction = [1, 8];

	return {
		...lick,
		id: `${lick.id}_displaced`,
		name: `${lick.name} (displaced)`,
		source: `mutated:${lick.id}`,
		notes: lick.notes.map((n) => ({
			...n,
			offset: addFractions(n.offset, shift)
		}))
	};
}

/**
 * Randomly shift some notes up or down an octave.
 * Applies to ~25% of notes, skipping the first and last.
 */
export function octaveDisplacement(lick: Phrase): Phrase {
	const pitched = lick.notes.filter((n) => n.pitch !== null);
	if (pitched.length < 4) return lick;

	const notes = lick.notes.map((n, i) => {
		if (n.pitch === null) return n;
		// Don't displace first or last pitched note
		if (i === 0 || i === lick.notes.length - 1) return n;
		// ~25% chance
		if (Math.random() > 0.25) return n;

		const direction = Math.random() > 0.5 ? 12 : -12;
		const newPitch = n.pitch + direction;

		// Keep in playable range
		if (newPitch < 44 || newPitch > 84) return n;

		return { ...n, pitch: newPitch };
	});

	return {
		...lick,
		id: `${lick.id}_octdispl`,
		name: `${lick.name} (oct. displaced)`,
		source: `mutated:${lick.id}`,
		notes
	};
}

/**
 * Truncate the phrase to the first N notes.
 * Useful for creating shorter practice fragments.
 */
export function truncate(lick: Phrase, maxNotes?: number): Phrase {
	const pitched = lick.notes.filter((n) => n.pitch !== null);
	if (pitched.length <= 4) return lick;

	const keep = maxNotes ?? Math.ceil(pitched.length * 0.6);
	const notes = lick.notes.slice(0, keep);

	// Recalculate length in bars
	let maxEnd = 0;
	for (const n of notes) {
		const end = fractionToFloat(n.offset) + fractionToFloat(n.duration);
		maxEnd = Math.max(maxEnd, end);
	}
	const bars = Math.ceil(maxEnd * 4 / (lick.timeSignature[0]));

	return {
		...lick,
		id: `${lick.id}_trunc`,
		name: `${lick.name} (short)`,
		source: `mutated:${lick.id}`,
		notes,
		difficulty: {
			...lick.difficulty,
			lengthBars: Math.max(1, bars)
		}
	};
}

/**
 * Reverse the pitch sequence while keeping the rhythm intact.
 * Creates a retrograde variation.
 */
export function retrograde(lick: Phrase): Phrase {
	const pitches = lick.notes.map((n) => n.pitch);
	const reversed = [...pitches].reverse();

	const notes = lick.notes.map((n, i) => ({
		...n,
		pitch: reversed[i]
	}));

	return {
		...lick,
		id: `${lick.id}_retro`,
		name: `${lick.name} (retrograde)`,
		source: `mutated:${lick.id}`,
		notes
	};
}
