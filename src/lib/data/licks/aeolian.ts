/**
 * Natural minor (Aeolian) b6 licks — 40 curated lines that give a Minor
 * session its colour.
 *
 * The natural minor's b6 (Ab in concert C, the b13 of Cm7) is what separates
 * it from Dorian: the sigh from b6 down to 5, the descending minor tetrachord
 * 1-b7-b6-5, the minor iv triad (F Ab C), the bVI triad (Ab C Eb). Before this
 * collection a Minor session played almost no b6 — three phrases in 169 at
 * level 30 — because its pool is minor-pentatonic, blues and Dorian material
 * (2026-10-07). Every line here sounds the b6, and the short ones are
 * front-loaded at levels 1-14.
 *
 * Shapes: the b6 against its neighbours (5 and b7), the lament b7-b6-5, the
 * Andalusian descent, the 1-b3-5-b6 arpeggio, the iv and bVI triads, Fm7 over
 * the tonic, a triplet descent, falling diatonic thirds.
 *
 * RATING: each line is rated as the same shape in C major — calculateDifficulty
 * with every degree moved to its major-scale version, raised to the note-count
 * floor. calculateDifficulty measures chromaticism against C major, so it
 * reads the minor scale's own Eb, Ab and Bb as out-of-scale notes. (The blues
 * 2-note cells, bc-051..055, are rated below their calculated level for the
 * same reason.)
 *
 * Concert C over Cm7, scaleId 'major.aeolian'. Reference: 1=C4(60) 2=D4(62)
 * b3=Eb4(63) 4=F4(65) 5=G4(67) b6=Ab4(68) b7=Bb4(70).
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

/* ── Harmony blocks ──────────────────────────────────────────────── */

const CMIN_AEOLIAN_1BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.aeolian', startOffset: [0, 1], duration: [1, 1] }
];

const CMIN_AEOLIAN_2BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.aeolian', startOffset: [0, 1], duration: [2, 1] }
];

