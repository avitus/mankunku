import { describe, it, expect } from 'vitest';
import { transposeLick, transposeLickForTonality, snapLickToScale } from '$lib/phrases/library-loader';
import type { Phrase } from '$lib/types/music';
import { ALL_CURATED_LICKS } from '$lib/data/licks';

/** Dm7 → G7 → Cmaj7: the harmony a real progression lick declares. */
const II_V_I: Phrase['harmony'] = [
	{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 1] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 1], duration: [1, 1] },
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [2, 1], duration: [1, 1] }
];

/** A progression-category phrase whose harmony actually moves through the progression. */
function makeProgression(pitches: (number | null)[], category: string): Phrase {
	return { ...makePhrase(pitches, category), harmony: II_V_I };
}

/** A single-chord phrase declared over C`quality` in `scaleId`. */
function makeModal(pitches: (number | null)[], scaleId: string, quality: 'maj7' | 'min7' | '7'): Phrase {
	return {
		...makePhrase(pitches),
		harmony: [{ chord: { root: 'C', quality }, scaleId, startOffset: [0, 1], duration: [1, 1] }]
	};
}

/** Helper: build a minimal phrase with given MIDI pitches */
function makePhrase(pitches: (number | null)[], category: string = 'pentatonic'): Phrase {
	return {
		id: 'test-001',
		name: 'Test Lick',
		timeSignature: [4, 4],
		key: 'C',
		notes: pitches.map((p, i) => ({
			pitch: p,
			duration: [1, 4] as [number, number],
			offset: [i, 4] as [number, number]
		})),
		harmony: [
			{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [0, 1],
				duration: [1, 1]
			}
		],
		difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
		category,
		tags: [],
		source: 'curated'
	} as Phrase;
}

describe('transposeLick — central range optimization', () => {
	it('transposes to D without octave shift when already in range', () => {
		// Notes around C4-C5 (60-72), transposing +2 keeps them in 62-74 — within 60-75
		const phrase = makePhrase([60, 64, 67, 72]);
		const result = transposeLick(phrase, 'D');
		expect(result.key).toBe('D');
		expect(result.notes.map((n) => n.pitch)).toEqual([62, 66, 69, 74]);
	});

	it('shifts down an octave when transposing to B would push notes too high', () => {
		// Notes at 67-79 (G4-G5). Naive +11 → 78-90, all above 75.
		// With -1 octave shift → 66-78, most within 60-75 (best available).
		const phrase = makePhrase([67, 70, 74, 79]);
		const result = transposeLick(phrase, 'B');
		const pitches = result.notes.map((n) => n.pitch) as number[];

		// Shifted -12 from naive: 67+11-12=66, etc. (3 of 4 within tenor range)
		expect(pitches).toEqual([66, 69, 73, 78]);
	});

	it('preserves rests (null pitches)', () => {
		const phrase = makePhrase([60, null, 67, null]);
		const result = transposeLick(phrase, 'G');
		expect(result.notes[1].pitch).toBeNull();
		expect(result.notes[3].pitch).toBeNull();
	});

	it('transposes harmony roots correctly', () => {
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLick(phrase, 'F');
		expect(result.harmony[0].chord.root).toBe('F');
	});

	it('returns original phrase for key of C', () => {
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLick(phrase, 'C');
		expect(result).toBe(phrase);
	});

	it('keeps high lick centered when transposing to F#', () => {
		// Notes at 72-84 (C5-C6). Naive +6 → 78-90, all above 75.
		// With -1 octave → 66-78, best fit (3 of 4 within 60-75).
		const phrase = makePhrase([72, 76, 79, 84]);
		const result = transposeLick(phrase, 'F#');
		const pitches = result.notes.map((n) => n.pitch) as number[];

		// Should shift down an octave: 72+6-12=66, 76+6-12=70, 79+6-12=73, 84+6-12=78
		expect(pitches).toEqual([66, 70, 73, 78]);
	});

	it('keeps low licks in range rather than pushing above tenor ceiling', () => {
		// Notes at 60-67 (C4-G4). Transposing to D (+2) → 62-69, all within 60-75.
		// With +1 octave → 74-81, only 74 within range. So shift 0 wins.
		const phrase = makePhrase([60, 62, 64, 67]);
		const result = transposeLick(phrase, 'D');
		const pitches = result.notes.map((n) => n.pitch) as number[];
		expect(pitches).toEqual([62, 64, 66, 69]);
	});
});

