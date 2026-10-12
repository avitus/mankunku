/** Provider-neutral acceptance of focused pitch or full-notation readings. */
import type { Clef, NoteheadEvidence, RecognizedBar } from './pdf-recognition';
import { notationReviewsAgree } from './pdf-notation-review';
import { pitchReviewAccidentalIssues } from './pdf-recognition-quality';
import { systemBarIssues } from './pdf-system-reading';
import {
	pitchReviewAgreesWithHeads,
	reconcilePitchReview,
	retainDisputedAccidentals
} from './pdf-pitch-reconciliation';

export interface FocusedBarReview {
	original: RecognizedBar;
	evidence: NoteheadEvidence | null | undefined;
	clef: Clef;
	beats: number;
	index: number;
	notation: boolean;
}

/** Each callback invocation must independently read the source, not the previous answer. */
export async function reviewRecognizedBar(
	input: FocusedBarReview,
	read: () => Promise<RecognizedBar>,
	signal: AbortSignal
): Promise<{ bar: RecognizedBar; warnings: string[]; confirmedAccidentals: boolean }> {
	const { original, evidence, clef, beats, index, notation } = input;
	const candidate = await read();
	const candidateClean = !systemBarIssues([candidate], 1, beats).perBar[0].length;
	const originalClean = !systemBarIssues([original], 1, beats).perBar[0].length;
	const corroborated = clef === 'treble' && pitchReviewAgreesWithHeads(candidate, evidence);
	const accept = (bar: RecognizedBar, extra: string[] = [], confirmed = false) => {
		const warnings = [...pitchReviewAccidentalIssues(original, bar, index), ...extra];
		const retained = retainDisputedAccidentals(original, bar);
		if (notation && confirmed && !notationReviewsAgree(retained, retained, evidence, beats))
			return {
				bar: original,
				warnings: [
					...warnings,
					`bar ${index + 1}: retained accidentals conflict with reread ties; original notation retained`
				],
				confirmedAccidentals: false
			};
		return {
			bar: retained,
			warnings,
			confirmedAccidentals: confirmed && !warnings.length
		};
	};
	if (notation) {
		let confirmation: RecognizedBar | null = null;
		if (candidateClean && corroborated) {
			try {
				confirmation = await read();
			} catch (err) {
				if (signal.aborted) throw err;
			}
		}
		if (confirmation && notationReviewsAgree(candidate, confirmation, evidence, beats))
			return accept(candidate, pitchReviewAccidentalIssues(candidate, confirmation, index), true);
		return accept(candidateClean ? reconcilePitchReview(original, candidate, evidence) : original, [
			`bar ${index + 1}: notation readings did not agree; original timing and ties retained`
		]);
	}
	if (candidateClean && (!originalClean || corroborated)) return accept(candidate, [], true);
	if (candidateClean && originalClean && clef === 'treble')
		return accept(reconcilePitchReview(original, candidate, evidence));
	return accept(original);
}
