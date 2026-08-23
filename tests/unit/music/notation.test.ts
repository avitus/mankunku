import { describe, it, expect } from 'vitest';
import {
	phraseToAbc,
	midiToDisplayName,
	durationToAbc,
	scaleSpellingPreference,
	spellingContextAt,
	resolveUseFlats
} from '$lib/music/notation';
import type { HarmonicSegment } from '$lib/types/music';
import type { Phrase, PitchClass } from '$lib/types/music';

/** Build a minimal phrase with a single note for testing ABC output. */
function singleNotePhrase(midi: number, key: PitchClass): Phrase {
	return {
		id: 'test',
		name: 'test',
		timeSignature: [4, 4],
		key,
		notes: [{ pitch: midi, duration: [1, 4], offset: [0, 1] }],
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'user',
		tags: [],
		source: 'test'
	};
}

/** Extract the note tokens line (last line) from ABC output. */
function noteLine(abc: string): string {
	return abc.split('\n').pop()!;
}

describe('phraseToAbc key signature accidentals', () => {
	describe('key of C (no accidentals)', () => {
		it('natural notes have no accidental', () => {
			expect(noteLine(phraseToAbc(singleNotePhrase(60, 'C')))).toContain('C');    // C4
			expect(noteLine(phraseToAbc(singleNotePhrase(65, 'C')))).toContain('F');    // F4
			expect(noteLine(phraseToAbc(singleNotePhrase(67, 'C')))).toContain('G');    // G4
		});

		it('chromatic notes show accidentals', () => {
			expect(noteLine(phraseToAbc(singleNotePhrase(61, 'C')))).toContain('^C');   // C#4
			expect(noteLine(phraseToAbc(singleNotePhrase(66, 'C')))).toContain('^F');   // F#4
		});
	});

	describe('key of G (F#)', () => {
		it('F# has no explicit accidental (covered by key sig)', () => {
			const line = noteLine(phraseToAbc(singleNotePhrase(66, 'G')));
			expect(line).not.toContain('^F');
			expect(line).not.toContain('=F');
			expect(line).toMatch(/F/);
		});

		it('F natural shows natural sign', () => {
			expect(noteLine(phraseToAbc(singleNotePhrase(65, 'G')))).toContain('=F');
		});

		it('other natural notes are unaffected', () => {
			const line = noteLine(phraseToAbc(singleNotePhrase(60, 'G')));
			expect(line).not.toContain('=C');
			expect(line).toContain('C');
		});
	});

	describe('key of D (F#, C#)', () => {
		it('F# needs no accidental', () => {
			const line = noteLine(phraseToAbc(singleNotePhrase(66, 'D')));
			expect(line).not.toContain('^F');
			expect(line).not.toContain('=F');
		});

		it('C# needs no accidental', () => {
			const line = noteLine(phraseToAbc(singleNotePhrase(61, 'D')));
			expect(line).not.toContain('^C');
			expect(line).not.toContain('=C');
		});

		it('F natural shows natural sign', () => {
			expect(noteLine(phraseToAbc(singleNotePhrase(65, 'D')))).toContain('=F');
		});

		it('C natural shows natural sign', () => {
			expect(noteLine(phraseToAbc(singleNotePhrase(60, 'D')))).toContain('=C');
		});
	});

	describe('key of A (F#, C#, G#)', () => {
		it('G# needs no accidental', () => {
			const line = noteLine(phraseToAbc(singleNotePhrase(68, 'A')));
			expect(line).not.toContain('^G');
		});

		it('G natural shows natural sign', () => {
			expect(noteLine(phraseToAbc(singleNotePhrase(67, 'A')))).toContain('=G');
		});
	});

	describe('key of F (Bb)', () => {
		it('Bb has no explicit accidental', () => {
			const line = noteLine(phraseToAbc(singleNotePhrase(70, 'F')));
			expect(line).not.toContain('_B');
			expect(line).not.toContain('=B');
		});

		it('B natural shows natural sign', () => {
			expect(noteLine(phraseToAbc(singleNotePhrase(71, 'F')))).toContain('=B');
		});
	});

	describe('key of Bb (Bb, Eb)', () => {
		it('Eb has no explicit accidental', () => {
			const line = noteLine(phraseToAbc(singleNotePhrase(63, 'Bb')));
			expect(line).not.toContain('_E');
			expect(line).not.toContain('=E');
		});

		it('E natural shows natural sign', () => {
			expect(noteLine(phraseToAbc(singleNotePhrase(64, 'Bb')))).toContain('=E');
		});

		it('B natural shows natural sign', () => {
			expect(noteLine(phraseToAbc(singleNotePhrase(71, 'Bb')))).toContain('=B');
		});
	});

	describe('key of Eb (Bb, Eb, Ab)', () => {
		it('Ab has no explicit accidental', () => {
			const line = noteLine(phraseToAbc(singleNotePhrase(68, 'Eb')));
			expect(line).not.toContain('_A');
			expect(line).not.toContain('=A');
		});

		it('A natural shows natural sign', () => {
			expect(noteLine(phraseToAbc(singleNotePhrase(69, 'Eb')))).toContain('=A');
		});
	});

	describe('arrow key semitone adjustment scenario', () => {
		it('F# stepped down to F natural in key of G gets natural sign', () => {
			// Simulate: enter F#4 (66), press down arrow → F4 (65)
			const phrase = singleNotePhrase(66, 'G');
			// Before adjustment: F# renders without accidental
			expect(noteLine(phraseToAbc(phrase))).not.toContain('^F');
			expect(noteLine(phraseToAbc(phrase))).not.toContain('=F');

			// After adjustment: F natural needs natural sign
			phrase.notes[0].pitch = 65;
			expect(noteLine(phraseToAbc(phrase))).toContain('=F');
		});

		it('Bb stepped up to B natural in key of F gets natural sign', () => {
			const phrase = singleNotePhrase(70, 'F');
			expect(noteLine(phraseToAbc(phrase))).not.toContain('_B');

			phrase.notes[0].pitch = 71;
			expect(noteLine(phraseToAbc(phrase))).toContain('=B');
		});

		it('C# stepped down to C natural in key of D gets natural sign', () => {
			const phrase = singleNotePhrase(61, 'D');
			expect(noteLine(phraseToAbc(phrase))).not.toContain('^C');

			phrase.notes[0].pitch = 60;
			expect(noteLine(phraseToAbc(phrase))).toContain('=C');
		});

		it('G# stepped down to G natural in key of A gets natural sign', () => {
			const phrase = singleNotePhrase(68, 'A');
			expect(noteLine(phraseToAbc(phrase))).not.toContain('^G');

			phrase.notes[0].pitch = 67;
			expect(noteLine(phraseToAbc(phrase))).toContain('=G');
		});

		it('Eb stepped up to E natural in key of Bb gets natural sign', () => {
			const phrase = singleNotePhrase(63, 'Bb');
			expect(noteLine(phraseToAbc(phrase))).not.toContain('_E');

			phrase.notes[0].pitch = 64;
			expect(noteLine(phraseToAbc(phrase))).toContain('=E');
		});

		it('Ab stepped up to A natural in key of Eb gets natural sign', () => {
			const phrase = singleNotePhrase(68, 'Eb');

			phrase.notes[0].pitch = 69;
			expect(noteLine(phraseToAbc(phrase))).toContain('=A');
		});
	});
});

