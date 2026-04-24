/**
 * Structural validation for externally-authored phrase data.
 *
 * This validator exists specifically for content entering the app from another
 * user — the "lick adoption" path. `validatePhrase` in `./validator.ts` is a
 * *musical* validator for generator/mutator output (step ratio, leap recovery,
 * range); it doesn't guard against the ways an adopted row can be malformed
 * (empty notes, zero-denominator fractions, XSS vectors in display strings,
 * harmony overlaps, etc.).
 *
 * The guarantees this validator provides:
 *   - Required fields are present and have the right primitive types.
 *   - Fraction pairs are `[numerator, denominator]` with positive denominators
 *     and non-negative numerators.
 *   - MIDI pitches are integers in [0, 127] or null (rest).
 *   - There is at least one pitched note.
 *   - Note count is below a DoS-prevention cap.
 *   - Display strings (name, tags) do not contain obvious XSS vectors
 *     (`<script`, `javascript:`) — a cheap defense-in-depth on top of Svelte's
 *     automatic template escaping.
 *   - Harmony segments don't overlap or extend past the phrase's last note.
 *
 * Intentionally not validated here:
 *   - Musical quality (use `validatePhrase` for that if needed).
 *   - Whether `category` is in the current enum — unknown categories render
 *     as "user" in the library, so no reason to reject adoption.
 *   - Whether `scaleId` exists in the local scale library — the practice
 *     pipeline's fallback handles missing scales.
 */

import { PITCH_CLASSES } from '$lib/types/music';
import type { PitchClass } from '$lib/types/music';

export interface AdoptedPhraseValidation {
	valid: boolean;
	errors: string[];
}

/** Cap on notes per adopted phrase. Prevents a malicious author from scheduling
 *  enough Tone.js events to freeze the practice UI. */
export const MAX_NOTES_PER_ADOPTED_PHRASE = 2000;

/** Cap on phrase name length. Long names break layout and signal abuse. */
export const MAX_ADOPTED_NAME_LENGTH = 200;

/** Cap on individual tag length. Matches common tag UI conventions. */
export const MAX_ADOPTED_TAG_LENGTH = 80;

/**
 * Matches common XSS vectors in untrusted strings. Three patterns, cheap to run:
 *   - `<[a-z]` — any HTML tag opening (`<script>`, `<img>`, `<iframe>`, etc.)
 *   - `javascript:` — the JavaScript URL scheme
 *   - `on\w+\s*=` — inline event handlers (`onerror=`, `onclick=`, …)
 *
 * Svelte's template interpolation already escapes untrusted strings at render
 * time; this is defense-in-depth at the data-entry boundary. The patterns are
 * narrow enough that legitimate lick names / tags (e.g., "V - I", "I<3 jazz")
 * are not flagged, since `<` must be immediately followed by a letter.
 */
const DANGEROUS_CONTENT = /<[a-z]|javascript:|on\w+\s*=/i;

const HARMONY_OVERLAP_TOLERANCE = 0.001;
const PHRASE_END_TOLERANCE = 0.01;

export function validateAdoptedPhrase(input: unknown): AdoptedPhraseValidation {
	const errors: string[] = [];
	if (!input || typeof input !== 'object') {
		return { valid: false, errors: ['phrase is not an object'] };
	}
	const p = input as Record<string, unknown>;

	if (typeof p.id !== 'string' || p.id.length === 0) {
		errors.push('missing or empty id');
	}

	if (typeof p.name !== 'string' || p.name.length === 0) {
		errors.push('missing or empty name');
	} else {
		if (p.name.length > MAX_ADOPTED_NAME_LENGTH) {
			errors.push(`name too long (${p.name.length} > ${MAX_ADOPTED_NAME_LENGTH})`);
		}
		if (DANGEROUS_CONTENT.test(p.name)) {
			errors.push('name contains disallowed content');
		}
	}

	if (typeof p.key !== 'string' || !PITCH_CLASSES.includes(p.key as PitchClass)) {
		errors.push('invalid or missing key');
	}

	if (!isValidFraction(p.timeSignature, { allowZeroNumerator: false })) {
		errors.push('invalid timeSignature');
	}

	validateNotes(p.notes, errors);

	const phraseLen = estimatePhraseLengthWhole(p.notes);
	validateHarmony(p.harmony, phraseLen, errors);

	if (!p.difficulty || typeof p.difficulty !== 'object') {
		errors.push('missing difficulty');
	} else {
		const d = p.difficulty as Record<string, unknown>;
		if (typeof d.level !== 'number' || !Number.isFinite(d.level) || d.level < 1 || d.level > 100) {
			errors.push('invalid difficulty.level');
		}
	}

	validateTags(p.tags, errors);

	return { valid: errors.length === 0, errors };
}

