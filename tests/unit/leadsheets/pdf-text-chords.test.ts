import { describe, it, expect } from 'vitest';
import { extractSystemTexts, type PageTextItem } from '$lib/leadsheets/import/pdf-text-chords';
import type { SystemGeometry } from '$lib/leadsheets/import/pdf-geometry';

// One system: staff top at y=500, interline 20, four bars.
const SYSTEMS: SystemGeometry[] = [
	{
		band: { top: 500, bottom: 580, lines: [500, 520, 540, 560, 580] },
		interline: 20,
		barlines: [100, 400, 700, 1000],
		firstBarLeft: 0,
		repeatDots: [
			{ left: false, right: false },
			{ left: false, right: false },
			{ left: false, right: false },
			{ left: false, right: false }
		]
	}
];

const item = (
	str: string,
	x: number,
	y: number,
	h = 60,
	w = str.length * 30,
	font = 'f1'
): PageTextItem => ({ str, x, y, h, w, font });

describe('extractSystemTexts', () => {
	it('collects plain-Unicode chord items in x order (Autumn shape)', () => {
		const [sys] = extractSystemTexts(
			[item('C♯7♭9', 420, 450, 48), item('G♯-7♭5', 110, 450, 48), item('F♯-', 720, 450, 48)],
			SYSTEMS
		);
		expect(sys.chords).toEqual([
			{ x: 110, text: 'G#-7b5' },
			{ x: 420, text: 'C#7b9' },
			{ x: 720, text: 'F#-' }
		]);
	});

	it('splices MuseJazz PUA glyphs and superscript alterations (A Train shape)', () => {
		// "G<E18A>7" = GΔ7; "E9" + raised smaller "<E10C>11" = E9#11.
		const [sys] = extractSystemTexts(
			[
				item('G7', 110, 450, 60, 90),
				item('E9', 420, 450, 60, 60),
				item('11', 484, 426, 45, 60)
			],
			SYSTEMS
		);
		expect(sys.chords).toEqual([
			{ x: 110, text: 'GΔ7' },
			{ x: 420, text: 'E9#11' }
		]);
	});

	it('treats double-printed single letters as rehearsal marks, not chords', () => {
		const [sys] = extractSystemTexts(
			[item('A', 60, 380, 56), item('A', 62, 380, 56), item('A7', 110, 450, 60)],
			SYSTEMS
		);
		expect(sys.marks).toEqual([{ x: 60, text: 'A' }]);
		expect(sys.chords).toEqual([{ x: 110, text: 'A7' }]);
	});

	it('treats a single letter in a non-chord font as a rehearsal mark', () => {
		// Autumn shape: the boxed "A" uses its own bold font, printed once.
		const [sys] = extractSystemTexts(
			[item('A', 300, 440, 56, 40, 'f4'), item('B-7', 110, 450, 60), item('E7', 420, 450, 60)],
			SYSTEMS
		);
		expect(sys.marks).toEqual([{ x: 300, text: 'A' }]);
		expect(sys.chords).toEqual([
			{ x: 110, text: 'B-7' },
			{ x: 420, text: 'E7' }
		]);
	});

	it('catches a rehearsal mark riding high above a chord-crowded first system', () => {
		// A Train's opening "A" sits ~6.1 interlines above the staff, pushed
		// up by the chord row — still in the zone.
		const [sys] = extractSystemTexts(
			[item('A', 60, 378, 56), item('A', 62, 378, 56), item('D6', 110, 450, 60)],
			SYSTEMS
		);
		expect(sys.marks).toEqual([{ x: 60, text: 'A' }]);
		expect(sys.chords).toEqual([{ x: 110, text: 'D6' }]);
	});

	it('treats a single letter well above the chord row as a rehearsal mark', () => {
		// Same font as chords, single print, but ~5 interlines above the
		// staff — chords sit 2-3 interlines up.
		const [sys] = extractSystemTexts(
			[item('C', 300, 396, 56), item('C7', 420, 450, 60)],
			SYSTEMS
		);
		expect(sys.marks).toEqual([{ x: 300, text: 'C' }]);
		expect(sys.chords).toEqual([{ x: 420, text: 'C7' }]);
	});

	it('does not glue analysis text onto a chord as a superscript', () => {
		// TWNBAY's colored chart annotates chords with raised analysis text;
		// only alteration-shaped fragments (#11, b9, 11) may attach.
		const [sys] = extractSystemTexts(
			[
				item('C-7', 110, 450, 60, 90),
				item('ii-V', 204, 430, 45),
				item('E9', 420, 450, 60, 60),
				item('\ue10c11', 484, 426, 45)
			],
			SYSTEMS
		);
		expect(sys.chords).toEqual([
			{ x: 110, text: 'C-7' },
			{ x: 420, text: 'E9#11' }
		]);
	});

	it('strips parentheses inside chord alterations', () => {
		const [sys] = extractSystemTexts(
			[item('C#m7(b5)', 110, 450, 60), item('F#7(b9', 420, 450, 60)],
			SYSTEMS
		);
		expect(sys.chords).toEqual([
			{ x: 110, text: 'C#m7b5' },
			{ x: 420, text: 'F#7b9' }
		]);
	});

	it('reads ending labels and printed bar numbers', () => {
		const [sys] = extractSystemTexts(
			[
				item('1.', 640, 430, 44),
				item('1.', 642, 430, 44),
				item('6', 40, 470, 32),
				item('B-7', 110, 450, 60)
			],
			SYSTEMS
		);
		expect(sys.endings).toEqual([{ x: 640, n: 1 }]);
		expect(sys.barNumber).toBe(6);
		expect(sys.chords).toEqual([{ x: 110, text: 'B-7' }]);
	});

	it('ignores lyrics below the staff and items with unknown music glyphs', () => {
		const [sys] = extractSystemTexts(
			[
				item('The', 200, 650, 44), // lyric: below the staff
				item('', 150, 450, 79), // stray music glyph above
				item('D6', 110, 450, 60)
			],
			SYSTEMS
		);
		expect(sys.chords).toEqual([{ x: 110, text: 'D6' }]);
	});

	it('strips tall parentheses around optional chords', () => {
		const [sys] = extractSystemTexts(
			[item('', 700, 450, 62, 15), item('E-7', 720, 450, 60), item('A7)', 830, 450, 60)],
			SYSTEMS
		);
		expect(sys.chords).toEqual([
			{ x: 720, text: 'E-7' },
			{ x: 830, text: 'A7' }
		]);
	});
});