describe('transposeLickForTonality — single-chord modal licks use modal root', () => {
	it('G Dorian root-second: transposes to G and snaps to G Dorian', () => {
		// C4(60), D4(62) → transpose to G(+7) → G4(67), A4(69)
		// G Dorian PCs: {7,9,10,0,2,4,5} — both 67%12=7 and 69%12=9 are in scale
		const phrase = makePhrase([60, 62]);
		const result = transposeLickForTonality(phrase, 'G', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([67, 69]);
		expect(result.key).toBe('G');
	});

	it('A Dorian: transposes to A and snaps', () => {
		// C4(60), E4(64) → transpose to A(+9) → A4(69), C#5(73)
		// A Dorian PCs: {9,11,0,2,4,6,7} — 73%12=1(C#) not in scale, snaps down to 72(C)
		const phrase = makePhrase([60, 64]);
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([69, 72]);
		expect(result.key).toBe('A');
	});

	it('D Dorian: transposes to D and snaps', () => {
		// C4(60), E4(64), G4(67) → transpose to D(+2) → D4(62), F#4(66), A4(69)
		// D Dorian PCs: {2,4,5,7,9,11,0} — 66%12=6(F#) not in scale, snaps down to 65(F)
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'D', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([62, 65, 69]);
		expect(result.key).toBe('D');
	});

	it('A Ionian: transposes to A (snap is no-op for Ionian)', () => {
		// Ionian = major scale, so snap should leave all diatonic notes intact
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'A', 'major.ionian');
		expect(result.notes.map(n => n.pitch)).toEqual([69, 73, 76]);
		expect(result.key).toBe('A');
	});

	it('A Mixolydian: transposes to A and snaps', () => {
		// C4(60), E4(64), G4(67) → transpose to A(+9) → A4(69), C#5(73), E5(76)
		// A Mixolydian PCs: {9,11,1,2,4,5,7} — 73%12=1(Db) IS in A Mixolydian (natural 3rd = C#/Db)
		// Wait — A Mixolydian = A B C# D E F# G, PCs: {9,11,1,2,4,6,7}
		// 73%12=1(C#) is in scale, 76%12=4(E) is in scale → no snapping needed
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'A', 'major.mixolydian');
		expect(result.notes.map(n => n.pitch)).toEqual([69, 73, 76]);
		expect(result.key).toBe('A');
	});

	it('preserves rests', () => {
		const phrase = makePhrase([60, null, 64]);
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes[1].pitch).toBeNull();
	});

	it('non-major scale: falls back to snap (blues)', () => {
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'A', 'blues.minor');
		expect(result.key).toBe('A');
		// All notes should be in A blues minor: A(9), C(0), D(2), Eb(3), E(4), G(7)
		const scalePCs = new Set([9, 0, 2, 3, 4, 7]);
		for (const n of result.notes) {
			if (n.pitch !== null) {
				expect(scalePCs.has(n.pitch % 12)).toBe(true);
			}
		}
	});
});

