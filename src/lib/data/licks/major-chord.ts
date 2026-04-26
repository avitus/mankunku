/**
 * 1-bar licks over a single major-7 chord in concert C (Cmaj7).
 *
 * When placed into a progression (e.g. the I bar of a ii-V-I), the lick is
 * transposed so its root chord matches the target chord's root — e.g. in a
 * ii-V-I in key F, this lick lands on Fmaj7.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

const MAJOR_CHORD: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [0, 1],
		duration: [1, 1]
	}
];

const MAJOR_CHORD_3BAR: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [0, 1],
		duration: [3, 1]
	}
];

export const MAJOR_CHORD_LICKS: Phrase[] = [
	{
		id: 'major-chord-001',
		name: 'Major Arpeggio Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] }, // C
			{ pitch: 64, duration: [1, 4], offset: [1, 4] }, // E
			{ pitch: 67, duration: [1, 4], offset: [1, 2] }, // G
			{ pitch: 71, duration: [1, 4], offset: [3, 4] }  // B
		],
		harmony: MAJOR_CHORD,
		difficulty: { level: 8, pitchComplexity: 8, rhythmComplexity: 5, lengthBars: 1 },
		category: 'major-chord',
		tags: ['major', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'major-chord-002',
		name: '1-2-3-5 Pattern',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },
			{ pitch: 64, duration: [1, 8], offset: [1, 2] },
			{ pitch: 62, duration: [1, 8], offset: [5, 8] },
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }
		],
		harmony: MAJOR_CHORD,
		difficulty: { level: 14, pitchComplexity: 12, rhythmComplexity: 15, lengthBars: 1 },
		category: 'major-chord',
		tags: ['major', 'digital-pattern'],
		source: 'curated'
	},
	{
		id: 'major-chord-003',
		name: 'Ionian Scalar',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },
			{ pitch: 71, duration: [1, 8], offset: [3, 4] },
			{ pitch: 72, duration: [1, 8], offset: [7, 8] }
		],
		harmony: MAJOR_CHORD,
		difficulty: { level: 12, pitchComplexity: 10, rhythmComplexity: 18, lengthBars: 1 },
		category: 'major-chord',
		tags: ['major', 'scalar'],
		source: 'curated'
	},
	{
		// 3-bar lick with a 1-bar pickup: lick bar 0 is a rest until beat 4,
		// where a triplet G-A-B leads into the bulk on lick bar 1 (Cmaj7
		// arpeggio up + scalar back down) and a final C resolution on bar 2
		// beat 1. The `pickupBars: 1` field tells the engine to shift the
		// category's base alignment left by 1 bar so the pickup lands on the
		// V chord (G7) in ii-V-I progressions.
		id: 'major-chord-pickup-001',
		name: 'Triplet Pickup to Major',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Pickup triplet on beat 4 of lick bar 0
			{ pitch: 55, duration: [1, 12], offset: [3, 4] },   // G3
			{ pitch: 57, duration: [1, 12], offset: [5, 6] },   // A3
			{ pitch: 59, duration: [1, 12], offset: [11, 12] }, // B3
			// Bulk on lick bar 1: arpeggio up, scalar down
			{ pitch: 60, duration: [1, 8], offset: [1, 1] },    // C4 ← bulk downbeat
			{ pitch: 64, duration: [1, 8], offset: [9, 8] },    // E4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },    // G4
			{ pitch: 71, duration: [1, 8], offset: [11, 8] },   // B4
			{ pitch: 69, duration: [1, 8], offset: [3, 2] },    // A4
			{ pitch: 67, duration: [1, 8], offset: [13, 8] },   // G4
			{ pitch: 65, duration: [1, 8], offset: [7, 4] },    // F4
			{ pitch: 64, duration: [1, 8], offset: [15, 8] },   // E4
			// Resolution on lick bar 2 beat 1
			{ pitch: 60, duration: [1, 4], offset: [2, 1] }     // C4
		],
		harmony: MAJOR_CHORD_3BAR,
		difficulty: {
			level: 28,
			pitchComplexity: 22,
			rhythmComplexity: 35,
			lengthBars: 3,
			pickupBars: 1
		},
		category: 'major-chord',
		tags: ['major', 'pickup', 'triplet', 'resolution'],
		source: 'curated'
	}
];