/** Build a phrase with multiple notes for bar-persistence testing. */
function multiNotePhrase(midis: number[], key: PitchClass, timeSignature: [number, number] = [4, 4]): Phrase {
	const barDurationBeats = timeSignature[0];
	return {
		id: 'test',
		name: 'test',
		timeSignature,
		key,
		notes: midis.map((midi, i) => ({
			pitch: midi,
			// Quarter notes so each bar holds 4 notes in 4/4
			duration: [1, 4] as [number, number],
			offset: [i, 4] as [number, number]
		})),
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: Math.ceil(midis.length / barDurationBeats) },
		category: 'user',
		tags: [],
		source: 'test'
	};
}

describe('phraseToAbc bar-persistent accidentals', () => {
	it('in D major, F natural followed by F# in the same bar re-emits the sharp', () => {
		// F4 natural (65), then F#4 (66), both in bar 1
		const phrase = multiNotePhrase([65, 66, 67, 69], 'D');
		const line = noteLine(phraseToAbc(phrase));
		// Should emit =F for natural, then ^F (not bare F) for the sharp
		expect(line).toMatch(/=F.*\^F/);
	});

	it('in D major, F natural then F natural again omits the natural sign the second time', () => {
		const phrase = multiNotePhrase([65, 65, 67, 69], 'D');
		const line = noteLine(phraseToAbc(phrase));
		// First F natural has =F, second does not (persistent natural)
		const firstF = line.indexOf('=F');
		expect(firstF).toBeGreaterThanOrEqual(0);
		const afterFirst = line.slice(firstF + 2);
		expect(afterFirst).not.toContain('=F');
	});

	it('accidental resets at the bar line', () => {
		// Bar 1: F natural, F natural. Bar 2: F# (back to key sig).
		// F# in bar 2 should NOT need an explicit accidental since the bar-level
		// natural from bar 1 no longer applies.
		const phrase = multiNotePhrase([65, 65, 65, 65, 66, 66, 66, 66], 'D');
		const line = noteLine(phraseToAbc(phrase));
		// After the barline, the F should be bare (key sig sharp applies)
		const parts = line.split('|');
		expect(parts.length).toBeGreaterThan(1);
		const bar2 = parts[1];
		// bar 2 should have plain 'F' tokens, not '^F' or '=F'
		expect(bar2).toMatch(/ F[^#=^_]/);
		expect(bar2).not.toContain('^F');
	});

	it('in Bb major, B natural followed by Bb in same bar re-emits the flat', () => {
		// Bb4 is the key, B4 natural (71), Bb4 (70)
		const phrase = multiNotePhrase([70, 71, 70, 72], 'Bb');
		const line = noteLine(phraseToAbc(phrase));
		// First note: bare B (matches flat key sig)
		// Second: =B (natural override)
		// Third: _B (re-apply flat)
		expect(line).toMatch(/=B.*_B/);
	});

	it('F# followed by F natural in key of C shows explicit natural', () => {
		const phrase = multiNotePhrase([66, 65, 67, 69], 'C');
		const line = noteLine(phraseToAbc(phrase));
		// ^F then =F (to cancel the persistent sharp within the bar)
		expect(line).toMatch(/\^F.*=F/);
	});

	it('chromatic sequence F F# F in same bar: =F, ^F (bare F if C), =F', () => {
		// Starting in C (no key sig): F (bare), F# (^F), F natural (=F)
		const phrase = multiNotePhrase([65, 66, 65, 67], 'C');
		const line = noteLine(phraseToAbc(phrase));
		// Parse: first F bare, then ^F, then =F
		expect(line).toContain('^F');
		expect(line).toContain('=F');
	});
});

describe('phraseToAbc flat/sharp preference by key', () => {
	it('in Bb major, chromatic Ab spells as _A (flat, not ^G)', () => {
		// Ab4 = MIDI 68 — chromatic flat 7 of Bb (A is natural in Bb key sig)
		const line = noteLine(phraseToAbc(singleNotePhrase(68, 'Bb')));
		expect(line).toContain('_A');
		expect(line).not.toContain('^G');
	});

	it('in D major, chromatic D# spells as ^D (sharp)', () => {
		// D#4 = MIDI 63
		const line = noteLine(phraseToAbc(singleNotePhrase(63, 'D')));
		expect(line).toContain('^D');
		expect(line).not.toContain('_E');
	});

	it('in Eb major, chromatic Ab spells as A (covered by key sig)', () => {
		// Ab4 = MIDI 68, Eb key sig already has Ab
		const line = noteLine(phraseToAbc(singleNotePhrase(68, 'Eb')));
		expect(line).not.toContain('_A');
		expect(line).not.toContain('^G');
	});

	it('in A major, chromatic G# is covered by key sig (no accidental)', () => {
		const line = noteLine(phraseToAbc(singleNotePhrase(68, 'A')));
		expect(line).not.toContain('^G');
		expect(line).not.toContain('_A');
	});
});

/** Build a phrase of `count` eighth notes starting at offset 0. */
function eighthsPhrase(
	count: number,
	timeSignature: [number, number] = [4, 4],
	midi = 60,
	key: PitchClass = 'C'
): Phrase {
	return {
		id: 'test',
		name: 'test',
		timeSignature,
		key,
		notes: Array.from({ length: count }, (_, i) => ({
			pitch: midi,
			duration: [1, 8] as [number, number],
			offset: [i, 8] as [number, number]
		})),
		harmony: [],
		difficulty: {
			level: 1,
			pitchComplexity: 1,
			rhythmComplexity: 1,
			lengthBars: Math.max(1, Math.ceil(count / (timeSignature[0] * 2)))
		},
		category: 'user',
		tags: [],
		source: 'test'
	};
}

/** Extract the token groups within the last bar (before the final `|]`). */
function beamGroups(abc: string): string[] {
	// Drop any trailing closing barline (' |]'), split on whitespace runs.
	return noteLine(abc)
		.replace(/\s*\|]\s*$/, '')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

describe('phraseToAbc beam grouping', () => {
	it('beams 8 eighths in 4/4 as two groups of 4', () => {
		const groups = beamGroups(phraseToAbc(eighthsPhrase(8, [4, 4])));
		expect(groups).toEqual(['CCCC', 'CCCC']);
	});

	it('never beams across the half-bar midpoint in 4/4', () => {
		const line = noteLine(phraseToAbc(eighthsPhrase(8, [4, 4])));
		// Five consecutive Cs would imply a beam spanning the middle of the bar.
		expect(line).not.toMatch(/CCCCC/);
		// Must contain a beam break between the fourth and fifth eighth.
		expect(line).toMatch(/CCCC\s+CCCC/);
	});

	it('beams 4 eighths in 2/4 (full bar) as a single group', () => {
		const groups = beamGroups(phraseToAbc(eighthsPhrase(4, [2, 4])));
		expect(groups).toEqual(['CCCC']);
	});

	it('beams 8 eighths in 2/4 across two bars as 4+4', () => {
		const line = noteLine(phraseToAbc(eighthsPhrase(8, [2, 4])));
		// Split on the internal bar line (ignoring the closing '|]').
		const bars = line
			.replace(/\s*\|]\s*$/, '')
			.split('|')
			.map((s) => s.trim())
			.filter(Boolean);
		expect(bars).toEqual(['CCCC', 'CCCC']);
	});

	it('keeps per-beat grouping in 3/4 (6 eighths as 3 pairs)', () => {
		const groups = beamGroups(phraseToAbc(eighthsPhrase(6, [3, 4])));
		expect(groups).toEqual(['CC', 'CC', 'CC']);
	});

	it('breaks at the half-bar boundary when the run starts on beat 2', () => {
		// 4 eighths starting at offset 2/8 — span beats 2 → 3.
		const phrase: Phrase = {
			...eighthsPhrase(4, [4, 4]),
			notes: [2, 3, 4, 5].map((i) => ({
				pitch: 60,
				duration: [1, 8] as [number, number],
				offset: [i, 8] as [number, number]
			}))
		};
		const groups = beamGroups(phraseToAbc(phrase));
		// Two beat-2 eighths + two beat-3 eighths, broken at the bar midpoint.
		expect(groups).toEqual(['CC', 'CC']);
	});

	it('falls back to per-beat grouping in a half-bar that contains 16ths', () => {
		// Bar 1 layout in 4/4:
		//   beat 1: four 16th notes
		//   beat 2: two eighths
		//   beats 3-4: four eighths (pure-eighth half-bar — still beams as 4)
		const notes: Phrase['notes'] = [];
		for (let i = 0; i < 4; i++) {
			notes.push({ pitch: 60, duration: [1, 16], offset: [i, 16] });
		}
		notes.push({ pitch: 60, duration: [1, 8], offset: [2, 8] });
		notes.push({ pitch: 60, duration: [1, 8], offset: [3, 8] });
		for (let i = 4; i < 8; i++) {
			notes.push({ pitch: 60, duration: [1, 8], offset: [i, 8] });
		}

		const phrase: Phrase = { ...eighthsPhrase(0, [4, 4]), notes };
		const groups = beamGroups(phraseToAbc(phrase));

		// Expect three beam groups:
		//   [0] beat-1 sixteenths (4 note tokens, no internal space)
		//   [1] beat-2 eighths ('CC')
		//   [2] beats 3-4 eighths ('CCCC')
		expect(groups).toHaveLength(3);
		// First group is the four 16ths — four 'C' heads with 16th duration suffixes.
		expect(groups[0].replace(/[^C]/g, '')).toBe('CCCC');
		expect(groups[1]).toBe('CC');
		expect(groups[2]).toBe('CCCC');
	});

	it('quarter note between eighths yields two separate beam groups', () => {
		// Beat 1: two eighths. Beat 2: quarter. Beats 3-4: four eighths.
		const notes: Phrase['notes'] = [
			{ pitch: 60, duration: [1, 8], offset: [0, 8] },
			{ pitch: 60, duration: [1, 8], offset: [1, 8] },
			{ pitch: 60, duration: [1, 4], offset: [1, 4] },
			{ pitch: 60, duration: [1, 8], offset: [4, 8] },
			{ pitch: 60, duration: [1, 8], offset: [5, 8] },
			{ pitch: 60, duration: [1, 8], offset: [6, 8] },
			{ pitch: 60, duration: [1, 8], offset: [7, 8] }
		];
		const phrase: Phrase = { ...eighthsPhrase(0, [4, 4]), notes };
		const line = noteLine(phraseToAbc(phrase));
		// The four eighths on beats 3-4 must still beam as one group.
		expect(line).toMatch(/CCCC\s*\|]/);
		// And the first half-bar (two eighths + quarter) must not run into
		// beats 3-4 without a break.
		expect(line).not.toMatch(/C2CCCC/);
	});

	it('eighth-note triplet still renders as a (3 group and does not break half-bar beaming', () => {
		// Bar layout in 4/4:
		//   beat 1: three eighth-note triplets (duration [1,12])
		//   beats 2-4: six eighths
		// The triplet group is self-contained; the following eighths should
		// still beam as 4 across the half-bar up to beat 4 (or as 2 groups of
		// varying size depending on the half-bar boundary).
		const notes: Phrase['notes'] = [
			{ pitch: 60, duration: [1, 12], offset: [0, 12] },
			{ pitch: 60, duration: [1, 12], offset: [1, 12] },
			{ pitch: 60, duration: [1, 12], offset: [2, 12] },
			{ pitch: 60, duration: [1, 8], offset: [2, 8] },
			{ pitch: 60, duration: [1, 8], offset: [3, 8] },
			{ pitch: 60, duration: [1, 8], offset: [4, 8] },
			{ pitch: 60, duration: [1, 8], offset: [5, 8] },
			{ pitch: 60, duration: [1, 8], offset: [6, 8] },
			{ pitch: 60, duration: [1, 8], offset: [7, 8] }
		];
		const phrase: Phrase = { ...eighthsPhrase(0, [4, 4]), notes };
		const line = noteLine(phraseToAbc(phrase));
		// Triplet is emitted with '(3' marker.
		expect(line).toContain('(3');
		// The four eighths on beats 3-4 still beam as a single group of 4.
		expect(line).toMatch(/CCCC\s*\|]/);
	});

	it('renders a dotted-eighth/sixteenth pair against an L:1/8 unit', () => {
		// The step-entry vocabulary can produce [3,16] and [1,16] directly, so
		// pin the ABC they emit: against the 1/8 default length a dotted eighth
		// is 3/2 units and a sixteenth is 1/2.
		const notes: Phrase['notes'] = [
			{ pitch: 60, duration: [3, 16], offset: [0, 16] },
			{ pitch: 60, duration: [1, 16], offset: [3, 16] },
			{ pitch: 60, duration: [1, 8], offset: [2, 8] },
			{ pitch: 60, duration: [1, 8], offset: [3, 8] },
			{ pitch: 60, duration: [1, 2], offset: [1, 2] }
		];
		const phrase: Phrase = { ...eighthsPhrase(0, [4, 4]), notes };
		const line = noteLine(phraseToAbc(phrase));
		expect(line).toContain('C3/2');
		expect(line).toContain('C/2');
		// Beat 1 holds a 16th, so that half-bar beams per beat rather than as 4.
		expect(beamGroups(phraseToAbc(phrase))).toEqual(['C3/2C/2', 'CC', 'C4']);
	});
});

