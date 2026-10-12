/** Select ambiguous rhythmic shapes and require independent notation agreement. */
import type { NoteheadEvidence, RecognizedBar } from './pdf-recognition';
import { hasCompleteHeadEvidence, pitchReviewAgreesWithHeads } from './pdf-pitch-reconciliation';
import { barTilingIssues, isRestPitch } from './system-bar-validation';

export function notationReviewNeeded(
	bar: RecognizedBar,
	evidence: NoteheadEvidence | null | undefined
): boolean {
	if (!hasCompleteHeadEvidence(evidence)) return false;
	// Pitch-only review cannot repair an incorrect note count, even when durations tile.
	if (bar.melody.filter((n) => !isRestPitch(n[2])).length !== evidence.count) return true;
	return bar.melody.some((note, i) => {
		if ([0.1875, 0.375, 0.75, 1.5, 3, 6, 12].some((d) => Math.abs(d - note[1]) < 0.001))
			return true;
		const next = bar.melody[i + 1];
		return (
			!isRestPitch(note[2]) &&
			note[3] !== true &&
			next?.[2] === note[2] &&
			Math.abs(note[0] + note[1] - next[0]) < 0.001
		);
	});
}

export function notationReviewsAgree(
	first: RecognizedBar,
	second: RecognizedBar,
	evidence: NoteheadEvidence | null | undefined,
	beats: number
): boolean {
	if (
		!pitchReviewAgreesWithHeads(first, evidence) ||
		!pitchReviewAgreesWithHeads(second, evidence) ||
		first.melody.length !== second.melody.length ||
		first.pickup !== second.pickup
	)
		return false;
	for (const bar of [first, second]) {
		if (barTilingIssues(bar.melody, 0, beats, { allowLeadingGap: bar.pickup }).length) return false;
		if (
			bar.melody.some(
				(note, i) =>
					note[3] === true &&
					(isRestPitch(note[2]) || (i < bar.melody.length - 1 && note[2] !== bar.melody[i + 1][2]))
			)
		)
			return false;
	}
	return first.melody.every((note, i) => {
		const other = second.melody[i];
		return (
			Math.abs(note[0] - other[0]) < 0.001 &&
			Math.abs(note[1] - other[1]) < 0.001 &&
			isRestPitch(note[2]) === isRestPitch(other[2]) &&
			(note[3] === true) === (other[3] === true)
		);
	});
}
