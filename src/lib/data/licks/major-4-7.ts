/**
 * Major 4th & 7th licks — 40 curated lines that fill the major-scale pool's
 * pentatonic gap (it otherwise carries no 4th or 7th).
 *
 * These deliberately feature the 4th (F in concert C) and 7th (B) so a major
 * session covers the full scale. Diatonic content is front-loaded to
 * difficulty levels 1-20, which is where the pool was previously almost
 * entirely pentatonic. Chromatic ii-V-I vocabulary is rated per the content
 * tier floors in difficulty/params.ts (chromaticism enters at tier 5 = level
 * 31+), matching the calibration of ii-V-I-major.ts — the ear-training filter
 * gates on difficulty.level alone, so a low level would put bebop chromaticism
 * on beginner ears (see tests/unit/data/difficulty-calibration.test.ts).
 *
 * Two harmonic frames, ~20 each:
 *
 *  - SINGLE-CHORD MAJOR (`scaleId: 'major.ionian'`): play over the tonic in a
 *    major session. These take the snap-to-scale path at runtime, so they are
 *    kept STRICTLY DIATONIC (C major only) — the 4th and 7th are diatonic and
 *    survive the snap; that is exactly the gap being filled.
 *
 *  - ii-V-I MAJOR (`category: 'ii-V-I-major'`, Dm7→G7→Cmaj7): take the
 *    progression branch at runtime (transpose to parent key, NO snap), so the
 *    full chromatic bebop vocabulary — enclosures, chromatic approach tones,
 *    the bebop dominant scale, b9/altered colours — stays intact. The 4th
 *    (= b7 of G7) and 7th (= 3rd of G7 / maj7 of I) are emphasised throughout.
 *
 * Every lick is real, idiomatic jazz vocabulary (guide-tone lines, digital
 * patterns, 3-5-7-9 cells, bebop scales, b9 arpeggios, chromatic enclosures,
 * full-scale runs), not invented note-salad. Each lick keeps its own
 * `category` (major-chord / bebop-lines / digital-patterns / ii-V-I-major);
 * they live together here as one themed collection but slot into the right
 * category everywhere category matters.
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
 *  Featuring the 4th (F) and 7th (B) the pentatonic pool omits.
 * ================================================================ */

