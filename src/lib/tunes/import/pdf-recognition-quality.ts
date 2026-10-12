/** Independent evidence is a reason to reread, never authority to rewrite a pitch. */
import type { NoteheadEvidence, RecognitionContext, RecognizedBar } from './pdf-recognition';
import { isRestPitch } from './system-bar-validation';
import { disputedPitchAccidentals } from './pdf-pitch-reconciliation';

export function inheritContext(
	previous: RecognitionContext,
	printed: RecognitionContext
): RecognitionContext {
	return {
		fifths: printed.fifths ?? previous.fifths,
		clef: printed.clef ?? previous.clef,
		timeSignature: printed.timeSignature ?? previous.timeSignature
	};
}

export function evidenceIssues(
	bar: RecognizedBar,
	evidence: NoteheadEvidence | null | undefined,
	index: number
): string[] {
	if (!evidence || !Number.isInteger(evidence.count)) return [];
	const pitches = bar.melody.filter((n) => !isRestPitch(n[2])).map((n) => n[2]);
	const letters = pitches.map((p) => p.replace(/[#b♯♭]/g, ''));
	const countMismatch = pitches.length !== evidence.count;
	const pitchMismatch =
		!countMismatch &&
		evidence.letters.length === letters.length &&
		letters.some((p, i) => p !== evidence.letters[i]);
	if (!countMismatch && !pitchMismatch) return [];
	return [
		`bar ${index + 1}: independent notehead detection reads ${evidence.count} notehead(s)` +
			(evidence.letters.length
				? ` on lines/spaces ${evidence.letters.join(' ')} (letters only; apply the key signature and printed accidentals)`
				: '') +
			` but your transcription reads ${pitches.join(' ') || 'no notes'} — re-read this bar; keep your reading only if the ink confirms it`
	];
}

/** A disagreement with the signature may be a printed natural/alteration.
 * Verify it from the isolated image; never normalize it away blindly. */
export function signatureIssues(
	bar: RecognizedBar,
	fifths: number | null | undefined,
	index: number
): string[] {
	if (fifths == null || fifths === 0) return [];
	const letters = (fifths < 0 ? 'BEADGCF' : 'FCGDAEB').slice(0, Math.abs(fifths));
	const accidental = fifths > 0 ? '#' : 'b';
	const unexpected = bar.melody
		.filter((n) => {
			const pitch = /^([A-G])([#b]*)(-?\d)$/.exec(n[2]);
			return pitch && letters.includes(pitch[1]) && pitch[2] !== accidental;
		})
		.map((n) => n[2]);
	return unexpected.length
		? [
				`bar ${index + 1}: ${[...new Set(unexpected)].join(' ')} differs from the key signature; verify the printed accidental`
			]
		: [];
}

/** Pixel staff coordinates cannot resolve disagreement about a printed accidental. */
export function pitchReviewAccidentalIssues(
	original: RecognizedBar,
	candidate: RecognizedBar,
	index: number
): string[] {
	const changed = disputedPitchAccidentals(original, candidate).map(
		(d) => `${d.before} versus ${d.after}`
	);
	return changed.length
		? [
				`bar ${index + 1}: readings disagree about ${changed.join(', ')}; check the printed accidental against the PDF`
			]
		: [];
}