describe('midiToDisplayName key-aware spelling', () => {
	it('defaults to flat spelling when no second arg', () => {
		expect(midiToDisplayName(61)).toBe('Db4');
		expect(midiToDisplayName(66)).toBe('Gb4');
	});

	it('honors explicit boolean useFlats', () => {
		expect(midiToDisplayName(61, true)).toBe('Db4');
		expect(midiToDisplayName(61, false)).toBe('C#4');
	});

	it('uses sharps for sharp keys', () => {
		// A major has F#, C#, G# — C# (midi 61) must spell as C#, not Db.
		expect(midiToDisplayName(61, 'A')).toBe('C#4');
		expect(midiToDisplayName(66, 'D')).toBe('F#4');
		expect(midiToDisplayName(68, 'E')).toBe('G#4');
		expect(midiToDisplayName(60, 'G')).toBe('C4');
	});

	it('uses flats for flat keys', () => {
		// Bb major has Bb, Eb — pc 3 must spell as Eb (matches existing default).
		expect(midiToDisplayName(63, 'Bb')).toBe('Eb4');
		expect(midiToDisplayName(58, 'F')).toBe('Bb3');
		expect(midiToDisplayName(56, 'Ab')).toBe('Ab3');
	});

	it('treats C major as sharp-keyed (no accidentals in signature)', () => {
		// C is not in FLAT_KEYS, so default behavior is sharps.
		expect(midiToDisplayName(61, 'C')).toBe('C#4');
	});

	// 2026-08-22: the session-recording note list showed A# for the b7 of a
	// written-C blues. With the tonality's scale supplied, the name follows
	// the scale's degrees (and the chord the scale implies), not the bare
	// sharp-side default of a key with no signature.
	describe('with a scale', () => {
		it('spells the blues b3, b5 and b7 as flats in written C', () => {
			expect(midiToDisplayName(63, 'C', 'blues.minor')).toBe('Eb4');
			expect(midiToDisplayName(66, 'C', 'blues.minor')).toBe('Gb4');
			expect(midiToDisplayName(70, 'C', 'blues.minor')).toBe('Bb4');
		});

		it('spells the blues degrees as flats in a sharp key too', () => {
			// G blues on tenor reading a concert-F blues: Bb, Db, F.
			expect(midiToDisplayName(70, 'G', 'blues.minor')).toBe('Bb4');
			expect(midiToDisplayName(61, 'G', 'blues.minor')).toBe('Db4');
		});

		it('follows sharp-side degrees even in a flat key', () => {
			expect(midiToDisplayName(66, 'C', 'major.lydian')).toBe('F#4');
			// The #5 of F whole-tone is C#; F's key-side default alone would say Db.
			expect(midiToDisplayName(61, 'F', 'symmetric.whole-tone')).toBe('C#4');
		});

		it('keeps an unambiguous chord tone over a theoretical degree label', () => {
			// Altered labels the major third "b4"; the third of E7alt is G#.
			expect(midiToDisplayName(68, 'E', 'melodic-minor.altered')).toBe('G#4');
			// …but its #9 follows the scale's b3: Bb over G7alt, not A#.
			expect(midiToDisplayName(70, 'G', 'melodic-minor.altered')).toBe('Bb4');
		});

		it('spells a chromatic note outside the scale against the tonic chord', () => {
			// Db is not in C major; as the b9 of the tonic it is spelled flat.
			expect(midiToDisplayName(61, 'C', 'major.ionian')).toBe('Db4');
			// F# is not in C major either; as the #11 it is spelled sharp.
			expect(midiToDisplayName(66, 'C', 'major.ionian')).toBe('F#4');
		});

		it('falls back to the key default when the scale id is unknown', () => {
			expect(midiToDisplayName(61, 'C', 'no-such-scale')).toBe('C#4');
			expect(midiToDisplayName(61, 'F', 'no-such-scale')).toBe('Db4');
		});
	});
});

