/**
 * Structural validation for lead sheets entering from ANOTHER user
 * (community adoption), mirroring `phrases/adopted-phrase-validator.ts`.
 *
 * This is a security/robustness gate, not a musical one: it enforces shape,
 * bounds, DoS caps, and a script-content heuristic so a malicious or corrupt
 * cloud row can neither crash the renderer/audio pipeline nor smuggle markup
 * into the UI. Called at BOTH adopt time and startup hydration.
 *
 * Deliberately NOT validated: musical quality, whether scaleIds exist
 * locally, or the finer points of form (unknown structures render as-is).
 */

import { PITCH_CLASSES } from '$lib/types/music';
import { CHORD_DEFINITIONS } from '$lib/music/chords';

export interface AdoptedTuneValidation {
	valid: boolean;
	errors: string[];
}

/** DoS cap: total melody notes across all sections (Tone.js scheduling). */
export const MAX_NOTES_PER_ADOPTED_TUNE = 5000;
/** DoS cap: harmony segments across all sections. */
export const MAX_HARMONY_PER_ADOPTED_TUNE = 2000;
export const MAX_SECTIONS_PER_ADOPTED_TUNE = 64;
export const MAX_BARS_PER_SECTION = 256;
export const MAX_ADOPTED_TITLE_LENGTH = 200;
export const MAX_ADOPTED_TAG_LENGTH = 80;
export const MAX_ADOPTED_SYMBOL_LENGTH = 32;

/**
 * Script-content heuristic — defense-in-depth on top of Svelte's automatic
 * template escaping. `<` must be immediately followed by a letter so
 * "I <3 Jazz" passes.
 */
const DANGEROUS_CONTENT = /<[a-z]|javascript:|on\w+\s*=/i;

function isFraction(v: unknown, allowZeroNumerator: boolean): v is [number, number] {
	return (
		Array.isArray(v) &&
		v.length === 2 &&
		typeof v[0] === 'number' &&
		typeof v[1] === 'number' &&
		Number.isFinite(v[0]) &&
		Number.isFinite(v[1]) &&
		v[1] > 0 &&
		(allowZeroNumerator ? v[0] >= 0 : v[0] > 0)
	);
}

function isCleanString(v: unknown, maxLength: number): v is string {
	return typeof v === 'string' && v.length <= maxLength && !DANGEROUS_CONTENT.test(v);
}

