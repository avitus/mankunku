/**
 * Lead-sheet engraving of a lick for the lick-practice key stack: a
 * struggling key's row shows the phrase as ONE system with chord symbols
 * above the staff. The engraving reuses the tune path (`tuneToAbc`) via a
 * synthesized one-section Tune, so this file pins (a) the three ABC options
 * the row needs that the tune path lacked, and (b) the phrase → Tune adapter.
 *
 * The existing tune goldens (tune-notation.test.ts) are byte-identical with
 * every option at its default — that is the additive contract.
 */

import { describe, it, expect } from 'vitest';
import { tuneToAbc } from '$lib/music/tune-notation';
import { phraseToAbc } from '$lib/music/notation';
import { leadSheetTuneFor, leadSheetAbcOptions } from '$lib/music/lead-sheet';
import { MINOR_CADENCE } from '$lib/data/progressions';
import { INSTRUMENTS, type InstrumentConfig } from '$lib/types/instruments';
import { seg, sheet, section, simpleSheet } from '../../helpers/tune-fixtures';
import type { Phrase, Note, HarmonicSegment, PitchClass, ChordQuality } from '$lib/types/music';

function note(midi: number, offsetEighths: number, durationEighths = 1): Note {
	return { pitch: midi, offset: [offsetEighths, 8], duration: [durationEighths, 8] };
}

const HDR_DEFAULT =
	'X:1\nT:Test Tune\nM:4/4\nL:1/8\n%%partsbox 1\n%%measurenb 0\n%%stretchlast 0\n%%score (M H)\nK:C\nV:M\nV:H stem=down\n';

describe('tuneToAbc options for a lead-sheet row', () => {
	it('keeps the default output byte-identical when no new option is set', () => {
		expect(tuneToAbc(simpleSheet())).toBe(
			HDR_DEFAULT + 'P:A\n[V:M]C8 | D4 z4 |]\n[V:H]"D-7"x4 "G7"x4 | "CΔ7"x8 |\n'
		);
	});

	it('prints a minor key field and spells by the relative major signature', () => {
		// D minor: one flat. A Bb reads as a signature note (plain B), and the
		// key field is Dm — as phraseToAbc already prints for a minor lick.
		const dMinor = sheet({
			key: 'D',
			sections: [
				section({
					bars: 1,
					notes: [note(62, 0, 4), note(70, 4, 4)], // D4, Bb4
					harmony: [seg('D', 'min7', [0, 1], [1, 1])]
				})
			]
		});
		const abc = tuneToAbc(dMinor, undefined, { mode: 'minor' });
		expect(abc).toContain('\nK:Dm\n');
		expect(abc).toContain('[V:M]D4 B4 |]');
		// Same sheet read as major spells the Bb explicitly.
		expect(tuneToAbc(dMinor)).toContain('\nK:D\n');
		expect(tuneToAbc(dMinor)).toContain('[V:M]D4 _B4 |]');
	});

	it('stretches the last system to full width on request', () => {
		expect(tuneToAbc(simpleSheet(), undefined, { stretchLast: true })).toContain(
			'\n%%stretchlast 1\n'
		);
	});

	it('omits measure numbers on request', () => {
		expect(tuneToAbc(simpleSheet(), undefined, { measureNumbers: false })).not.toContain(
			'%%measurenb'
		);
	});
});

function phrase(overrides: Partial<Phrase>): Phrase {
	return {
		id: 'lick-1',
		name: 'Test lick',
		timeSignature: [4, 4],
		key: 'C',
		notes: [],
		harmony: [],
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
		category: 'short-ii-V-I-major',
		tags: [],
		source: 'curated',
		...overrides
	};
}

/** ii-V | I over two bars, the short ii-V-I template shape. */
const SHORT_II_V_I: HarmonicSegment[] = [
	seg('D', 'min7', [0, 1], [1, 2]),
	seg('G', '7', [1, 2], [1, 2]),
	seg('C', 'maj7', [1, 1], [1, 1])
];

