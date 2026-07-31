import { describe, it, expect } from 'vitest';
import type { Tune } from '$lib/types/tune';
import type { Note } from '$lib/types/music';
import { INSTRUMENTS } from '$lib/types/instruments';
import { tuneToAbc, tuneToAbcWithMap } from '$lib/music/tune-notation';
import { seg, section, sheet, simpleSheet } from '../../helpers/tune-fixtures';

const TENOR = INSTRUMENTS['tenor-sax'];

/** Repeat + numbered endings across four sections (A A[1 A[2 B). */
function repeatsSheet(): Tune {
	return sheet({
		sections: [
			section({ label: 'A', bars: 2, repeatStart: true, harmony: [seg('C', 'maj7', [0, 1], [2, 1])] }),
			section({ label: 'A', bars: 1, ending: 1, repeatEnd: true, harmony: [seg('G', '7', [0, 1], [1, 1])] }),
			section({ label: 'A', bars: 1, ending: 2, harmony: [seg('C', 'maj7', [0, 1], [1, 1])] }),
			section({ label: 'B', bars: 2, harmony: [seg('F', 'maj7', [0, 1], [2, 1])] })
		]
	});
}

describe('tuneToAbc — headers', () => {
	it('emits X/T/M/L/K headers with the concert key when no instrument is given', () => {
		const abc = tuneToAbc(simpleSheet());
		expect(abc).toContain('X:1');
		expect(abc).toContain('T:Test Tune');
		expect(abc).toContain('M:4/4');
		expect(abc).toContain('L:1/8');
		expect(abc).toMatch(/^K:C$/m);
	});

	it('emits a composer line when present', () => {
		const abc = tuneToAbc({ ...simpleSheet(), composer: 'Trad.' });
		expect(abc).toMatch(/^C:Trad\.$/m);
	});

	it('transposes the key signature for a transposing instrument', () => {
		const abc = tuneToAbc(simpleSheet(), TENOR);
		expect(abc).toMatch(/^K:D$/m);
	});
});

