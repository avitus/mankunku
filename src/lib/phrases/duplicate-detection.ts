/**
 * Duplicate-lick detection.
 *
 * A "duplicate" here means same melody + rhythm, regardless of key or octave.
 * Used on the entry page to flip the Save button to "Steal" when the phrase
 * the user is typing already exists somewhere in the library.
 *
 * Two phrases are considered duplicates when there exists a rotation of
 * pitch-class space (0..11 semitones) that makes the entered phrase's
 * pitch-class / rest / duration sequence exactly equal the candidate's.
 * Octave is ignored (collapsed via % 12); rhythm must match exactly.
 */

import type { Phrase, Note } from '$lib/types/music';

/** Minimum pitched-note count before we consider a phrase worth checking. */
const MIN_PITCHED_NOTES_FOR_DUPLICATE = 4;

/** Reduced fraction `[num, den]` — rests and pitched notes both carry one. */
type ReducedFraction = [number, number];

/** Entry in a contour: pitch class (0..11) or null for rest, plus rhythm. */
type ContourEntry = [number | null, ReducedFraction];

function gcd(a: number, b: number): number {
	a = Math.abs(a);
	b = Math.abs(b);
	while (b) {
		[a, b] = [b, a % b];
	}
	return a || 1;
}

function reduceFraction([n, d]: [number, number]): ReducedFraction {
	const g = gcd(n, d);
	return [n / g, d / g];
}

function countPitched(notes: Note[]): number {
	let c = 0;
	for (const n of notes) if (n.pitch !== null) c++;
	return c;
}

/**
 * Build the key-and-octave-agnostic contour of a phrase: one entry per note,
 * in order. Pitched notes become `[pitch % 12, reducedDuration]`; rests become
 * `[null, reducedDuration]`.
 *
 * Trailing rests are stripped so that an unpadded entered phrase can match a
 * saved phrase padded out to the end of a bar (saveUserLick stores
 * getPaddedNotes() which appends a trailing rest).
 */
export function pitchClassContour(phrase: Phrase): ContourEntry[] {
	const entries: ContourEntry[] = phrase.notes.map((note) => {
		const pc = note.pitch === null ? null : ((note.pitch % 12) + 12) % 12;
		return [pc, reduceFraction(note.duration)] as ContourEntry;
	});
	while (entries.length > 0 && entries[entries.length - 1][0] === null) {
		entries.pop();
	}
	return entries;
}

/** Rotate every pitch class in a contour by `shift` semitones. Rests unchanged. */
function rotateContour(contour: ContourEntry[], shift: number): ContourEntry[] {
	return contour.map(([pc, dur]) => {
		const rotated = pc === null ? null : ((pc + shift) % 12 + 12) % 12;
		return [rotated, dur] as ContourEntry;
	});
}

function contoursEqual(a: ContourEntry[], b: ContourEntry[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const [aPc, [aN, aD]] = a[i];
		const [bPc, [bN, bD]] = b[i];
		if (aPc !== bPc) return false;
		if (aN !== bN || aD !== bD) return false;
	}
	return true;
}

/**
 * True if `a` matches `b` under any key transposition.
 *
 * Determines the unique rotation implied by the first pitched pair and checks
 * that. If there are no pitched notes in either contour, we treat them as
 * equal iff the rhythm sequences match — but duplicate detection short-circuits
 * on MIN_PITCHED_NOTES_FOR_DUPLICATE before this point, so the edge case is
 * never hit in practice.
 */
export function contoursMatchAnyKey(a: ContourEntry[], b: ContourEntry[]): boolean {
	if (a.length !== b.length) return false;

	// Find first pitched index in `a` and the corresponding entry in `b`.
	// If their pitch/rest classification disagrees at any index, no rotation
	// can fix it, so we fail early inside contoursEqual via the null check.
	let firstPitchedIdx = -1;
	for (let i = 0; i < a.length; i++) {
		if (a[i][0] !== null) { firstPitchedIdx = i; break; }
	}

	if (firstPitchedIdx === -1) {
		// No pitched notes — match on rhythm only.
		return contoursEqual(a, b);
	}

	const aPc = a[firstPitchedIdx][0]!;
	const bPc = b[firstPitchedIdx][0];
	if (bPc === null) return false; // rest/pitch mismatch at fixed index

	const shift = ((bPc - aPc) % 12 + 12) % 12;
	return contoursEqual(rotateContour(a, shift), b);
}

/**
 * Find the first lick in `library` that matches `entered` under any key
 * transposition (octave-agnostic). Returns null when the entered phrase is too
 * short, has nothing to match, or no candidate matches.
 */
export function findDuplicateLick(entered: Phrase, library: Phrase[]): Phrase | null {
	if (countPitched(entered.notes) < MIN_PITCHED_NOTES_FOR_DUPLICATE) return null;

	const enteredContour = pitchClassContour(entered);

	for (const candidate of library) {
		// Skip self-matches (same id) — a saved lick re-opened for edit.
		if (candidate.id && candidate.id === entered.id) continue;
		const candContour = pitchClassContour(candidate);
		if (contoursMatchAnyKey(enteredContour, candContour)) return candidate;
	}

	return null;
}