describe('phraseToAbc tie suffix', () => {
	function tiedPair(): Phrase {
		return {
			id: 'test',
			name: 'test',
			timeSignature: [4, 4],
			key: 'C',
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1], tied: true },
				{ pitch: 60, duration: [1, 8], offset: [1, 4] }
			],
			harmony: [],
			difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
			category: 'user',
			tags: [],
			source: 'test'
		};
	}

	it('emits `-` immediately after a tied note', () => {
		const line = noteLine(phraseToAbc(tiedPair()));
		// L:1/8 default → quarter at C4 = "C2", then tie suffix, then beam/space, then "C"
		expect(line).toMatch(/C2-/);
	});

	it('does not emit `-` when tied is absent', () => {
		const phrase = tiedPair();
		phrase.notes[0].tied = false;
		const line = noteLine(phraseToAbc(phrase));
		expect(line).not.toMatch(/C2-/);
	});
});

describe('phraseToAbc chord-aware enharmonic spelling', () => {
	function phraseWithChord(midi: number, key: PitchClass, root: PitchClass, quality: '7' | 'min7' | 'maj7'): Phrase {
		const p = singleNotePhrase(midi, key);
		p.harmony = [
			{ chord: { root, quality }, scaleId: 'major.mixolydian', startOffset: [0, 1], duration: [1, 1] }
		];
		return p;
	}

	it('spells the third of A7 as C# even in a flat key', () => {
		// Key F (flat key) used to force _D; over A7 the note is the third.
		expect(noteLine(phraseToAbc(phraseWithChord(61, 'F', 'A', '7')))).toContain('^C');
	});

	it('spells the minor third of C-7 as Eb even in a sharp key', () => {
		expect(noteLine(phraseToAbc(phraseWithChord(63, 'D', 'C', 'min7')))).toContain('_E');
	});

	it('keeps the key-signature default when the phrase has no harmony', () => {
		expect(noteLine(phraseToAbc(singleNotePhrase(61, 'F')))).toContain('_D');
	});

	it('keeps the key-signature spelling ahead of the chord preference', () => {
		// Written C#5 in D major is IN the signature; over B♭-7 (whose minor
		// third prefers the flat spelling) it must stay C# — printed with no
		// accidental — not respell as Db, which would force an explicit flat.
		const line = noteLine(phraseToAbc(phraseWithChord(73, 'D', 'Bb', 'min7')));
		expect(line).not.toContain('_D');
		expect(line).toContain('c');
	});
});

