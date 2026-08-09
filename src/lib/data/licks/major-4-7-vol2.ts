/**
 * Major 4th & 7th licks, volume 2 — 40 curated lines, most at difficulty 18-30.
 *
 * Fills the intermediate major-scale band (the original collection's diatonic
 * content tops out at 20, and the next major-facing curated content starts in
 * the 30s). Every lick features the 4th (F in concert C) and/or the 7th (B),
 * and the collection as a whole uses all seven scale degrees.
 *
 * The 18-30 band was originally applied to ALL 40 lines, including 15- to
 * 21-note ones: the ratings scored harmony but not length, and length is its
 * own memory load in play-by-ear. The long lines now sit at the `maxNotes`
 * floor for their tier (up to level 53) per the calibration guard; the short
 * ones are unchanged and still carry the intermediate band.
 *
 * STRICTLY DIATONIC by design: levels 18-30 sit in content tiers 3-4
 * ("Swing 8ths" / "Diatonic Lines" in difficulty/params.ts) — chromaticism is
 * not introduced until tier 5 (level 31+), and the calibration guard
 * (tests/unit/data/difficulty-calibration.test.ts) enforces that for
 * progression licks. Jazz character comes from vocabulary shape and rhythm:
 * guide tones, digital patterns, diatonic seventh-chord arpeggios (Bm7b5 over
 * G7 = the 3-to-9 sound), quartal cells, syncopation, anticipation, hemiola,
 * rhythmic displacement.
 *
 * Two harmonic frames, matching major-4-7.ts:
 *  - SINGLE-CHORD MAJOR (`scaleId: 'major.ionian'`): snapped at runtime; kept
 *    strictly diatonic so nothing is altered by the snap.
 *  - ii-V-I MAJOR (`category: 'ii-V-I-major'`, Dm7→G7→Cmaj7): un-snapped at
 *    runtime, so these are kept strictly diatonic on purpose.
 *
 * Concert C. Reference (main octave): 1=C4(60) 2=D4(62) 3=E4(64) 4=F4(65)
 * 5=G4(67) 6=A4(69) 7=B4(71) 8=C5(72) 9=D5(74) 10=E5(76) 11=F5(77).
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

/* ── Harmony blocks ──────────────────────────────────────────────── */

const CMAJ_1BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }
];

const CMAJ_2BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [2, 1] }
];

/** Dm7 (bar 1) → G7 (bar 2) → Cmaj7 (bar 3). */
const II_V_I: HarmonicSegment[] = [
	{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 1] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 1], duration: [1, 1] },
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [2, 1], duration: [1, 1] }
];

/* ================================================================
 *  SINGLE-CHORD MAJOR (Cmaj7 / Ionian) — strictly diatonic.
 * ================================================================ */