const SINGLE_CHORD_LICKS: Phrase[] = [
	{
		id: 'm47-001',
		name: 'Leading-Tone Resolution',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 71, duration: [1, 2], offset: [0, 1] }, // B4 (7)
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }  // C5 (1)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'major-chord',
		tags: ['major', '7th', 'leading-tone', 'resolution'],
		source: 'curated'
	},
	{
		id: 'm47-002',
		name: 'Fourth Falls to Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 2], offset: [0, 1] }, // F4 (4)
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }  // E4 (3)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 2, pitchComplexity: 2, rhythmComplexity: 1, lengthBars: 1 },
		category: 'major-chord',
		tags: ['major', '4th', 'resolution', 'avoid-note'],
		source: 'curated'
	},
	{
		id: 'm47-003',
		name: 'Sixth–Seventh–Eighth Approach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 4], offset: [0, 1] }, // A4 (6)
			{ pitch: 71, duration: [1, 4], offset: [1, 4] }, // B4 (7)
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }  // C5 (1)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 3, pitchComplexity: 4, rhythmComplexity: 3, lengthBars: 1 },
		category: 'bebop-lines',
		tags: ['major', '7th', 'approach', 'scalar'],
		source: 'curated'
	},
	{
		id: 'm47-004',
		name: 'Digital 2-3-4-5',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] }, // D4 (2)
			{ pitch: 64, duration: [1, 4], offset: [1, 4] }, // E4 (3)
			{ pitch: 65, duration: [1, 4], offset: [1, 2] }, // F4 (4)
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }  // G4 (5)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 4, pitchComplexity: 5, rhythmComplexity: 4, lengthBars: 1 },
		category: 'digital-patterns',
		tags: ['major', '4th', 'digital-pattern', 'ascending'],
		source: 'curated'
	},
	{
		id: 'm47-005',
		name: 'Digital 5-6-7-8',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] }, // G4 (5)
			{ pitch: 69, duration: [1, 4], offset: [1, 4] }, // A4 (6)
			{ pitch: 71, duration: [1, 4], offset: [1, 2] }, // B4 (7)
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }  // C5 (1)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 4, lengthBars: 1 },
		category: 'digital-patterns',
		tags: ['major', '7th', 'digital-pattern', 'ascending'],
		source: 'curated'
	},
	{
		id: 'm47-006',
		name: 'Upper Tetrachord Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] }, // C5 (8)
			{ pitch: 71, duration: [1, 4], offset: [1, 4] }, // B4 (7)
			{ pitch: 69, duration: [1, 4], offset: [1, 2] }, // A4 (6)
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }  // G4 (5)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 6, pitchComplexity: 6, rhythmComplexity: 4, lengthBars: 1 },
		category: 'bebop-lines',
		tags: ['major', '7th', 'tetrachord', 'descending'],
		source: 'curated'
	},
	{
		id: 'm47-007',
		name: 'Lower Tetrachord Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] }, // G4 (5)
			{ pitch: 65, duration: [1, 4], offset: [1, 4] }, // F4 (4)
			{ pitch: 64, duration: [1, 4], offset: [1, 2] }, // E4 (3)
			{ pitch: 62, duration: [1, 4], offset: [3, 4] }  // D4 (2)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 6, pitchComplexity: 6, rhythmComplexity: 4, lengthBars: 1 },
		category: 'bebop-lines',
		tags: ['major', '4th', 'tetrachord', 'descending'],
		source: 'curated'
	},
	{
		id: 'm47-008',
		name: 'Four-Three Suspension',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] }, // G4 (5)
			{ pitch: 65, duration: [1, 4], offset: [1, 4] }, // F4 (4 — the suspension)
			{ pitch: 64, duration: [1, 4], offset: [1, 2] }, // E4 (3 — resolution)
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }  // C4 (1)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 7, pitchComplexity: 7, rhythmComplexity: 4, lengthBars: 1 },
		category: 'bebop-lines',
		tags: ['major', '4th', 'suspension', 'resolution'],
		source: 'curated'
	},
	{
		id: 'm47-009',
		name: 'Full Major Scale Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] }, // C4 (1)
			{ pitch: 62, duration: [1, 8], offset: [1, 8] }, // D4 (2)
			{ pitch: 64, duration: [1, 8], offset: [1, 4] }, // E4 (3)
			{ pitch: 65, duration: [1, 8], offset: [3, 8] }, // F4 (4)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] }, // G4 (5)
			{ pitch: 69, duration: [1, 8], offset: [5, 8] }, // A4 (6)
			{ pitch: 71, duration: [1, 8], offset: [3, 4] }, // B4 (7)
			{ pitch: 72, duration: [1, 8], offset: [7, 8] }  // C5 (8)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 9, rhythmComplexity: 8, lengthBars: 1 },
		category: 'bebop-lines',
		tags: ['major', '4th', '7th', 'scalar', 'full-scale', 'ascending'],
		source: 'curated'
	},
	{
		id: 'm47-010',
		name: 'Full Major Scale Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] }, // C5 (8)
			{ pitch: 71, duration: [1, 8], offset: [1, 8] }, // B4 (7)
			{ pitch: 69, duration: [1, 8], offset: [1, 4] }, // A4 (6)
			{ pitch: 67, duration: [1, 8], offset: [3, 8] }, // G4 (5)
			{ pitch: 65, duration: [1, 8], offset: [1, 2] }, // F4 (4)
			{ pitch: 64, duration: [1, 8], offset: [5, 8] }, // E4 (3)
			{ pitch: 62, duration: [1, 8], offset: [3, 4] }, // D4 (2)
			{ pitch: 60, duration: [1, 8], offset: [7, 8] }  // C4 (1)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 9, rhythmComplexity: 8, lengthBars: 1 },
		category: 'bebop-lines',
		tags: ['major', '4th', '7th', 'scalar', 'full-scale', 'descending'],
		source: 'curated'
	},
	{
		id: 'm47-011',
		name: 'Three-Five-Seven-Nine',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] }, // E4 (3)
			{ pitch: 67, duration: [1, 4], offset: [1, 4] }, // G4 (5)
			{ pitch: 71, duration: [1, 4], offset: [1, 2] }, // B4 (7)
			{ pitch: 74, duration: [1, 4], offset: [3, 4] }  // D5 (9)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 9, pitchComplexity: 11, rhythmComplexity: 4, lengthBars: 1 },
		category: 'digital-patterns',
		tags: ['major', '7th', 'arpeggio', '3-5-7-9'],
		source: 'curated'
	},
	{
		id: 'm47-012',
		name: 'Seventh-to-Root Arpeggio',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 71, duration: [1, 4], offset: [0, 1] }, // B4 (7)
			{ pitch: 67, duration: [1, 4], offset: [1, 4] }, // G4 (5)
			{ pitch: 64, duration: [1, 4], offset: [1, 2] }, // E4 (3)
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }  // C4 (1)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 10, pitchComplexity: 12, rhythmComplexity: 4, lengthBars: 1 },
		category: 'major-chord',
		tags: ['major', '7th', 'arpeggio', 'descending'],
		source: 'curated'
	},
	{
		id: 'm47-013',
		name: 'Pentatonic Filled with 4 and 7',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] }, // C4 (1)
			{ pitch: 64, duration: [1, 8], offset: [1, 8] }, // E4 (3)
			{ pitch: 65, duration: [1, 8], offset: [1, 4] }, // F4 (4 — added)
			{ pitch: 67, duration: [1, 8], offset: [3, 8] }, // G4 (5)
			{ pitch: 69, duration: [1, 8], offset: [1, 2] }, // A4 (6)
			{ pitch: 71, duration: [1, 8], offset: [5, 8] }, // B4 (7 — added)
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }  // C5 (8)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 10, pitchComplexity: 11, rhythmComplexity: 9, lengthBars: 1 },
		category: 'bebop-lines',
		tags: ['major', '4th', '7th', 'passing-tone'],
		source: 'curated'
	},
	{
		id: 'm47-014',
		name: 'Tonic Turn with Leading Tone',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] }, // C5 (1)
			{ pitch: 71, duration: [1, 4], offset: [1, 4] }, // B4 (7)
			{ pitch: 74, duration: [1, 4], offset: [1, 2] }, // D5 (9)
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }  // C5 (1)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 11, pitchComplexity: 10, rhythmComplexity: 5, lengthBars: 1 },
		category: 'bebop-lines',
		tags: ['major', '7th', 'turn', 'enclosure'],
		source: 'curated'
	},
	{
		id: 'm47-015',
		name: 'Scalar Climb to the Ninth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] }, // G4 (5)
			{ pitch: 69, duration: [1, 8], offset: [1, 8] }, // A4 (6)
			{ pitch: 71, duration: [1, 8], offset: [1, 4] }, // B4 (7)
			{ pitch: 72, duration: [1, 8], offset: [3, 8] }, // C5 (8)
			{ pitch: 74, duration: [1, 8], offset: [1, 2] }, // D5 (9)
			{ pitch: 72, duration: [1, 8], offset: [5, 8] }, // C5 (8)
			{ pitch: 71, duration: [1, 4], offset: [3, 4] }  // B4 (7)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 12, pitchComplexity: 12, rhythmComplexity: 10, lengthBars: 1 },
		category: 'bebop-lines',
		tags: ['major', '7th', 'scalar'],
		source: 'curated'
	},
	{
		id: 'm47-016',
		name: 'Rising Triadic Cells',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] }, // E4 (3)
			{ pitch: 65, duration: [1, 8], offset: [1, 8] }, // F4 (4)
			{ pitch: 67, duration: [1, 8], offset: [1, 4] }, // G4 (5)
			{ pitch: 67, duration: [1, 8], offset: [3, 8] }, // G4 (5)
			{ pitch: 69, duration: [1, 8], offset: [1, 2] }, // A4 (6)
			{ pitch: 71, duration: [1, 8], offset: [5, 8] }, // B4 (7)
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }  // C5 (8)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 12, pitchComplexity: 12, rhythmComplexity: 10, lengthBars: 1 },
		category: 'digital-patterns',
		tags: ['major', '4th', '7th', 'sequence'],
		source: 'curated'
	},
	{
		id: 'm47-017',
		name: 'Arpeggio Up, Scale Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] }, // C4 (1)
			{ pitch: 64, duration: [1, 8], offset: [1, 8] }, // E4 (3)
			{ pitch: 67, duration: [1, 8], offset: [1, 4] }, // G4 (5)
			{ pitch: 71, duration: [1, 8], offset: [3, 8] }, // B4 (7)
			{ pitch: 69, duration: [1, 8], offset: [1, 2] }, // A4 (6)
			{ pitch: 67, duration: [1, 8], offset: [5, 8] }, // G4 (5)
			{ pitch: 65, duration: [1, 8], offset: [3, 4] }, // F4 (4)
			{ pitch: 64, duration: [1, 8], offset: [7, 8] }  // E4 (3)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 13, pitchComplexity: 13, rhythmComplexity: 12, lengthBars: 1 },
		category: 'major-chord',
		tags: ['major', '4th', '7th', 'arpeggio', 'scalar'],
		source: 'curated'
	},
	{
		id: 'm47-018',
		name: 'Long Diatonic Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] }, // E4 (3)
			{ pitch: 65, duration: [1, 8], offset: [1, 8] }, // F4 (4)
			{ pitch: 67, duration: [1, 8], offset: [1, 4] }, // G4 (5)
			{ pitch: 69, duration: [1, 8], offset: [3, 8] }, // A4 (6)
			{ pitch: 71, duration: [1, 8], offset: [1, 2] }, // B4 (7)
			{ pitch: 72, duration: [1, 8], offset: [5, 8] }, // C5 (8)
			{ pitch: 74, duration: [1, 8], offset: [3, 4] }, // D5 (9)
			{ pitch: 71, duration: [1, 8], offset: [7, 8] }, // B4 (7)
			{ pitch: 72, duration: [1, 2], offset: [1, 1] }  // C5 (1) — bar 2
		],
		harmony: CMAJ_2BAR,
		difficulty: { level: 14, pitchComplexity: 14, rhythmComplexity: 13, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['major', '4th', '7th', 'bebop', 'line'],
		source: 'curated'
	},
	{
		id: 'm47-019',
		name: 'Stepwise Digital Sequence',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] }, // D4 (2)
			{ pitch: 64, duration: [1, 8], offset: [1, 8] }, // E4 (3)
			{ pitch: 65, duration: [1, 8], offset: [1, 4] }, // F4 (4)
			{ pitch: 67, duration: [1, 8], offset: [3, 8] }, // G4 (5)
			{ pitch: 65, duration: [1, 8], offset: [1, 2] }, // F4 (4)
			{ pitch: 67, duration: [1, 8], offset: [5, 8] }, // G4 (5)
			{ pitch: 69, duration: [1, 8], offset: [3, 4] }, // A4 (6)
			{ pitch: 71, duration: [1, 8], offset: [7, 8] }  // B4 (7)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 14, pitchComplexity: 13, rhythmComplexity: 12, lengthBars: 1 },
		category: 'digital-patterns',
		tags: ['major', '4th', '7th', 'digital-pattern', 'sequence'],
		source: 'curated'
	},
	{
		id: 'm47-020',
		name: 'Descending Bebop Resolution',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] }, // C5 (8)
			{ pitch: 71, duration: [1, 8], offset: [1, 8] }, // B4 (7)
			{ pitch: 69, duration: [1, 8], offset: [1, 4] }, // A4 (6)
			{ pitch: 67, duration: [1, 8], offset: [3, 8] }, // G4 (5)
			{ pitch: 65, duration: [1, 8], offset: [1, 2] }, // F4 (4)
			{ pitch: 64, duration: [1, 8], offset: [5, 8] }, // E4 (3)
			{ pitch: 62, duration: [1, 8], offset: [3, 4] }, // D4 (2)
			{ pitch: 60, duration: [1, 8], offset: [7, 8] }  // C4 (1)
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 15, pitchComplexity: 14, rhythmComplexity: 13, lengthBars: 1 },
		category: 'bebop-lines',
		tags: ['major', '4th', '7th', 'bebop', 'descending', 'resolution'],
		source: 'curated'
	}
];