function validateNotes(notesInput: unknown, errors: string[]): void {
	if (!Array.isArray(notesInput)) {
		errors.push('notes must be an array');
		return;
	}
	if (notesInput.length === 0) {
		errors.push('notes array is empty');
		return;
	}
	if (notesInput.length > MAX_NOTES_PER_ADOPTED_PHRASE) {
		errors.push(
			`too many notes (${notesInput.length} > ${MAX_NOTES_PER_ADOPTED_PHRASE})`
		);
		return;
	}

	let pitchedCount = 0;
	for (let i = 0; i < notesInput.length; i++) {
		const n = notesInput[i];
		if (!n || typeof n !== 'object') {
			errors.push(`note ${i}: not an object`);
			continue;
		}
		const note = n as Record<string, unknown>;

		if (note.pitch !== null && note.pitch !== undefined) {
			if (
				typeof note.pitch !== 'number' ||
				!Number.isInteger(note.pitch) ||
				note.pitch < 0 ||
				note.pitch > 127
			) {
				errors.push(`note ${i}: pitch out of MIDI range`);
			} else {
				pitchedCount++;
			}
		}

		if (!isValidFraction(note.duration, { allowZeroNumerator: false })) {
			errors.push(`note ${i}: invalid duration (expected fraction [num>0, den>0])`);
			// Surface the most likely culprit for easy grep in error messages.
			if (Array.isArray(note.duration) && note.duration.length === 2) {
				if ((note.duration[1] as number) <= 0) {
					errors.push(`note ${i}: non-positive duration denominator`);
				}
			}
		}

		if (!isValidFraction(note.offset, { allowZeroNumerator: true })) {
			errors.push(`note ${i}: invalid offset (expected fraction [num>=0, den>0])`);
		}
	}

	if (pitchedCount === 0) {
		errors.push('no pitched notes (phrase consists only of rests)');
	}
}

function validateHarmony(
	harmonyInput: unknown,
	phraseLen: number,
	errors: string[]
): void {
	if (!Array.isArray(harmonyInput)) {
		errors.push('harmony must be an array');
		return;
	}

	const segments: Array<{ start: number; end: number }> = [];
	for (let i = 0; i < harmonyInput.length; i++) {
		const h = harmonyInput[i];
		if (!h || typeof h !== 'object') {
			errors.push(`harmony ${i}: not an object`);
			continue;
		}
		const seg = h as Record<string, unknown>;

		const chord = seg.chord as Record<string, unknown> | null | undefined;
		if (
			!chord ||
			typeof chord.root !== 'string' ||
			!PITCH_CLASSES.includes(chord.root as PitchClass)
		) {
			errors.push(`harmony ${i}: invalid chord root`);
		}

		if (typeof seg.scaleId !== 'string' || seg.scaleId.length === 0) {
			errors.push(`harmony ${i}: missing scaleId`);
		}

		const hasValidStart = isValidFraction(seg.startOffset, { allowZeroNumerator: true });
		const hasValidDuration = isValidFraction(seg.duration, { allowZeroNumerator: false });
		if (!hasValidStart || !hasValidDuration) {
			errors.push(`harmony ${i}: invalid timing`);
			continue;
		}
		const start = fractionToFloat(seg.startOffset as [number, number]);
		const dur = fractionToFloat(seg.duration as [number, number]);
		if (!Number.isFinite(start) || !Number.isFinite(dur)) {
			errors.push(`harmony ${i}: non-finite timing`);
			continue;
		}
		segments.push({ start, end: start + dur });
		if (phraseLen > 0 && start + dur > phraseLen + PHRASE_END_TOLERANCE) {
			errors.push(`harmony ${i}: extends past phrase end`);
		}
	}

	segments.sort((a, b) => a.start - b.start);
	for (let i = 1; i < segments.length; i++) {
		if (segments[i].start < segments[i - 1].end - HARMONY_OVERLAP_TOLERANCE) {
			errors.push('harmony segments overlap');
			break;
		}
	}
}

function validateTags(tagsInput: unknown, errors: string[]): void {
	if (!Array.isArray(tagsInput)) {
		errors.push('tags must be an array');
		return;
	}
	for (let i = 0; i < tagsInput.length; i++) {
		const t = tagsInput[i];
		if (typeof t !== 'string') {
			errors.push(`tag ${i}: not a string`);
			continue;
		}
		if (t.length > MAX_ADOPTED_TAG_LENGTH) {
			errors.push(`tag ${i}: too long (${t.length} > ${MAX_ADOPTED_TAG_LENGTH})`);
		}
		if (DANGEROUS_CONTENT.test(t)) {
			errors.push(`tag ${i}: disallowed content`);
		}
	}
}

function isValidFraction(
	input: unknown,
	opts: { allowZeroNumerator: boolean }
): boolean {
	if (!Array.isArray(input) || input.length !== 2) return false;
	const [num, den] = input as [unknown, unknown];
	if (typeof num !== 'number' || !Number.isFinite(num)) return false;
	if (typeof den !== 'number' || !Number.isFinite(den)) return false;
	if (den <= 0) return false;
	if (num < 0) return false;
	if (num === 0 && !opts.allowZeroNumerator) return false;
	return true;
}

function fractionToFloat(f: [number, number]): number {
	return f[0] / f[1];
}

function estimatePhraseLengthWhole(notesInput: unknown): number {
	if (!Array.isArray(notesInput)) return 0;
	let max = 0;
	for (const n of notesInput) {
		if (!n || typeof n !== 'object') continue;
		const note = n as Record<string, unknown>;
		if (
			!isValidFraction(note.offset, { allowZeroNumerator: true }) ||
			!isValidFraction(note.duration, { allowZeroNumerator: false })
		) {
			continue;
		}
		const end =
			fractionToFloat(note.offset as [number, number]) +
			fractionToFloat(note.duration as [number, number]);
		if (end > max) max = end;
	}
	return max;
}