export const AEOLIAN_LICKS: Phrase[] = [
	{
		id: 'aeo-001',
		name: 'Flat Six Sighs to Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 2], offset: [0, 1] },  // Ab4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'descending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'aeo-002',
		name: 'Five Leans on Flat Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 68, duration: [1, 2], offset: [1, 2] }   // Ab4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-003',
		name: 'Flat Seven Down to Flat Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 2], offset: [0, 1] },  // Bb4
			{ pitch: 68, duration: [1, 2], offset: [1, 2] }   // Ab4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'aeo-004',
		name: 'Flat Six Up to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 2], offset: [0, 1] },  // Ab4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-005',
		name: 'Flat Six Down to Fourth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 2], offset: [0, 1] },  // Ab4
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 2, pitchComplexity: 4, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'aeo-006',
		name: 'Fourth Up to Flat Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 2], offset: [0, 1] },  // F4
			{ pitch: 68, duration: [1, 2], offset: [1, 2] }   // Ab4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 2, pitchComplexity: 4, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-007',
		name: 'Root Down to Flat Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 2], offset: [0, 1] },  // C5
			{ pitch: 68, duration: [1, 2], offset: [1, 2] }   // Ab4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'aeo-008',
		name: 'Flat Six Up to Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 2], offset: [0, 1] },  // Ab4
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-009',
		name: 'Second Up to Flat Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 2], offset: [0, 1] },  // D4
			{ pitch: 68, duration: [1, 2], offset: [1, 2] }   // Ab4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 19, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'ascending', 'tritone'],
		source: 'curated'
	},
	{
		id: 'aeo-010',
		name: 'Flat Six Down to Second',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 2], offset: [0, 1] },  // Ab4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] }   // D4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 19, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'descending', 'tritone'],
		source: 'curated'
	},
	{
		id: 'aeo-011',
		name: 'Flat Six Held, Then Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [3, 4], offset: [0, 1] },  // Ab4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }   // G4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 5, pitchComplexity: 1, rhythmComplexity: 10, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'descending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'aeo-012',
		name: 'Five Pushes into Flat Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 68, duration: [3, 4], offset: [1, 4] }   // Ab4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 5, pitchComplexity: 1, rhythmComplexity: 10, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-013',
		name: 'Minor Third Up to Flat Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 2], offset: [0, 1] },  // Eb4
			{ pitch: 68, duration: [1, 2], offset: [1, 2] }   // Ab4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 4, pitchComplexity: 7, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-014',
		name: 'Flat Six Down to Minor Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 2], offset: [0, 1] },  // Ab4
			{ pitch: 63, duration: [1, 2], offset: [1, 2] }   // Eb4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 4, pitchComplexity: 7, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'aeo-015',
		name: 'The Minor Lament',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 68, duration: [1, 4], offset: [1, 4] },  // Ab4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'stepwise', 'descending', 'lament'],
		source: 'curated'
	},
	{
		id: 'aeo-016',
		name: 'Lament Reversed',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 68, duration: [1, 4], offset: [1, 4] },  // Ab4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'stepwise', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-017',
		name: 'Flat Six Neighbor on Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 68, duration: [1, 4], offset: [1, 4] },  // Ab4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'aeo-018',
		name: 'Flat Six, Five, Four',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 4], offset: [0, 1] },  // Ab4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'stepwise', 'descending'],
		source: 'curated'
	},
	{
		id: 'aeo-019',
		name: 'Minor Four Triad',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },  // F4
			{ pitch: 68, duration: [1, 4], offset: [1, 4] },  // Ab4
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'triad', 'upper-structure', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-020',
		name: 'Minor Four Triad Falling',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },  // C5
			{ pitch: 68, duration: [1, 4], offset: [1, 4] },  // Ab4
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'triad', 'upper-structure', 'descending'],
		source: 'curated'
	},
	{
		id: 'aeo-021',
		name: 'Flat Six Enclosed',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 68, duration: [1, 2], offset: [1, 2] }   // Ab4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'enclosure'],
		source: 'curated'
	},
	{
		id: 'aeo-022',
		name: 'Flat Six Major Triad',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 4], offset: [0, 1] },  // Ab4
			{ pitch: 72, duration: [1, 4], offset: [1, 4] },  // C5
			{ pitch: 75, duration: [1, 2], offset: [1, 2] }   // Eb5
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'triad', 'upper-structure', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-023',
		name: 'Falling Sigh to the Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 4], offset: [0, 1] },  // Ab4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 63, duration: [1, 2], offset: [1, 2] }   // Eb4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'descending', 'lament'],
		source: 'curated'
	},
	{
		id: 'aeo-024',
		name: 'Andalusian Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },  // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },  // Bb4
			{ pitch: 68, duration: [1, 4], offset: [1, 2] },  // Ab4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }   // G4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'scale-run', 'descending', 'lament'],
		source: 'curated'
	},
	{
		id: 'aeo-025',
		name: 'Andalusian Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 68, duration: [1, 4], offset: [1, 4] },  // Ab4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },  // Bb4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }   // C5
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-026',
		name: 'Minor Flat-Six Arpeggio',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },  // Eb4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 68, duration: [1, 4], offset: [3, 4] }   // Ab4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 12, pitchComplexity: 10, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'arpeggio', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-027',
		name: 'Flat-Six Arpeggio Falling',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 4], offset: [0, 1] },  // Ab4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },  // Eb4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }   // C4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 12, pitchComplexity: 10, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'arpeggio', 'descending'],
		source: 'curated'
	},
	{
		id: 'aeo-028',
		name: 'Lament to the Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 4], offset: [0, 1] },  // Ab4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },  // F4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] }   // Eb4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'scale-run', 'descending', 'lament'],
		source: 'curated'
	},
	{
		id: 'aeo-029',
		name: 'Flat Six Turn',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 4], offset: [0, 1] },  // Ab4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },  // F4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }   // G4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'turn'],
		source: 'curated'
	},
	{
		id: 'aeo-030',
		name: 'Four-Minor Seventh over One',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },  // F4
			{ pitch: 68, duration: [1, 4], offset: [1, 4] },  // Ab4
			{ pitch: 72, duration: [1, 4], offset: [1, 2] },  // C5
			{ pitch: 75, duration: [1, 4], offset: [3, 4] }   // Eb5
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 14, pitchComplexity: 15, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'intermediate', 'arpeggio', 'upper-structure', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-031',
		name: 'Aeolian Climb to Flat Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },  // D4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },  // Eb4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },  // F4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },  // G4
			{ pitch: 68, duration: [1, 2], offset: [1, 1] }   // Ab4
		],
		harmony: CMIN_AEOLIAN_2BAR,
		difficulty: { level: 12, pitchComplexity: 11, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-032',
		name: 'Aeolian Fall from Flat Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 4], offset: [0, 1] },  // Ab4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },  // F4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] },  // Eb4
			{ pitch: 62, duration: [1, 2], offset: [1, 1] }   // D4
		],
		harmony: CMIN_AEOLIAN_2BAR,
		difficulty: { level: 12, pitchComplexity: 11, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'scale-run', 'descending'],
		source: 'curated'
	},
	{
		id: 'aeo-033',
		name: 'Long Lament to the Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 68, duration: [1, 4], offset: [1, 4] },  // Ab4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },  // F4
			{ pitch: 63, duration: [1, 2], offset: [1, 1] }   // Eb4
		],
		harmony: CMIN_AEOLIAN_2BAR,
		difficulty: { level: 12, pitchComplexity: 11, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'scale-run', 'descending', 'lament'],
		source: 'curated'
	},
	{
		id: 'aeo-034',
		name: 'Rocking on the Sigh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 68, duration: [1, 4], offset: [1, 4] },  // Ab4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },  // F4
			{ pitch: 67, duration: [1, 2], offset: [1, 1] }   // G4
		],
		harmony: CMIN_AEOLIAN_2BAR,
		difficulty: { level: 11, pitchComplexity: 9, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'beginner', 'neighbor', 'turn'],
		source: 'curated'
	},
	{
		id: 'aeo-035',
		name: 'Triplet Andalusian',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 12], offset: [0, 1] },  // C5
			{ pitch: 70, duration: [1, 12], offset: [1, 12] },  // Bb4
			{ pitch: 68, duration: [1, 12], offset: [1, 6] },  // Ab4
			{ pitch: 67, duration: [3, 4], offset: [1, 4] }   // G4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 33, pitchComplexity: 6, rhythmComplexity: 65, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'intermediate', 'triplet', 'descending', 'lament'],
		source: 'curated'
	},
	{
		id: 'aeo-036',
		name: 'Aeolian Run to Flat Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },  // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },  // Eb4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },  // F4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 68, duration: [1, 4], offset: [3, 4] }   // Ab4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 32, pitchComplexity: 16, rhythmComplexity: 52, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'intermediate', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-037',
		name: 'Aeolian Descent from Flat Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 8], offset: [0, 1] },  // Ab4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },  // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },  // F4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },  // Eb4
			{ pitch: 62, duration: [1, 4], offset: [1, 2] },  // D4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }   // C4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 32, pitchComplexity: 16, rhythmComplexity: 52, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'intermediate', 'scale-run', 'descending'],
		source: 'curated'
	},
	{
		id: 'aeo-038',
		name: 'Lament in Sequence',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 8], offset: [0, 1] },  // Ab4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },  // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },  // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },  // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },  // F4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] }   // Eb4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 30, pitchComplexity: 12, rhythmComplexity: 52, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'intermediate', 'sequence', 'descending', 'lament'],
		source: 'curated'
	},
	{
		id: 'aeo-039',
		name: 'Aeolian Line to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },  // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },  // Eb4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },  // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },  // G4
			{ pitch: 68, duration: [1, 8], offset: [5, 8] },  // Ab4
			{ pitch: 70, duration: [1, 4], offset: [3, 4] }   // Bb4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 39, pitchComplexity: 22, rhythmComplexity: 60, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'intermediate', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'aeo-040',
		name: 'Thirds Down from Flat Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 8], offset: [0, 1] },  // Ab4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },  // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },  // G4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },  // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },  // F4
			{ pitch: 62, duration: [1, 8], offset: [5, 8] },  // D4
			{ pitch: 63, duration: [1, 8], offset: [3, 4] },  // Eb4
			{ pitch: 60, duration: [1, 8], offset: [7, 8] }   // C4
		],
		harmony: CMIN_AEOLIAN_1BAR,
		difficulty: { level: 40, pitchComplexity: 23, rhythmComplexity: 62, lengthBars: 1 },
		category: 'modal',
		tags: ['aeolian', 'flat-six', 'intermediate', 'thirds', 'sequence', 'descending'],
		source: 'curated'
	}
];