describe('leadSheetTuneFor', () => {
	it('wraps a short-cycle phrase as one unlabelled section covering the whole cycle', () => {
		const p = phrase({
			notes: [note(64, 0), note(62, 1), note(60, 2), note(59, 3), note(60, 8, 4)],
			harmony: SHORT_II_V_I
		});
		const { tune, startBar, bars } = leadSheetTuneFor(p);
		expect(startBar).toBe(0);
		expect(bars).toBe(2);
		expect(tune.sections).toHaveLength(1);
		expect(tune.sections[0].label).toBe('');
		expect(tune.sections[0].bars).toBe(2);
		expect(tune.sections[0].notes).toBe(p.notes); // untouched, same reference
		expect(tune.sections[0].harmony).toBe(p.harmony);
		expect(tune.key).toBe('C');
		expect(tune.timeSignature).toEqual([4, 4]);
		// No title: abcjs reserves masthead height for one even when CSS hides it.
		expect(tune.title).toBe('');
	});

	it('engraves the whole cycle even when the melody stops early', () => {
		const p = phrase({ notes: [note(64, 0), note(62, 1)], harmony: SHORT_II_V_I });
		expect(leadSheetTuneFor(p).bars).toBe(2);
	});

	it('engraves at least one bar for an empty phrase', () => {
		const { bars, tune } = leadSheetTuneFor(phrase({}));
		expect(bars).toBe(1);
		expect(tune.sections[0].bars).toBe(1);
	});

	it('windows a long cycle to the bars the melody occupies', () => {
		// 12-bar blues cycle; a 2-bar lick sitting on bars 9–10 (0-based 8–9).
		const blues: HarmonicSegment[] = Array.from({ length: 12 }, (_, bar) =>
			seg(bar === 8 ? 'D' : bar === 9 ? 'G' : 'C', bar === 8 ? 'min7' : '7', [bar, 1], [1, 1])
		);
		const p = phrase({
			notes: [note(62, 64), note(64, 65), note(65, 66, 2), note(67, 72, 8)],
			harmony: blues
		});
		const { tune, startBar, bars } = leadSheetTuneFor(p);
		expect(startBar).toBe(8);
		expect(bars).toBe(2);
		// Notes rebased to the window start; harmony clipped to the window.
		expect(tune.sections[0].notes.map((n) => n.offset)).toEqual([
			[0, 1],
			[1, 8],
			[1, 4],
			[1, 1]
		]);
		expect(tune.sections[0].harmony.map((h) => [h.chord.root, h.startOffset, h.duration])).toEqual([
			['D', [0, 1], [1, 1]],
			['G', [1, 1], [1, 1]]
		]);
	});

	it('caps the window at the maximum bars, from the melody\'s first bar', () => {
		const eightBars: HarmonicSegment[] = Array.from({ length: 8 }, (_, bar) =>
			seg('C', 'maj7', [bar, 1], [1, 1])
		);
		// Melody spans bars 0–5; window is the first four.
		const p = phrase({
			notes: [note(60, 0), note(60, 40, 8)],
			harmony: eightBars
		});
		const { startBar, bars, tune } = leadSheetTuneFor(p, 4);
		expect(startBar).toBe(0);
		expect(bars).toBe(4);
		expect(tune.sections[0].notes).toHaveLength(1); // the bar-5 note falls outside
	});

	it('extends the window to the bar a sustained note ends in', () => {
		// 12-bar cycle; one note starts in bar 9 (0-based 8) and holds for two
		// bars. The window must cover both, not just the bar it starts in.
		const blues: HarmonicSegment[] = Array.from({ length: 12 }, (_, bar) =>
			seg('C', '7', [bar, 1], [1, 1])
		);
		const p = phrase({ notes: [note(60, 64, 16)], harmony: blues });
		const { startBar, bars, tune } = leadSheetTuneFor(p);
		expect(startBar).toBe(8);
		expect(bars).toBe(2);
		expect(tune.sections[0].notes[0].duration).toEqual([2, 1]);
	});

	it('clips a note that would sound past the capped window', () => {
		// Melody spans bars 0–5 of an 8-bar cycle; the window is the first four
		// bars, and the note that starts in bar 3 and holds for two bars must
		// end at the window's edge rather than overhang the row.
		const eightBars: HarmonicSegment[] = Array.from({ length: 8 }, (_, bar) =>
			seg('C', 'maj7', [bar, 1], [1, 1])
		);
		const p = phrase({ notes: [note(60, 0), note(62, 24, 16)], harmony: eightBars });
		const { bars, tune } = leadSheetTuneFor(p, 4);
		expect(bars).toBe(4);
		expect(tune.sections[0].notes).toHaveLength(2);
		expect(tune.sections[0].notes[1].offset).toEqual([3, 1]);
		expect(tune.sections[0].notes[1].duration).toEqual([1, 1]);
	});

	it('produces the row options: minor mode from the phrase, one system, stretched, unnumbered', () => {
		const p = phrase({ key: 'D', mode: 'minor', harmony: SHORT_II_V_I });
		expect(leadSheetAbcOptions(p, 2)).toEqual({
			mode: 'minor',
			barsPerLine: 2,
			stretchLast: true,
			measureNumbers: false
		});
	});

	it('golden: a short ii-V-I lick engraves as one system with chords over the notes', () => {
		const p = phrase({
			notes: [note(64, 0), note(62, 1), note(60, 2), note(59, 3), note(60, 8, 4)],
			harmony: SHORT_II_V_I
		});
		const { tune, bars } = leadSheetTuneFor(p);
		expect(tuneToAbc(tune, undefined, leadSheetAbcOptions(p, bars))).toBe(
			'X:1\nT:\nM:4/4\nL:1/8\n%%partsbox 1\n%%stretchlast 1\n%%score (M H)\nK:C\nV:M\nV:H stem=down\n' +
				'[V:M]EDCB, z4 | C4 z4 |]\n[V:H]"D-7"x4 "G7"x4 | "CΔ7"x8 |\n'
		);
	});
});