/* ================================================================
 *  ii-V-I MAJOR (Dm7 → G7 → Cmaj7) — chromatic vocabulary kept intact.
 *  4th = b7 of G7; 7th = 3rd of G7 / maj7 of I.
 * ================================================================ */

const II_V_I_LICKS: Phrase[] = [
	{
		id: 'm47-021',
		name: 'Guide-Tone Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 2], offset: [0, 1] }, // F4  — 3rd of Dm7 (4 of key)
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }, // A4  — 5th of Dm7
			{ pitch: 65, duration: [1, 2], offset: [1, 1] }, // F4  — b7 of G7 (4 of key)
			{ pitch: 71, duration: [1, 2], offset: [3, 2] }, // B4  — 3rd of G7 (7 of key)
			{ pitch: 64, duration: [1, 2], offset: [2, 1] }, // E4  — 3rd of Cmaj7
			{ pitch: 71, duration: [1, 2], offset: [5, 2] }  // B4  — maj7 of Cmaj7 (7)
		],
		harmony: II_V_I,
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 6, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'guide-tones'],
		source: 'curated'
	},
	{
		id: 'm47-022',
		name: 'Arpeggio Walk',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] }, // D4  — Dm7
			{ pitch: 65, duration: [1, 4], offset: [1, 4] }, // F4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] }, // A4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }, // C5
			{ pitch: 71, duration: [1, 4], offset: [1, 1] }, // B4  — G7 (3)
			{ pitch: 67, duration: [1, 4], offset: [5, 4] }, // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] }, // F4  — b7
			{ pitch: 62, duration: [1, 4], offset: [7, 4] }, // D4
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }  // C4  — resolve
		],
		harmony: II_V_I,
		difficulty: { level: 11, pitchComplexity: 12, rhythmComplexity: 8, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'm47-023',
		name: 'Diatonic Run Through the Changes',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] }, // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] }, // E4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] }, // F4 (4)
			{ pitch: 67, duration: [1, 8], offset: [3, 8] }, // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 2] }, // A4
			{ pitch: 71, duration: [1, 8], offset: [5, 8] }, // B4 (7)
			{ pitch: 72, duration: [1, 8], offset: [3, 4] }, // C5
			{ pitch: 74, duration: [1, 8], offset: [7, 8] }, // D5
			{ pitch: 74, duration: [1, 8], offset: [1, 1] }, // D5  — G7
			{ pitch: 72, duration: [1, 8], offset: [9, 8] }, // C5
			{ pitch: 71, duration: [1, 8], offset: [5, 4] }, // B4 (3 of G7)
			{ pitch: 69, duration: [1, 8], offset: [11, 8] }, // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 2] }, // G4
			{ pitch: 65, duration: [1, 8], offset: [13, 8] }, // F4 (b7)
			{ pitch: 64, duration: [1, 8], offset: [7, 4] }, // E4
			{ pitch: 62, duration: [1, 8], offset: [15, 8] }, // D4
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }  // E4  — 3rd of Cmaj7
		],
		harmony: II_V_I,
		difficulty: { level: 16, pitchComplexity: 13, rhythmComplexity: 14, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'scalar', 'eighth-notes'],
		source: 'curated'
	},
	{
		id: 'm47-024',
		name: 'G7 Bebop Scale Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] }, // D4  — Dm7 arp
			{ pitch: 65, duration: [1, 4], offset: [1, 4] }, // F4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] }, // A4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }, // C5
			{ pitch: 67, duration: [1, 8], offset: [1, 1] }, // G4  — G7 bebop scale down
			{ pitch: 66, duration: [1, 8], offset: [9, 8] }, // F#4 (chromatic passing)
			{ pitch: 65, duration: [1, 8], offset: [5, 4] }, // F4  (b7)
			{ pitch: 64, duration: [1, 8], offset: [11, 8] }, // E4
			{ pitch: 62, duration: [1, 8], offset: [3, 2] }, // D4
			{ pitch: 60, duration: [1, 8], offset: [13, 8] }, // C4
			{ pitch: 59, duration: [1, 8], offset: [7, 4] }, // B3  (3 of G7)
			{ pitch: 57, duration: [1, 8], offset: [15, 8] }, // A3
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }  // E4  — resolve to 3rd
		],
		harmony: II_V_I,
		difficulty: { level: 55, pitchComplexity: 55, rhythmComplexity: 50, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'bebop-scale', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'm47-025',
		name: 'G7 b9 Arpeggio',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] }, // F4  — Dm7 (3=F)
			{ pitch: 69, duration: [1, 4], offset: [1, 4] }, // A4  (5)
			{ pitch: 72, duration: [1, 4], offset: [1, 2] }, // C5  (b7)
			{ pitch: 76, duration: [1, 4], offset: [3, 4] }, // E5  (9)
			{ pitch: 77, duration: [1, 4], offset: [1, 1] }, // F5  — G7 (b7)
			{ pitch: 74, duration: [1, 4], offset: [5, 4] }, // D5  (5)
			{ pitch: 71, duration: [1, 4], offset: [3, 2] }, // B4  (3 = 7 of key)
			{ pitch: 68, duration: [1, 4], offset: [7, 4] }, // Ab4 (b9)
			{ pitch: 67, duration: [1, 1], offset: [2, 1] }  // G4  — resolve (5 of Cmaj7)
		],
		harmony: II_V_I,
		difficulty: { level: 53, pitchComplexity: 54, rhythmComplexity: 40, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'b9', 'altered', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'm47-026',
		name: 'Chromatic Enclosure of the Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] }, // D4  — Dm7
			{ pitch: 65, duration: [1, 4], offset: [1, 4] }, // F4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] }, // A4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }, // G4
			{ pitch: 71, duration: [1, 4], offset: [1, 1] }, // B4  — G7 (3)
			{ pitch: 74, duration: [1, 4], offset: [5, 4] }, // D5
			{ pitch: 65, duration: [1, 4], offset: [3, 2] }, // F4  (b7)
			{ pitch: 62, duration: [1, 4], offset: [7, 4] }, // D4
			{ pitch: 65, duration: [1, 8], offset: [2, 1] }, // F4  — upper enclosure (4)
			{ pitch: 63, duration: [1, 8], offset: [17, 8] }, // Eb4 — lower (chromatic)
			{ pitch: 64, duration: [1, 2], offset: [9, 4] }  // E4  — target (3 of Cmaj7)
		],
		harmony: II_V_I,
		difficulty: { level: 44, pitchComplexity: 44, rhythmComplexity: 42, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'enclosure', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'm47-027',
		name: 'Three-to-Nine Both Chords',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] }, // F4  — Dm7 3-5-b7-9
			{ pitch: 69, duration: [1, 4], offset: [1, 4] }, // A4
			{ pitch: 72, duration: [1, 4], offset: [1, 2] }, // C5
			{ pitch: 76, duration: [1, 4], offset: [3, 4] }, // E5
			{ pitch: 71, duration: [1, 4], offset: [1, 1] }, // B4  — G7 3-5-b7-9: B
			{ pitch: 74, duration: [1, 4], offset: [5, 4] }, // D5
			{ pitch: 77, duration: [1, 4], offset: [3, 2] }, // F5  (b7)
			{ pitch: 69, duration: [1, 4], offset: [7, 4] }, // A4  (9)
			{ pitch: 71, duration: [1, 1], offset: [2, 1] }  // B4  — resolve to maj7 (7)
		],
		harmony: II_V_I,
		difficulty: { level: 15, pitchComplexity: 16, rhythmComplexity: 9, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', '3-5-7-9'],
		source: 'curated'
	},
	{
		id: 'm47-028',
		name: 'Honeysuckle Chromatic Approach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 8], offset: [0, 1] }, // A4  — Dm7
			{ pitch: 67, duration: [1, 8], offset: [1, 8] }, // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] }, // F4 (3 of Dm)
			{ pitch: 64, duration: [1, 8], offset: [3, 8] }, // E4
			{ pitch: 62, duration: [1, 4], offset: [1, 2] }, // D4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] }, // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 1] }, // G4  — G7
			{ pitch: 68, duration: [1, 8], offset: [9, 8] }, // Ab4 (chromatic)
			{ pitch: 69, duration: [1, 8], offset: [5, 4] }, // A4
			{ pitch: 71, duration: [1, 8], offset: [11, 8] }, // B4 (3)
			{ pitch: 65, duration: [1, 4], offset: [3, 2] }, // F4 (b7)
			{ pitch: 62, duration: [1, 4], offset: [7, 4] }, // D4
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }  // E4 — resolve
		],
		harmony: II_V_I,
		difficulty: { level: 46, pitchComplexity: 46, rhythmComplexity: 45, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'chromatic', 'approach'],
		source: 'curated'
	},
	{
		id: 'm47-029',
		name: 'Descending Thirds',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] }, // C5  — Dm7
			{ pitch: 69, duration: [1, 4], offset: [1, 4] }, // A4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] }, // A4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] }, // F4 (3)
			{ pitch: 71, duration: [1, 4], offset: [1, 1] }, // B4  — G7 (3)
			{ pitch: 67, duration: [1, 4], offset: [5, 4] }, // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] }, // F4 (b7)
			{ pitch: 62, duration: [1, 4], offset: [7, 4] }, // D4
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }  // E4  — resolve
		],
		harmony: II_V_I,
		difficulty: { level: 16, pitchComplexity: 14, rhythmComplexity: 9, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'thirds'],
		source: 'curated'
	},
	{
		id: 'm47-030',
		name: 'Bebop Line to the Seventh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] }, // F4  — Dm7
			{ pitch: 64, duration: [1, 8], offset: [1, 8] }, // E4
			{ pitch: 62, duration: [1, 8], offset: [1, 4] }, // D4
			{ pitch: 60, duration: [1, 8], offset: [3, 8] }, // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 2] }, // D4
			{ pitch: 65, duration: [1, 8], offset: [5, 8] }, // F4
			{ pitch: 69, duration: [1, 8], offset: [3, 4] }, // A4
			{ pitch: 72, duration: [1, 8], offset: [7, 8] }, // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 1] }, // B4  — G7 (3)
			{ pitch: 69, duration: [1, 8], offset: [9, 8] }, // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] }, // G4
			{ pitch: 65, duration: [1, 8], offset: [11, 8] }, // F4 (b7)
			{ pitch: 64, duration: [1, 8], offset: [3, 2] }, // E4
			{ pitch: 62, duration: [1, 8], offset: [13, 8] }, // D4
			{ pitch: 67, duration: [1, 8], offset: [7, 4] }, // G4
			{ pitch: 68, duration: [1, 8], offset: [15, 8] }, // Ab4 (chromatic)
			{ pitch: 71, duration: [1, 1], offset: [2, 1] }  // B4  — resolve to maj7 (7)
		],
		harmony: II_V_I,
		difficulty: { level: 50, pitchComplexity: 50, rhythmComplexity: 52, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'bebop', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'm47-031',
		name: 'Altered Dominant Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] }, // D4  — Dm7
			{ pitch: 65, duration: [1, 4], offset: [1, 4] }, // F4  (3)
			{ pitch: 69, duration: [1, 4], offset: [1, 2] }, // A4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }, // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 1] }, // Bb4 — G7alt (#9)
			{ pitch: 68, duration: [1, 4], offset: [5, 4] }, // Ab4 (b9)
			{ pitch: 65, duration: [1, 4], offset: [3, 2] }, // F4  (b7)
			{ pitch: 63, duration: [1, 4], offset: [7, 4] }, // Eb4 (b13)
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }  // E4  — resolve to 3rd
		],
		harmony: II_V_I,
		difficulty: { level: 58, pitchComplexity: 60, rhythmComplexity: 40, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', 'altered', 'b9', 'b13'],
		source: 'curated'
	},
	{
		id: 'm47-032',
		name: 'Double Enclosure to the Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] }, // F4  — Dm7
			{ pitch: 69, duration: [1, 4], offset: [1, 4] }, // A4
			{ pitch: 72, duration: [1, 4], offset: [1, 2] }, // C5
			{ pitch: 69, duration: [1, 4], offset: [3, 4] }, // A4
			{ pitch: 71, duration: [1, 4], offset: [1, 1] }, // B4  — G7 (3)
			{ pitch: 65, duration: [1, 4], offset: [5, 4] }, // F4  (b7)
			{ pitch: 62, duration: [1, 4], offset: [3, 2] }, // D4
			{ pitch: 67, duration: [1, 4], offset: [7, 4] }, // G4
			{ pitch: 62, duration: [1, 8], offset: [2, 1] }, // D4  — upper neighbor
			{ pitch: 59, duration: [1, 8], offset: [17, 8] }, // B3 — lower (7)
			{ pitch: 60, duration: [1, 2], offset: [9, 4] }  // C4  — root resolution
		],
		harmony: II_V_I,
		difficulty: { level: 18, pitchComplexity: 16, rhythmComplexity: 13, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'enclosure'],
		source: 'curated'
	},
	{
		id: 'm47-033',
		name: 'Parker-Style Eighth-Note Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 4], offset: [0, 1] }, // A4  — Dm7 (bar 1 thinned to quarters)
			{ pitch: 67, duration: [1, 4], offset: [1, 4] }, // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] }, // F4 (3)
			{ pitch: 62, duration: [1, 4], offset: [3, 4] }, // D4
			{ pitch: 71, duration: [1, 8], offset: [1, 1] }, // B4  — G7 (3)
			{ pitch: 72, duration: [1, 8], offset: [9, 8] }, // C5
			{ pitch: 74, duration: [1, 8], offset: [5, 4] }, // D5
			{ pitch: 65, duration: [1, 8], offset: [11, 8] }, // F4 (b7)
			{ pitch: 69, duration: [1, 8], offset: [3, 2] }, // A4 (9)
			{ pitch: 67, duration: [1, 8], offset: [13, 8] }, // G4
			{ pitch: 68, duration: [1, 8], offset: [7, 4] }, // Ab4 (b9)
			{ pitch: 69, duration: [1, 8], offset: [15, 8] }, // A4
			{ pitch: 71, duration: [1, 1], offset: [2, 1] }  // B4  — resolve (7)
		],
		harmony: II_V_I,
		difficulty: { level: 55, pitchComplexity: 55, rhythmComplexity: 54, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'parker', 'bebop', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'm47-034',
		name: 'Scalar Cascade',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 74, duration: [1, 4], offset: [0, 1] }, // D5  — Dm7 (bar 1 thinned to quarters)
			{ pitch: 71, duration: [1, 4], offset: [1, 4] }, // B4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] }, // G4
			{ pitch: 64, duration: [1, 4], offset: [3, 4] }, // E4
			{ pitch: 71, duration: [1, 8], offset: [1, 1] }, // B4  — G7 (3)
			{ pitch: 69, duration: [1, 8], offset: [9, 8] }, // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] }, // G4
			{ pitch: 65, duration: [1, 8], offset: [11, 8] }, // F4 (b7)
			{ pitch: 64, duration: [1, 8], offset: [3, 2] }, // E4
			{ pitch: 62, duration: [1, 8], offset: [13, 8] }, // D4
			{ pitch: 60, duration: [1, 8], offset: [7, 4] }, // C4
			{ pitch: 59, duration: [1, 8], offset: [15, 8] }, // B3
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }  // C4  — resolve
		],
		harmony: II_V_I,
		difficulty: { level: 19, pitchComplexity: 16, rhythmComplexity: 16, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'scalar', 'eighth-notes'],
		source: 'curated'
	},
	{
		id: 'm47-035',
		name: 'Diminished Passing on the Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] }, // D4  — Dm7
			{ pitch: 65, duration: [1, 4], offset: [1, 4] }, // F4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] }, // A4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }, // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 1] }, // B4  — G7 (3)
			{ pitch: 74, duration: [1, 8], offset: [9, 8] }, // D5  (5)
			{ pitch: 77, duration: [1, 8], offset: [5, 4] }, // F5  (b7)
			{ pitch: 68, duration: [1, 8], offset: [11, 8] }, // Ab4 (b9 — dim sound)
			{ pitch: 71, duration: [1, 8], offset: [3, 2] }, // B4
			{ pitch: 65, duration: [1, 8], offset: [13, 8] }, // F4 (b7)
			{ pitch: 62, duration: [1, 8], offset: [7, 4] }, // D4
			{ pitch: 68, duration: [1, 8], offset: [15, 8] }, // Ab4 (b9)
			{ pitch: 67, duration: [1, 1], offset: [2, 1] }  // G4  — resolve to 5
		],
		harmony: II_V_I,
		difficulty: { level: 56, pitchComplexity: 57, rhythmComplexity: 52, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'diminished', 'b9', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'm47-036',
		name: 'Long Bebop ii-V-I',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] }, // C4  — Dm7 (bar 1 thinned to quarters)
			{ pitch: 64, duration: [1, 4], offset: [1, 4] }, // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] }, // G4
			{ pitch: 71, duration: [1, 4], offset: [3, 4] }, // B4 (7)
			{ pitch: 74, duration: [1, 8], offset: [1, 1] }, // D5  — G7
			{ pitch: 72, duration: [1, 8], offset: [9, 8] }, // C5
			{ pitch: 71, duration: [1, 8], offset: [5, 4] }, // B4 (3)
			{ pitch: 69, duration: [1, 8], offset: [11, 8] }, // A4
			{ pitch: 68, duration: [1, 8], offset: [3, 2] }, // Ab4 (b9 chromatic)
			{ pitch: 67, duration: [1, 8], offset: [13, 8] }, // G4
			{ pitch: 65, duration: [1, 8], offset: [7, 4] }, // F4 (b7)
			{ pitch: 64, duration: [1, 8], offset: [15, 8] }, // E4
			{ pitch: 64, duration: [1, 4], offset: [2, 1] }, // E4  — Cmaj7 (3)
			{ pitch: 67, duration: [1, 4], offset: [9, 4] }, // G4
			{ pitch: 71, duration: [1, 2], offset: [5, 2] }  // B4  — maj7 (7)
		],
		harmony: II_V_I,
		difficulty: { level: 54, pitchComplexity: 55, rhythmComplexity: 54, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'bebop', 'line', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'm47-037',
		name: 'Enclosed Approach to Each Chord',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] }, // E4  — enclose F (3 of Dm)
			{ pitch: 66, duration: [1, 8], offset: [1, 8] }, // F#4 (chromatic upper)
			{ pitch: 65, duration: [1, 4], offset: [1, 4] }, // F4  — target
			{ pitch: 69, duration: [1, 4], offset: [1, 2] }, // A4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }, // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 1] }, // Bb4 — enclose B (3 of G7)
			{ pitch: 72, duration: [1, 8], offset: [9, 8] }, // C5  (upper)
			{ pitch: 71, duration: [1, 4], offset: [5, 4] }, // B4  — target (3)
			{ pitch: 65, duration: [1, 4], offset: [3, 2] }, // F4  (b7)
			{ pitch: 62, duration: [1, 4], offset: [7, 4] }, // D4
			{ pitch: 63, duration: [1, 8], offset: [2, 1] }, // Eb4 — enclose E (3 of Cmaj7)
			{ pitch: 65, duration: [1, 8], offset: [17, 8] }, // F4  (upper, the 4)
			{ pitch: 64, duration: [1, 2], offset: [9, 4] }  // E4  — target
		],
		harmony: II_V_I,
		difficulty: { level: 52, pitchComplexity: 52, rhythmComplexity: 50, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'enclosure', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'm47-038',
		name: 'Triplet Pickup ii-V-I',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] }, // D4  — Dm7
			{ pitch: 65, duration: [1, 4], offset: [1, 4] }, // F4 (3)
			{ pitch: 69, duration: [1, 4], offset: [1, 2] }, // A4
			{ pitch: 72, duration: [1, 12], offset: [3, 4] }, // C5  triplet
			{ pitch: 71, duration: [1, 12], offset: [5, 6] }, // B4
			{ pitch: 72, duration: [1, 12], offset: [11, 12] }, // C5
			{ pitch: 71, duration: [1, 4], offset: [1, 1] }, // B4  — G7 (3)
			{ pitch: 67, duration: [1, 4], offset: [5, 4] }, // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] }, // F4 (b7)
			{ pitch: 62, duration: [1, 4], offset: [7, 4] }, // D4
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }  // E4  — resolve
		],
		harmony: II_V_I,
		difficulty: { level: 19, pitchComplexity: 15, rhythmComplexity: 18, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'triplet', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'm47-039',
		name: 'Pentatonic over the Changes',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] }, // F4  — Dm pentatonic-ish
			{ pitch: 67, duration: [1, 8], offset: [1, 8] }, // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] }, // A4
			{ pitch: 72, duration: [1, 8], offset: [3, 8] }, // C5
			{ pitch: 74, duration: [1, 4], offset: [1, 2] }, // D5
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }, // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 1] }, // B4  — G7 (3)
			{ pitch: 69, duration: [1, 8], offset: [9, 8] }, // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] }, // G4
			{ pitch: 65, duration: [1, 8], offset: [11, 8] }, // F4 (b7)
			{ pitch: 64, duration: [1, 4], offset: [3, 2] }, // E4
			{ pitch: 62, duration: [1, 4], offset: [7, 4] }, // D4
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }  // E4  — resolve (3)
		],
		harmony: II_V_I,
		difficulty: { level: 16, pitchComplexity: 14, rhythmComplexity: 13, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'pentatonic', 'line'],
		source: 'curated'
	},
	{
		id: 'm47-040',
		name: 'Confirmation-Style Resolution',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 8], offset: [0, 1] }, // A4  — Dm7
			{ pitch: 71, duration: [1, 8], offset: [1, 8] }, // B4
			{ pitch: 72, duration: [1, 8], offset: [1, 4] }, // C5
			{ pitch: 74, duration: [1, 8], offset: [3, 8] }, // D5
			{ pitch: 72, duration: [1, 8], offset: [1, 2] }, // C5
			{ pitch: 69, duration: [1, 8], offset: [5, 8] }, // A4
			{ pitch: 65, duration: [1, 8], offset: [3, 4] }, // F4 (3)
			{ pitch: 64, duration: [1, 8], offset: [7, 8] }, // E4
			{ pitch: 62, duration: [1, 8], offset: [1, 1] }, // D4  — G7
			{ pitch: 65, duration: [1, 8], offset: [9, 8] }, // F4 (b7)
			{ pitch: 68, duration: [1, 8], offset: [5, 4] }, // Ab4 (b9)
			{ pitch: 71, duration: [1, 8], offset: [11, 8] }, // B4 (3)
			{ pitch: 74, duration: [1, 8], offset: [3, 2] }, // D5
			{ pitch: 71, duration: [1, 8], offset: [13, 8] }, // B4
			{ pitch: 69, duration: [1, 8], offset: [7, 4] }, // A4
			{ pitch: 67, duration: [1, 8], offset: [15, 8] }, // G4
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }  // E4  — resolve (3)
		],
		harmony: II_V_I,
		difficulty: { level: 56, pitchComplexity: 56, rhythmComplexity: 54, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['major', '4th', '7th', 'parker', 'confirmation', 'chromatic'],
		source: 'curated'
	}
];

export const MAJOR_4_7_LICKS: Phrase[] = [...SINGLE_CHORD_LICKS, ...II_V_I_LICKS];
