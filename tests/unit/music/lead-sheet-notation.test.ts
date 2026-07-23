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
		expect(abc).toContain('"D-7""G7"C8');
		expect(abc).toContain('"CΔ7"D4');
	});

	it('fills melody gaps with rests and closes with a final barline', () => {
		const abc = leadSheetToAbc(simpleSheet());
		// Second half of bar 2 has no melody → half-bar rest.
		expect(abc).toContain('z4');
		expect(abc.trimEnd().endsWith('|]')).toBe(true);
	});

	it('transposes chord roots to written pitch for a transposing instrument', () => {
		const abc = leadSheetToAbc(simpleSheet(), TENOR);
		expect(abc).toContain('"E-7""A7"d8');
		expect(abc).toContain('"DΔ7"e4');
	});

	it('places two chords in a bar side by side on their own beat-aligned rests', () => {
		const abc = leadSheetToAbc(sheet({
			sections: [
				section({
					bars: 2,
					harmony: [
						seg('D', 'min7', [0, 1], [1, 2]),
						seg('G', '7', [1, 2], [1, 2]),
						seg('C', 'maj7', [1, 1], [1, 1])
					]
				})
			]
		}));
		// Half-bar rests, each carrying its own chord — never stacked on one
		// whole-bar rest.
		expect(abc).toContain('"D-7"z4 "G7"z4');
		expect(abc).not.toContain('"D-7""G7"');
		expect(abc).toContain('"CΔ7"z8');
	});

	it('keeps a beat-3-only chord aligned to beat 3', () => {
		const abc = leadSheetToAbc(sheet({
			sections: [
				section({ bars: 1, harmony: [seg('G', '7', [1, 2], [1, 2])] })
			]
		}));
		// First half of the bar is a bare rest; the chord opens the second half.
		expect(abc).toContain('z4 "G7"z4');
	});

	it('annotates only the first bar of a multi-bar chord', () => {
		const abc = leadSheetToAbc(sheet({
			sections: [
				section({
					bars: 3,
					harmony: [
						seg('F', 'maj7', [0, 1], [2, 1]),
						seg('G', '7', [2, 1], [1, 1])
					]
				})
			]
		}));
		expect(abc).toContain('"FΔ7"z8 | z8 | "G7"z8');
	});

	it('emits the partsbox directive so section labels render boxed', () => {
		const abc = leadSheetToAbc(simpleSheet());
		expect(abc).toMatch(/^%%partsbox 1$/m);
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
		expect(abc).toContain('"FΔ7"z8');
		expect(abc).toContain('"Bb7"z8');
	});

	it('canonicalizes parseable raw symbols to the compact display forms', () => {
		const abc = leadSheetToAbc(sheet({
			sections: [section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1], 'C^7')] })]
		}));
		expect(abc).toContain('"CΔ7"');
	});

	it('keeps an unparseable raw symbol verbatim when not transposing', () => {
		const abc = leadSheetToAbc(sheet({
			sections: [section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1], 'C(mystery)')] })]
		}));
		expect(abc).toContain('"C(mystery)"');
	});

	it('re-parses and transposes the raw symbol for a transposing instrument', () => {
		const abc = leadSheetToAbc(sheet({
			sections: [section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1], 'C^7')] })]
		}), TENOR);
		expect(abc).toContain('"DΔ7"');
	});

	it('falls back to the structured chord when the raw symbol is unparseable', () => {
		const abc = leadSheetToAbc(sheet({
			sections: [section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1], 'C(mystery)')] })]
		}), TENOR);
		expect(abc).toContain('"DΔ7"');
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
		expect(abc.slice(noteAnchors[0].startChar, noteAnchors[0].endChar)).toBe('"D-7""G7"C8');
		expect(abc.slice(noteAnchors[1].startChar, noteAnchors[1].endChar)).toBe('"CΔ7"D4');
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