describe('phraseToAbc scale-aware enharmonic spelling', () => {
	function phraseOver(
		midi: number,
		key: PitchClass,
		root: PitchClass,
		quality: '7' | 'min7' | 'maj7' | '7alt',
		scaleId: string
	): Phrase {
		const p = singleNotePhrase(midi, key);
		p.harmony = [{ chord: { root, quality }, scaleId, startOffset: [0, 1], duration: [1, 1] }];
		return p;
	}

	// 2026-08-22 user report: in a written-C blues the chart (and the session
	// recording's note list) spelled the blue notes as the #9 / #11 of C7 —
	// ^D, ^F — and the b7 as A#. A line declared over the blues scale is
	// spelled with that scale's degrees: Eb, Gb, Bb.
	it('spells the blue third over C7 as Eb when the segment declares the blues scale', () => {
		const line = noteLine(phraseToAbc(phraseOver(63, 'C', 'C', '7', 'blues.minor')));
		expect(line).toContain('_E');
		expect(line).not.toContain('^D');
	});

	it('spells the blue fifth over C7 as Gb under the blues scale', () => {
		const line = noteLine(phraseToAbc(phraseOver(66, 'C', 'C', '7', 'blues.minor')));
		expect(line).toContain('_G');
		expect(line).not.toContain('^F');
	});

	it('keeps the b7 over C7 flat under the blues scale', () => {
		expect(noteLine(phraseToAbc(phraseOver(70, 'C', 'C', '7', 'blues.minor')))).toContain('_B');
	});

	it('still spells the same pitch as the #9 / #11 when the declared scale has no say', () => {
		// Mixolydian has neither a b3 nor a b5, so the chord tier decides as before.
		expect(noteLine(phraseToAbc(phraseOver(63, 'C', 'C', '7', 'major.mixolydian')))).toContain('^D');
		expect(noteLine(phraseToAbc(phraseOver(66, 'C', 'C', '7', 'major.mixolydian')))).toContain('^F');
	});

	it('follows a sharp-side scale degree: the #4 of C lydian is F#', () => {
		const line = noteLine(phraseToAbc(phraseOver(66, 'C', 'C', 'maj7', 'major.lydian')));
		expect(line).toContain('^F');
		expect(line).not.toContain('_G');
	});

	it('lets the altered scale spell the #9 of G7alt as Bb (its b3)', () => {
		const line = noteLine(phraseToAbc(phraseOver(70, 'C', 'G', '7alt', 'melodic-minor.altered')));
		expect(line).toContain('_B');
		expect(line).not.toContain('^A');
	});

	it('never lets a theoretical degree label respell an unambiguous chord tone', () => {
		// The altered scale labels the major third "b4" (Ab over E7alt); the
		// third of E7 is G#. The scale only settles the chord tier's three
		// ambiguous degrees (b3/#9, b5/#11, #5/b13).
		const line = noteLine(phraseToAbc(phraseOver(68, 'C', 'E', '7alt', 'melodic-minor.altered')));
		expect(line).toContain('^G');
		expect(line).not.toContain('_A');
	});

	it('keeps the key-signature spelling ahead of the scale preference', () => {
		// Written D#5 in E major is IN the signature; a blues-scale segment on
		// C (b3 = Eb) must not force an explicit flat.
		const line = noteLine(phraseToAbc(phraseOver(75, 'E', 'C', '7', 'blues.minor')));
		expect(line).not.toContain('_e');
		expect(line).toContain('d');
	});
});