// ─── One spelling chain: the row prints what the lick chart prints ───────
//
// The row engraves a lick through the TUNE path; the lick chart and every
// note-name display (NoteComparison) spell through `spellingContextAt` +
// `resolveUseFlats`. A pitch must print with the same accidental on both, or
// a session's lead-sheet row and its note list disagree — the 2026-08-22
// blues report (a written-C blues line whose blue third and fifth read as the
// #9 / #11 of C7) reappearing on a second surface.

/** Pitched tokens (accidental + letter + octave marks) of an ABC melody, in order. */
function pitchTokens(melody: string): string[] {
	// Inline fields ([V:M], [I:…]), quoted chords and !decorations! go first
	// so only note letters remain; rests (z, x) never match.
	return melody.replace(/\[[^\]]*\]|"[^"]*"|![^!]*!/g, '').match(/[_^=]?[A-Ga-g][,']*/g) ?? [];
}

/** The lick chart's spelling of the phrase (`phraseToAbc`, body on the last line). */
function chartSpelling(p: Phrase, instrument?: InstrumentConfig): string[] {
	return pitchTokens(phraseToAbc(p, instrument).split('\n').pop()!);
}

/** The row's ABC exactly as UpcomingKeysDisplay hands it to NotationDisplay. */
function rowAbc(p: Phrase, instrument?: InstrumentConfig): string {
	const { tune, bars } = leadSheetTuneFor(p);
	return tuneToAbc(tune, instrument, leadSheetAbcOptions(p, bars));
}

function rowSpelling(p: Phrase, instrument?: InstrumentConfig): string[] {
	return pitchTokens(rowAbc(p, instrument).split('\n').filter((l) => l.startsWith('[V:M]')).join(' '));
}

function over(root: PitchClass, quality: ChordQuality, scaleId: string): HarmonicSegment[] {
	return [{ chord: { root, quality }, scaleId, startOffset: [0, 1], duration: [1, 1] }];
}

/**
 * Concert B minor through the shared minor cadence — what `buildPhraseFor`
 * stamps on a minor drill — with the dorian 6th (G#4) over the i chord.
 * On tenor it reads in C# minor: E major's four sharps, chords D#ø7 · G#7b9
 * · C#-7, and the G# becomes a written A#5 that no signature sharp covers.
 */