describe('tuneToAbc — chord symbols over the melody', () => {
	it('keeps held notes whole — chords sit at their beats in the chord voice', () => {
		const abc = tuneToAbc(simpleSheet());
		// The whole note engraves as a whole note; both chords position over
		// it from the invisible chord voice at beats 1 and 3, never stacked.
		expect(abc).toContain('C8');
		expect(abc).not.toContain('C4-');
		expect(abc).toContain('"D-7"x4 "G7"x4');
		expect(abc).not.toContain('"D-7""G7"');
	});

	it('positions a lone mid-bar chord over an untouched tied note', () => {
		const abc = tuneToAbc(sheet({
			sections: [
				section({
					bars: 2,
					notes: [
						{ pitch: 60, duration: [1, 1], offset: [0, 1], tied: true },
						{ pitch: 60, duration: [1, 1], offset: [1, 1] }
					],
					harmony: [seg('G', '7', [1, 2], [3, 2])]
				})
			]
		}));
		expect(abc).toContain('C8-');
		expect(abc).toContain('x4 "G7"x4');
	});

	it('fills melody gaps with rests and closes with a final barline', () => {
		const abc = tuneToAbc(simpleSheet());
		// Second half of bar 2 has no melody → half-bar rest in M (H is
		// spacer-only); the melody line closes with |].
		expect(abc).toMatch(/D4 z4/);
		expect(abc).toContain(' |]');
	});

	it('transposes chord roots to written pitch for a transposing instrument', () => {
		const abc = tuneToAbc(simpleSheet(), TENOR);
		expect(abc).toContain('d8');
		expect(abc).toContain('"E-7"x4 "A7"x4');
		expect(abc).toContain('"DΔ7"');
	});

	it('places two chords in a bar side by side on their own beat-aligned spacers', () => {
		const abc = tuneToAbc(sheet({
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
		// Empty bars → chord voice uses invisible x (slashes live in M);
		// half-bar cells keep each chord on its own beat.
		expect(abc).toContain('"D-7"x4 "G7"x4');
		expect(abc).not.toContain('"D-7""G7"');
		expect(abc).toContain('"CΔ7"x8');
	});

	it('keeps a beat-3-only chord aligned to beat 3', () => {
		const abc = tuneToAbc(sheet({
			sections: [
				section({ bars: 1, harmony: [seg('G', '7', [1, 2], [1, 2])] })
			]
		}));
		// Empty bar: invisible spacers in H; chord opens the second half.
		expect(abc).toContain('x4 "G7"x4');
	});

	it('annotates only the first bar of a multi-bar chord', () => {
		const abc = tuneToAbc(sheet({
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
		// Empty bars use x in H (M owns the slash marks).
		expect(abc).toContain('"FΔ7"x8 | x8 | "G7"x8');
	});

	it('emits boxed rehearsal marks and system-start measure numbers', () => {
		const abc = tuneToAbc(simpleSheet());
		expect(abc).toMatch(/^%%partsbox 1$/m);
		expect(abc).toMatch(/^%%measurenb 0$/m);
	});

	it('uses rhythm slashes (not whole rests) for harmony-only bars', () => {
		const abc = tuneToAbc(sheet({
			sections: [
				section({
					bars: 2,
					harmony: [seg('F', 'maj7', [0, 1], [1, 1]), seg('Bb', '7', [1, 1], [1, 1])]
				})
			]
		}));
		// Melody voice: beat-aligned jazz slashes; chord voice: invisible
		// spacers (x) so rests never double-print under the slashes.
		expect(abc).toMatch(/!style=rhythm!z2/);
		expect(abc).toContain('"FΔ7"x8');
		expect(abc).toContain('"Bb7"x8');
		expect(abc).not.toContain('"FΔ7"z8');
	});

	it('emits the style field on the masthead when present', () => {
		const abc = tuneToAbc({ ...simpleSheet(), style: 'Medium Swing' });
		expect(abc).toMatch(/^R:Medium Swing$/m);
	});

	it('canonicalizes parseable raw symbols to the compact display forms', () => {
		const abc = tuneToAbc(sheet({
			sections: [section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1], 'C^7')] })]
		}));
		expect(abc).toContain('"CΔ7"');
	});

	it('keeps an unparseable raw symbol verbatim when not transposing', () => {
		const abc = tuneToAbc(sheet({
			sections: [section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1], 'C(mystery)')] })]
		}));
		expect(abc).toContain('"C(mystery)"');
	});

	it('strips a double-quote from an unparseable symbol so the ABC annotation stays intact', () => {
		// A raw import symbol carrying a `"` would otherwise terminate the ABC
		// chord annotation early and corrupt the whole voice line.
		const abc = tuneToAbc(sheet({
			sections: [section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1], 'C"evil')] })]
		}));
		expect(abc).not.toContain('C"evil');
		expect(abc).toContain('"Cevil"');
	});

	it('re-parses and transposes the raw symbol for a transposing instrument', () => {
		const abc = tuneToAbc(sheet({
			sections: [section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1], 'C^7')] })]
		}), TENOR);
		expect(abc).toContain('"DΔ7"');
	});

	it('falls back to the structured chord when the raw symbol is unparseable', () => {
		const abc = tuneToAbc(sheet({
			sections: [section({ bars: 1, harmony: [seg('C', 'maj7', [0, 1], [1, 1], 'C(mystery)')] })]
		}), TENOR);
		expect(abc).toContain('"DΔ7"');
	});

	it('respells F# chord roots as Gb in flat key contexts', () => {
		const abc = tuneToAbc(sheet({
			key: 'F',
			sections: [section({ bars: 1, harmony: [seg('F#', '7', [0, 1], [1, 1])] })]
		}));
		expect(abc).toContain('"Gb7"');
	});
});

/** Force classic 4 bars/line so layout assertions don't depend on density auto-pick. */
const BPL4 = { barsPerLine: 4 } as const;