describe('scaleSpellingPreference', () => {
	const BLUES = ['1', 'b3', '4', 'b5', '5', 'b7'];
	const ALTERED = ['1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'];
	const WHOLE_TONE = ['1', '2', '3', '#4', '#5', 'b7'];

	it('settles the b3 and b5 of a blues scale as flats', () => {
		expect(scaleSpellingPreference(63, 'C', BLUES)).toBe('flat');
		expect(scaleSpellingPreference(66, 'C', BLUES)).toBe('flat');
	});

	it('abstains on degrees the chord tier spells unambiguously (b7, b2)', () => {
		expect(scaleSpellingPreference(70, 'C', BLUES)).toBeNull();
		expect(scaleSpellingPreference(61, 'C', ALTERED)).toBeNull();
	});

	it('abstains on pitches outside the scale and on white keys', () => {
		expect(scaleSpellingPreference(61, 'C', BLUES)).toBeNull(); // Db not in C blues
		expect(scaleSpellingPreference(65, 'D', BLUES)).toBeNull(); // b3 of D is F natural
	});

	it('abstains on the altered scale b4 (a double-accidental or chord-tone respelling)', () => {
		expect(scaleSpellingPreference(68, 'E', ALTERED)).toBeNull(); // 3rd of E, labelled b4
	});

	it('follows sharp-side labels (#4, #5)', () => {
		expect(scaleSpellingPreference(66, 'C', WHOLE_TONE)).toBe('sharp');
		expect(scaleSpellingPreference(68, 'C', WHOLE_TONE)).toBe('sharp');
	});

	it('reads the root letter from a display spelling', () => {
		// Gb blues: b3 = Bbb (white A) → abstain; b5 = Dbb (white C) → abstain.
		expect(scaleSpellingPreference(69, 'Gb', BLUES)).toBeNull();
		// F# blues: b3 = A natural → abstain; b5 = C natural → abstain.
		expect(scaleSpellingPreference(69, 'F#', BLUES)).toBeNull();
		// Eb blues: b3 = Gb, b5 = Bbb (white A) → flat / abstain.
		expect(scaleSpellingPreference(66, 'Eb', BLUES)).toBe('flat');
		expect(scaleSpellingPreference(69, 'Eb', BLUES)).toBeNull();
	});
});

