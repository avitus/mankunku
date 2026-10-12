/** Reconcile aligned readings without treating pixel positions as a transcription. */
import type { NoteheadEvidence, RecognizedBar } from './pdf-recognition';
import { isRestPitch } from './system-bar-validation';

/** Aligned readings disagree on a symbol that staff coordinates cannot resolve. */
export function disputedPitchAccidentals(
	original: RecognizedBar,
	candidate: RecognizedBar
): Array<{ index: number; before: string; after: string }> {
	const before = original.melody.filter((note) => !isRestPitch(note[2]));
	const after = candidate.melody.flatMap((note, index) =>
		isRestPitch(note[2]) ? [] : [{ note, index }]
	);
	if (before.length !== after.length) return [];
	return after.flatMap(({ note, index }, i) => {
		const previous = before[i];
		return previous[2] !== note[2] &&
			previous[2].replace(/[#b♯♭]/g, '') === note[2].replace(/[#b♯♭]/g, '')
			? [{ index, before: previous[2], after: note[2] }]
			: [];
	});
}

/** A second opinion alone cannot adjudicate a disputed printed accidental.
 * Retain the original spelling and let the caller expose the disagreement.
 */
export function retainDisputedAccidentals(
	original: RecognizedBar,
	candidate: RecognizedBar
): RecognizedBar {
	const disputed = new Map(
		disputedPitchAccidentals(original, candidate).map((d) => [d.index, d.before])
	);
	if (!disputed.size) return candidate;
	return {
		...candidate,
		melody: candidate.melody.map((note, i) => {
			const pitch = disputed.get(i);
			if (!pitch) return note;
			const retained = [...note] as typeof note;
			retained[2] = pitch;
			return retained;
		})
	};
}

export function hasCompleteHeadEvidence(
	evidence: NoteheadEvidence | null | undefined
): evidence is NoteheadEvidence {
	return (
		!!evidence &&
		Number.isInteger(evidence.count) &&
		evidence.count > 0 &&
		evidence.letters.length === evidence.count &&
		evidence.letters.every((letter) => /^[A-G]-?\d+$/.test(letter))
	);
}

/** Absence of a mismatch is not corroboration when staff positions are absent. */
export function pitchReviewAgreesWithHeads(
	bar: RecognizedBar,
	evidence: NoteheadEvidence | null | undefined
): boolean {
	if (!hasCompleteHeadEvidence(evidence)) return false;
	const notes = bar.melody.filter((note) => !isRestPitch(note[2]));
	return (
		notes.length === evidence.count &&
		notes.every((note, i) => note[2].replace(/[#b♯♭]/g, '') === evidence.letters[i])
	);
}

/** Caller must establish clean rhythm and a clef supported by the pixel detector.
 * Only a reread pitch independently corroborated by a head may replace a pitch.
 * Incomplete evidence or changed timing prevents positional alignment entirely.
 * Accidentals remain the rereader's observation and need separate quality checks.
 */
export function reconcilePitchReview(
	original: RecognizedBar,
	candidate: RecognizedBar,
	evidence: NoteheadEvidence | null | undefined
): RecognizedBar {
	if (
		!hasCompleteHeadEvidence(evidence) ||
		original.melody.filter((note) => !isRestPitch(note[2])).length !== evidence.count ||
		original.melody.length !== candidate.melody.length ||
		original.melody.some((note, i) => {
			const after = candidate.melody[i];
			return (
				Math.abs(note[0] - after[0]) >= 0.001 ||
				Math.abs(note[1] - after[1]) >= 0.001 ||
				isRestPitch(note[2]) !== isRestPitch(after[2])
			);
		})
	)
		return original;
	let head = 0;
	return {
		...original,
		melody: original.melody.map((note, i) => {
			if (isRestPitch(note[2])) return note;
			const pitch = candidate.melody[i][2];
			if (pitch.replace(/[#b♯♭]/g, '') !== evidence.letters[head++]) return note;
			const corrected = [...note] as typeof note;
			corrected[2] = pitch;
			return corrected;
		})
	};
}
