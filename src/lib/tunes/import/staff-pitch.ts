/** Deterministic spelling from a calibrated staff coordinate and printed accidental. */
import type { Clef } from './pdf-recognition';
import type { BarMelody } from './system-bar-validation';
export type PrintedAccidental = 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'double-flat';
export interface StaffEvent {
	beat: number;
	duration: number;
	/** Diatonic half-spaces above the bottom staff line; null is a rest. */
	position: number | null;
	/** Only an explicit printed accidental; null inherits the key/bar state. */
	accidental: PrintedAccidental | null;
	tied: boolean;
}
const LETTERS = 'CDEFGAB';
const BOTTOM: Record<Clef, number> = {
	treble: 4 * 7 + 2,
	bass: 2 * 7 + 4,
	alto: 3 * 7 + 3,
	tenor: 3 * 7 + 1
};
const ACCIDENTALS: Record<PrintedAccidental, number> = {
	sharp: 1,
	flat: -1,
	natural: 0,
	'double-sharp': 2,
	'double-flat': -2
};

export function resolveStaffEvents(
	events: StaffEvent[],
	clef: Clef,
	fifths: number,
	tiedFrom?: string
): BarMelody {
	if (!Number.isInteger(fifths) || Math.abs(fifths) > 7) throw new Error('Unknown key signature');
	const signature = new Map<string, number>();
	const order = fifths < 0 ? 'BEADGCF' : 'FCGDAEB';
	for (const letter of order.slice(0, Math.abs(fifths))) signature.set(letter, Math.sign(fifths));
	const accidentals = new Map<number, number>();
	const tie = tiedFrom ? /^([A-G])([#b]{0,2})(-?\d)$/.exec(tiedFrom) : null;
	return [...events]
		.sort((a, b) => a.beat - b.beat)
		.map((event, index) => {
			if (event.position === null) return [event.beat, event.duration, 'rest'];
			if (!Number.isInteger(event.position) || Math.abs(event.position) > 28)
				throw new Error('Invalid staff position');
			const step = BOTTOM[clef] + event.position;
			const letter = LETTERS[((step % 7) + 7) % 7],
				octave = Math.floor(step / 7);
			if (event.accidental !== null) accidentals.set(step, ACCIDENTALS[event.accidental]);
			let alteration = accidentals.get(step) ?? signature.get(letter) ?? 0;
			// A tie across a barline preserves the originating pitch, even when
			// that accidental otherwise resets at the new measure.
			if (
				index === 0 &&
				event.accidental === null &&
				tie &&
				tie[1] === letter &&
				Number(tie[3]) === octave
			)
				alteration = tie[2].includes('#') ? tie[2].length : -tie[2].length;
			const pitch = `${letter}${alteration > 0 ? '#'.repeat(alteration) : 'b'.repeat(-alteration)}${octave}`;
			return event.tied
				? [event.beat, event.duration, pitch, true]
				: [event.beat, event.duration, pitch];
		});
}
