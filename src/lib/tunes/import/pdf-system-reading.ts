import { printedDirections } from './pdf-directions';
/** Shared structural screening and rhythm validation for recognition adapters. */
import type { RecognizedBar as SystemBar, Clef } from './pdf-recognition';
import { barTilingIssues } from './system-bar-validation';
import { sanitizeRecognitionContext } from './pdf-recognition-screen';

/** Per-bar rhythm issues (exact tiling incl. rests) plus the global bar
 * count; index 0 of the result is the global issue list, then one list per
 * bar. */
export function systemBarIssues(
	bars: SystemBar[],
	barCount: number,
	beats: number
): { global: string[]; perBar: string[][] } {
	const global: string[] = [];
	if (bars.length !== barCount) {
		global.push(`expected ${barCount} bars but the transcription returned ${bars.length}`);
	}
	const perBar = bars.map((bar, i) =>
		barTilingIssues(bar.melody, i, beats, { allowLeadingGap: bar.pickup })
	);
	return { global, perBar };
}

/** Screen the raw model JSON into SystemBar[]; null when malformed. */
export function screenSystemBars(parsed: unknown): {
	fifths: number | null;
	clef: Clef | null;
	timeSignature: [number, number] | null;
	bars: SystemBar[];
} | null {
	if (!parsed || typeof parsed !== 'object') return null;
	const obj = parsed as {
		keySignature?: { fifths?: unknown };
		clef?: unknown;
		timeSignature?: unknown;
		bars?: unknown;
	};
	if (!Array.isArray(obj.bars) || obj.bars.length > 32) return null;
	const bars: SystemBar[] = [];
	for (const raw of obj.bars) {
		if (!raw || typeof raw !== 'object') return null;
		const b = raw as Record<string, unknown>;
		if (!Array.isArray(b.melody) || b.melody.length > 128) return null;
		const melody: SystemBar['melody'] = [];
		for (const note of b.melody) {
			if (
				!Array.isArray(note) ||
				note.length < 3 ||
				typeof note[0] !== 'number' ||
				typeof note[1] !== 'number' ||
				typeof note[2] !== 'string' ||
				!Number.isFinite(note[0]) ||
				!Number.isFinite(note[1]) ||
				note[0] < 0 ||
				note[1] <= 0 ||
				!/^(?:rest|[A-G][#b]{0,2}-?\d)$/i.test(note[2])
			) {
				return null;
			}
			melody.push(
				note[4] === 'staccato' ? [note[0], note[1], note[2], note[3] === true, 'staccato']
					: note[3] === true ? [note[0], note[1], note[2], true] : [note[0], note[1], note[2]]
			);
		}
		const directions = printedDirections(b.directions);
		const printedAccidentals = Array.isArray(b.printedAccidentals)
			? b.printedAccidentals.slice(0, 128).filter((beat): beat is number =>
				typeof beat === 'number' && Number.isFinite(beat) && beat >= 0 && beat < 32)
			: [];
		bars.push({
			...(directions.length ? { directions } : {}),
			...(printedAccidentals.length ? { printedAccidentals } : {}),
			startRepeat: b.startRepeat === true,
			endRepeat: b.endRepeat === true,
			ending: typeof b.ending === 'number' ? b.ending : null,
			pickup: b.pickup === true,
			melody
		});
	}
	const context = sanitizeRecognitionContext({
		fifths: obj.keySignature?.fifths,
		clef: obj.clef,
		timeSignature: obj.timeSignature
	});
	return { ...context, bars };
}