describe('tuneToAbc — sections, repeats, endings', () => {
	it('emits part labels when the section label changes', () => {
		const abc = tuneToAbc(repeatsSheet(), undefined, BPL4);
		expect(abc).toMatch(/^P:A$/m);
		expect(abc).toMatch(/^P:B$/m);
		// Three consecutive A-labeled sections produce a single P:A.
		expect(abc.match(/^P:A$/gm)).toHaveLength(1);
	});

	it('opens a repeat at a repeatStart section', () => {
		const abc = tuneToAbc(repeatsSheet(), undefined, BPL4);
		expect(abc).toMatch(/P:A\n\[V:M\]\|:/);
	});

	it('flows the first ending inline and stacks the second on a pad-free system', () => {
		const abc = tuneToAbc(repeatsSheet(), undefined, BPL4);
		// [1 continues the body's line (no newline before it)…
		expect(abc).toMatch(/\| \[1/);
		// …and [2 starts a fresh system with NO invisible pad bars — indent
		// under [1] is applied post-render in SVG.
		expect(abc).toMatch(/\[V:M\]\[2/);
		expect(abc).not.toMatch(/\[V:M\]x\d+ \[2/);
		expect(abc).not.toMatch(/\[V:H\]x\d+ /);
	});

	it('opens both endings at the left margin when [1] starts a fresh system', () => {
		const abc = tuneToAbc(sheet({
			sections: [
				section({ label: 'A', bars: 4, repeatStart: true, harmony: [seg('C', 'maj7', [0, 1], [4, 1])] }),
				section({ label: 'A', bars: 1, ending: 1, repeatEnd: true, harmony: [seg('G', '7', [0, 1], [1, 1])] }),
				section({ label: 'A', bars: 1, ending: 2, harmony: [seg('C', 'maj7', [0, 1], [1, 1])] }),
				section({ label: 'B', bars: 1, harmony: [seg('F', 'maj7', [0, 1], [1, 1])] })
			]
		}), undefined, BPL4);
		// A 4-bar body fills its line, so [1 opens the next system at column 0
		// and [2 follows with no align-under indent needed.
		expect(abc).toMatch(/\[V:M\]\[1/);
		expect(abc).toMatch(/\[V:M\]\[2/);
	});

	it('breaks an inline-flowed first ending at the line width, not its section-local bar count', () => {
		// The [1 flows inline after a 2-bar body, entering at column 2 — its
		// line break must land after 2 inline bars (absolute column 4), not
		// after 4 section-local bars, or the first system over-fills.
		const abc = tuneToAbc(sheet({
			sections: [
				section({ label: 'A', bars: 2, repeatStart: true, harmony: [seg('C', 'maj7', [0, 1], [2, 1])] }),
				section({ label: 'A', bars: 6, ending: 1, repeatEnd: true, harmony: [seg('G', '7', [0, 1], [6, 1])] }),
				section({ label: 'A', bars: 1, ending: 2, harmony: [seg('C', 'maj7', [0, 1], [1, 1])] })
			]
		}), undefined, BPL4);
		for (const line of abc.split('\n').filter((l) => l.startsWith('[V:M]'))) {
			// Empty bars emit one slash-bar token (4× style=rhythm); no pad bars.
			const slashBars = (line.match(/!style=rhythm!/g) ?? []).length / 4;
			expect(slashBars, line).toBeLessThanOrEqual(4);
		}
	});

	it('closes the second ending with a non-thin barline (volta right hook)', () => {
		// abcjs only ends an open volta on non-thin bars; a thin '|' would leave
		// the [2] bracket open-ended with no staff barline at the close.
		const abc = tuneToAbc(repeatsSheet(), undefined, BPL4);
		// [2] section is not last (B follows) → double bar.
		expect(abc).toMatch(/\[2[^\n]+\|\|/);
		const last = sheet({
			sections: [
				section({ bars: 2, repeatStart: true }),
				section({ bars: 1, ending: 1, repeatEnd: true }),
				section({ bars: 1, ending: 2 })
			]
		});
		// [2] is last → thin-thick final.
		expect(tuneToAbc(last, undefined, BPL4)).toMatch(/\[2[^\n]+\|\]/);
	});

	it('closes a first ending WITHOUT a repeat barline on a non-thin bar (volta right hook)', () => {
		// A first ending that flows into [2] without repeating back must still
		// close its own volta bracket. Before the fix it fell through to the thin
		// ' |' used for "approach into an ending", leaving the [1] hook open-ended.
		const noRepeatFirst = sheet({
			sections: [
				section({ label: 'A', bars: 2, repeatStart: true, harmony: [seg('C', 'maj7', [0, 1], [2, 1])] }),
				section({ label: 'A', bars: 1, ending: 1, harmony: [seg('G', '7', [0, 1], [1, 1])] }),
				section({ label: 'A', bars: 1, ending: 2, harmony: [seg('C', 'maj7', [0, 1], [1, 1])] })
			]
		});
		const abc = tuneToAbc(noRepeatFirst, undefined, BPL4);
		// [1] (not last, [2] follows) closes on a double bar, never a thin '|'.
		expect(abc).toMatch(/\[1[^\n]*\|\|/);
		expect(abc).not.toMatch(/\[1[^\n]* \|(?!\|)/);
	});

	it('separates plain sections with a double bar and ends with a final bar', () => {
		const abc = tuneToAbc(repeatsSheet(), undefined, BPL4);
		expect(abc).toMatch(/\|\|\n\[V:H\]/);
		expect(abc).toMatch(/P:B\n\[V:M\]/);
		// The melody line closes with the final barline; the chord voice's
		// system line follows it.
		expect(abc).toContain(' |]');
	});
});

describe('tuneToAbc — multi-system reflow', () => {
	it('breaks the body onto a new line every four bars by default', () => {
		const notes: Note[] = Array.from({ length: 8 }, (_, bar) => ({
			pitch: 60,
			duration: [1, 1] as [number, number],
			offset: [bar, 1] as [number, number]
		}));
		// One whole note per bar is unremarkable density → 4 bars/line.
		const abc = tuneToAbc(sheet({ sections: [section({ bars: 8, notes })] }), undefined, {
			barsPerLine: 4
		});
		const bodyLines = abc.split('\n').filter((l) => l.includes('C8'));
		expect(bodyLines).toHaveLength(2);
	});

	it('renders no stray empty chord-voice bar for a zero-bar section', () => {
		// Unvalidated drafts can carry bars: 0 — flushLine must not emit a
		// dangling "[V:H] … |" line with no bars in it.
		const abc = tuneToAbc(sheet({ sections: [section({ bars: 0 })] }));
		expect(abc).not.toMatch(/\[V:H\]\s*\|/);
	});

	it('keeps the next section header on its own line after a zero-bar section', () => {
		// The zero-bar guard must still newline-terminate the dangling [V:M]
		// open, or the following section's boxed P: label concatenates onto it.
		const abc = tuneToAbc(
			sheet({
				sections: [
					section({ label: 'A', bars: 0 }),
					section({ label: 'B', bars: 2 })
				]
			})
		);
		expect(abc).not.toMatch(/\[V:M\][^\n]*P:/);
	});
});

describe('tuneToAbcWithMap — click anchors', () => {
	it('anchors each pitched note, including its chord prefix, at exact char offsets', () => {
		const { abc, noteAnchors } = tuneToAbcWithMap(simpleSheet());
		// Chords live in the chord voice now — melody tokens carry no prefixes.
		expect(noteAnchors).toHaveLength(2);
		expect(abc.slice(noteAnchors[0].startChar, noteAnchors[0].endChar)).toBe('C8');
		expect(abc.slice(noteAnchors[1].startChar, noteAnchors[1].endChar)).toBe('D4');
		expect(noteAnchors.map((a) => a.sourceIndex)).toEqual([0, 1]);
	});

	it('keeps anchors exact across line breaks', () => {
		const notes: Note[] = Array.from({ length: 8 }, (_, bar) => ({
			pitch: 60 + (bar % 3),
			duration: [1, 1] as [number, number],
			offset: [bar, 1] as [number, number]
		}));
		const { abc, noteAnchors } = tuneToAbcWithMap(sheet({ sections: [section({ bars: 8, notes })] }));
		expect(noteAnchors).toHaveLength(8);
		for (const anchor of noteAnchors) {
			const token = abc.slice(anchor.startChar, anchor.endChar);
			expect(token).toMatch(/^[CD_^=]*\d*.*8$/);
		}
		// The fifth note starts the second system; its anchor must still resolve.
		expect(abc.slice(noteAnchors[4].startChar, noteAnchors[4].endChar)).toMatch(/8$/);
	});

	it('indexes anchors into the flattened note array across sections', () => {
		const { noteAnchors } = tuneToAbcWithMap(sheet({
			sections: [
				section({ bars: 1, notes: [{ pitch: 60, duration: [1, 1], offset: [0, 1] }] }),
				section({ label: 'B', bars: 1, notes: [{ pitch: 64, duration: [1, 1], offset: [0, 1] }] })
			]
		}));
		expect(noteAnchors.map((a) => a.sourceIndex)).toEqual([0, 1]);
	});
});

describe('tuneToAbc — chord-aware enharmonic spelling', () => {
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
		const { abc } = tuneToAbcWithMap(s);
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
		const { abc } = tuneToAbcWithMap(s);
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
		const { abc } = tuneToAbcWithMap(s);
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
		const { abc } = tuneToAbcWithMap(s, TENOR);
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
		const { abc } = tuneToAbcWithMap(s);
		const body = abc.split('K:C')[1];
		expect(body).toContain('_E'); // Eb over C-7
		expect(body).toContain('^D'); // D# over C7#9
		expect(body).toContain('_A'); // Ab over G7b13
	});
});

describe('tuneToAbc — unlabeled sections', () => {
	it('emits no part marker for a blank-labeled section (e.g. a pickup bar)', () => {
		const s = sheet({
			sections: [
				section({ label: '', bars: 1, notes: [{ pitch: 55, duration: [1, 4], offset: [3, 4] }] }),
				section({ label: 'A', bars: 2, notes: [{ pitch: 60, duration: [1, 1], offset: [0, 1] }] })
			]
		});
		const { abc } = tuneToAbcWithMap(s);
		expect(abc).not.toContain('P:\n');
		expect(abc).toContain('P:A');
	});
});

describe('tuneToAbc — sharp-key chord respelling', () => {
	it('spells diatonic flat-named roots as the sharp key spells them', () => {
		// Key A (3 sharps): the canonical Ab/Db roots are the diatonic G#/C#.
		const abc = tuneToAbc(sheet({
			key: 'A',
			sections: [
				section({
					bars: 3,
					harmony: [
						seg('Ab', 'min7b5', [0, 1], [1, 1]),
						seg('Db', '7b9', [1, 1], [1, 1]),
						seg('Bb', '7', [2, 1], [1, 1]) // chromatic — keeps its flat name
					]
				})
			]
		}));
		expect(abc).toContain('"G#-7b5"');
		expect(abc).toContain('"C#7b9"');
		expect(abc).toContain('"Bb7"');
	});

	it('spells notes against the respelled chord root', () => {
		// C# over C#7b9 in key A: the root, covered by the key signature —
		// never an explicit Db.
		const abc = tuneToAbc(sheet({
			key: 'A',
			sections: [
				section({
					bars: 1,
					notes: [{ pitch: 61, duration: [1, 1], offset: [0, 1] }],
					harmony: [seg('Db', '7b9', [0, 1], [1, 1])]
				})
			]
		}));
		expect(abc).toContain('"C#7b9"');
		expect(abc).toMatch(/\[V:M\]C8/);
		expect(abc).not.toContain('_D');
	});

	it('leaves flat-key contexts untouched', () => {
		const abc = tuneToAbc(sheet({
			key: 'Bb',
			sections: [
				section({ bars: 1, harmony: [seg('Ab', '7', [0, 1], [1, 1])] })
			]
		}));
		expect(abc).toContain('"Ab7"');
	});
});

describe('glissando rendering', () => {
	it('flags the source note anchor; the wavy connector is drawn over the SVG', () => {
		const { abc, noteAnchors } = tuneToAbcWithMap(
			sheet({
				sections: [
					section({
						bars: 1,
						notes: [
							{ pitch: 69, duration: [1, 2], offset: [0, 1], gliss: true },
							{ pitch: 72, duration: [1, 2], offset: [1, 2] }
						]
					})
				]
			})
		);
		// No ABC decoration — abcjs's !slide! renders a scoop, not a
		// MuseScore-style glissando; NotationDisplay draws the wavy line.
		expect(abc).not.toContain('!slide!');
		expect(noteAnchors[0].gliss).toBe(true);
		expect(noteAnchors[1].gliss).toBeUndefined();
	});
});

describe('in-signature spelling priority', () => {
	it('prefers the enharmonic that is IN the key signature over the chord preference', () => {
		// Lady Bird bar 8: C#5 over F7 in D major. The chord preference
		// says Db (the b13), but C# is in the signature — no accidental.
		const abc = tuneToAbc(
			sheet({
				key: 'D',
				sections: [
					section({
						bars: 1,
						harmony: [seg('F', '7', [0, 1], [1, 1], 'F7')],
						notes: [{ pitch: 73, duration: [1, 1], offset: [0, 1] }]
					})
				]
			})
		);
		expect(abc).not.toContain('_d');
		expect(abc).toMatch(/[^_^]c8/);
	});

	it('keeps the chord preference when neither spelling is in the signature', () => {
		// The original request: C# over A7 in F major (Db not in F's sig).
		const abc = tuneToAbc(
			sheet({
				key: 'F',
				sections: [
					section({
						bars: 1,
						harmony: [seg('A', '7', [0, 1], [1, 1], 'A7')],
						notes: [{ pitch: 73, duration: [1, 1], offset: [0, 1] }]
					})
				]
			})
		);
		expect(abc).toContain('^c');
	});
});

// ── Fixtures shared by the anchor + golden-guard suites ────────────────────

/** 8 whole-note bars → two 4-bar systems. */
function multiSystemSheet(): Tune {
	const notes: Note[] = Array.from({ length: 8 }, (_, bar) => ({
		pitch: 60,
		duration: [1, 1] as [number, number],
		offset: [bar, 1] as [number, number]
	}));
	return sheet({ sections: [section({ bars: 8, notes })] });
}

/** 3/4 sheet: three quarter notes over Dm7/G7, then an empty bar under CΔ7. */
function threeFourSheet(): Tune {
	return sheet({
		timeSignature: [3, 4],
		sections: [
			section({
				bars: 2,
				notes: [
					{ pitch: 60, duration: [1, 4], offset: [0, 1] },
					{ pitch: 62, duration: [1, 4], offset: [1, 4] },
					{ pitch: 64, duration: [1, 4], offset: [1, 2] }
				],
				harmony: [
					seg('D', 'min7', [0, 1], [1, 4]),
					seg('G', '7', [1, 2], [1, 4]),
					seg('C', 'maj7', [3, 4], [3, 4])
				]
			})
		]
	});
}

const HDR =
	'X:1\nT:Test Tune\nM:4/4\nL:1/8\n%%partsbox 1\n%%measurenb 0\n%%stretchlast 0\n%%score (M H)\nK:C\nV:M\nV:H stem=down\n';

describe('tuneToAbc — golden guard (byte-identical output)', () => {
	// These pins capture the EXACT current output; they must hold before AND
	// after the anchor-emission restructure — that byte-identity is the point.
	it('simple 2-bar sheet', () => {
		// Partial rest is visible in M; H is spacer-only and cuts only at
		// chord events (one full-bar spacer under CΔ7).
		expect(tuneToAbc(simpleSheet())).toBe(
			HDR + 'P:A\n[V:M]C8 | D4 z4 |]\n[V:H]"D-7"x4 "G7"x4 | "CΔ7"x8 |\n'
		);
	});

	it('multi-system 8-bar sheet', () => {
		// Force 4 bars/line so the golden doesn't depend on density auto-pick.
		expect(tuneToAbc(multiSystemSheet(), undefined, BPL4)).toBe(
			HDR +
				'P:A\n[V:M]C8 | C8 | C8 | C8 |\n[V:H]x8 | x8 | x8 | x8 |\n' +
				'[V:M]C8 | C8 | C8 | C8 |]\n[V:H]x8 | x8 | x8 | x8 |\n'
		);
	});

	it('repeats + numbered endings sheet', () => {
		// Empty bars engrave as beat-aligned rhythm slashes; H uses x (not z).
		// [2] has no pad measures — post-render indent aligns it under [1].
		const slash = '!style=rhythm!z2 !style=rhythm!z2 !style=rhythm!z2 !style=rhythm!z2';
		expect(tuneToAbc(repeatsSheet(), undefined, BPL4)).toBe(
			HDR +
				`P:A\n[V:M]|:${slash} | ${slash} | [1${slash} :|\n[V:H]"CΔ7"x8 | x8 | "G7"x8 |\n` +
				`[V:M][2${slash} ||\n[V:H]"CΔ7"x8 |\n` +
				`P:B\n[V:M]${slash} | ${slash} |]\n[V:H]"FΔ7"x8 | x8 |\n`
		);
	});

	it('3/4 sheet', () => {
		// Second bar is melody-silent → three beat-aligned slashes; H uses x.
		const slash34 = '!style=rhythm!z2 !style=rhythm!z2 !style=rhythm!z2';
		const hdr34 =
			'X:1\nT:Test Tune\nM:3/4\nL:1/8\n%%partsbox 1\n%%measurenb 0\n%%stretchlast 0\n%%score (M H)\nK:C\nV:M\nV:H stem=down\n';
		expect(tuneToAbc(threeFourSheet())).toBe(
			hdr34 + `P:A\n[V:M]C2 D2 E2 | ${slash34} |]\n[V:H]"D-7"x4 "G7"x2 | "CΔ7"x24/4 |\n`
		);
	});
});

describe('tuneToAbcWithMap — bar anchors', () => {
	it('emits one anchor per bar whose slice runs through its closing barline', () => {
		const { abc, barAnchors } = tuneToAbcWithMap(simpleSheet());
		expect(barAnchors).toHaveLength(2);
		expect(barAnchors.map((b) => [b.sectionIdx, b.bar])).toEqual([
			[0, 0],
			[0, 1]
		]);
		expect(abc.slice(barAnchors[0].startChar, barAnchors[0].endChar)).toBe('C8 |');
		expect(abc.slice(barAnchors[1].startChar, barAnchors[1].endChar)).toBe('D4 z4 |]');
	});

	it('resolves bar anchors across a system break without capturing the chord flush', () => {
		const { abc, barAnchors } = tuneToAbcWithMap(multiSystemSheet(), undefined, BPL4);
		expect(barAnchors).toHaveLength(8);
		expect(barAnchors.map((b) => b.bar)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		for (const b of barAnchors) {
			const slice = abc.slice(b.startChar, b.endChar);
			expect(slice).not.toContain('[V:H]');
			expect(slice).not.toContain('\n');
		}
		// Bar 4 opens the second system; its span still resolves to the melody.
		expect(abc.slice(barAnchors[4].startChar, barAnchors[4].endChar)).toBe('C8 |');
		expect(abc.slice(barAnchors[7].startChar, barAnchors[7].endChar)).toBe('C8 |]');
	});

	it('starts repeat/ending bar spans after the |: and [n decorations', () => {
		const { abc, barAnchors } = tuneToAbcWithMap(repeatsSheet(), undefined, BPL4);
		expect(barAnchors.map((b) => [b.sectionIdx, b.bar])).toEqual([
			[0, 0],
			[0, 1],
			[1, 0],
			[2, 0],
			[3, 0],
			[3, 1]
		]);
		const slash = '!style=rhythm!z2 !style=rhythm!z2 !style=rhythm!z2 !style=rhythm!z2';
		const s00 = abc.slice(barAnchors[0].startChar, barAnchors[0].endChar);
		expect(s00).toBe(`${slash} |`); // opens after |:, not '|:…'
		const ending1 = abc.slice(barAnchors[2].startChar, barAnchors[2].endChar);
		expect(ending1).toBe(`${slash} :|`); // opens after [1
		const ending2 = abc.slice(barAnchors[3].startChar, barAnchors[3].endChar);
		// [2] system has no pad measures — bar 0 is the real ending bar only.
		expect(ending2).toBe(`${slash} ||`);
	});

	it('emits an anchor for every bar including empty and pickup bars', () => {
		const { barAnchors } = tuneToAbcWithMap(
			sheet({
				sections: [
					// 1-bar pickup: rest then a short note, all in bar 0.
					section({ label: '', bars: 1, notes: [{ pitch: 55, duration: [1, 4], offset: [3, 4] }] }),
					// melody-less section: two empty bars.
					section({ label: 'A', bars: 2, notes: [], harmony: [] })
				]
			})
		);
		expect(barAnchors.map((b) => [b.sectionIdx, b.bar])).toEqual([
			[0, 0],
			[1, 0],
			[1, 1]
		]);
	});
});

describe('tuneToAbcWithMap — chord-slot anchors', () => {
	it('emits one anchor per H-voice segment with beat + display text', () => {
		const { abc, chordSlotAnchors } = tuneToAbcWithMap(simpleSheet());
		// H cuts only at chord events — no phantom null slot for the partial rest.
		expect(chordSlotAnchors.map((c) => [c.sectionIdx, c.bar, c.beat, c.chord])).toEqual([
			[0, 0, 0, 'D-7'],
			[0, 0, 2, 'G7'],
			[0, 1, 0, 'CΔ7']
		]);
		expect(abc.slice(chordSlotAnchors[0].startChar, chordSlotAnchors[0].endChar)).toBe('"D-7"x4');
		expect(abc.slice(chordSlotAnchors[1].startChar, chordSlotAnchors[1].endChar)).toBe('"G7"x4');
		expect(abc.slice(chordSlotAnchors[2].startChar, chordSlotAnchors[2].endChar)).toBe('"CΔ7"x8');
	});

	it('scales chord-slot beats with a non-4/4 meter', () => {
		const { chordSlotAnchors } = tuneToAbcWithMap(threeFourSheet());
		// A 3/4 bar has three beats (0,1,2); the G7 lands on the last beat.
		expect(chordSlotAnchors.map((c) => [c.bar, c.beat, c.chord])).toEqual([
			[0, 0, 'D-7'],
			[0, 2, 'G7'],
			[1, 0, 'CΔ7']
		]);
	});

	it('reports a fractional beat for an off-beat chord', () => {
		const { chordSlotAnchors } = tuneToAbcWithMap(
			sheet({
				sections: [
					// Chord at offset 3/8 → beat 1.5 in 4/4.
					section({ bars: 1, harmony: [seg('G', '7', [3, 8], [5, 8])] })
				]
			})
		);
		const g7 = chordSlotAnchors.find((c) => c.chord === 'G7');
		expect(g7).toBeDefined();
		expect(g7!.beat).toBe(1.5);
	});
});

describe('tuneToAbc — articulations', () => {
	it('emits ABC decorations for accent and staccato', () => {
		const abc = tuneToAbc(
			sheet({
				sections: [
					section({
						bars: 1,
						notes: [
							{ pitch: 60, duration: [1, 4], offset: [0, 1], articulation: 'accent' },
							{ pitch: 62, duration: [1, 4], offset: [1, 4], articulation: 'staccato' },
							{ pitch: 64, duration: [1, 2], offset: [1, 2] }
						],
						harmony: [seg('C', 'maj7', [0, 1], [1, 1])]
					})
				]
			})
		);
		expect(abc).toContain('!>!C2');
		expect(abc).toContain('.D2');
	});
});

describe('tuneToAbcWithMap — note offsets', () => {
	it('records each pitched note absolute whole-note offset across sections', () => {
		const { noteAnchors } = tuneToAbcWithMap(
			sheet({
				sections: [
					section({
						bars: 2,
						notes: [
							{ pitch: 60, duration: [1, 1], offset: [0, 1] },
							{ pitch: 62, duration: [1, 2], offset: [1, 1] }
						]
					}),
					section({ label: 'B', bars: 1, notes: [{ pitch: 64, duration: [1, 1], offset: [0, 1] }] })
				]
			})
		);
		expect(noteAnchors.map((a) => a.offset)).toEqual([0, 1, 2]);
	});
});