const SINGLE_CHORD_LICKS: Phrase[] = [
	{
		id: 'm47v2-001',
		name: 'Cascading Thirds from the Seventh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 71, duration: [1, 8], offset: [0, 1] }, // B4 (7) — thirds fall in pairs
			{ pitch: 67, duration: [1, 8], offset: [1, 8] }, // G4 (5)
			{ pitch: 69, duration: [1, 8], offset: [1, 4] }, // A4 (6)
			{ pitch: 65, duration: [1, 8], offset: [3, 8] }, // F4 (4)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] }, // G4 (5)
			{ pitch: 64, duration: [1, 8], offset: [5, 8] }, // E4 (3)
			{ pitch: 65, duration: [1, 8], offset: [3, 4] }, // F4 (4)
			{ pitch: 62, duration: [1, 8], offset: [7, 8] }, // D4 (2)
			{ pitch: 64, duration: [1, 1], offset: [1, 1] }  // E4 (3) — settle
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 18, pitchComplexity: 17, rhythmComplexity: 13, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['major', '4th', '7th', 'thirds', 'descending'],
		source: 'curated'
	},
	{
		id: 'm47v2-002',
		name: 'Question on the Seventh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] }, // E4 (3) — question rises...
			{ pitch: 67, duration: [1, 4], offset: [1, 4] }, // G4 (5)
			{ pitch: 71, duration: [1, 2], offset: [1, 2] }, // B4 (7) — ...and hangs
			{ pitch: 65, duration: [1, 4], offset: [1, 1] }, // F4 (4) — answer walks home
			{ pitch: 64, duration: [1, 4], offset: [5, 4] }, // E4 (3)
			{ pitch: 62, duration: [1, 4], offset: [3, 2] }, // D4 (2)
			{ pitch: 60, duration: [1, 4], offset: [7, 4] }  // C4 (1)
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 18, pitchComplexity: 14, rhythmComplexity: 11, lengthBars: 2 },
		category: 'major-chord',
		tags: ['major', '4th', '7th', 'call-response'],
		source: 'curated'
	},
	{
		id: 'm47v2-003',
		name: 'Fourths Up the Scale',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] }, // C4 (1) — diatonic fourths climb
			{ pitch: 65, duration: [1, 8], offset: [1, 8] }, // F4 (4)
			{ pitch: 62, duration: [1, 8], offset: [1, 4] }, // D4 (2)
			{ pitch: 67, duration: [1, 8], offset: [3, 8] }, // G4 (5)
			{ pitch: 64, duration: [1, 8], offset: [1, 2] }, // E4 (3)
			{ pitch: 69, duration: [1, 8], offset: [5, 8] }, // A4 (6)
			{ pitch: 65, duration: [1, 8], offset: [3, 4] }, // F4 (4)
			{ pitch: 71, duration: [1, 8], offset: [7, 8] }  // B4 (7) — the lydian-bright top
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 19, pitchComplexity: 18, rhythmComplexity: 13, lengthBars: 1 },
		category: 'digital-patterns',
		tags: ['major', '4th', '7th', 'fourths', 'sequence'],
		source: 'curated'
	},
	{
		id: 'm47v2-004',
		name: 'Tendency Tones with Escape',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] }, // F4 (4) — 4 escapes up...
			{ pitch: 67, duration: [1, 8], offset: [1, 8] }, // G4 (5)
			{ pitch: 64, duration: [1, 4], offset: [1, 4] }, // E4 (3) — ...then resolves
			{ pitch: 71, duration: [1, 8], offset: [1, 2] }, // B4 (7) — 7 steps away...
			{ pitch: 69, duration: [1, 8], offset: [5, 8] }, // A4 (6)
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }  // C5 (8) — ...then leaps home
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 19, pitchComplexity: 15, rhythmComplexity: 12, lengthBars: 1 },
		category: 'major-chord',
		tags: ['major', '4th', '7th', 'resolution', 'escape-tone'],
		source: 'curated'
	},
	{
		id: 'm47v2-005',
		name: 'Turn Around the Seventh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] }, // C5 (8) — turn figure on 7
			{ pitch: 71, duration: [1, 8], offset: [1, 8] }, // B4 (7)
			{ pitch: 69, duration: [1, 8], offset: [1, 4] }, // A4 (6)
			{ pitch: 71, duration: [1, 8], offset: [3, 8] }, // B4 (7)
			{ pitch: 74, duration: [1, 4], offset: [1, 2] }, // D5 (9) — lift
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }  // C5 (8) — land
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 20, pitchComplexity: 17, rhythmComplexity: 14, lengthBars: 1 },
		category: 'bebop-lines',
		tags: ['major', '7th', 'turn', 'ornament'],
		source: 'curated'
	},
	{
		id: 'm47v2-006',
		name: 'Scale the Full Octave and Back',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] }, // C4 (1) — every degree up...
			{ pitch: 62, duration: [1, 8], offset: [1, 8] }, // D4 (2)
			{ pitch: 64, duration: [1, 8], offset: [1, 4] }, // E4 (3)
			{ pitch: 65, duration: [1, 8], offset: [3, 8] }, // F4 (4)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] }, // G4 (5)
			{ pitch: 69, duration: [1, 8], offset: [5, 8] }, // A4 (6)
			{ pitch: 71, duration: [1, 8], offset: [3, 4] }, // B4 (7)
			{ pitch: 72, duration: [1, 8], offset: [7, 8] }, // C5 (8)
			{ pitch: 71, duration: [1, 8], offset: [1, 1] }, // B4 (7) — ...and back down
			{ pitch: 69, duration: [1, 8], offset: [9, 8] }, // A4 (6)
			{ pitch: 67, duration: [1, 8], offset: [5, 4] }, // G4 (5)
			{ pitch: 65, duration: [1, 8], offset: [11, 8] }, // F4 (4)
			{ pitch: 64, duration: [1, 8], offset: [3, 2] }, // E4 (3)
			{ pitch: 62, duration: [1, 8], offset: [13, 8] }, // D4 (2)
			{ pitch: 60, duration: [1, 4], offset: [7, 4] }  // C4 (1)
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 41, pitchComplexity: 41, rhythmComplexity: 16, lengthBars: 2 },
		category: 'major-chord',
		tags: ['major', '4th', '7th', 'scale', 'full-octave'],
		source: 'curated'
	},
	{
		id: 'm47v2-007',
		name: 'Charleston on Top',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [3, 8], offset: [0, 1] }, // G4 (5) — Charleston hit 1
			{ pitch: 71, duration: [1, 8], offset: [3, 8] }, // B4 (7) — and-of-two
			{ pitch: 69, duration: [1, 4], offset: [3, 4] }, // A4 (6) — pickup into bar 2
			{ pitch: 65, duration: [3, 8], offset: [1, 1] }, // F4 (4) — Charleston again
			{ pitch: 64, duration: [1, 8], offset: [11, 8] }, // E4 (3)
			{ pitch: 62, duration: [1, 4], offset: [3, 2] }, // D4 (2)
			{ pitch: 60, duration: [1, 4], offset: [7, 4] }  // C4 (1)
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 21, pitchComplexity: 14, rhythmComplexity: 21, lengthBars: 2 },
		category: 'major-chord',
		tags: ['major', '4th', '7th', 'charleston', 'syncopation'],
		source: 'curated'
	},
	{
		id: 'm47v2-008',
		name: 'Extensions off the Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] }, // E4 (3) — Em7 arp = 3-5-7-9
			{ pitch: 67, duration: [1, 8], offset: [1, 8] }, // G4 (5)
			{ pitch: 71, duration: [1, 8], offset: [1, 4] }, // B4 (7)
			{ pitch: 74, duration: [1, 8], offset: [3, 8] }, // D5 (9)
			{ pitch: 72, duration: [1, 8], offset: [1, 2] }, // C5 (8) — step back down
			{ pitch: 71, duration: [1, 8], offset: [5, 8] }, // B4 (7)
			{ pitch: 69, duration: [1, 8], offset: [3, 4] }, // A4 (6)
			{ pitch: 67, duration: [1, 8], offset: [7, 8] }  // G4 (5)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 21, pitchComplexity: 19, rhythmComplexity: 14, lengthBars: 1 },
		category: 'bebop-lines',
		tags: ['major', '7th', 'arpeggio', 'extensions'],
		source: 'curated'
	},
	{
		id: 'm47v2-009',
		name: 'Offbeat Ladder',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [1, 8] }, // C4 (1) — every note on an "and"
			{ pitch: 62, duration: [1, 8], offset: [3, 8] }, // D4 (2)
			{ pitch: 64, duration: [1, 8], offset: [5, 8] }, // E4 (3)
			{ pitch: 65, duration: [1, 8], offset: [7, 8] }, // F4 (4)
			{ pitch: 67, duration: [1, 8], offset: [9, 8] }, // G4 (5)
			{ pitch: 69, duration: [1, 8], offset: [11, 8] }, // A4 (6)
			{ pitch: 71, duration: [1, 8], offset: [13, 8] }, // B4 (7)
			{ pitch: 72, duration: [1, 8], offset: [15, 8] }  // C5 (8)
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 22, pitchComplexity: 13, rhythmComplexity: 24, lengthBars: 2 },
		category: 'digital-patterns',
		tags: ['major', '4th', '7th', 'syncopation', 'offbeats'],
		source: 'curated'
	},
	{
		id: 'm47v2-010',
		name: 'Fmaj7 Over the Tonic',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] }, // F4 (4) — Fmaj7 arp = 4-6-8-10
			{ pitch: 69, duration: [1, 8], offset: [1, 8] }, // A4 (6)
			{ pitch: 72, duration: [1, 8], offset: [1, 4] }, // C5 (8)
			{ pitch: 76, duration: [1, 8], offset: [3, 8] }, // E5 (10)
			{ pitch: 74, duration: [1, 4], offset: [1, 2] }, // D5 (9) — step off the top
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }  // C5 (8)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 22, pitchComplexity: 20, rhythmComplexity: 13, lengthBars: 1 },
		category: 'major-chord',
		tags: ['major', '4th', 'arpeggio', 'color'],
		source: 'curated'
	},
	{
		id: 'm47v2-011',
		name: 'Sixes and Sevens',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] }, // E4 (3) — leap a sixth...
			{ pitch: 72, duration: [1, 8], offset: [1, 8] }, // C5 (8)
			{ pitch: 71, duration: [1, 4], offset: [1, 4] }, // B4 (7) — ...resolve by step
			{ pitch: 65, duration: [1, 8], offset: [1, 2] }, // F4 (4)
			{ pitch: 74, duration: [1, 8], offset: [5, 8] }, // D5 (9)
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }, // C5 (8)
			{ pitch: 67, duration: [1, 8], offset: [1, 1] }, // G4 (5)
			{ pitch: 76, duration: [1, 8], offset: [9, 8] }, // E5 (10)
			{ pitch: 74, duration: [1, 4], offset: [5, 4] }, // D5 (9)
			{ pitch: 72, duration: [1, 2], offset: [3, 2] }  // C5 (8) — settle
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 23, pitchComplexity: 22, rhythmComplexity: 16, lengthBars: 2 },
		category: 'digital-patterns',
		tags: ['major', '4th', '7th', 'sixths', 'intervals'],
		source: 'curated'
	},
	{
		id: 'm47v2-012',
		name: 'Pedal Point Bounce',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] }, // G4 (5) — pedal...
			{ pitch: 60, duration: [1, 8], offset: [1, 8] }, // C4 (1)
			{ pitch: 67, duration: [1, 8], offset: [1, 4] }, // G4 (5)
			{ pitch: 62, duration: [1, 8], offset: [3, 8] }, // D4 (2)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] }, // G4 (5)
			{ pitch: 64, duration: [1, 8], offset: [5, 8] }, // E4 (3)
			{ pitch: 67, duration: [1, 8], offset: [3, 4] }, // G4 (5)
			{ pitch: 65, duration: [1, 8], offset: [7, 8] }, // F4 (4) — ...against a climb
			{ pitch: 69, duration: [1, 8], offset: [1, 1] }, // A4 (6)
			{ pitch: 71, duration: [1, 8], offset: [9, 8] }, // B4 (7)
			{ pitch: 72, duration: [3, 4], offset: [5, 4] }  // C5 (8) — arrival
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 24, pitchComplexity: 17, rhythmComplexity: 19, lengthBars: 2 },
		category: 'digital-patterns',
		tags: ['major', '4th', '7th', 'pedal-point'],
		source: 'curated'
	},
	{
		id: 'm47v2-013',
		name: 'Broken Sixths Descending',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 76, duration: [1, 8], offset: [0, 1] }, // E5 (10) — sixths in pairs
			{ pitch: 67, duration: [1, 8], offset: [1, 8] }, // G4 (5)
			{ pitch: 74, duration: [1, 8], offset: [1, 4] }, // D5 (9)
			{ pitch: 65, duration: [1, 8], offset: [3, 8] }, // F4 (4)
			{ pitch: 72, duration: [1, 8], offset: [1, 2] }, // C5 (8)
			{ pitch: 64, duration: [1, 8], offset: [5, 8] }, // E4 (3)
			{ pitch: 71, duration: [1, 8], offset: [3, 4] }, // B4 (7)
			{ pitch: 62, duration: [1, 8], offset: [7, 8] }, // D4 (2)
			{ pitch: 64, duration: [1, 1], offset: [1, 1] }  // E4 (3) — settle on the third
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 25, pitchComplexity: 24, rhythmComplexity: 15, lengthBars: 2 },
		category: 'digital-patterns',
		tags: ['major', '4th', '7th', 'sixths', 'intervals', 'descending'],
		source: 'curated'
	},
	{
		id: 'm47v2-014',
		name: 'Half-Diminished Pivot',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 59, duration: [1, 8], offset: [0, 1] }, // B3 (7) — Bm7b5 arp up
			{ pitch: 62, duration: [1, 8], offset: [1, 8] }, // D4 (2)
			{ pitch: 65, duration: [1, 8], offset: [1, 4] }, // F4 (4)
			{ pitch: 69, duration: [1, 8], offset: [3, 8] }, // A4 (6)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] }, // G4 (5) — scale back down
			{ pitch: 65, duration: [1, 8], offset: [5, 8] }, // F4 (4)
			{ pitch: 64, duration: [1, 8], offset: [3, 4] }, // E4 (3)
			{ pitch: 62, duration: [1, 8], offset: [7, 8] }, // D4 (2)
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }  // C4 (1) — home
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 26, pitchComplexity: 24, rhythmComplexity: 15, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['major', '4th', '7th', 'arpeggio', 'half-diminished'],
		source: 'curated'
	},
	{
		id: 'm47v2-015',
		name: 'Displaced Motif',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] }, // C5 — 3-note motif...
			{ pitch: 71, duration: [1, 8], offset: [1, 8] }, // B4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] }, // G4
			{ pitch: 72, duration: [1, 8], offset: [3, 8] }, // C5 — ...shifted an 8th early
			{ pitch: 71, duration: [1, 8], offset: [1, 2] }, // B4
			{ pitch: 67, duration: [1, 8], offset: [5, 8] }, // G4
			{ pitch: 72, duration: [1, 8], offset: [3, 4] }, // C5 — crosses the barline
			{ pitch: 71, duration: [1, 8], offset: [7, 8] }, // B4
			{ pitch: 67, duration: [1, 8], offset: [1, 1] }, // G4
			{ pitch: 72, duration: [1, 8], offset: [9, 8] }, // C5
			{ pitch: 71, duration: [1, 8], offset: [5, 4] }, // B4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] }, // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] }, // F4 (4) — release
			{ pitch: 64, duration: [1, 4], offset: [7, 4] }  // E4 (3)
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 41, pitchComplexity: 41, rhythmComplexity: 27, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['major', '4th', '7th', 'displacement', 'motif', 'cross-rhythm'],
		source: 'curated'
	},
	{
		id: 'm47v2-016',
		name: 'Stacked Thirds to the Eleventh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] }, // C4 (1) — thirds stack up
			{ pitch: 64, duration: [1, 8], offset: [1, 8] }, // E4 (3)
			{ pitch: 67, duration: [1, 8], offset: [1, 4] }, // G4 (5)
			{ pitch: 71, duration: [1, 8], offset: [3, 8] }, // B4 (7)
			{ pitch: 74, duration: [1, 8], offset: [1, 2] }, // D5 (9)
			{ pitch: 77, duration: [1, 8], offset: [5, 8] }, // F5 (11) — the top of the stack
			{ pitch: 76, duration: [1, 4], offset: [3, 4] }, // E5 (10) — step off
			{ pitch: 74, duration: [1, 4], offset: [1, 1] }, // D5 (9)
			{ pitch: 71, duration: [1, 4], offset: [5, 4] }, // B4 (7)
			{ pitch: 72, duration: [1, 2], offset: [3, 2] }  // C5 (8) — resolve
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 28, pitchComplexity: 27, rhythmComplexity: 16, lengthBars: 2 },
		category: 'major-chord',
		tags: ['major', '4th', '7th', 'arpeggio', 'extensions'],
		source: 'curated'
	},
	{
		id: 'm47v2-017',
		name: 'Hemiola Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 71, duration: [3, 8], offset: [0, 1] }, // B4 (7) — dotted quarters...
			{ pitch: 69, duration: [3, 8], offset: [3, 8] }, // A4 (6) — ...three against four
			{ pitch: 67, duration: [3, 8], offset: [3, 4] }, // G4 (5)
			{ pitch: 65, duration: [3, 8], offset: [9, 8] }, // F4 (4)
			{ pitch: 64, duration: [1, 4], offset: [3, 2] }, // E4 (3) — realign
			{ pitch: 62, duration: [1, 8], offset: [7, 4] }, // D4 (2)
			{ pitch: 60, duration: [1, 8], offset: [15, 8] }  // C4 (1)
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 29, pitchComplexity: 15, rhythmComplexity: 30, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['major', '4th', '7th', 'hemiola', 'cross-rhythm'],
		source: 'curated'
	},
	{
		id: 'm47v2-018',
		name: 'Interval Widening',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 71, duration: [1, 8], offset: [0, 1] }, // B4 — a second below C5...
			{ pitch: 72, duration: [1, 8], offset: [1, 8] }, // C5
			{ pitch: 69, duration: [1, 8], offset: [1, 4] }, // A4 — a third below
			{ pitch: 72, duration: [1, 8], offset: [3, 8] }, // C5
			{ pitch: 67, duration: [1, 8], offset: [1, 2] }, // G4 — a fourth below
			{ pitch: 72, duration: [1, 8], offset: [5, 8] }, // C5
			{ pitch: 65, duration: [1, 8], offset: [3, 4] }, // F4 — a fifth below
			{ pitch: 72, duration: [1, 8], offset: [7, 8] }, // C5
			{ pitch: 64, duration: [1, 8], offset: [1, 1] }, // E4 — a sixth below
			{ pitch: 72, duration: [1, 8], offset: [9, 8] }, // C5
			{ pitch: 62, duration: [1, 4], offset: [5, 4] }, // D4 — then settle by step
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }  // C4 — home
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 31, pitchComplexity: 31, rhythmComplexity: 18, lengthBars: 2 },
		category: 'digital-patterns',
		tags: ['major', '4th', '7th', 'intervals', 'pedal-point'],
		source: 'curated'
	}
];

