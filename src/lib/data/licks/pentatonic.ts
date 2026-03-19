/**
 * Curated pentatonic licks — all in concert C.
 * Major and minor pentatonic patterns and sequences.
 *
 * Transposed at runtime to any key.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music.ts';

const CMAJ_PENT_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'pentatonic.major',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

const CMIN_PENT_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'pentatonic.minor',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

const DOM7_PENT_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: '7' },
		scaleId: 'pentatonic.major',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

export const PENTATONIC_LICKS: Phrase[] = [
	// ── Level 1-2: Basic pentatonic patterns ────────────────
	{
		id: 'pent-001',
		name: 'Major Pent Ascend',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 62, duration: [1, 4], offset: [1, 4] },     // D4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },     // E4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 1] },     // A4
			{ pitch: 72, duration: [3, 4], offset: [5, 4] }      // C5
		],
		harmony: CMAJ_PENT_HARMONY,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'ascending', 'beginner'],
		source: 'curated'
	},
	{
		id: 'pent-002',
		name: 'Minor Pent Descend',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },     // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			{ pitch: 63, duration: [1, 4], offset: [1, 1] },     // Eb4
			{ pitch: 60, duration: [3, 4], offset: [5, 4] }      // C4
		],
		harmony: CMIN_PENT_HARMONY,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['minor-pentatonic', 'descending', 'beginner'],
		source: 'curated'
	},

	// ── Level 2-3: Pentatonic sequences ─────────────────────
	{
		id: 'pent-003',
		name: 'Pent Groups of Three',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// C-D-E, D-E-G, E-G-A, G-A-C
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },     // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [3, 8] },     // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 2] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [3, 4] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [7, 8] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 1] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 72, duration: [1, 2], offset: [11, 8] }     // C5
		],
		harmony: CMAJ_PENT_HARMONY,
		difficulty: { level: 3, pitchComplexity: 2, rhythmComplexity: 2, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['sequence', 'groups-of-three', 'major-pentatonic'],
		source: 'curated'
	},
	{
		id: 'pent-004',
		name: 'Minor Pent Skippy',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Skip pattern: C-G, Eb-Bb, F-C, G-Eb
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },     // Eb4
			{ pitch: 70, duration: [1, 8], offset: [3, 8] },     // Bb4
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },     // F4
			{ pitch: 72, duration: [1, 8], offset: [5, 8] },     // C5
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 1] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 63, duration: [1, 4], offset: [5, 4] },     // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: CMIN_PENT_HARMONY,
		difficulty: { level: 3, pitchComplexity: 3, rhythmComplexity: 2, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['skip-pattern', 'minor-pentatonic', 'intervals'],
		source: 'curated'
	},
	{
		id: 'pent-005',
		name: 'McCoy Tyner Fourths',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Stacked fourths pattern (Tyner-style)
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },     // Bb4
			{ pitch: 62, duration: [1, 8], offset: [1, 2] },     // D4
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },     // G4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 1] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 4] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: CMIN_PENT_HARMONY,
		difficulty: { level: 4, pitchComplexity: 4, rhythmComplexity: 2, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['fourths', 'mccoy-tyner', 'modern'],
		source: 'curated'
	},
	{
		id: 'pent-006',
		name: 'Pent Four-Note Cells',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// 1-2-3-5 pentatonic cells ascending
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },     // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 62, duration: [1, 8], offset: [1, 2] },     // D4
			{ pitch: 64, duration: [1, 8], offset: [5, 8] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [7, 8] },     // A4
			{ pitch: 64, duration: [1, 8], offset: [1, 1] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 72, duration: [1, 2], offset: [11, 8] }     // C5
		],
		harmony: CMAJ_PENT_HARMONY,
		difficulty: { level: 3, pitchComplexity: 2, rhythmComplexity: 2, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['digital-pattern', 'cells', 'major-pentatonic'],
		source: 'curated'
	},

	// ── Level 3-4: Applied pentatonic patterns ──────────────
	{
		id: 'pent-007',
		name: 'Dominant Pent Riff',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5
			{ pitch: 74, duration: [1, 8], offset: [3, 8] },     // D5
			{ pitch: 72, duration: [1, 4], offset: [1, 2] },     // C5
			{ pitch: 69, duration: [1, 4], offset: [3, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [9, 8] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [5, 4] },     // D4
			{ pitch: 60, duration: [1, 8], offset: [11, 8] },    // C4
			{ pitch: 62, duration: [1, 2], offset: [3, 2] }      // D4
		],
		harmony: DOM7_PENT_HARMONY,
		difficulty: { level: 3, pitchComplexity: 2, rhythmComplexity: 2, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['dominant', 'riff', 'major-pentatonic'],
		source: 'curated'
	},
	{
		id: 'pent-008',
		name: 'Wes Montgomery Octaves',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Octave-style pentatonic melody
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] },     // A4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [1, 1] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 64, duration: [1, 4], offset: [5, 4] },     // E4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: CMAJ_PENT_HARMONY,
		difficulty: { level: 2, pitchComplexity: 2, rhythmComplexity: 2, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['wes-montgomery', 'melodic', 'major-pentatonic'],
		source: 'curated'
	},

	// ── Level 4-5: Advanced pentatonic ──────────────────────
	{
		id: 'pent-009',
		name: 'Herbie Hancock Lick',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Funky pentatonic with syncopation
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: null, duration: [1, 8], offset: [1, 2] },   // rest
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [7, 8] },     // Bb4
			{ pitch: 72, duration: [1, 8], offset: [1, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [9, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [11, 8] },    // F4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: CMIN_PENT_HARMONY,
		difficulty: { level: 4, pitchComplexity: 3, rhythmComplexity: 3, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['herbie-hancock', 'funky', 'syncopation'],
		source: 'curated'
	},
	{
		id: 'pent-010',
		name: 'Pentatonic Superimposition',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// D major pentatonic over Cmaj7 (creates lydian color)
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E4
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },     // F#4
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			{ pitch: 71, duration: [1, 8], offset: [1, 2] },     // B4
			{ pitch: 74, duration: [1, 8], offset: [5, 8] },     // D5
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 1] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [9, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [11, 8] },    // E4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: CMAJ_PENT_HARMONY,
		difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 3, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['superimposition', 'lydian', 'advanced'],
		source: 'curated'
	}
];
