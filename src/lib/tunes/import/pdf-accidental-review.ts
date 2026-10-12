/** Provider-neutral alignment of advisory printed accidental observations. */
import type { NoteheadEvidence, RecognizedBar } from './pdf-recognition';
import type { PrintedAccidental } from './staff-pitch';
import { pitchReviewAgreesWithHeads } from './pdf-pitch-reconciliation';
import { isRestPitch } from './system-bar-validation';

export interface AccidentalBarReading {
	notes: number;
	/** One-based pitched-note index, excluding rests. */
	signs: Array<[number, PrintedAccidental]>;
}
const SPELLING: Record<PrintedAccidental, string> = {
	sharp: '#',
	flat: 'b',
	natural: '',
	'double-sharp': '##',
	'double-flat': 'bb'
};
export function screenAccidentalReading(raw: unknown, count: number): AccidentalBarReading[] {
	const bars = raw && typeof raw === 'object' && 'bars' in raw ? raw.bars : null;
	if (!Array.isArray(bars) || bars.length !== count)
		throw new Error('Accidental measure count mismatch');
	return bars.map((bar) => {
		if (
			!bar ||
			!Number.isInteger(bar.notes) ||
			bar.notes < 0 ||
			bar.notes > 128 ||
			!Array.isArray(bar.signs) ||
			bar.signs.length > bar.notes
		)
			throw new Error('Invalid accidental note count');
		const used = new Set<number>();
		const signs: AccidentalBarReading['signs'] = bar.signs.map((sign: unknown) => {
			if (
				!Array.isArray(sign) ||
				sign.length !== 2 ||
				!Number.isInteger(sign[0]) ||
				sign[0] < 1 ||
				sign[0] > bar.notes ||
				used.has(sign[0]) ||
				typeof sign[1] !== 'string' ||
				!Object.hasOwn(SPELLING, sign[1])
			)
				throw new Error('Invalid or duplicate printed accidental');
			used.add(sign[0]);
			return [sign[0], sign[1] as PrintedAccidental];
		});
		return { notes: bar.notes, signs: signs.sort((a, b) => a[0] - b[0]) };
	});
}

/** Absence of a sign is never used to erase an existing accidental. Two readers
 * must agree on the whole measure's symbols and independently count its heads.
 * Pixel evidence corroborates note order, letter and octave, not symbol identity.
 * Same-model agreement misread printed naturals in held-out evaluation, so this
 * comparison must never rewrite pitches. It only exposes specific review items.
 */
export function comparePrintedAccidentals(
	original: RecognizedBar[],
	evidence: Array<NoteheadEvidence | null>,
	first: AccidentalBarReading[],
	second: AccidentalBarReading[]
): { bars: RecognizedBar[]; warnings: string[] } {
	const bars = original,
		warnings: string[] = [];
	for (let i = 0; i < bars.length; i++) {
		const a = first[i],
			b = second[i],
			bar = original[i];
		if (!a || !b || (!a.signs.length && !b.signs.length)) continue;
		const warn = (message: string) => warnings.push(`bar ${i + 1}: ${message}`);
		if (JSON.stringify(a) !== JSON.stringify(b)) {
			warn('printed accidental readings disagree; original pitches retained');
			continue;
		}
		if (a.notes !== evidence[i]?.count || !pitchReviewAgreesWithHeads(bar, evidence[i])) {
			warn('printed accidentals could not be aligned with every note; original pitches retained');
			continue;
		}
		const signs = new Map(a.signs),
			active = new Map<string, string>();
		let noteIndex = 0;
		const changes: string[] = [];
		const melody = bar.melody.map((note) => {
			if (isRestPitch(note[2])) return note;
			const match = /^([A-G])([#b]{0,2})(-?\d+)$/.exec(note[2]);
			const sign = signs.get(++noteIndex);
			if (!match) return note;
			const step = match[1] + match[3];
			if (sign) active.set(step, SPELLING[sign]);
			const spelling = active.get(step);
			if (spelling === undefined) return note;
			const pitch = match[1] + spelling + match[3];
			if (pitch === note[2]) return note;
			changes.push(`note ${noteIndex} ${note[2]} to ${pitch}`);
			const corrected = [...note] as typeof note;
			corrected[2] = pitch;
			return corrected;
		});
		if (!changes.length) continue;
		// Include neighboring events so a correction cannot break an incoming or outgoing tie.
		const surrounding = [bars[i - 1]?.melody.at(-1), ...melody, original[i + 1]?.melody[0]].filter(
			(n) => n !== undefined
		);
		if (
			surrounding.some(
				(note, j) => note[3] === true && surrounding[j + 1] && note[2] !== surrounding[j + 1][2]
			)
		) {
			warn('printed accidental correction conflicts with a tie; original pitches retained');
			continue;
		}
		warn(
			`printed accidental review suggests ${changes.join(', ')}; original pitches retained, verify against the PDF`
		);
	}
	return { bars, warnings };
}