/* ================================================================
 *  ii-V-I MAJOR (Dm7 → G7 → Cmaj7) — strictly diatonic on purpose.
 *  4th (F) = b3 of Dm7 / b7 of G7; 7th (B) = 3rd of G7 / maj7 of I.
 * ================================================================ */

const II_V_I_LICKS: Phrase[] = [
	{
		id: 'm47v2-019',
		name: 'Guide-Tone Pendulum',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] }, // F4 — b3 of Dm7
			{ pitch: 72, duration: [1, 4], offset: [1, 4] }, // C5 — b7 of Dm7
			{ pitch: 65, duration: [1, 4], offset: [1, 2] }, // F4 — swing between them
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }, // C5
			{ pitch: 71, duration: [1, 4], offset: [1, 1] }, // B4 — 3 of G7
			{ pitch: 65, duration: [1, 4], offset: [5, 4] }, // F4 — b7 of G7
			{ pitch: 71, duration: [1, 4], offset: [3, 2] }, // B4
			{ pitch: 65, duration: [1, 4], offset: [7, 4] }, // F4
			{ pitch: 71, duration: [1, 4], offset: [2, 1] }, // B4 — maj7 of Cmaj7...
			{ pitch: 72, duration: [3, 4], offset: [9, 4] }  // C5 — ...resolves up
		],
		harmony: II_V_I,
		difficulty: { level: 21, pitchComplexity: 21, rhythmComplexity: 11, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'guide-tones'],
		source: 'curated'
	},
	{
		id: 'm47v2-020',
		name: 'Digital Cells Through the Changes',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] }, // D4 — Dm7: 1-2-b3-5
			{ pitch: 64, duration: [1, 4], offset: [1, 4] }, // E4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] }, // F4
			{ pitch: 69, duration: [1, 4], offset: [3, 4] }, // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 1] }, // G4 — G7: 1-2-3-5
			{ pitch: 69, duration: [1, 4], offset: [5, 4] }, // A4
			{ pitch: 71, duration: [1, 4], offset: [3, 2] }, // B4
			{ pitch: 74, duration: [1, 4], offset: [7, 4] }, // D5
			{ pitch: 72, duration: [1, 1], offset: [2, 1] }  // C5 — land the root
		],
		harmony: II_V_I,
		difficulty: { level: 19, pitchComplexity: 15, rhythmComplexity: 11, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'digital-pattern'],
		source: 'curated'
	},
	{
		id: 'm47v2-021',
		name: 'Over the Top',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] }, // D4 — dorian octave up
			{ pitch: 64, duration: [1, 8], offset: [1, 8] }, // E4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] }, // F4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] }, // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 2] }, // A4
			{ pitch: 71, duration: [1, 8], offset: [5, 8] }, // B4 — dorian 6
			{ pitch: 72, duration: [1, 8], offset: [3, 4] }, // C5
			{ pitch: 74, duration: [1, 8], offset: [7, 8] }, // D5
			{ pitch: 76, duration: [1, 8], offset: [1, 1] }, // E5 — over the top (13 of G7)
			{ pitch: 74, duration: [1, 8], offset: [9, 8] }, // D5 — mixolydian down
			{ pitch: 72, duration: [1, 8], offset: [5, 4] }, // C5
			{ pitch: 71, duration: [1, 8], offset: [11, 8] }, // B4 — 3 of G7
			{ pitch: 69, duration: [1, 8], offset: [3, 2] }, // A4
			{ pitch: 67, duration: [1, 8], offset: [13, 8] }, // G4
			{ pitch: 65, duration: [1, 8], offset: [7, 4] }, // F4 — b7 of G7
			{ pitch: 62, duration: [1, 8], offset: [15, 8] }, // D4
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }  // E4 — 3 of Cmaj7
		],
		harmony: II_V_I,
		difficulty: { level: 42, pitchComplexity: 42, rhythmComplexity: 16, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'scale', 'run'],
		source: 'curated'
	},
	{
		id: 'm47v2-022',
		name: 'Arpeggios in Inversion',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] }, // F4 — Dm7 from the 3rd
			{ pitch: 69, duration: [1, 4], offset: [1, 4] }, // A4
			{ pitch: 72, duration: [1, 4], offset: [1, 2] }, // C5
			{ pitch: 74, duration: [1, 4], offset: [3, 4] }, // D5
			{ pitch: 71, duration: [1, 4], offset: [1, 1] }, // B4 — G7 down from the 3rd
			{ pitch: 67, duration: [1, 4], offset: [5, 4] }, // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] }, // F4 — b7
			{ pitch: 62, duration: [1, 4], offset: [7, 4] }, // D4 — 5
			{ pitch: 60, duration: [1, 2], offset: [2, 1] }, // C4 — root...
			{ pitch: 64, duration: [1, 2], offset: [5, 2] }  // E4 — ...then the 3rd
		],
		harmony: II_V_I,
		difficulty: { level: 22, pitchComplexity: 22, rhythmComplexity: 11, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'arpeggio', 'inversion'],
		source: 'curated'
	},
	{
		id: 'm47v2-023',
		name: 'Anticipation Setup',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] }, // D4 — Dm7 climb
			{ pitch: 65, duration: [1, 4], offset: [1, 4] }, // F4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] }, // A4
			{ pitch: 71, duration: [1, 8], offset: [7, 8] }, // B4 — G7's 3rd, an 8th early
			{ pitch: 74, duration: [1, 4], offset: [1, 1] }, // D5
			{ pitch: 71, duration: [1, 4], offset: [5, 4] }, // B4
			{ pitch: 67, duration: [1, 4], offset: [3, 2] }, // G4
			{ pitch: 64, duration: [1, 8], offset: [15, 8] }, // E4 — Cmaj7's 3rd, early too
			{ pitch: 72, duration: [3, 4], offset: [2, 1] }  // C5 — arrival
		],
		harmony: II_V_I,
		difficulty: { level: 21, pitchComplexity: 15, rhythmComplexity: 22, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'anticipation', 'syncopation'],
		source: 'curated'
	},
	{
		id: 'm47v2-024',
		name: 'Ask and Answer',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] }, // D4 — the question...
			{ pitch: 65, duration: [1, 8], offset: [1, 8] }, // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] }, // G4
			{ pitch: 69, duration: [1, 8], offset: [3, 8] }, // A4
			{ pitch: 72, duration: [1, 4], offset: [1, 2] }, // C5
			{ pitch: 69, duration: [1, 4], offset: [3, 4] }, // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 1] }, // G4
			{ pitch: 69, duration: [1, 8], offset: [9, 8] }, // A4
			{ pitch: 71, duration: [1, 2], offset: [5, 4] }, // B4 — ...hangs on the key's 7th (3 of G7)
			{ pitch: 72, duration: [1, 4], offset: [2, 1] }, // C5 — the answer comes home
			{ pitch: 67, duration: [1, 4], offset: [9, 4] }, // G4
			{ pitch: 64, duration: [1, 4], offset: [5, 2] }, // E4
			{ pitch: 60, duration: [1, 4], offset: [11, 4] }  // C4
		],
		harmony: II_V_I,
		difficulty: { level: 31, pitchComplexity: 31, rhythmComplexity: 16, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'call-response'],
		source: 'curated'
	},
	{
		id: 'm47v2-025',
		name: 'Melodic Turn on Each Chord',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] }, // G4 — turn around F (b3 of Dm7)
			{ pitch: 65, duration: [1, 8], offset: [1, 8] }, // F4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] }, // E4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] }, // F4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] }, // A4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }, // C5
			{ pitch: 72, duration: [1, 8], offset: [1, 1] }, // C5 — turn around B (3 of G7)
			{ pitch: 71, duration: [1, 8], offset: [9, 8] }, // B4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] }, // A4
			{ pitch: 71, duration: [1, 8], offset: [11, 8] }, // B4
			{ pitch: 74, duration: [1, 4], offset: [3, 2] }, // D5
			{ pitch: 71, duration: [1, 4], offset: [7, 4] }, // B4
			{ pitch: 65, duration: [1, 8], offset: [2, 1] }, // F4 — turn around E (3 of C)
			{ pitch: 64, duration: [1, 8], offset: [17, 8] }, // E4
			{ pitch: 62, duration: [1, 8], offset: [9, 4] }, // D4
			{ pitch: 64, duration: [1, 8], offset: [19, 8] }, // E4
			{ pitch: 60, duration: [1, 2], offset: [5, 2] }  // C4 — resolve
		],
		harmony: II_V_I,
		difficulty: { level: 42, pitchComplexity: 42, rhythmComplexity: 19, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'turn', 'ornament'],
		source: 'curated'
	},
	{
		id: 'm47v2-026',
		name: 'Quartal Steps',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] }, // D4 — fourth-stack on D
			{ pitch: 67, duration: [1, 8], offset: [1, 8] }, // G4
			{ pitch: 72, duration: [1, 4], offset: [1, 4] }, // C5
			{ pitch: 64, duration: [1, 8], offset: [1, 2] }, // E4 — fourth-stack on E
			{ pitch: 69, duration: [1, 8], offset: [5, 8] }, // A4
			{ pitch: 74, duration: [1, 4], offset: [3, 4] }, // D5
			{ pitch: 65, duration: [1, 8], offset: [1, 1] }, // F4 — fourth-stack on F...
			{ pitch: 71, duration: [1, 8], offset: [9, 8] }, // B4 — ...with the tritone inside
			{ pitch: 76, duration: [1, 4], offset: [5, 4] }, // E5 — 13 of G7
			{ pitch: 74, duration: [1, 8], offset: [3, 2] }, // D5 — step back down
			{ pitch: 69, duration: [1, 8], offset: [13, 8] }, // A4
			{ pitch: 67, duration: [1, 4], offset: [7, 4] }, // G4
			{ pitch: 72, duration: [1, 1], offset: [2, 1] }  // C5 — settle
		],
		harmony: II_V_I,
		difficulty: { level: 31, pitchComplexity: 31, rhythmComplexity: 18, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'quartal', 'fourths'],
		source: 'curated'
	},
	{
		id: 'm47v2-027',
		name: 'Thirds Tumble',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 76, duration: [1, 8], offset: [0, 1] }, // E5 (9 of Dm7) — falling thirds
			{ pitch: 72, duration: [1, 8], offset: [1, 8] }, // C5
			{ pitch: 74, duration: [1, 8], offset: [1, 4] }, // D5
			{ pitch: 71, duration: [1, 8], offset: [3, 8] }, // B4
			{ pitch: 72, duration: [1, 8], offset: [1, 2] }, // C5
			{ pitch: 69, duration: [1, 8], offset: [5, 8] }, // A4
			{ pitch: 71, duration: [1, 8], offset: [3, 4] }, // B4
			{ pitch: 67, duration: [1, 8], offset: [7, 8] }, // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 1] }, // A4 (9 of G7) — keep tumbling
			{ pitch: 65, duration: [1, 8], offset: [9, 8] }, // F4 — b7
			{ pitch: 67, duration: [1, 8], offset: [5, 4] }, // G4
			{ pitch: 64, duration: [1, 8], offset: [11, 8] }, // E4
			{ pitch: 65, duration: [1, 8], offset: [3, 2] }, // F4
			{ pitch: 62, duration: [1, 8], offset: [13, 8] }, // D4
			{ pitch: 64, duration: [1, 8], offset: [7, 4] }, // E4
			{ pitch: 60, duration: [1, 8], offset: [15, 8] }, // C4
			{ pitch: 59, duration: [1, 4], offset: [2, 1] }, // B3 — under the tonic...
			{ pitch: 60, duration: [3, 4], offset: [9, 4] }  // C4 — ...and back up through 7
		],
		harmony: II_V_I,
		difficulty: { level: 53, pitchComplexity: 53, rhythmComplexity: 18, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'thirds', 'descending'],
		source: 'curated'
	},
	{
		id: 'm47v2-028',
		name: 'Half-Diminished Over the Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] }, // D4 — Dm7 arp up
			{ pitch: 65, duration: [1, 4], offset: [1, 4] }, // F4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] }, // A4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }, // C5
			{ pitch: 69, duration: [1, 4], offset: [1, 1] }, // A4 — Bm7b5 down = 9 of G7...
			{ pitch: 65, duration: [1, 4], offset: [5, 4] }, // F4 — b7
			{ pitch: 62, duration: [1, 4], offset: [3, 2] }, // D4 — 5
			{ pitch: 59, duration: [1, 4], offset: [7, 4] }, // B3 — 3, leaning on C
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }  // C4 — half-step resolution
		],
		harmony: II_V_I,
		difficulty: { level: 24, pitchComplexity: 19, rhythmComplexity: 12, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'arpeggio', 'half-diminished', 'extensions'],
		source: 'curated'
	},
	{
		id: 'm47v2-029',
		name: 'The Common Tone',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [3, 8], offset: [0, 1] }, // A4 — 5 of Dm7, the anchor
			{ pitch: 65, duration: [1, 8], offset: [3, 8] }, // F4
			{ pitch: 62, duration: [1, 4], offset: [1, 2] }, // D4
			{ pitch: 69, duration: [1, 4], offset: [3, 4] }, // A4
			{ pitch: 69, duration: [1, 8], offset: [1, 1] }, // A4 — now the 9 of G7
			{ pitch: 71, duration: [1, 8], offset: [9, 8] }, // B4
			{ pitch: 69, duration: [1, 4], offset: [5, 4] }, // A4
			{ pitch: 65, duration: [1, 8], offset: [3, 2] }, // F4
			{ pitch: 62, duration: [1, 8], offset: [13, 8] }, // D4
			{ pitch: 69, duration: [1, 4], offset: [7, 4] }, // A4
			{ pitch: 69, duration: [1, 4], offset: [2, 1] }, // A4 — now the 6 of Cmaj7
			{ pitch: 67, duration: [1, 4], offset: [9, 4] }, // G4 — release the anchor
			{ pitch: 64, duration: [1, 4], offset: [5, 2] }, // E4
			{ pitch: 60, duration: [1, 4], offset: [11, 4] }  // C4
		],
		harmony: II_V_I,
		difficulty: { level: 41, pitchComplexity: 41, rhythmComplexity: 22, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'common-tone', 'syncopation'],
		source: 'curated'
	},
	{
		id: 'm47v2-030',
		name: 'Dorian Six Color',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 8], offset: [0, 1] }, // A4 — lean on B, the dorian 6
			{ pitch: 71, duration: [1, 8], offset: [1, 8] }, // B4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] }, // A4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] }, // F4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] }, // E4
			{ pitch: 62, duration: [1, 4], offset: [3, 4] }, // D4
			{ pitch: 62, duration: [1, 8], offset: [1, 1] }, // D4 — G7: climb to the same B...
			{ pitch: 65, duration: [1, 8], offset: [9, 8] }, // F4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] }, // A4
			{ pitch: 71, duration: [1, 8], offset: [11, 8] }, // B4 — ...now it's the 3rd
			{ pitch: 72, duration: [1, 4], offset: [3, 2] }, // C5
			{ pitch: 71, duration: [1, 4], offset: [7, 4] }, // B4
			{ pitch: 64, duration: [1, 4], offset: [2, 1] }, // E4 — rise to rest
			{ pitch: 67, duration: [1, 4], offset: [9, 4] }, // G4
			{ pitch: 72, duration: [1, 2], offset: [5, 2] }  // C5
		],
		harmony: II_V_I,
		difficulty: { level: 41, pitchComplexity: 41, rhythmComplexity: 18, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'dorian', 'color'],
		source: 'curated'
	},
	{
		id: 'm47v2-031',
		name: 'Long Inside Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] }, // D4 — zigzag thirds, ever upward
			{ pitch: 65, duration: [1, 8], offset: [1, 8] }, // F4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] }, // E4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] }, // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 2] }, // F4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] }, // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 4] }, // G4
			{ pitch: 71, duration: [1, 8], offset: [7, 8] }, // B4
			{ pitch: 69, duration: [1, 8], offset: [1, 1] }, // A4 — through the G7 bar
			{ pitch: 72, duration: [1, 8], offset: [9, 8] }, // C5
			{ pitch: 71, duration: [1, 8], offset: [5, 4] }, // B4
			{ pitch: 74, duration: [1, 8], offset: [11, 8] }, // D5
			{ pitch: 72, duration: [1, 8], offset: [3, 2] }, // C5
			{ pitch: 76, duration: [1, 8], offset: [13, 8] }, // E5
			{ pitch: 74, duration: [1, 8], offset: [7, 4] }, // D5
			{ pitch: 77, duration: [1, 8], offset: [15, 8] }, // F5 — peak on the b7
			{ pitch: 76, duration: [1, 1], offset: [2, 1] }  // E5 — resolve to the 3rd
		],
		harmony: II_V_I,
		difficulty: { level: 42, pitchComplexity: 42, rhythmComplexity: 20, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'line', 'zigzag'],
		source: 'curated'
	},
	{
		id: 'm47v2-032',
		name: 'Offbeat Guide Tones',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [3, 8], offset: [1, 8] }, // F4 — b3 of Dm7, off the beat
			{ pitch: 72, duration: [3, 8], offset: [5, 8] }, // C5 — b7, floating
			{ pitch: 71, duration: [3, 8], offset: [9, 8] }, // B4 — 3 of G7
			{ pitch: 65, duration: [3, 8], offset: [13, 8] }, // F4 — b7 of G7
			{ pitch: 64, duration: [3, 8], offset: [17, 8] }, // E4 — 3 of Cmaj7
			{ pitch: 72, duration: [3, 8], offset: [21, 8] }  // C5 — root on top
		],
		harmony: II_V_I,
		difficulty: { level: 26, pitchComplexity: 14, rhythmComplexity: 26, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'guide-tones', 'syncopation', 'offbeats'],
		source: 'curated'
	},
	{
		id: 'm47v2-033',
		name: 'Sequence Falling by Step',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 77, duration: [1, 8], offset: [0, 1] }, // F5 — four-note cell...
			{ pitch: 76, duration: [1, 8], offset: [1, 8] }, // E5
			{ pitch: 74, duration: [1, 8], offset: [1, 4] }, // D5
			{ pitch: 72, duration: [1, 8], offset: [3, 8] }, // C5
			{ pitch: 76, duration: [1, 8], offset: [1, 2] }, // E5 — ...sequenced a step down
			{ pitch: 74, duration: [1, 8], offset: [5, 8] }, // D5
			{ pitch: 72, duration: [1, 8], offset: [3, 4] }, // C5
			{ pitch: 71, duration: [1, 8], offset: [7, 8] }, // B4
			{ pitch: 74, duration: [1, 8], offset: [1, 1] }, // D5 — continuing over G7
			{ pitch: 72, duration: [1, 8], offset: [9, 8] }, // C5
			{ pitch: 71, duration: [1, 8], offset: [5, 4] }, // B4
			{ pitch: 69, duration: [1, 8], offset: [11, 8] }, // A4
			{ pitch: 72, duration: [1, 8], offset: [3, 2] }, // C5
			{ pitch: 71, duration: [1, 8], offset: [13, 8] }, // B4
			{ pitch: 69, duration: [1, 8], offset: [7, 4] }, // A4
			{ pitch: 67, duration: [1, 8], offset: [15, 8] }, // G4
			{ pitch: 71, duration: [1, 8], offset: [2, 1] }, // B4 — last cell lands home
			{ pitch: 69, duration: [1, 8], offset: [17, 8] }, // A4
			{ pitch: 67, duration: [1, 8], offset: [9, 4] }, // G4
			{ pitch: 65, duration: [1, 8], offset: [19, 8] }, // F4
			{ pitch: 64, duration: [1, 2], offset: [5, 2] }  // E4 — the 3rd
		],
		harmony: II_V_I,
		difficulty: { level: 53, pitchComplexity: 53, rhythmComplexity: 21, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'sequence', 'descending'],
		source: 'curated'
	},
	{
		id: 'm47v2-034',
		name: 'Charleston Changes',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [3, 8], offset: [0, 1] }, // F4 — Charleston: beat one...
			{ pitch: 72, duration: [5, 8], offset: [3, 8] }, // C5 — ...and-of-two, held long
			{ pitch: 71, duration: [3, 8], offset: [1, 1] }, // B4 — same rhythm on G7
			{ pitch: 65, duration: [5, 8], offset: [11, 8] }, // F4 — the tritone partner
			{ pitch: 64, duration: [3, 8], offset: [2, 1] }, // E4 — and on the I
			{ pitch: 72, duration: [5, 8], offset: [19, 8] }  // C5 — floated to the end
		],
		harmony: II_V_I,
		difficulty: { level: 27, pitchComplexity: 13, rhythmComplexity: 28, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'charleston', 'syncopation', 'guide-tones'],
		source: 'curated'
	},
	{
		id: 'm47v2-035',
		name: 'Sweep to the Nine',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] }, // D4 — Dm9 sweep up...
			{ pitch: 65, duration: [1, 8], offset: [1, 8] }, // F4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] }, // A4
			{ pitch: 72, duration: [1, 8], offset: [3, 8] }, // C5
			{ pitch: 76, duration: [1, 8], offset: [1, 2] }, // E5 — the 9 on top
			{ pitch: 74, duration: [1, 8], offset: [5, 8] }, // D5 — ...turn back
			{ pitch: 72, duration: [1, 8], offset: [3, 4] }, // C5
			{ pitch: 69, duration: [1, 8], offset: [7, 8] }, // A4
			{ pitch: 71, duration: [1, 8], offset: [1, 1] }, // B4 — G7 arp: 3...
			{ pitch: 74, duration: [1, 8], offset: [9, 8] }, // D5 — 5
			{ pitch: 77, duration: [1, 8], offset: [5, 4] }, // F5 — b7 at the peak
			{ pitch: 76, duration: [1, 8], offset: [11, 8] }, // E5 — tumble down through the chord
			{ pitch: 74, duration: [1, 8], offset: [3, 2] }, // D5
			{ pitch: 71, duration: [1, 8], offset: [13, 8] }, // B4
			{ pitch: 67, duration: [1, 8], offset: [7, 4] }, // G4
			{ pitch: 65, duration: [1, 8], offset: [15, 8] }, // F4
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }  // E4 — 3rd of home
		],
		harmony: II_V_I,
		difficulty: { level: 43, pitchComplexity: 43, rhythmComplexity: 21, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'arpeggio', 'sweep'],
		source: 'curated'
	},
	{
		id: 'm47v2-036',
		name: 'Floating Triad',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 74, duration: [1, 8], offset: [0, 1] }, // D5 — one G-triad shape...
			{ pitch: 71, duration: [1, 8], offset: [1, 8] }, // B4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] }, // G4
			{ pitch: 74, duration: [1, 8], offset: [3, 8] }, // D5 — ...cycled every 3 eighths
			{ pitch: 71, duration: [1, 8], offset: [1, 2] }, // B4
			{ pitch: 67, duration: [1, 8], offset: [5, 8] }, // G4
			{ pitch: 74, duration: [1, 8], offset: [3, 4] }, // D5
			{ pitch: 71, duration: [1, 8], offset: [7, 8] }, // B4
			{ pitch: 67, duration: [1, 8], offset: [1, 1] }, // G4 — floats over the barline
			{ pitch: 74, duration: [1, 8], offset: [9, 8] }, // D5
			{ pitch: 71, duration: [1, 8], offset: [5, 4] }, // B4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] }, // G4
			{ pitch: 74, duration: [1, 8], offset: [3, 2] }, // D5
			{ pitch: 71, duration: [1, 8], offset: [13, 8] }, // B4
			{ pitch: 67, duration: [1, 8], offset: [7, 4] }, // G4
			{ pitch: 74, duration: [1, 8], offset: [15, 8] }, // D5
			{ pitch: 71, duration: [1, 8], offset: [2, 1] }, // B4 — into bar three
			{ pitch: 67, duration: [1, 8], offset: [17, 8] }, // G4
			{ pitch: 72, duration: [3, 4], offset: [9, 4] }  // C5 — release to the root
		],
		harmony: II_V_I,
		difficulty: { level: 53, pitchComplexity: 53, rhythmComplexity: 29, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '7th', 'displacement', 'superimposition', 'cross-rhythm'],
		source: 'curated'
	},
	{
		id: 'm47v2-037',
		name: 'Ninths on Everything',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] }, // D4 — Dm7 arp...
			{ pitch: 65, duration: [1, 8], offset: [1, 8] }, // F4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] }, // A4
			{ pitch: 72, duration: [1, 8], offset: [3, 8] }, // C5
			{ pitch: 76, duration: [1, 2], offset: [1, 2] }, // E5 — ...held on the 9
			{ pitch: 74, duration: [1, 8], offset: [1, 1] }, // D5 — G7: down from the 5
			{ pitch: 71, duration: [1, 8], offset: [9, 8] }, // B4
			{ pitch: 65, duration: [1, 8], offset: [5, 4] }, // F4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] }, // G4
			{ pitch: 69, duration: [1, 2], offset: [3, 2] }, // A4 — held on the 9 of G7
			{ pitch: 64, duration: [1, 8], offset: [2, 1] }, // E4 — Cmaj7 climb
			{ pitch: 67, duration: [1, 8], offset: [17, 8] }, // G4
			{ pitch: 71, duration: [1, 8], offset: [9, 4] }, // B4
			{ pitch: 72, duration: [1, 8], offset: [19, 8] }, // C5
			{ pitch: 74, duration: [1, 2], offset: [5, 2] }  // D5 — end on the 9: modern
		],
		harmony: II_V_I,
		difficulty: { level: 42, pitchComplexity: 42, rhythmComplexity: 21, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'extensions', 'ninths'],
		source: 'curated'
	},
	{
		id: 'm47v2-038',
		name: 'The Long Way Home',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] }, // D4 — winding dorian line
			{ pitch: 64, duration: [1, 8], offset: [1, 8] }, // E4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] }, // F4
			{ pitch: 69, duration: [1, 8], offset: [3, 8] }, // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] }, // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 8] }, // F4
			{ pitch: 64, duration: [1, 8], offset: [3, 4] }, // E4
			{ pitch: 67, duration: [1, 8], offset: [7, 8] }, // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 1] }, // F4 — b7 of G7 first
			{ pitch: 69, duration: [1, 8], offset: [9, 8] }, // A4
			{ pitch: 71, duration: [1, 8], offset: [5, 4] }, // B4 — the 3rd
			{ pitch: 74, duration: [1, 8], offset: [11, 8] }, // D5
			{ pitch: 72, duration: [1, 8], offset: [3, 2] }, // C5
			{ pitch: 71, duration: [1, 8], offset: [13, 8] }, // B4
			{ pitch: 69, duration: [1, 8], offset: [7, 4] }, // A4
			{ pitch: 65, duration: [1, 8], offset: [15, 8] }, // F4 — tritone pair again
			{ pitch: 64, duration: [1, 8], offset: [2, 1] }, // E4 — Cmaj7: rise through it
			{ pitch: 67, duration: [1, 8], offset: [17, 8] }, // G4
			{ pitch: 71, duration: [1, 8], offset: [9, 4] }, // B4
			{ pitch: 74, duration: [1, 8], offset: [19, 8] }, // D5
			{ pitch: 72, duration: [1, 2], offset: [5, 2] }  // C5 — home at last
		],
		harmony: II_V_I,
		difficulty: { level: 54, pitchComplexity: 54, rhythmComplexity: 24, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'line', 'bebop'],
		source: 'curated'
	},
	{
		id: 'm47v2-039',
		name: 'Hemiola Through the Changes',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [3, 8], offset: [0, 1] }, // F4 — dotted quarters ride...
			{ pitch: 69, duration: [3, 8], offset: [3, 8] }, // A4
			{ pitch: 72, duration: [3, 8], offset: [3, 4] }, // C5 — across the barline
			{ pitch: 76, duration: [3, 8], offset: [9, 8] }, // E5 — 13 of G7
			{ pitch: 74, duration: [3, 8], offset: [3, 2] }, // D5
			{ pitch: 71, duration: [3, 8], offset: [15, 8] }, // B4 — 3 of G7, into bar 3
			{ pitch: 67, duration: [3, 8], offset: [9, 4] }, // G4
			{ pitch: 64, duration: [3, 8], offset: [21, 8] }  // E4 — realigns at the very end
		],
		harmony: II_V_I,
		difficulty: { level: 30, pitchComplexity: 20, rhythmComplexity: 30, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'hemiola', 'cross-rhythm'],
		source: 'curated'
	},
	{
		id: 'm47v2-040',
		name: 'Fourth Leaps Home',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] }, // D4 — rising diatonic fourths
			{ pitch: 67, duration: [1, 8], offset: [1, 8] }, // G4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] }, // E4
			{ pitch: 69, duration: [1, 8], offset: [3, 8] }, // A4
			{ pitch: 65, duration: [1, 8], offset: [1, 2] }, // F4 — the tritone pair...
			{ pitch: 71, duration: [1, 8], offset: [5, 8] }, // B4
			{ pitch: 67, duration: [1, 8], offset: [3, 4] }, // G4
			{ pitch: 72, duration: [1, 8], offset: [7, 8] }, // C5
			{ pitch: 77, duration: [1, 8], offset: [1, 1] }, // F5 — G7: falling fourths now
			{ pitch: 72, duration: [1, 8], offset: [9, 8] }, // C5
			{ pitch: 76, duration: [1, 8], offset: [5, 4] }, // E5
			{ pitch: 71, duration: [1, 8], offset: [11, 8] }, // B4
			{ pitch: 74, duration: [1, 8], offset: [3, 2] }, // D5
			{ pitch: 69, duration: [1, 8], offset: [13, 8] }, // A4
			{ pitch: 72, duration: [1, 8], offset: [7, 4] }, // C5
			{ pitch: 67, duration: [1, 8], offset: [15, 8] }, // G4
			{ pitch: 71, duration: [1, 4], offset: [2, 1] }, // B4 — maj7 leans in...
			{ pitch: 72, duration: [3, 4], offset: [9, 4] }  // C5 — ...resolves up
		],
		harmony: II_V_I,
		difficulty: { level: 53, pitchComplexity: 53, rhythmComplexity: 22, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'fourths', 'intervals'],
		source: 'curated'
	}
];

export const MAJOR_4_7_VOL2_LICKS: Phrase[] = [...SINGLE_CHORD_LICKS, ...II_V_I_LICKS];