describe('spellingContextAt — the chart\'s spelling frame for one note', () => {
	const C_BLUES: HarmonicSegment[] = [
		{ chord: { root: 'C', quality: '7' }, scaleId: 'blues.minor', startOffset: [0, 1], duration: [1, 1] }
	];
	const II_V_I_C: HarmonicSegment[] = [
		{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 2] },
		{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 2], duration: [1, 2] },
		{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [1, 1], duration: [1, 1] }
	];
	const name = (midi: number, ctx: ReturnType<typeof spellingContextAt>): string =>
		midiToDisplayName(midi, resolveUseFlats(midi, ctx));

	it('spells the session\'s blues notes through its harmony the way the chart did', () => {
		const ctx = spellingContextAt({ displayKey: 'C', harmony: C_BLUES, offset: 0 });
		expect(name(63, ctx)).toBe('Eb4');
		expect(name(66, ctx)).toBe('Gb4');
		expect(name(70, ctx)).toBe('Bb4');
	});

	it('picks the chord governing the note\'s offset', () => {
		// Eb is the b13 of G7 (flat) but the #9 of Cmaj7 (sharp).
		expect(name(63, spellingContextAt({ displayKey: 'C', harmony: II_V_I_C, offset: 0.5 }))).toBe('Eb4');
		expect(name(63, spellingContextAt({ displayKey: 'C', harmony: II_V_I_C, offset: 1 }))).toBe('D#4');
	});

	it('transposes the harmony to written pitch before judging the chord', () => {
		// Concert Bb7 blues read by a Bb instrument: written C7 blues, so the
		// written Bb (midi 70) is the b7 — flat, not A#.
		const concertBbBlues: HarmonicSegment[] = [
			{ chord: { root: 'Bb', quality: '7' }, scaleId: 'blues.minor', startOffset: [0, 1], duration: [1, 1] }
		];
		const ctx = spellingContextAt({
			displayKey: 'C',
			harmony: concertBbBlues,
			offset: 0,
			transpositionSemitones: 2
		});
		expect(name(70, ctx)).toBe('Bb4');
		expect(name(63, ctx)).toBe('Eb4');
	});

	it('falls back to the scale rooted at the key when no chord governs', () => {
		expect(name(70, spellingContextAt({ displayKey: 'C', harmony: [], offset: 0, scaleId: 'blues.minor' }))).toBe('Bb4');
		expect(name(70, spellingContextAt({ displayKey: 'C', harmony: null, scaleId: 'blues.minor' }))).toBe('Bb4');
	});

	it('falls back to the key-side default with neither harmony nor scale', () => {
		expect(name(70, spellingContextAt({ displayKey: 'C' }))).toBe('A#4');
		expect(name(70, spellingContextAt({ displayKey: 'F' }))).toBe('Bb4');
	});

	it('honours the note\'s explicit spelling above everything', () => {
		expect(name(70, spellingContextAt({ displayKey: 'C', harmony: C_BLUES, offset: 0, explicit: 'sharp' }))).toBe('A#4');
	});
});

