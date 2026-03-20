/**
 * Curated ii-V-I minor licks — all in concert C minor.
 * Harmony: Dm7b5 → G7alt → Cm(maj7)
 *
 * Transposed at runtime to any key.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music.ts';

const II_V_I_MINOR_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7b5' },
		scaleId: 'melodic-minor.locrian-nat2',
		startOffset: [0, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'G', quality: '7alt' },
		scaleId: 'melodic-minor.altered',
		startOffset: [1, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'major.aeolian',
		startOffset: [2, 1],
		duration: [1, 1]
	}
];

const II_V_I_MINOR_HALF: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7b5' },
		scaleId: 'melodic-minor.locrian-nat2',
		startOffset: [0, 1],
		duration: [1, 2]
	},
	{
		chord: { root: 'G', quality: '7alt' },
		scaleId: 'melodic-minor.altered',
		startOffset: [1, 2],
		duration: [1, 2]
	},
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'major.aeolian',
		startOffset: [1, 1],
		duration: [1, 1]
	}
];

export const II_V_I_MINOR_LICKS: Phrase[] = [
	{
		id: 'ii-V-I-min-001',
		name: 'Minor Arpeggio Walk',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },     // D4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },     // F4
			{ pitch: 68, duration: [1, 4], offset: [1, 2] },     // Ab4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },     // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 1] },     // Bb4
			{ pitch: 68, duration: [1, 4], offset: [5, 4] },     // Ab4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] },     // F4
			{ pitch: 63, duration: [1, 4], offset: [7, 4] },     // Eb4
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 28, pitchComplexity: 39, rhythmComplexity: 15, lengthBars: 3 },
		category: 'ii-V-I-minor',
		tags: ['arpeggio', 'minor'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-002',
		name: 'Natural Minor Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 8], offset: [0, 1] },     // Ab4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 62, duration: [1, 4], offset: [1, 2] },     // D4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] },     // C4
			{ pitch: 68, duration: [1, 8], offset: [1, 1] },     // Ab4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 4] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 62, duration: [1, 4], offset: [3, 2] },     // D4
			{ pitch: 60, duration: [1, 4], offset: [7, 4] },     // C4
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 49, pitchComplexity: 50, rhythmComplexity: 49, lengthBars: 3 },
		category: 'ii-V-I-minor',
		tags: ['natural-minor', 'descending'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-003',
		name: 'Harmonic Minor Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 68, duration: [1, 8], offset: [3, 8] },     // Ab4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			// G7alt: altered tones
			{ pitch: 68, duration: [1, 8], offset: [1, 1] },     // Ab4
			{ pitch: 71, duration: [1, 8], offset: [9, 8] },     // B4 (nat 3 of G)
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4 (#9)
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] },     // F4
			{ pitch: 63, duration: [1, 4], offset: [7, 4] },     // Eb4
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 48, pitchComplexity: 47, rhythmComplexity: 49, lengthBars: 3 },
		category: 'ii-V-I-minor',
		tags: ['harmonic-minor', 'altered'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-004',
		name: 'Altered Scale Run',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] },     // F4
			{ pitch: 68, duration: [1, 8], offset: [1, 8] },     // Ab4
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5
			{ pitch: 68, duration: [1, 8], offset: [3, 8] },     // Ab4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },     // F4
			{ pitch: 62, duration: [1, 4], offset: [3, 4] },     // D4
			// G7alt: altered scale descending
			{ pitch: 68, duration: [1, 8], offset: [1, 1] },     // Ab4 (b9)
			{ pitch: 66, duration: [1, 8], offset: [9, 8] },     // F#4 (b7 enharmonic)
			{ pitch: 65, duration: [1, 8], offset: [5, 4] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 62, duration: [1, 8], offset: [3, 2] },     // D4
			{ pitch: 60, duration: [1, 8], offset: [13, 8] },    // C4
			{ pitch: 59, duration: [1, 4], offset: [7, 4] },     // B3
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 56, pitchComplexity: 60, rhythmComplexity: 52, lengthBars: 3 },
		category: 'ii-V-I-minor',
		tags: ['altered', 'scale-run'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-005',
		name: 'Minor Enclosure',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7b5: enclosure around Ab
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			{ pitch: 68, duration: [1, 4], offset: [1, 4] },     // Ab4 (target)
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },     // F4
			{ pitch: 62, duration: [1, 8], offset: [5, 8] },     // D4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] },     // C4
			// G7alt
			{ pitch: 71, duration: [1, 8], offset: [1, 1] },     // B4
			{ pitch: 68, duration: [1, 8], offset: [9, 8] },     // Ab4
			{ pitch: 66, duration: [1, 8], offset: [5, 4] },     // Gb4
			{ pitch: 65, duration: [1, 8], offset: [11, 8] },    // F4
			{ pitch: 63, duration: [1, 4], offset: [3, 2] },     // Eb4
			{ pitch: 60, duration: [1, 4], offset: [7, 4] },     // C4
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 53, pitchComplexity: 57, rhythmComplexity: 49, lengthBars: 3 },
		category: 'ii-V-I-minor',
		tags: ['enclosure', 'minor'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-006',
		name: 'Quick Minor ii-V',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7b5 (2 beats)
			{ pitch: 68, duration: [1, 8], offset: [0, 1] },     // Ab4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 62, duration: [1, 8], offset: [1, 4] },     // D4
			{ pitch: 60, duration: [1, 8], offset: [3, 8] },     // C4
			// G7alt (2 beats)
			{ pitch: 59, duration: [1, 8], offset: [1, 2] },     // B3
			{ pitch: 63, duration: [1, 8], offset: [5, 8] },     // Eb4
			{ pitch: 66, duration: [1, 8], offset: [3, 4] },     // F#4
			{ pitch: 68, duration: [1, 8], offset: [7, 8] },     // Ab4
			// Cm resolution
			{ pitch: 67, duration: [1, 1], offset: [1, 1] }      // G4
		],
		harmony: II_V_I_MINOR_HALF,
		difficulty: { level: 42, pitchComplexity: 36, rhythmComplexity: 49, lengthBars: 2 },
		category: 'ii-V-I-minor',
		tags: ['compact', 'altered'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-007',
		name: 'Melodic Minor Approach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 68, duration: [1, 8], offset: [1, 4] },     // Ab4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [5, 8] },     // Eb4
			{ pitch: 62, duration: [1, 4], offset: [3, 4] },     // D4
			// G7: melodic minor a half-step up
			{ pitch: 68, duration: [1, 8], offset: [1, 1] },     // Ab4
			{ pitch: 66, duration: [1, 8], offset: [9, 8] },     // Gb4
			{ pitch: 65, duration: [1, 8], offset: [5, 4] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 62, duration: [1, 8], offset: [3, 2] },     // D4
			{ pitch: 59, duration: [1, 8], offset: [13, 8] },    // B3
			{ pitch: 60, duration: [1, 4], offset: [7, 4] },     // C4
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 53, pitchComplexity: 50, rhythmComplexity: 55, lengthBars: 3 },
		category: 'ii-V-I-minor',
		tags: ['melodic-minor', 'approach'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-008',
		name: 'Diminished Passing',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7b5: diminished arpeggio
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 68, duration: [1, 8], offset: [1, 4] },     // Ab4
			{ pitch: 71, duration: [1, 8], offset: [3, 8] },     // B4 (dim7)
			{ pitch: 72, duration: [1, 8], offset: [1, 2] },     // C5
			{ pitch: 68, duration: [1, 8], offset: [5, 8] },     // Ab4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			// G7alt
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 68, duration: [1, 8], offset: [9, 8] },     // Ab4
			{ pitch: 71, duration: [1, 8], offset: [5, 4] },     // B4
			{ pitch: 68, duration: [1, 8], offset: [11, 8] },    // Ab4
			{ pitch: 67, duration: [1, 8], offset: [3, 2] },     // G4
			{ pitch: 63, duration: [1, 8], offset: [13, 8] },    // Eb4
			{ pitch: 62, duration: [1, 4], offset: [7, 4] },     // D4
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 53, pitchComplexity: 52, rhythmComplexity: 55, lengthBars: 3 },
		category: 'ii-V-I-minor',
		tags: ['diminished', 'passing-tones'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-009',
		name: 'Simple Minor Guide',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },     // F4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },     // Eb4
			{ pitch: 62, duration: [1, 4], offset: [1, 2] },     // D4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] },     // C4
			{ pitch: 59, duration: [1, 4], offset: [1, 1] },     // B3
			{ pitch: 63, duration: [1, 4], offset: [5, 4] },     // Eb4
			{ pitch: 62, duration: [1, 4], offset: [3, 2] },     // D4
			{ pitch: 60, duration: [1, 4], offset: [7, 4] },     // C4
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 22, pitchComplexity: 28, rhythmComplexity: 15, lengthBars: 3 },
		category: 'ii-V-I-minor',
		tags: ['guide-tones', 'beginner', 'minor'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-010',
		name: 'Chromatic Minor Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 68, duration: [1, 8], offset: [1, 8] },     // Ab4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 62, duration: [1, 8], offset: [3, 8] },     // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 2] },     // Eb4
			{ pitch: 64, duration: [1, 8], offset: [5, 8] },     // E4 (chromatic)
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			// G7alt
			{ pitch: 71, duration: [1, 8], offset: [1, 1] },     // B4
			{ pitch: 70, duration: [1, 8], offset: [9, 8] },     // Bb4
			{ pitch: 68, duration: [1, 8], offset: [5, 4] },     // Ab4
			{ pitch: 66, duration: [1, 8], offset: [11, 8] },    // F#4
			{ pitch: 65, duration: [1, 8], offset: [3, 2] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [13, 8] },    // Eb4
			{ pitch: 62, duration: [1, 4], offset: [7, 4] },     // D4
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 59, pitchComplexity: 62, rhythmComplexity: 55, lengthBars: 3 },
		category: 'ii-V-I-minor',
		tags: ['chromatic', 'minor', 'bebop'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-011',
		name: 'Minor Pentatonic Vamp',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [5, 4] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [11, 8] },    // C4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 47, pitchComplexity: 39, rhythmComplexity: 56, lengthBars: 2 },
		category: 'ii-V-I-minor',
		tags: ['pentatonic', 'minor', 'swing'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-012',
		name: 'Tritone Sub Minor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] },     // F4
			{ pitch: 68, duration: [1, 8], offset: [1, 8] },     // Ab4
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [3, 8] },     // Bb4
			{ pitch: 68, duration: [1, 8], offset: [1, 2] },     // Ab4
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },     // F4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] },     // Eb4
			// Db7 (tritone sub of G7)
			{ pitch: 61, duration: [1, 8], offset: [1, 1] },     // Db4
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },     // F4
			{ pitch: 68, duration: [1, 8], offset: [5, 4] },     // Ab4
			{ pitch: 72, duration: [1, 8], offset: [11, 8] },    // C5 (nat 7)
			{ pitch: 70, duration: [1, 8], offset: [3, 2] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [13, 8] },    // G4
			{ pitch: 63, duration: [1, 4], offset: [7, 4] },     // Eb4
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 56, pitchComplexity: 57, rhythmComplexity: 55, lengthBars: 3 },
		category: 'ii-V-I-minor',
		tags: ['tritone-sub', 'advanced', 'minor'],
		source: 'curated'
	},

	// ── Difficulty 45-60: More minor ii-V-I vocabulary ──────
	{
		id: 'ii-V-I-min-013',
		name: 'Woody Shaw Minor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Woody Shaw style: wide intervals over minor
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 68, duration: [1, 8], offset: [1, 8] },     // Ab4 (wide leap)
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [1, 2] },     // Eb4
			{ pitch: 62, duration: [1, 8], offset: [5, 8] },     // D4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] },     // C4
			// G7alt
			{ pitch: 71, duration: [1, 8], offset: [1, 1] },     // B4
			{ pitch: 68, duration: [1, 8], offset: [9, 8] },     // Ab4
			{ pitch: 66, duration: [1, 8], offset: [5, 4] },     // F#4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 62, duration: [1, 8], offset: [3, 2] },     // D4
			{ pitch: 60, duration: [1, 8], offset: [13, 8] },    // C4
			{ pitch: 59, duration: [1, 4], offset: [7, 4] },     // B3
			// Cm
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 61, pitchComplexity: 66, rhythmComplexity: 55, lengthBars: 3 },
		category: 'ii-V-I-minor',
		tags: ['woody-shaw', 'wide-intervals', 'altered'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-014',
		name: 'Joe Henderson Minor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Joe Henderson style: angular, intervallic
			{ pitch: 68, duration: [1, 8], offset: [0, 1] },     // Ab4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5
			{ pitch: 68, duration: [1, 8], offset: [3, 8] },     // Ab4
			{ pitch: 62, duration: [1, 8], offset: [1, 2] },     // D4
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },     // F4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			// G7alt
			{ pitch: 68, duration: [1, 8], offset: [1, 1] },     // Ab4
			{ pitch: 71, duration: [1, 8], offset: [9, 8] },     // B4
			{ pitch: 66, duration: [1, 8], offset: [5, 4] },     // F#4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 60, duration: [1, 4], offset: [3, 2] },     // C4
			{ pitch: 59, duration: [1, 4], offset: [7, 4] },     // B3
			// Cm
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_MINOR_HARMONY,
		difficulty: { level: 58, pitchComplexity: 62, rhythmComplexity: 52, lengthBars: 3 },
		category: 'ii-V-I-minor',
		tags: ['joe-henderson', 'angular', 'intervallic'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-min-015',
		name: 'Quick Minor Chromatic',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7b5 (2 beats)
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 68, duration: [1, 8], offset: [1, 8] },     // Ab4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },     // E4 (chromatic)
			// G7alt (2 beats)
			{ pitch: 63, duration: [1, 8], offset: [1, 2] },     // Eb4
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },     // F#4
			{ pitch: 68, duration: [1, 8], offset: [3, 4] },     // Ab4
			{ pitch: 71, duration: [1, 8], offset: [7, 8] },     // B4
			// Cm resolution
			{ pitch: 72, duration: [1, 1], offset: [1, 1] }      // C5
		],
		harmony: II_V_I_MINOR_HALF,
		difficulty: { level: 45, pitchComplexity: 41, rhythmComplexity: 49, lengthBars: 2 },
		category: 'ii-V-I-minor',
		tags: ['compact', 'chromatic', 'altered'],
		source: 'curated'
	}
];