describe('leadSheetToAbc — chord-aware enharmonic spelling', () => {
	it('spells notes diatonically to the governing chord, not the key signature', () => {
		// Key Bb (a flat key): the old key-signature default spelled pc 1 as
		// Db and pc 6 as Gb — but over A7 that note is the major third C#,
		// and over Dmaj7 it is the major third F#.
		const s = sheet({
			key: 'Bb',
			sections: [
				section({
					bars: 2,
					notes: [
						{ pitch: 61, duration: [1, 1], offset: [0, 1] },
						{ pitch: 66, duration: [1, 1], offset: [1, 1] }
					],
					harmony: [
						seg('A', '7', [0, 1], [1, 1]),
						seg('D', 'maj7', [1, 1], [1, 1])
					]
				})
			]
		});
		const { abc } = leadSheetToAbcWithMap(s);
		expect(abc).toContain('^C');
		expect(abc).toContain('^F');
		expect(abc).not.toContain('_D');
		expect(abc).not.toContain('_G');
	});

	it('an explicit user spelling still overrides the chord preference', () => {
		const s = sheet({
			key: 'Bb',
			sections: [
				section({
					bars: 1,
					notes: [{ pitch: 61, duration: [1, 1], offset: [0, 1], spelling: 'flat' }],
					harmony: [seg('A', '7', [0, 1], [1, 1])]
				})
			]
		});
		const { abc } = leadSheetToAbcWithMap(s);
		expect(abc).toContain('_D');
	});

	it('falls back to the key signature when no chord governs the note', () => {
		const s = sheet({
			key: 'Bb',
			sections: [
				section({
					bars: 1,
					notes: [{ pitch: 61, duration: [1, 1], offset: [0, 1] }],
					harmony: []
				})
			]
		});
		const { abc } = leadSheetToAbcWithMap(s);
		expect(abc).toContain('_D'); // flat key default
	});

	it('judges the chord in WRITTEN pitch for transposing instruments', () => {
		// Concert Ab on a tenor displays in written Bb — a flat key whose
		// default would spell written C#5 as Db. Concert G7 shows as A7, and
		// concert B (59) is its written third C#5 — spelled sharp.
		const s = sheet({
			key: 'Ab',
			sections: [
				section({
					bars: 1,
					notes: [{ pitch: 59, duration: [1, 1], offset: [0, 1] }],
					harmony: [seg('G', '7', [0, 1], [1, 1])]
				})
			]
		});
		const { abc } = leadSheetToAbcWithMap(s, TENOR);
		expect(abc).toContain('"A7"');
		expect(abc).toContain('^c');
		expect(abc).not.toContain('_d');
	});

	it('spells minor-family thirds flat and dominant colors by their alteration', () => {
		const s = sheet({
			key: 'C',
			sections: [
				section({
					bars: 3,
					notes: [
						{ pitch: 63, duration: [1, 1], offset: [0, 1] }, // b3 of C-7 → Eb
						{ pitch: 63, duration: [1, 1], offset: [1, 1] }, // #9 of C7#9 → D#
						{ pitch: 68, duration: [1, 1], offset: [2, 1] } // b13 of G7b13 → Ab (over G: pc 8)
					],
					harmony: [
						seg('C', 'min7', [0, 1], [1, 1]),
						seg('C', '7#9', [1, 1], [1, 1]),
						seg('G', '7b13', [2, 1], [1, 1])
					]
				})
			]
		});
		const { abc } = leadSheetToAbcWithMap(s);
		const body = abc.split('K:C')[1];
		expect(body).toContain('_E'); // Eb over C-7
		expect(body).toContain('^D'); // D# over C7#9
		expect(body).toContain('_A'); // Ab over G7b13
	});
});

describe('leadSheetToAbc — unlabeled sections', () => {
	it('emits no part marker for a blank-labeled section (e.g. a pickup bar)', () => {
		const s = sheet({
			sections: [
				section({ label: '', bars: 1, notes: [{ pitch: 55, duration: [1, 4], offset: [3, 4] }] }),
				section({ label: 'A', bars: 2, notes: [{ pitch: 60, duration: [1, 1], offset: [0, 1] }] })
			]
		});
		const { abc } = leadSheetToAbcWithMap(s);
		expect(abc).not.toContain('P:\n');
		expect(abc).toContain('P:A');
	});
});