describe('generated trick anacrusis rendering', () => {
	// The full enclosure drill figure begins mid-way through a leading bar.
	// With no leading rest before the first note, the renderer emits a TRUE
	// partial pickup bar (barlines are only inserted between notes) — the
	// same emergent behavior major-chord-pickup-001 relies on, previously
	// untested. Regression pin for the 4-bars-plus-pickup figure design.
	function trickContext(): import('$lib/types/tricks').TrickContext {
		return {
			chordRoot: 'C',
			chordQuality: 'maj7',
			scaleId: 'major.ionian',
			key: 'C',
			timeSignature: [4, 4],
			level: 50,
			tempo: 120
		};
	}

	function bodyBars(abc: string): string[] {
		return noteLine(abc)
			.replace(/\s*\|\]\s*$/, '')
			.split('|')
			.map((bar) => bar.trim())
			.filter((bar) => bar.length > 0);
	}

	it('renders the full enclosure figure as a partial pickup bar plus 4 content bars', async () => {
		const { enclosuresTrick } = await import('$lib/tricks/devices/enclosures');
		const phrase = enclosuresTrick.generateExample(
			{ noteCount: '2', shape: 'above-below', targetTone: 'third', beatPlacement: 'downbeat', type: 'major' },
			trickContext()
		);
		expect(phrase).not.toBeNull();

		const bars = bodyBars(phraseToAbc(phrase!));
		expect(bars).toHaveLength(5);
		// Bar 0 holds ONLY the two approach notes — no rest padding, no target.
		expect(bars[0]).toBe('F^D');
		// Every content bar opens on the ringing target chord tone...
		for (const bar of bars.slice(1, 4)) {
			expect(bar.startsWith('E')).toBe(true);
		}
		// ...and the figure closes on the held final target alone.
		expect(bars[4]).toBe('E4');
	});

	it('ring-residue rests render inside content bars, never in the pickup bar', async () => {
		const { enclosuresTrick } = await import('$lib/tricks/devices/enclosures');
		// k=1: the dotted-half ring leaves an eighth before each next approach,
		// bridged by an explicit generator rest.
		const phrase = enclosuresTrick.generateExample(
			{ noteCount: '1', shape: 'scale-above', targetTone: 'third', beatPlacement: 'downbeat', type: 'major' },
			trickContext()
		);
		expect(phrase).not.toBeNull();

		const bars = bodyBars(phraseToAbc(phrase!));
		expect(bars).toHaveLength(5);
		expect(bars[0]).not.toContain('z');
		for (const bar of bars.slice(1, 4)) {
			expect(bar).toContain('z');
		}
	});
});

describe('durationToAbc general-case reduction', () => {
	it('renders a dotted half at L:1/8 as 6, not 24/4', () => {
		expect(durationToAbc([3, 4], [1, 8])).toBe('6');
	});

	it('reduces arbitrary ratios to lowest terms', () => {
		expect(durationToAbc([7, 8], [1, 8])).toBe('7');
		expect(durationToAbc([5, 8], [1, 8])).toBe('5');
		expect(durationToAbc([3, 16], [1, 8])).toBe('3/2');
	});
});
