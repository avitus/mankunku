import { describe, it, expect } from 'vitest';
import { extractSystemTexts, type PageTextItem } from '$lib/tunes/import/pdf-text-chords';
import type { SystemGeometry } from '$lib/tunes/import/pdf-geometry';

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
				// \ue18a = MuseJazz major-seventh Delta glyph (PUA, invisible in most editors).
				item('G\ue18a7', 110, 450, 60, 90),
				item('E9', 420, 450, 60, 60),
				item('\ue10c11', 484, 426, 45, 60)
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
				item('\ue262', 150, 450, 79), // stray music glyph above (SMuFL sharp, PUA)
				item('D6', 110, 450, 60)
			],
			SYSTEMS
		);
		expect(sys.chords).toEqual([{ x: 110, text: 'D6' }]);
	});

	it('strips tall parentheses around optional chords', () => {
		const [sys] = extractSystemTexts(
			// \ue875 = MuseJazz tall left parenthesis glyph (PUA).
			[item('\ue875', 700, 450, 62, 15), item('E-7', 720, 450, 60), item('A7)', 830, 450, 60)],
			SYSTEMS
		);
		expect(sys.chords).toEqual([
			{ x: 720, text: 'E-7' },
			{ x: 830, text: 'A7' }
		]);
	});

	it('keeps optional chords printed inside plain ASCII parentheses', () => {
		// parseChordSymbol rejects a leading '(' — validate the stripped text.
		const [sys] = extractSystemTexts(
			[item('(E-7', 720, 450, 60), item('(A7)', 830, 450, 60)],
			SYSTEMS
		);
		expect(sys.chords).toEqual([
			{ x: 720, text: 'E-7' },
			{ x: 830, text: 'A7' }
		]);
	});
});

it('joins a raised diminished symbol and baseline seventh without treating a lyric I as a rehearsal mark',()=>{
 const systems=[{band:{top:200,bottom:280,lines:[200,220,240,260,280]},interline:20,firstBarLeft:70,barlines:[450],repeatDots:[]}];
 const item=(str:string,x:number,y:number,h:number,w:number,font='chords')=>({str,x,y,h,w,font});
 const result=extractSystemTexts([item('F',100,160,60,34),item('\ue18e',135,130,45,28),item('7',165,160,60,22),item('I',250,80,40,12,'lyrics')],systems);
 expect(result[0].chords).toEqual([{x:100,text:'F°7'}]);
 expect(result[0].marks).toEqual([]);
});

it('splits combined chord text and retains a half-diminished quality without treating Fine as a chord',()=>{
 const g={band:{top:100,bottom:180,lines:[100,120,140,160,180]},interline:20,firstBarLeft:50,barlines:[500],repeatDots:[]};
 const items=[{str:'D',x:100,y:50,w:25,h:30},{str:'\ue18f',x:125,y:40,w:12,h:20},{str:'7',x:137,y:50,w:15,h:30},{str:'C#7 C7',x:230,y:50,w:100,h:30},{str:'Fine',x:400,y:50,w:60,h:30}];
 const result=extractSystemTexts(items,[g])[0];
 expect(result.chords.map(c=>c.text)).toEqual(['Dø7','C#7','C7']);
});