function bMinorCadence(): Phrase {
	return phrase({
		key: 'B',
		mode: 'minor',
		category: 'ii-V-I-minor',
		notes: [{ pitch: 68, offset: [2, 1], duration: [1, 2] }],
		harmony: [
			{ chord: { root: 'Db', quality: MINOR_CADENCE.ii.quality }, scaleId: MINOR_CADENCE.ii.scaleId, startOffset: [0, 1], duration: [1, 1] },
			{ chord: { root: 'F#', quality: MINOR_CADENCE.V.quality }, scaleId: MINOR_CADENCE.V.scaleId, startOffset: [1, 1], duration: [1, 1] },
			{ chord: { root: 'B', quality: 'min7' }, scaleId: 'major.aeolian', startOffset: [2, 1], duration: [2, 1] }
		]
	});
}

describe('lead-sheet row — one spelling chain with the lick chart', () => {
	const TENOR = INSTRUMENTS['tenor-sax'];

	// A quarter note on beat 1 in key C — the 2026-08-22 input pinned in
	// notation.test.ts. The declared scale settles exactly the chord tier's
	// three ambiguous degrees (b3/#9, b5/#11, #5/b13), over a dominant and
	// over a minor chord (G-7 as a ii in C, so no signature note decides).
	it.each([
		['the b3 over C7, blues scale', 63, 'C', '7', 'blues.minor', '_E'],
		['the b5 over C7, blues scale', 66, 'C', '7', 'blues.minor', '_G'],
		['the #5 over C7, whole-tone scale', 68, 'C', '7', 'symmetric.whole-tone', '^G'],
		['the b3 over G7alt, altered scale', 70, 'G', '7alt', 'melodic-minor.altered', '_B'],
		['the b3 over G-7, blues scale', 70, 'G', 'min7', 'blues.minor', '_B'],
		['the b5 over G-7, blues scale', 61, 'G', 'min7', 'blues.minor', '_D'],
		['the b13 over G-7, aeolian scale', 63, 'G', 'min7', 'major.aeolian', '_E']
	] as const)('spells %s as the chart does', (_what, midi, root, quality, scaleId, printed) => {
		const p = phrase({
			notes: [{ pitch: midi, offset: [0, 1], duration: [1, 4] }],
			harmony: over(root, quality, scaleId)
		});
		expect(chartSpelling(p)).toEqual([printed]);
		expect(rowSpelling(p)).toEqual(chartSpelling(p));
	});

	it('agrees on tenor: a concert Bb7 blues reads as a written C7 blues', () => {
		// Concert Db4 / E4 → written Eb5 / Gb5: the blue third and fifth.
		const p = phrase({
			key: 'Bb',
			notes: [
				{ pitch: 61, offset: [0, 1], duration: [1, 4] },
				{ pitch: 64, offset: [1, 4], duration: [1, 4] }
			],
			harmony: over('Bb', '7', 'blues.minor')
		});
		expect(chartSpelling(p, TENOR)).toEqual(['_e', '_g']);
		expect(rowSpelling(p, TENOR)).toEqual(chartSpelling(p, TENOR));
	});

	it('agrees in a minor key: judges the chord with its root read in the minor key', () => {
		// The chart reads the i chord as C#-7 (roots respelled for the relative
		// major, E), so the dorian 6th is A# — never the Bb a Db-7 would give.
		const p = bMinorCadence();
		expect(chartSpelling(p, TENOR)).toEqual(['^a']);
		expect(rowSpelling(p, TENOR)).toEqual(chartSpelling(p, TENOR));
	});

	it('agrees on a minor lick\'s note that no chord governs: the harmonic-minor frame', () => {
		// D minor, no harmony: the leading tone is C#, not the one-flat default Db.
		const p = phrase({ key: 'D', mode: 'minor', notes: [{ pitch: 61, offset: [0, 1], duration: [1, 4] }] });
		expect(chartSpelling(p)).toEqual(['^C']);
		expect(rowSpelling(p)).toEqual(chartSpelling(p));
	});

	it('prints a minor row\'s chord roots the way the key chart reads them', () => {
		// ChordChart respells roots with the phrase's mode (`displayPitchClass`
		// in C# minor → the relative major E): D#-7b5 · G#7b9 · C#-7, the chord
		// the note above was judged against — not Eb · Ab · Db.
		const chords = rowAbc(bMinorCadence(), TENOR).split('\n').find((l) => l.startsWith('[V:H]'));
		expect(chords).toBe('[V:H]"D#-7b5"x8 | "G#7b9"x8 | "C#-7"x8 | x8 |');
	});
});
