/**
 * Curated modal jazz licks — all in concert C.
 * Dorian, Lydian, Mixolydian, and other modal vocabulary.
 *
 * Transposed at runtime to any key.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

const DORIAN_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

const LYDIAN_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.lydian',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

const MIXOLYDIAN_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

const PHRYGIAN_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'sus4' },
		scaleId: 'major.phrygian',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

export const MODAL_LICKS: Phrase[] = [
	// ── Level 2-3: Dorian modal licks ───────────────────────
	{
		id: 'modal-001',
		name: 'So What Motif',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Miles Davis "So What" voicing motif
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },     // Eb4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },     // F4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] },     // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 1] },     // Bb4
			{ pitch: 72, duration: [1, 4], offset: [5, 4] },     // C5
			{ pitch: 70, duration: [1, 4], offset: [3, 2] },     // Bb4
			{ pitch: 67, duration: [1, 4], offset: [7, 4] }      // G4
		],
		harmony: DORIAN_HARMONY,
		difficulty: { level: 24, pitchComplexity: 29, rhythmComplexity: 17, lengthBars: 2 },
		category: 'modal',
		tags: ['miles-davis', 'dorian', 'so-what'],
		source: 'curated'
	},
	{
		id: 'modal-002',
		name: 'Dorian Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Emphasizes the natural 6th (A) that defines Dorian
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },     // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },     // Eb4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] },     // A4 (natural 6th)
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 1] },     // Bb4
			{ pitch: 69, duration: [1, 8], offset: [9, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },     // G4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: DORIAN_HARMONY,
		difficulty: { level: 47, pitchComplexity: 39, rhythmComplexity: 56, lengthBars: 2 },
		category: 'modal',
		tags: ['dorian', 'characteristic-note', 'swing'],
		source: 'curated'
	},
	{
		id: 'modal-003',
		name: 'Coltrane Dorian',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Coltrane-style pentatonic over Dorian
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },     // Bb4
			{ pitch: 72, duration: [1, 8], offset: [5, 8] },     // C5
			{ pitch: 74, duration: [1, 4], offset: [3, 4] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [1, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [9, 8] },     // Bb4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G4
			{ pitch: 63, duration: [1, 4], offset: [3, 2] },     // Eb4
			{ pitch: 60, duration: [1, 4], offset: [7, 4] }      // C4
		],
		harmony: DORIAN_HARMONY,
		difficulty: { level: 53, pitchComplexity: 50, rhythmComplexity: 56, lengthBars: 2 },
		category: 'modal',
		tags: ['coltrane', 'dorian', 'pentatonic'],
		source: 'curated'
	},

	// ── Level 3-4: Lydian modal licks ───────────────────────
	{
		id: 'modal-004',
		name: 'Lydian Float',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Emphasizes #4 (F#) for Lydian color
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },     // E4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },     // F#4 (#4)
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 71, duration: [1, 4], offset: [3, 4] },     // B4
			{ pitch: 72, duration: [1, 4], offset: [1, 1] },     // C5
			{ pitch: 71, duration: [1, 4], offset: [5, 4] },     // B4
			{ pitch: 67, duration: [1, 4], offset: [3, 2] },     // G4
			{ pitch: 64, duration: [1, 4], offset: [7, 4] }      // E4
		],
		harmony: LYDIAN_HARMONY,
		difficulty: { level: 23, pitchComplexity: 30, rhythmComplexity: 14, lengthBars: 2 },
		category: 'modal',
		tags: ['lydian', 'characteristic-note', 'floating'],
		source: 'curated'
	},
	{
		id: 'modal-005',
		name: 'Lydian Cascade',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 8] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },     // F#4
			{ pitch: 64, duration: [1, 8], offset: [5, 8] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [3, 4] },     // D4
			{ pitch: 60, duration: [1, 8], offset: [7, 8] },     // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 1] },     // D4
			{ pitch: 66, duration: [1, 8], offset: [9, 8] },     // F#4
			{ pitch: 71, duration: [1, 4], offset: [5, 4] },     // B4
			{ pitch: 72, duration: [1, 2], offset: [3, 2] }      // C5
		],
		harmony: LYDIAN_HARMONY,
		difficulty: { level: 50, pitchComplexity: 42, rhythmComplexity: 61, lengthBars: 2 },
		category: 'modal',
		tags: ['lydian', 'descending', 'ascending'],
		source: 'curated'
	},

	// ── Level 3-4: Mixolydian modal licks ───────────────────
	{
		id: 'modal-006',
		name: 'Mixolydian Groove',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [1, 1] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [9, 8] },     // D4
			{ pitch: 60, duration: [1, 4], offset: [5, 4] },     // C4
			{ pitch: 62, duration: [1, 4], offset: [3, 2] },     // D4
			{ pitch: 60, duration: [1, 4], offset: [7, 4] }      // C4
		],
		harmony: MIXOLYDIAN_HARMONY,
		difficulty: { level: 42, pitchComplexity: 37, rhythmComplexity: 47, lengthBars: 2 },
		category: 'modal',
		tags: ['mixolydian', 'groove', 'dominant'],
		source: 'curated'
	},
	{
		id: 'modal-007',
		name: 'Wayne Shorter Modal',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Angular Wayne Shorter-style line
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },     // G4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },     // F4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
			{ pitch: null, duration: [1, 8], offset: [3, 4] },   // rest
			{ pitch: 69, duration: [1, 8], offset: [7, 8] },     // A4
			{ pitch: 72, duration: [1, 4], offset: [1, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [5, 4] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G4
			{ pitch: 63, duration: [1, 2], offset: [3, 2] }      // Eb4
		],
		harmony: DORIAN_HARMONY,
		difficulty: { level: 44, pitchComplexity: 36, rhythmComplexity: 55, lengthBars: 2 },
		category: 'modal',
		tags: ['wayne-shorter', 'angular', 'dorian'],
		source: 'curated'
	},

	// ── Level 4-5: Extended modal vocabulary ────────────────
	{
		id: 'modal-008',
		name: 'Impressions Motif',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Coltrane "Impressions" style
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 2] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [5, 8] },     // C5
			{ pitch: 74, duration: [1, 8], offset: [3, 4] },     // D5
			{ pitch: 75, duration: [1, 8], offset: [7, 8] },     // Eb5
			{ pitch: 74, duration: [1, 8], offset: [1, 1] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [9, 8] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] },     // F4
			{ pitch: 63, duration: [1, 4], offset: [7, 4] }      // Eb4
		],
		harmony: DORIAN_HARMONY,
		difficulty: { level: 57, pitchComplexity: 55, rhythmComplexity: 60, lengthBars: 2 },
		category: 'modal',
		tags: ['coltrane', 'impressions', 'dorian'],
		source: 'curated'
	},
	{
		id: 'modal-009',
		name: 'Phrygian Mystery',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Phrygian with the b2 characteristic tone
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 61, duration: [1, 8], offset: [1, 4] },     // Db4 (b2)
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },     // F4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 68, duration: [1, 8], offset: [1, 1] },     // Ab4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 4] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 61, duration: [1, 4], offset: [3, 2] },     // Db4
			{ pitch: 60, duration: [1, 4], offset: [7, 4] }      // C4
		],
		harmony: PHRYGIAN_HARMONY,
		difficulty: { level: 47, pitchComplexity: 46, rhythmComplexity: 47, lengthBars: 2 },
		category: 'modal',
		tags: ['phrygian', 'characteristic-note', 'mysterious'],
		source: 'curated'
	},
	{
		id: 'modal-010',
		name: 'Herbie Dorian Vamp',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Herbie Hancock style modal vamp
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 72, duration: [1, 4], offset: [1, 4] },     // C5
			{ pitch: null, duration: [1, 8], offset: [1, 2] },   // rest
			{ pitch: 74, duration: [1, 8], offset: [5, 8] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [3, 4] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [7, 8] },     // Bb4
			{ pitch: 69, duration: [1, 8], offset: [1, 1] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 4] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: DORIAN_HARMONY,
		difficulty: { level: 52, pitchComplexity: 43, rhythmComplexity: 64, lengthBars: 2 },
		category: 'modal',
		tags: ['herbie-hancock', 'dorian', 'vamp'],
		source: 'curated'
	}
];
