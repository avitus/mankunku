import type { PitchClass } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';
import { transposePitchClass } from '$lib/music/transposition';
import { parseChordSymbol, formatChordSymbol } from '$lib/music/chord-symbol';
import type { Tune } from '$lib/types/tune';

/**
 * Source transposition — what pitch a chart being ADDED is written in.
 *
 * Tunes store concert pitch, but the chart in front of the user may be
 * a written-pitch part: a Bb book page, a tenor part, an Eb alto edition.
 * Every add method (manual entry + all importers) lets the user say which,
 * and the sheet is shifted to concert before it is stored.
 */

export type SourceTransposition = 'C' | 'Bb' | 'Eb';

export const SOURCE_TRANSPOSITIONS: { id: SourceTransposition; label: string }[] = [
	{ id: 'C', label: 'C — Concert' },
	{ id: 'Bb', label: 'B♭ — Tenor Sax / Trumpet' },
	{ id: 'Eb', label: 'E♭ — Alto Sax' }
];

/** Written key's pitch-class offset above concert for each family. */
const WRITTEN_PC_OFFSET: Record<SourceTransposition, number> = { C: 0, Bb: 2, Eb: 9 };

function instrumentFamilyPc(instrument: InstrumentConfig): number {
	return ((instrument.transpositionSemitones % 12) + 12) % 12;
}

/** The family the user's own instrument reads in — the natural default. */
export function defaultSourceTransposition(instrument: InstrumentConfig): SourceTransposition {
	const pc = instrumentFamilyPc(instrument);
	if (pc === WRITTEN_PC_OFFSET.Bb) return 'Bb';
	if (pc === WRITTEN_PC_OFFSET.Eb) return 'Eb';
	return 'C';
}

/**
 * Semitones the SOURCE chart is written above concert.
 *
 * When the user's own horn is in the chart's family, use its exact offset —
 * so importing your own part and displaying it on your instrument reproduces
 * the printed page, octave included (a tenor part is +14, not +2). Outside
 * the family, fall back to the canonical book offset (published Bb/Eb
 * editions are written a major 2nd / major 6th above concert).
 */
export function sourceTranspositionSemitones(
	source: SourceTransposition,
	instrument: InstrumentConfig
): number {
	const pc = WRITTEN_PC_OFFSET[source];
	if (pc === 0) return 0;
	if (instrumentFamilyPc(instrument) === pc) return instrument.transpositionSemitones;
	return pc;
}

/** Shift a chord symbol's root/bass by pitch class; null for unparseable text. */
function shiftSymbol(symbol: string | undefined, semitones: number): string | undefined {
	if (!symbol) return undefined;
	const parsed = parseChordSymbol(symbol);
	if (!parsed) return undefined;
	return formatChordSymbol({
		...parsed,
		root: transposePitchClass(parsed.root, semitones),
		bass: parsed.bass ? transposePitchClass(parsed.bass, semitones) : undefined
	});
}

/**
 * Convert a sheet parsed at WRITTEN pitch to concert: melody down by the
 * exact source offset, key/chords down by its pitch class. Identity (same
 * reference) for concert sources. The id is preserved — the PDF flow
 * pre-assigns it to keep the stored original linked.
 */
export function writtenSheetToConcert(
	sheet: Tune,
	source: SourceTransposition,
	instrument: InstrumentConfig
): Tune {
	const semitones = sourceTranspositionSemitones(source, instrument);
	if (semitones === 0) return sheet;

	return {
		...sheet,
		key: transposePitchClass(sheet.key as PitchClass, -semitones),
		sections: sheet.sections.map((sec) => ({
			...sec,
			notes: sec.notes.map((n) => ({
				...n,
				pitch: n.pitch === null ? null : n.pitch - semitones
			})),
			harmony: sec.harmony.map((h) => ({
				...h,
				chord: {
					...h.chord,
					root: transposePitchClass(h.chord.root, -semitones),
					...(h.chord.bass ? { bass: transposePitchClass(h.chord.bass, -semitones) } : {})
				},
				symbol: shiftSymbol(h.symbol, -semitones)
			}))
		}))
	};
}
