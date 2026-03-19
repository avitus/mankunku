/**
 * Curated ballad licks — all in concert C.
 * Melodic, lyrical phrases suitable for slow tempos.
 *
 * Transposed at runtime to any key.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music.ts';

const BALLAD_MAJ_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

const BALLAD_II_V_I: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [0, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'G', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [1, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [2, 1],
		duration: [2, 1]
	}
];

const BALLAD_MINOR_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'major.aeolian',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

export const BALLAD_LICKS: Phrase[] = [
	// ── Level 2-3: Simple ballad melodies ───────────────────
	{
		id: 'ballad-001',
		name: 'Body and Soul Opening',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },     // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },     // C5
			{ pitch: 71, duration: [1, 2], offset: [1, 1] },     // B4
			{ pitch: 69, duration: [1, 4], offset: [3, 2] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [7, 4] }      // G4
		],
		harmony: BALLAD_MAJ_HARMONY,
		difficulty: { level: 2, pitchComplexity: 2, rhythmComplexity: 1, lengthBars: 2 },
		category: 'ballad',
		tags: ['melodic', 'lyrical', 'standard'],
		source: 'curated'
	},
	{
		id: 'ballad-002',
		name: 'Misty Motif',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Misty-style wide interval melody
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 71, duration: [1, 4], offset: [1, 4] },     // B4 (wide leap)
			{ pitch: 69, duration: [1, 4], offset: [1, 2] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 1] },     // F4
			{ pitch: 67, duration: [1, 4], offset: [5, 4] },     // G4
			{ pitch: 64, duration: [1, 2], offset: [3, 2] }      // E4
		],
		harmony: BALLAD_MAJ_HARMONY,
		difficulty: { level: 3, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'ballad',
		tags: ['misty', 'wide-intervals', 'lyrical'],
		source: 'curated'
	},
	{
		id: 'ballad-003',
		name: 'Round Midnight Phrase',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Monk-style angular ballad phrase
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },     // Eb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 68, duration: [1, 8], offset: [3, 8] },     // Ab4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 1] },     // Bb4
			{ pitch: 68, duration: [1, 8], offset: [9, 8] },     // Ab4
			{ pitch: 67, duration: [1, 4], offset: [5, 4] },     // G4
			{ pitch: 63, duration: [1, 2], offset: [3, 2] }      // Eb4
		],
		harmony: BALLAD_MINOR_HARMONY,
		difficulty: { level: 4, pitchComplexity: 4, rhythmComplexity: 2, lengthBars: 2 },
		category: 'ballad',
		tags: ['monk', 'minor', 'angular'],
		source: 'curated'
	},

	// ── Level 3-4: Expressive ballad phrases ────────────────
	{
		id: 'ballad-004',
		name: 'Ballad ii-V-I Sigh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: lyrical opening
			{ pitch: 69, duration: [1, 4], offset: [0, 1] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			// G7: gentle descent
			{ pitch: 71, duration: [1, 4], offset: [1, 1] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G4
			{ pitch: 65, duration: [1, 2], offset: [3, 2] },     // F4
			// Cmaj7: resolve
			{ pitch: 64, duration: [1, 1], offset: [2, 1] },     // E4
			{ pitch: 60, duration: [1, 1], offset: [3, 1] }      // C4
		],
		harmony: BALLAD_II_V_I,
		difficulty: { level: 3, pitchComplexity: 3, rhythmComplexity: 2, lengthBars: 4 },
		category: 'ballad',
		tags: ['ii-V-I', 'lyrical', 'sigh'],
		source: 'curated'
	},
	{
		id: 'ballad-005',
		name: 'Chet Baker Phrase',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Chet Baker style: simple, beautiful, space
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },     // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] },     // A4
			{ pitch: 71, duration: [1, 4], offset: [3, 4] },     // B4
			{ pitch: 72, duration: [1, 2], offset: [1, 1] },     // C5
			{ pitch: null, duration: [1, 4], offset: [3, 2] },   // rest (space)
			{ pitch: 71, duration: [1, 8], offset: [7, 4] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [15, 8] },    // A4
			{ pitch: 67, duration: [1, 2], offset: [2, 1] },     // G4
			{ pitch: 64, duration: [1, 2], offset: [5, 2] }      // E4
		],
		harmony: BALLAD_MAJ_HARMONY,
		difficulty: { level: 2, pitchComplexity: 2, rhythmComplexity: 1, lengthBars: 3 },
		category: 'ballad',
		tags: ['chet-baker', 'space', 'lyrical'],
		source: 'curated'
	},

	// ── Level 4-5: Ornamental ballad phrases ────────────────
	{
		id: 'ballad-006',
		name: 'Ballad Ornament',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Ornamental turn on the 3rd
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 65, duration: [1, 16], offset: [1, 8] },    // F4 (turn)
			{ pitch: 64, duration: [1, 16], offset: [3, 16] },   // E4
			{ pitch: 62, duration: [1, 8], offset: [1, 4] },     // D4
			{ pitch: 64, duration: [1, 4], offset: [3, 8] },     // E4
			{ pitch: 67, duration: [1, 4], offset: [5, 8] },     // G4
			{ pitch: 72, duration: [1, 4], offset: [7, 8] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [9, 8] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [11, 8] },    // G4
			{ pitch: 64, duration: [1, 2], offset: [13, 8] }     // E4
		],
		harmony: BALLAD_MAJ_HARMONY,
		difficulty: { level: 5, pitchComplexity: 3, rhythmComplexity: 4, lengthBars: 2 },
		category: 'ballad',
		tags: ['ornament', 'turn', 'expressive'],
		source: 'curated'
	},
	{
		id: 'ballad-007',
		name: 'Lush Life Fragment',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Strayhorn-style chromatic ballad melody
			{ pitch: 71, duration: [1, 4], offset: [0, 1] },     // B4
			{ pitch: 72, duration: [1, 4], offset: [1, 4] },     // C5
			{ pitch: 74, duration: [1, 4], offset: [1, 2] },     // D5
			{ pitch: 73, duration: [1, 4], offset: [3, 4] },     // Db5 (chromatic)
			{ pitch: 72, duration: [1, 4], offset: [1, 1] },     // C5
			{ pitch: 69, duration: [1, 4], offset: [5, 4] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [3, 2] },     // G4
			{ pitch: 64, duration: [1, 4], offset: [7, 4] }      // E4
		],
		harmony: BALLAD_MAJ_HARMONY,
		difficulty: { level: 4, pitchComplexity: 4, rhythmComplexity: 1, lengthBars: 2 },
		category: 'ballad',
		tags: ['strayhorn', 'chromatic', 'lyrical'],
		source: 'curated'
	}
];