describe('transposeLickForTonality — progression licks use parent key', () => {
	it('A Dorian ii-V-I: transposes to G major (parent key)', () => {
		// ii-V-I lick in A Dorian → parent key is G major
		// C4(60), E4(64) → transpose to G(+7) → G4(67), B4(71)
		const phrase = makeProgression([60, 64], 'ii-V-I-major');
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([67, 71]);
		expect(result.key).toBe('A');
	});

	it('D Dorian ii-V-I: transposes to C major (parent key)', () => {
		// D Dorian = mode 2 of C major. Parent = C → no transposition.
		const phrase = makeProgression([60, 64, 67], 'ii-V-I-major');
		const result = transposeLickForTonality(phrase, 'D', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([60, 64, 67]);
		expect(result.key).toBe('D');
	});

	it('A Dorian ii-V-I minor: a MINOR cadence lick is keyed by its tonic, so it transposes tonic → A', () => {
		// The parent-major hop assumes lick.key is the parent major; a minor
		// cadence lick's key is its tonic minor, so C minor → A minor (+9).
		const phrase: Phrase = { ...makeProgression([60, 64], 'ii-V-I-minor'), mode: 'minor' };
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([69, 73]);
		expect(result.key).toBe('A');
		expect(result.mode).toBe('minor');
	});

	it('a ii-V-I-minor-category lick that is NOT minor (legacy, relative-major keyed) keeps the parent-key rule', () => {
		// The progression resolves to Cmaj7 on the key root → lickMode major.
		const phrase = makeProgression([60, 64], 'ii-V-I-minor');
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([67, 71]);
	});

	it('rhythm-changes lick uses parent key', () => {
		const phrase = makeProgression([60, 64], 'rhythm-changes');
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([67, 71]);
		expect(result.key).toBe('A');
	});
});

describe('minor cadence licks under minor tonalities — tonic → tonality root, never snapped', () => {
	const full = ALL_CURATED_LICKS.find((l) => l.id === 'ii-V-I-min-001')!;
	const short = ALL_CURATED_LICKS.find((l) => l.id === 'short-ii-V-min-001')!;
	const roots = (p: Phrase): string[] => p.harmony.map((h) => h.chord.root);

	it('D minor (aeolian): the C-minor ii-V-i lands on D — E-7b5 A7 D-7, resolving to D', () => {
		const r = transposeLickForTonality(full, 'D', 'major.aeolian');
		expect(r.key).toBe('D');
		expect(roots(r)).toEqual(['E', 'A', 'D']);
		expect(r.harmony[2].chord.quality).toBe('min7');
		const last = r.notes[r.notes.length - 1].pitch!;
		expect(last % 12).toBe(2);
	});

	it('D dorian: same answer (the lick carries its own harmony; the mode of the daily scale is not a parent hop)', () => {
		expect(roots(transposeLickForTonality(full, 'D', 'major.dorian'))).toEqual(['E', 'A', 'D']);
		expect(roots(transposeLickForTonality(full, 'A', 'major.dorian'))).toEqual(['B', 'E', 'A']);
	});

	it('melodic-minor / altered tonalities no longer snap the cadence into the scale', () => {
		for (const scaleId of ['melodic-minor.melodic-minor', 'melodic-minor.altered']) {
			const r = transposeLickForTonality(full, 'Eb', scaleId);
			const plain = transposeLick(full, 'Eb');
			expect(r.notes.map((n) => n.pitch), scaleId).toEqual(plain.notes.map((n) => n.pitch));
			expect(roots(r)).toEqual(['F', 'Bb', 'Eb']);
		}
	});

	it('short ii-V minor: F minor → G-7b5 C7', () => {
		expect(roots(transposeLickForTonality(short, 'F', 'major.aeolian'))).toEqual(['G', 'C']);
	});
});

/**
 * 2026-10-07: three levels of C Lydian ear training never played an F#. A
 * major-scale lick's F is out of Lydian, and the nearest-tone snap moved it
 * DOWN to E ("F E" played as "E E"). Between two modes of the major scale a
 * note keeps its degree: the 4th becomes Lydian's #4. Downward snapping was
 * right only when the target mode lowers the degree, so Dorian (6 from
 * Aeolian's b6) and Major (7 from Mixolydian's b7) lost their own colour notes
 * the same way.
 */
describe('mode-to-mode adaptation keeps each scale degree', () => {
	/** The phrase's MIDI pitches in note order, null for a rest. */
	const pitches = (p: Phrase): (number | null)[] => p.notes.map((n) => n.pitch);

	it('C Lydian raises an Ionian lick\'s 4th to F#, never down to E', () => {
		const lick = makeModal([65, 64], 'major.ionian', 'maj7'); // F4 E4
		expect(pitches(transposeLickForTonality(lick, 'C', 'major.lydian'))).toEqual([66, 64]);
		const run = makeModal([67, 65, 64, 62], 'major.ionian', 'maj7'); // G F E D
		expect(pitches(transposeLickForTonality(run, 'C', 'major.lydian'))).toEqual([67, 66, 64, 62]);
	});

	it('follows the session key: an Ionian 4th in D Lydian is G#', () => {
		const lick = makeModal([65, 64], 'major.ionian', 'maj7');
		expect(pitches(transposeLickForTonality(lick, 'D', 'major.lydian')).map((p) => p! % 12)).toEqual([8, 6]);
	});

	it('C Dorian raises an Aeolian lick\'s b6 to A, never down to G', () => {
		const lick = makeModal([68, 67], 'major.aeolian', 'min7'); // Ab4 G4
		expect(pitches(transposeLickForTonality(lick, 'C', 'major.dorian'))).toEqual([69, 67]);
	});

	it('C Major raises a Mixolydian lick\'s b7 to B, never down to A', () => {
		const lick = makeModal([70, 72], 'major.mixolydian', '7'); // Bb4 C5
		expect(pitches(transposeLickForTonality(lick, 'C', 'major.ionian'))).toEqual([71, 72]);
	});

	it('lowered degrees move as before: an Ionian 3rd and 7th become Mixolydian\'s b7 and Dorian\'s b3', () => {
		expect(pitches(transposeLickForTonality(makeModal([71, 72], 'major.ionian', 'maj7'), 'C', 'major.mixolydian'))).toEqual([70, 72]);
		expect(pitches(transposeLickForTonality(makeModal([64, 62], 'major.ionian', 'maj7'), 'C', 'major.dorian'))).toEqual([63, 62]);
	});

	it('a chromatic note (no degree of the lick\'s scale) still snaps to the nearest scale tone', () => {
		// Eb is not in C Ionian; C Lydian has no Eb either → nearest, D.
		const lick = makeModal([63, 64], 'major.ionian', 'maj7');
		expect(pitches(transposeLickForTonality(lick, 'C', 'major.lydian'))).toEqual([62, 64]);
	});

	it('C melodic minor raises an Aeolian lick\'s b6 and b7 to A and B, never down to G and A', () => {
		// A seven-note scale whose every degree sits within a semitone of the
		// lick's: the melodic minor is Aeolian with a raised 6 and 7.
		const lick = makeModal([67, 68, 70, 72], 'major.aeolian', 'min7'); // G Ab Bb C
		expect(pitches(transposeLickForTonality(lick, 'C', 'melodic-minor.melodic-minor'))).toEqual([67, 69, 71, 72]);
	});

	it('a source outside the major-scale modes keeps the nearest-tone snap (blues into Dorian)', () => {
		// C blues' Gb is no degree of a seven-note mode; it snaps down to F.
		const lick = makeModal([66, 67], 'blues.minor', '7');
		expect(pitches(transposeLickForTonality(lick, 'C', 'major.dorian'))).toEqual([65, 67]);
	});
});

/**
 * The combiner files single-chord phrases (one bar of Cmaj7 or Cm7) under
 * ii-V-I categories. The parent-key hop exists to keep a progression's chord
 * relationships, and one chord has none: in C Lydian it moved "C D E F" to
 * G A B C, centred on G. Declared over one chord, a phrase adapts like any
 * single-chord lick, whatever its category.
 */
describe('single-chord phrases filed under a progression category', () => {
	it('stay on the session root and adapt to its mode (C Lydian: C D E F → C D E F#)', () => {
		const phrase = makePhrase([60, 62, 64, 65], 'short-ii-V-I-major');
		const result = transposeLickForTonality(phrase, 'C', 'major.lydian');
		expect(result.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 66]);
		expect(result.harmony[0].chord.root).toBe('C');
	});

	it('a single-chord minor phrase in D Dorian lands on D and takes Dorian\'s natural 6', () => {
		// C aeolian 5-b6-5 → D dorian 5-6-5 (A B A), not a C-minor phrase moved intact.
		const phrase = { ...makeModal([67, 68, 67], 'major.aeolian', 'min7'), category: 'ii-V-I-minor' } as Phrase;
		const result = transposeLickForTonality(phrase, 'D', 'major.dorian');
		expect(result.notes.map((n) => n.pitch! % 12)).toEqual([9, 11, 9]);
		expect(result.harmony[0].chord.root).toBe('D');
	});

	it('a real progression still takes the parent-key hop', () => {
		const result = transposeLickForTonality(makeProgression([60, 64], 'ii-V-I-major'), 'A', 'major.dorian');
		expect(result.harmony.map((h) => h.chord.root)).toEqual(['A', 'D', 'G']);
	});
});