/** Validate an untrusted lead-sheet payload. */
export function validateAdoptedTune(input: unknown): AdoptedTuneValidation {
	const errors: string[] = [];

	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return { valid: false, errors: ['payload is not an object'] };
	}
	const sheet = input as Record<string, unknown>;

	if (typeof sheet.id !== 'string' || sheet.id.length === 0) errors.push('missing or empty id');
	if (!isCleanString(sheet.title, MAX_ADOPTED_TITLE_LENGTH) || sheet.title === '') {
		errors.push('missing, oversized, or unsafe title');
	}
	if (sheet.composer !== undefined && sheet.composer !== null && !isCleanString(sheet.composer, MAX_ADOPTED_TITLE_LENGTH)) {
		errors.push('unsafe composer');
	}
	if (sheet.style !== undefined && sheet.style !== null && !isCleanString(sheet.style, MAX_ADOPTED_TITLE_LENGTH)) {
		errors.push('unsafe style');
	}
	if (!PITCH_CLASSES.includes(sheet.key as never)) errors.push(`invalid key: ${String(sheet.key)}`);
	if (!isFraction(sheet.timeSignature, false)) errors.push('invalid timeSignature');

	if (!Array.isArray(sheet.tags)) {
		errors.push('tags is not an array');
	} else {
		for (const tag of sheet.tags) {
			if (!isCleanString(tag, MAX_ADOPTED_TAG_LENGTH)) {
				errors.push('oversized or unsafe tag');
				break;
			}
		}
	}

	const sections = sheet.sections;
	if (!Array.isArray(sections) || sections.length === 0) {
		errors.push('sheet has no sections');
		return { valid: false, errors };
	}
	if (sections.length > MAX_SECTIONS_PER_ADOPTED_TUNE) {
		errors.push(`too many sections (${sections.length} > ${MAX_SECTIONS_PER_ADOPTED_TUNE})`);
		return { valid: false, errors };
	}

	let totalNotes = 0;
	let totalHarmony = 0;

	for (let s = 0; s < sections.length; s++) {
		const sec = sections[s] as Record<string, unknown>;
		if (typeof sec !== 'object' || sec === null) {
			errors.push(`section ${s} is not an object`);
			continue;
		}
		if (!isCleanString(sec.label, MAX_ADOPTED_TAG_LENGTH)) errors.push(`section ${s}: unsafe label`);
		if (!Number.isInteger(sec.bars) || (sec.bars as number) < 1 || (sec.bars as number) > MAX_BARS_PER_SECTION) {
			errors.push(`section ${s}: invalid bar count`);
		}
		if (sec.ending !== undefined && sec.ending !== 1 && sec.ending !== 2) {
			errors.push(`section ${s}: invalid ending marker`);
		}

		const notes = sec.notes;
		if (!Array.isArray(notes)) {
			errors.push(`section ${s}: notes is not an array`);
		} else {
			totalNotes += notes.length;
			for (const n of notes) {
				const note = n as Record<string, unknown>;
				if (note.pitch !== null && (!Number.isInteger(note.pitch) || (note.pitch as number) < 0 || (note.pitch as number) > 127)) {
					errors.push(`section ${s}: note pitch out of MIDI range`);
					break;
				}
				if (!isFraction(note.duration, false) || !isFraction(note.offset, true)) {
					errors.push(`section ${s}: malformed note duration/offset`);
					break;
				}
			}
		}

		const harmony = sec.harmony;
		if (!Array.isArray(harmony)) {
			errors.push(`section ${s}: harmony is not an array`);
		} else {
			totalHarmony += harmony.length;
			for (const h of harmony) {
				const seg = h as Record<string, unknown>;
				const chord = seg.chord as Record<string, unknown> | undefined;
				if (!chord || !PITCH_CLASSES.includes(chord.root as never)) {
					errors.push(`section ${s}: invalid chord root`);
					break;
				}
				if (!(typeof chord.quality === 'string' && chord.quality in CHORD_DEFINITIONS)) {
					errors.push(`section ${s}: unknown chord quality ${String(chord.quality)}`);
					break;
				}
				if (chord.bass !== undefined && !PITCH_CLASSES.includes(chord.bass as never)) {
					errors.push(`section ${s}: invalid chord bass`);
					break;
				}
				if (typeof seg.scaleId !== 'string' || seg.scaleId.length === 0) {
					errors.push(`section ${s}: missing scaleId`);
					break;
				}
				if (!isFraction(seg.startOffset, true) || !isFraction(seg.duration, false)) {
					errors.push(`section ${s}: malformed harmony offsets`);
					break;
				}
				if (seg.symbol !== undefined && !isCleanString(seg.symbol, MAX_ADOPTED_SYMBOL_LENGTH)) {
					errors.push(`section ${s}: unsafe chord symbol`);
					break;
				}
			}
		}
	}

	if (totalNotes > MAX_NOTES_PER_ADOPTED_TUNE) {
		errors.push(`too many notes (${totalNotes} > ${MAX_NOTES_PER_ADOPTED_TUNE})`);
	}
	if (totalHarmony > MAX_HARMONY_PER_ADOPTED_TUNE) {
		errors.push(`too many harmony segments (${totalHarmony} > ${MAX_HARMONY_PER_ADOPTED_TUNE})`);
	}
	if (totalNotes + totalHarmony === 0) {
		errors.push('sheet has no melody and no harmony');
	}

	const difficulty = sheet.difficulty as Record<string, unknown> | undefined;
	if (difficulty !== undefined && difficulty !== null) {
		if (typeof difficulty !== 'object' || !Number.isFinite(difficulty.level) ||
			(difficulty.level as number) < 1 || (difficulty.level as number) > 100) {
			errors.push('invalid difficulty');
		}
	}

	return { valid: errors.length === 0, errors };
}
