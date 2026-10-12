/** Bounded, inert input at the browser/server recognition seam. */
import type { Clef, NoteheadEvidence, RecognitionContext } from './pdf-recognition';
const clefs: Clef[] = ['treble', 'bass', 'alto', 'tenor'];
export function sanitizeRecognitionContext(raw: unknown): RecognitionContext {
	const c = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	return {
		fifths:
			typeof c.fifths === 'number' && Number.isInteger(c.fifths) && Math.abs(c.fifths) <= 7
				? c.fifths
				: null,
		clef: clefs.includes(c.clef as Clef) ? (c.clef as Clef) : null,
		timeSignature:
			Array.isArray(c.timeSignature) &&
			c.timeSignature.length === 2 &&
			c.timeSignature.every((n) => Number.isInteger(n) && n > 0 && n <= 32)
				? (c.timeSignature as [number, number])
				: null
	};
}
export function sanitizeEvidence(raw: unknown, count: number): Array<NoteheadEvidence | null> {
	if (!Array.isArray(raw)) return [];
	return raw.slice(0, count).map((e) => {
		if (
			!e ||
			!Number.isInteger(e.count) ||
			e.count < 0 ||
			e.count > 128 ||
			!Array.isArray(e.letters)
		)
			return null;
		const letters = e.letters.slice(0, 128);
		if (!letters.every((l: unknown) => typeof l === 'string' && /^[A-G]-?\d$/.test(l))) return null;
		return { count: e.count, letters };
	});
}
