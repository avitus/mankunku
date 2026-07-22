import { describe, it, expect } from 'vitest';
import type { LeadSheet, LeadSheetSection } from '$lib/types/lead-sheet';
import type { HarmonicSegment, Note } from '$lib/types/music';
import { INSTRUMENTS } from '$lib/types/instruments';
import { leadSheetToAbc, leadSheetToAbcWithMap } from '$lib/music/lead-sheet-notation';

const TENOR = INSTRUMENTS['tenor-sax'];

function seg(
	root: HarmonicSegment['chord']['root'],
	quality: HarmonicSegment['chord']['quality'],
	startOffset: [number, number],
	duration: [number, number],
	symbol?: string
): HarmonicSegment {
	const s: HarmonicSegment = { chord: { root, quality }, scaleId: 'major.ionian', startOffset, duration };
	if (symbol) s.symbol = symbol;
	return s;
}

function section(overrides: Partial<LeadSheetSection>): LeadSheetSection {
	return { label: 'A', bars: 4, notes: [], harmony: [], ...overrides };
}

function sheet(overrides: Partial<LeadSheet>): LeadSheet {
	return {
		id: 'ls-test',
		title: 'Test Tune',
		key: 'C',
		timeSignature: [4, 4],
		tags: [],
		sections: [],
		source: 'user',
		...overrides
	};
}

/** 2-bar sheet: whole-note C4 over Dm7→G7, then half-note D4 over Cmaj7 + rest. */
function simpleSheet(): LeadSheet {
	const notes: Note[] = [
		{ pitch: 60, duration: [1, 1], offset: [0, 1] },
		{ pitch: 62, duration: [1, 2], offset: [1, 1] }
	];
	return sheet({
		sections: [
			section({
				bars: 2,
				notes,
				harmony: [
					seg('D', 'min7', [0, 1], [1, 2]),
					seg('G', '7', [1, 2], [1, 2]),
					seg('C', 'maj7', [1, 1], [1, 1])
				]
			})
		]
	});
}

describe('leadSheetToAbc — headers', () => {
	it('emits X/T/M/L/K headers with the concert key when no instrument is given', () => {
		const abc = leadSheetToAbc(simpleSheet());
		expect(abc).toContain('X:1');
		expect(abc).toContain('T:Test Tune');
		expect(abc).toContain('M:4/4');
		expect(abc).toContain('L:1/8');
		expect(abc).toMatch(/^K:C$/m);
	});

	it('emits a composer line when present', () => {
		const abc = leadSheetToAbc({ ...simpleSheet(), composer: 'Trad.' });
		expect(abc).toMatch(/^C:Trad\.$/m);
	});

	it('transposes the key signature for a transposing instrument', () => {
		const abc = leadSheetToAbc(simpleSheet(), TENOR);
		expect(abc).toMatch(/^K:D$/m);
	});
});

describe('leadSheetToAbc — chord symbols over the melody', () => {
	it('attaches quoted chords to the notes sounding at their offsets', () => {
		const abc = leadSheetToAbc(simpleSheet());
		// G7 lands mid-way through the held whole note, so it stacks on it.
		expect(abc).toContain('"Dm7""G7"C8');
		expect(abc).toContain('"Cmaj7"D4');
	});

	it('fills melody gaps with rests and closes with a final barline', () => {
		const abc = leadSheetToAbc(simpleSheet());
		// Second half of bar 2 has no melody → half-bar rest.
		expect(abc).toContain('z4');
		expect(abc.trimEnd().endsWith('|]')).toBe(true);
	});

	it('transposes chord roots to written pitch for a transposing instrument', () => {
		const abc = leadSheetToAbc(simpleSheet(), TENOR);
		expect(abc).toContain('"Em7""A7"d8');
		expect(abc).toContain('"Dmaj7"e4');
	});

	it('renders whole-bar rests with chords for harmony-only sections', () => {
		const abc = leadSheetToAbc(sheet({
			sections: [
				section({
					bars: 2,
					harmony: [seg('F', 'maj7', [0, 1], [1, 1]), seg('Bb', '7', [1, 1], [1, 1])]
				})
			]
		}));
		expect(abc).toContain('"Fmaj7"z8');
		expect(abc).toContain('"Bb7"z8');
	});

	it('prefers the raw source symbol verbatim when not transposing', () => {
		const abc = leadSheetToAbc(sheet({
			sections: [section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1], 'C^7')] })]
		}));
		expect(abc).toContain('"C^7"');
	});

	it('re-parses and transposes the raw symbol for a transposing instrument', () => {
		const abc = leadSheetToAbc(sheet({
			sections: [section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1], 'C^7')] })]
		}), TENOR);
		expect(abc).toContain('"Dmaj7"');
	});

	it('falls back to the structured chord when the raw symbol is unparseable', () => {
		const abc = leadSheetToAbc(sheet({
			sections: [section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1], 'C(mystery)')] })]
		}), TENOR);
		expect(abc).toContain('"Dmaj7"');
	});

	it('respells F# chord roots as Gb in flat key contexts', () => {
		const abc = leadSheetToAbc(sheet({
			key: 'F',
			sections: [section({ bars: 1, harmony: [seg('F#', '7', [0, 1], [1, 1])] })]
		}));
		expect(abc).toContain('"Gb7"');
	});
});

describe('leadSheetToAbc — sections, repeats, endings', () => {
	function formSheet(): LeadSheet {
		return sheet({
			sections: [
				section({ label: 'A', bars: 2, repeatStart: true, harmony: [seg('C', 'maj7', [0, 1], [2, 1])] }),
				section({ label: 'A', bars: 1, ending: 1, repeatEnd: true, harmony: [seg('G', '7', [0, 1], [1, 1])] }),
				section({ label: 'A', bars: 1, ending: 2, harmony: [seg('C', 'maj7', [0, 1], [1, 1])] }),
				section({ label: 'B', bars: 2, harmony: [seg('F', 'maj7', [0, 1], [2, 1])] })
			]
		});
	}

	it('emits part labels when the section label changes', () => {
		const abc = leadSheetToAbc(formSheet());
		expect(abc).toMatch(/^P:A$/m);
		expect(abc).toMatch(/^P:B$/m);
		// Three consecutive A-labeled sections produce a single P:A.
		expect(abc.match(/^P:A$/gm)).toHaveLength(1);
	});

	it('opens a repeat at a repeatStart section', () => {
		const abc = leadSheetToAbc(formSheet());
		expect(abc).toMatch(/P:A\n\|:/);
	});

	it('marks first and second endings across the repeat barline', () => {
		const abc = leadSheetToAbc(formSheet());
		expect(abc).toMatch(/\|\n\[1/);
		expect(abc).toMatch(/:\|\n\[2/);
	});

	it('separates plain sections with a double bar and ends with a final bar', () => {
		const abc = leadSheetToAbc(formSheet());
		expect(abc).toMatch(/\|\|\nP:B/);
		expect(abc.trimEnd().endsWith('|]')).toBe(true);
	});
});

describe('leadSheetToAbc — multi-system reflow', () => {
	it('breaks the body onto a new line every four bars', () => {
		const notes: Note[] = Array.from({ length: 8 }, (_, bar) => ({
			pitch: 60,
			duration: [1, 1] as [number, number],
			offset: [bar, 1] as [number, number]
		}));
		const abc = leadSheetToAbc(sheet({ sections: [section({ bars: 8, notes })] }));
		const bodyLines = abc.split('\n').filter((l) => l.includes('C8'));
		expect(bodyLines).toHaveLength(2);
	});
});

describe('leadSheetToAbcWithMap — click anchors', () => {
	it('anchors each pitched note, including its chord prefix, at exact char offsets', () => {
		const { abc, noteAnchors } = leadSheetToAbcWithMap(simpleSheet());
		expect(noteAnchors).toHaveLength(2);
		expect(abc.slice(noteAnchors[0].startChar, noteAnchors[0].endChar)).toBe('"Dm7""G7"C8');
		expect(abc.slice(noteAnchors[1].startChar, noteAnchors[1].endChar)).toBe('"Cmaj7"D4');
		expect(noteAnchors.map((a) => a.sourceIndex)).toEqual([0, 1]);
	});

	it('keeps anchors exact across line breaks', () => {
		const notes: Note[] = Array.from({ length: 8 }, (_, bar) => ({
			pitch: 60 + (bar % 3),
			duration: [1, 1] as [number, number],
			offset: [bar, 1] as [number, number]
		}));
		const { abc, noteAnchors } = leadSheetToAbcWithMap(sheet({ sections: [section({ bars: 8, notes })] }));
		expect(noteAnchors).toHaveLength(8);
		for (const anchor of noteAnchors) {
			const token = abc.slice(anchor.startChar, anchor.endChar);
			expect(token).toMatch(/^[CD_^=]*\d*.*8$/);
		}
		// The fifth note starts the second system; its anchor must still resolve.
		expect(abc.slice(noteAnchors[4].startChar, noteAnchors[4].endChar)).toMatch(/8$/);
	});

	it('indexes anchors into the flattened note array across sections', () => {
		const { noteAnchors } = leadSheetToAbcWithMap(sheet({
			sections: [
				section({ bars: 1, notes: [{ pitch: 60, duration: [1, 1], offset: [0, 1] }] }),
				section({ label: 'B', bars: 1, notes: [{ pitch: 64, duration: [1, 1], offset: [0, 1] }] })
			]
		}));
		expect(noteAnchors.map((a) => a.sourceIndex)).toEqual([0, 1]);
	});
});
