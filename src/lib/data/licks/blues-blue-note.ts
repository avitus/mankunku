/**
 * Blues "blue note" licks — 75 curated lines that fill the blues-scale
 * pool's pentatonic gap. The minor-pentatonic scale (1 b3 4 5 b7) and the minor-blues
 * scale (1 b3 4 b5 5 b7) differ by exactly one note: the b5, the "blue note"
 * (F# / MIDI 66 in concert C). Without it, early blues licks are indistinguishable
 * from minor pentatonic.
 *
 * Every lick here FEATURES the b5 and uses only the six blues-scale tones
 * { C, Eb, F, F#, G, Bb } = pitch classes { 0, 3, 5, 6, 7, 10 }, so it survives the
 * runtime snap-to-scale intact in a blues session. Evenly distributed across
 * difficulty levels 1-25 (3 per level) so the blue note is present from the very
 * first blues session onward.
 *
 * Concert C. Palette: 55=G3 58=Bb3 60=C4(1) 63=Eb4(b3) 65=F4(4) 66=F#4(b5)
 * 67=G4(5) 70=Bb4(b7) 72=C5(1) 75=Eb5 77=F5 78=F#5 79=G5.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

const BLUES_1BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: '7' }, scaleId: 'blues.minor', startOffset: [0, 1], duration: [1, 1] }
];

const BLUES_2BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: '7' }, scaleId: 'blues.minor', startOffset: [0, 1], duration: [2, 1] }
];

export const BLUES_BLUE_NOTE_LICKS: Phrase[] = [
	{
		id: 'bbn-001',
		name: 'Blue Note Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 2], offset: [0, 1] },
			{ pitch: 66, duration: [1, 2], offset: [1, 2] },
			{ pitch: 67, duration: [1, 2], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 1, pitchComplexity: 5, rhythmComplexity: 1, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'passing-up', 'beginner'],
		source: 'curated'
	},
	{
		id: 'bbn-002',
		name: 'Blue Note Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },
			{ pitch: 66, duration: [1, 2], offset: [1, 2] },
			{ pitch: 65, duration: [1, 2], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 1, pitchComplexity: 5, rhythmComplexity: 1, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'passing-down', 'beginner'],
		source: 'curated'
	},
	{
		id: 'bbn-003',
		name: 'Blue Neighbor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },
			{ pitch: 66, duration: [1, 2], offset: [1, 2] },
			{ pitch: 67, duration: [1, 2], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 1, pitchComplexity: 5, rhythmComplexity: 1, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'neighbor', 'upper-neighbor', 'beginner'],
		source: 'curated'
	},
	{
		id: 'bbn-004',
		name: 'Four to Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },
			{ pitch: 67, duration: [1, 2], offset: [1, 2] },
			{ pitch: 67, duration: [1, 4], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 2, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'passing-up'],
		source: 'curated'
	},
	{
		id: 'bbn-005',
		name: 'Down to the Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },
			{ pitch: 63, duration: [1, 2], offset: [3, 4] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 2, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'passing-down', 'resolve-b3'],
		source: 'curated'
	},
	{
		id: 'bbn-006',
		name: 'Up to the Seventh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },
			{ pitch: 70, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 2, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'passing-up', 'reach-b7'],
		source: 'curated'
	},
	{
		id: 'bbn-007',
		name: 'Root Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 3, pitchComplexity: 7, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'passing-up', 'from-root'],
		source: 'curated'
	},
	{
		id: 'bbn-008',
		name: 'Reach for the High Cry',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },
			{ pitch: 72, duration: [1, 4], offset: [1, 2] },
			{ pitch: 78, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 3, pitchComplexity: 7, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'high-register', 'octave-blue'],
		source: 'curated'
	},
	{
		id: 'bbn-009',
		name: 'Blue Note Step-Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 3, pitchComplexity: 7, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'beginner', 'passing-up'],
		source: 'curated'
	},
	{
		id: 'bbn-010',
		name: 'Blue Note Roll-Off',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },
			{ pitch: 63, duration: [1, 2], offset: [1, 2] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 4, pitchComplexity: 8, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'beginner', 'passing-down'],
		source: 'curated'
	},
	{
		id: 'bbn-011',
		name: 'Through the Blue to the Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 4, pitchComplexity: 8, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'beginner', 'passing-up'],
		source: 'curated'
	},
	{
		id: 'bbn-012',
		name: 'Low Blue Lift',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 58, duration: [1, 4], offset: [0, 1] },
			{ pitch: 60, duration: [1, 4], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 4, pitchComplexity: 8, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'beginner', 'low-register'],
		source: 'curated'
	},
	{
		id: 'bbn-013',
		name: 'Blue Note Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 5, pitchComplexity: 9, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'beginner', 'blues', 'descending', 'passing-down'],
		source: 'curated'
	},
	{
		id: 'bbn-014',
		name: 'Blue Wobble',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 5, pitchComplexity: 9, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'beginner', 'blues', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'bbn-015',
		name: 'Cry on the Blue',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 2], offset: [1, 4] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 5, pitchComplexity: 9, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'beginner', 'blues', 'held-cry', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bbn-016',
		name: 'Curl Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },
			{ pitch: 63, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 6, pitchComplexity: 10, rhythmComplexity: 2, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'curl', 'descending', 'passing-down'],
		source: 'curated'
	},
	{
		id: 'bbn-017',
		name: 'Step Up Blue',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },
			{ pitch: 66, duration: [1, 4], offset: [1, 2] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 6, pitchComplexity: 10, rhythmComplexity: 2, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'passing-up'],
		source: 'curated'
	},
	{
		id: 'bbn-018',
		name: 'Neighbor Cry',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 6, pitchComplexity: 10, rhythmComplexity: 2, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'neighbor', 'valley'],
		source: 'curated'
	},
	{
		id: 'bbn-019',
		name: 'Curl to the Floor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 7, pitchComplexity: 11, rhythmComplexity: 3, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'curl', 'descending', 'passing-down'],
		source: 'curated'
	},
	{
		id: 'bbn-020',
		name: 'Step to the Blue',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },
			{ pitch: 66, duration: [1, 4], offset: [1, 2] },
			{ pitch: 67, duration: [1, 2], offset: [3, 4] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 7, pitchComplexity: 11, rhythmComplexity: 3, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'ascending', 'blue-note-passing-up'],
		source: 'curated'
	},
	{
		id: 'bbn-021',
		name: 'Blue Neighbor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 7, pitchComplexity: 11, rhythmComplexity: 3, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'neighbor', 'blue-note-neighbor', 'arch'],
		source: 'curated'
	},
	{
		id: 'bbn-022',
		name: 'Curl and Bounce',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 8, pitchComplexity: 12, rhythmComplexity: 4, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'valley', 'blue-note-passing-down', 'blues-curl', 'eighths'],
		source: 'curated'
	},
	{
		id: 'bbn-023',
		name: 'Blue Shake',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 4], offset: [1, 2] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 8, pitchComplexity: 12, rhythmComplexity: 4, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'shake', 'blue-note-shake', 'eighths'],
		source: 'curated'
	},
	{
		id: 'bbn-024',
		name: 'Up to the Cry',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 66, duration: [1, 4], offset: [1, 2] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 8, pitchComplexity: 12, rhythmComplexity: 4, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'ascending', 'blue-note-accented', 'blue-note-held'],
		source: 'curated'
	},
	{
		id: 'bbn-025',
		name: 'Climb to Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 9, pitchComplexity: 13, rhythmComplexity: 5, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'ascending', 'passing-up'],
		source: 'curated'
	},
	{
		id: 'bbn-026',
		name: 'Low Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },
			{ pitch: 67, duration: [1, 4], offset: [5, 8] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 9, pitchComplexity: 13, rhythmComplexity: 5, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'ascending', 'passing-up'],
		source: 'curated'
	},
	{
		id: 'bbn-027',
		name: 'Up and Over',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },
			{ pitch: 63, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 9, pitchComplexity: 13, rhythmComplexity: 5, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'arch', 'passing'],
		source: 'curated'
	},
	{
		id: 'bbn-028',
		name: 'Syncopated Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [3, 8], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 10, pitchComplexity: 14, rhythmComplexity: 6, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'syncopation', 'ascending', 'passing-up'],
		source: 'curated'
	},
	{
		id: 'bbn-029',
		name: 'Climb Through the Blue',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 10, pitchComplexity: 14, rhythmComplexity: 6, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues-scale', 'passing-up', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bbn-030',
		name: 'Blue Note Wobble',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },
			{ pitch: 63, duration: [1, 4], offset: [1, 2] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 10, pitchComplexity: 14, rhythmComplexity: 6, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues-scale', 'neighbor', 'zigzag'],
		source: 'curated'
	},
	{
		id: 'bbn-031',
		name: 'Blue Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 4], offset: [1, 2] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 11, pitchComplexity: 15, rhythmComplexity: 7, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'passing-up', 'eighths'],
		source: 'curated'
	},
	{
		id: 'bbn-032',
		name: 'Slide Back Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },
			{ pitch: 60, duration: [1, 4], offset: [1, 2] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 11, pitchComplexity: 15, rhythmComplexity: 7, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'passing-down', 'eighths'],
		source: 'curated'
	},
	{
		id: 'bbn-033',
		name: 'Little Cry',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 11, pitchComplexity: 15, rhythmComplexity: 7, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'neighbor', 'cry'],
		source: 'curated'
	},
	{
		id: 'bbn-034',
		name: 'Shake It Out',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },
			{ pitch: 65, duration: [1, 8], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 12, pitchComplexity: 16, rhythmComplexity: 8, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'shake', 'repeated'],
		source: 'curated'
	},
	{
		id: 'bbn-035',
		name: 'Reaching High',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },
			{ pitch: 70, duration: [1, 8], offset: [3, 8] },
			{ pitch: 72, duration: [1, 4], offset: [1, 2] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 12, pitchComplexity: 16, rhythmComplexity: 8, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'passing-up', 'high-register'],
		source: 'curated'
	},
	{
		id: 'bbn-036',
		name: 'Blue Note Step Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 2], offset: [3, 4] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 12, pitchComplexity: 16, rhythmComplexity: 8, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'ascending', 'passing-up'],
		source: 'curated'
	},
	{
		id: 'bbn-037',
		name: 'Zigzag Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 13, pitchComplexity: 17, rhythmComplexity: 9, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'zigzag', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'bbn-038',
		name: 'Blues Run Down From Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 63, duration: [1, 8], offset: [5, 8] },
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 13, pitchComplexity: 17, rhythmComplexity: 9, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'descending', 'passing-down', 'run'],
		source: 'curated'
	},
	{
		id: 'bbn-039',
		name: 'Octave Reach Through Blue',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 13, pitchComplexity: 17, rhythmComplexity: 9, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'ascending', 'passing-up', 'octave'],
		source: 'curated'
	},
	{
		id: 'bbn-040',
		name: 'Call and Answer Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },
			{ pitch: 63, duration: [1, 4], offset: [3, 4] },
			{ pitch: 60, duration: [1, 4], offset: [1, 1] },
			{ pitch: 65, duration: [1, 8], offset: [5, 4] },
			{ pitch: 66, duration: [1, 8], offset: [11, 8] },
			{ pitch: 67, duration: [1, 2], offset: [3, 2] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 14, pitchComplexity: 18, rhythmComplexity: 10, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'zigzag', 'two-bar'],
		source: 'curated'
	},
	{
		id: 'bbn-041',
		name: 'Blue Step Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },
			{ pitch: 60, duration: [1, 2], offset: [3, 4] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 14, pitchComplexity: 18, rhythmComplexity: 10, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'descending', 'passing-down'],
		source: 'curated'
	},
	{
		id: 'bbn-042',
		name: 'Valley Blue',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 2], offset: [3, 4] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 14, pitchComplexity: 18, rhythmComplexity: 10, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'valley', 'passing-up'],
		source: 'curated'
	},
	{
		id: 'bbn-043',
		name: 'Altissimo Shake',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },
			{ pitch: 75, duration: [1, 8], offset: [1, 8] },
			{ pitch: 78, duration: [1, 8], offset: [1, 4] },
			{ pitch: 77, duration: [1, 8], offset: [3, 8] },
			{ pitch: 78, duration: [1, 8], offset: [1, 2] },
			{ pitch: 79, duration: [1, 8], offset: [5, 8] },
			{ pitch: 77, duration: [1, 8], offset: [3, 4] },
			{ pitch: 75, duration: [1, 4], offset: [7, 8] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 15, pitchComplexity: 19, rhythmComplexity: 11, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'shake', 'altissimo', 'high-register'],
		source: 'curated'
	},
	{
		id: 'bbn-044',
		name: 'Blue Shake to the Octave',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },
			{ pitch: 70, duration: [1, 8], offset: [3, 8] },
			{ pitch: 72, duration: [1, 4], offset: [1, 2] },
			{ pitch: 70, duration: [1, 8], offset: [3, 4] },
			{ pitch: 67, duration: [1, 8], offset: [7, 8] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 15, pitchComplexity: 19, rhythmComplexity: 11, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'arch', 'shake'],
		source: 'curated'
	},
	{
		id: 'bbn-045',
		name: 'Shake Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] },
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },
			{ pitch: 67, duration: [1, 4], offset: [5, 8] },
			{ pitch: 70, duration: [1, 4], offset: [7, 8] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 15, pitchComplexity: 19, rhythmComplexity: 11, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'blues', 'shake', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bbn-046',
		name: 'Ascending Cry',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },
			{ pitch: 70, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 16, pitchComplexity: 20, rhythmComplexity: 12, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'passing-tone'],
		source: 'curated'
	},
	{
		id: 'bbn-047',
		name: 'Descending Slide',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 8], offset: [0, 1] },
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 16, pitchComplexity: 20, rhythmComplexity: 12, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'passing-tone'],
		source: 'curated'
	},
	{
		id: 'bbn-048',
		name: 'Blue Neighbor Riff',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }
		],
		harmony: BLUES_1BAR,
		difficulty: { level: 16, pitchComplexity: 20, rhythmComplexity: 12, lengthBars: 1 },
		category: 'blues',
		tags: ['blue-note', 'neighbor', 'descending'],
		source: 'curated'
	},
	{
		id: 'bbn-049',
		name: 'Stepwise Arch',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [3, 4] },
			{ pitch: 65, duration: [1, 8], offset: [7, 8] },
			{ pitch: 63, duration: [1, 4], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 17, pitchComplexity: 21, rhythmComplexity: 13, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'arch', 'passing-tone'],
		source: 'curated'
	},
	{
		id: 'bbn-050',
		name: 'Syncopated Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [3, 8], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },
			{ pitch: 70, duration: [1, 8], offset: [7, 8] },
			{ pitch: 72, duration: [1, 8], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 17, pitchComplexity: 21, rhythmComplexity: 13, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'syncopation'],
		source: 'curated'
	},
	{
		id: 'bbn-051',
		name: 'Repeated Tumble',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },
			{ pitch: 63, duration: [1, 4], offset: [3, 4] },
			{ pitch: 60, duration: [1, 4], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 17, pitchComplexity: 21, rhythmComplexity: 13, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'repeated-riff', 'descending'],
		source: 'curated'
	},
	{
		id: 'bbn-052',
		name: 'Zigzag Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },
			{ pitch: 60, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 63, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: 65, duration: [1, 8], offset: [3, 4] },
			{ pitch: 67, duration: [1, 8], offset: [7, 8] },
			{ pitch: 70, duration: [1, 4], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 18, pitchComplexity: 22, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'zigzag', 'passing-tone'],
		source: 'curated'
	},
	{
		id: 'bbn-053',
		name: 'Two-Bar Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },
			{ pitch: 63, duration: [1, 8], offset: [3, 4] },
			{ pitch: 60, duration: [1, 8], offset: [7, 8] },
			{ pitch: 58, duration: [1, 8], offset: [1, 1] },
			{ pitch: 60, duration: [1, 4], offset: [9, 8] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 18, pitchComplexity: 22, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'wide-range'],
		source: 'curated'
	},
	{
		id: 'bbn-054',
		name: 'Off-Beat Shake',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: null, duration: [1, 8], offset: [0, 1] },
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },
			{ pitch: 63, duration: [1, 8], offset: [3, 4] },
			{ pitch: 65, duration: [1, 8], offset: [7, 8] },
			{ pitch: 66, duration: [1, 4], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 18, pitchComplexity: 22, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'shake', 'syncopation'],
		source: 'curated'
	},
	{
		id: 'bbn-055',
		name: 'Full Run Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 55, duration: [1, 8], offset: [0, 1] },
			{ pitch: 58, duration: [1, 8], offset: [1, 8] },
			{ pitch: 60, duration: [1, 8], offset: [1, 4] },
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },
			{ pitch: 70, duration: [1, 8], offset: [7, 8] },
			{ pitch: 72, duration: [1, 4], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 19, pitchComplexity: 23, rhythmComplexity: 15, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'wide-range'],
		source: 'curated'
	},
	{
		id: 'bbn-056',
		name: 'High Cascade',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 77, duration: [1, 8], offset: [0, 1] },
			{ pitch: 75, duration: [1, 8], offset: [1, 8] },
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },
			{ pitch: 70, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: 65, duration: [1, 8], offset: [3, 4] },
			{ pitch: 63, duration: [1, 8], offset: [7, 8] },
			{ pitch: 60, duration: [1, 4], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 19, pitchComplexity: 23, rhythmComplexity: 15, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'high-register'],
		source: 'curated'
	},
	{
		id: 'bbn-057',
		name: 'Syncopated Zigzag',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [3, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 63, duration: [1, 8], offset: [5, 8] },
			{ pitch: 65, duration: [1, 8], offset: [3, 4] },
			{ pitch: 66, duration: [1, 8], offset: [7, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },
			{ pitch: 70, duration: [1, 4], offset: [9, 8] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 19, pitchComplexity: 23, rhythmComplexity: 15, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'zigzag', 'syncopation'],
		source: 'curated'
	},
	{
		id: 'bbn-058',
		name: 'Floor to Ceiling',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 58, duration: [1, 8], offset: [0, 1] },
			{ pitch: 60, duration: [1, 8], offset: [1, 8] },
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },
			{ pitch: 70, duration: [1, 8], offset: [3, 4] },
			{ pitch: 72, duration: [1, 8], offset: [7, 8] },
			{ pitch: 75, duration: [1, 4], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 20, pitchComplexity: 24, rhythmComplexity: 16, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'wide-range'],
		source: 'curated'
	},
	{
		id: 'bbn-059',
		name: 'High Cry Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 79, duration: [1, 8], offset: [0, 1] },
			{ pitch: 77, duration: [1, 8], offset: [1, 8] },
			{ pitch: 75, duration: [1, 8], offset: [1, 4] },
			{ pitch: 72, duration: [1, 8], offset: [3, 8] },
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },
			{ pitch: 66, duration: [1, 8], offset: [3, 4] },
			{ pitch: 65, duration: [1, 8], offset: [7, 8] },
			{ pitch: 63, duration: [1, 4], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 20, pitchComplexity: 24, rhythmComplexity: 16, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'high-register'],
		source: 'curated'
	},
	{
		id: 'bbn-060',
		name: 'Broken Phrase',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: null, duration: [1, 8], offset: [3, 4] },
			{ pitch: 70, duration: [1, 8], offset: [7, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },
			{ pitch: 66, duration: [1, 4], offset: [9, 8] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 20, pitchComplexity: 24, rhythmComplexity: 16, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'zigzag', 'rest'],
		source: 'curated'
	},
	{
		id: 'bbn-061',
		name: 'Crossroads Neighbor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },
			{ pitch: 66, duration: [1, 8], offset: [3, 4] },
			{ pitch: 67, duration: [1, 4], offset: [7, 8] },
			{ pitch: 63, duration: [1, 4], offset: [9, 8] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 21, pitchComplexity: 25, rhythmComplexity: 17, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'passing-up', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'bbn-062',
		name: 'Half-Step Tease',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },
			{ pitch: 63, duration: [1, 8], offset: [3, 4] },
			{ pitch: 60, duration: [1, 8], offset: [7, 8] },
			{ pitch: 63, duration: [1, 4], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 21, pitchComplexity: 25, rhythmComplexity: 17, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'bbn-063',
		name: 'Bb Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 63, duration: [1, 8], offset: [5, 8] },
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },
			{ pitch: 67, duration: [1, 4], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 21, pitchComplexity: 25, rhythmComplexity: 17, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'valley', 'passing-down'],
		source: 'curated'
	},
	{
		id: 'bbn-064',
		name: 'Stagger Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 58, duration: [1, 8], offset: [0, 1] },
			{ pitch: 60, duration: [1, 8], offset: [1, 8] },
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },
			{ pitch: 67, duration: [1, 4], offset: [5, 8] },
			{ pitch: 66, duration: [1, 8], offset: [7, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 1] },
			{ pitch: 67, duration: [1, 4], offset: [9, 8] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 22, pitchComplexity: 26, rhythmComplexity: 18, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'passing-up', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'bbn-065',
		name: 'Call and Space',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },
			{ pitch: null, duration: [1, 4], offset: [3, 4] },
			{ pitch: 63, duration: [1, 8], offset: [1, 1] },
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },
			{ pitch: 66, duration: [1, 8], offset: [5, 4] },
			{ pitch: 67, duration: [1, 8], offset: [11, 8] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 22, pitchComplexity: 26, rhythmComplexity: 18, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'call-response', 'rest', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'bbn-066',
		name: 'Octave Reach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },
			{ pitch: 70, duration: [1, 8], offset: [5, 8] },
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },
			{ pitch: 70, duration: [1, 8], offset: [1, 1] },
			{ pitch: 67, duration: [1, 8], offset: [9, 8] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 22, pitchComplexity: 26, rhythmComplexity: 18, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'high-register', 'passing-up'],
		source: 'curated'
	},
	{
		id: 'bbn-067',
		name: 'Long Climb Cry',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 55, duration: [1, 8], offset: [0, 1] },
			{ pitch: 58, duration: [1, 8], offset: [1, 8] },
			{ pitch: 60, duration: [1, 8], offset: [1, 4] },
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },
			{ pitch: 66, duration: [1, 8], offset: [1, 1] },
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },
			{ pitch: 63, duration: [1, 4], offset: [5, 4] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 23, pitchComplexity: 27, rhythmComplexity: 19, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'low-register', 'passing-up', 'passing-down'],
		source: 'curated'
	},
	{
		id: 'bbn-068',
		name: 'Funky Zigzag',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 63, duration: [1, 8], offset: [1, 2] },
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },
			{ pitch: 66, duration: [1, 8], offset: [1, 1] },
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },
			{ pitch: 70, duration: [1, 4], offset: [5, 4] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 23, pitchComplexity: 27, rhythmComplexity: 19, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'zigzag', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'bbn-069',
		name: 'Descending Stairs',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },
			{ pitch: 63, duration: [1, 8], offset: [3, 4] },
			{ pitch: 60, duration: [1, 4], offset: [7, 8] },
			{ pitch: 63, duration: [1, 8], offset: [9, 8] },
			{ pitch: 65, duration: [1, 8], offset: [5, 4] },
			{ pitch: 66, duration: [1, 8], offset: [11, 8] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 23, pitchComplexity: 27, rhythmComplexity: 19, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'passing-down', 'cry-ending'],
		source: 'curated'
	},
	{
		id: 'bbn-070',
		name: 'Blue Note Shuffle',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [3, 4] },
			{ pitch: 65, duration: [1, 8], offset: [7, 8] },
			{ pitch: 63, duration: [1, 2], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 24, pitchComplexity: 28, rhythmComplexity: 20, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'passing', 'arch', 'shuffle'],
		source: 'curated'
	},
	{
		id: 'bbn-071',
		name: 'High Blue Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: 65, duration: [1, 8], offset: [3, 4] },
			{ pitch: 63, duration: [1, 4], offset: [7, 8] },
			{ pitch: 60, duration: [1, 2], offset: [9, 8] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 24, pitchComplexity: 28, rhythmComplexity: 20, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'bbn-072',
		name: 'Blues Valley',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },
			{ pitch: 60, duration: [1, 4], offset: [3, 8] },
			{ pitch: 63, duration: [1, 8], offset: [5, 8] },
			{ pitch: 65, duration: [1, 8], offset: [3, 4] },
			{ pitch: 66, duration: [1, 8], offset: [7, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },
			{ pitch: 66, duration: [1, 8], offset: [9, 8] },
			{ pitch: 67, duration: [1, 4], offset: [5, 4] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 24, pitchComplexity: 28, rhythmComplexity: 20, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'valley', 'shake'],
		source: 'curated'
	},
	{
		id: 'bbn-073',
		name: 'Blue Zigzag',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },
			{ pitch: 66, duration: [1, 8], offset: [3, 4] },
			{ pitch: 67, duration: [1, 8], offset: [7, 8] },
			{ pitch: 70, duration: [1, 4], offset: [1, 1] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 25, pitchComplexity: 29, rhythmComplexity: 21, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'zigzag', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'bbn-074',
		name: 'Double Blue Fall',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },
			{ pitch: 63, duration: [1, 8], offset: [5, 8] },
			{ pitch: 65, duration: [1, 8], offset: [3, 4] },
			{ pitch: 66, duration: [1, 8], offset: [7, 8] },
			{ pitch: 65, duration: [1, 4], offset: [1, 1] },
			{ pitch: 63, duration: [1, 4], offset: [5, 4] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 25, pitchComplexity: 29, rhythmComplexity: 21, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'passing'],
		source: 'curated'
	},
	{
		id: 'bbn-075',
		name: 'Question Answer Blue',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 63, duration: [1, 4], offset: [3, 8] },
			{ pitch: null, duration: [1, 8], offset: [5, 8] },
			{ pitch: 60, duration: [1, 8], offset: [3, 4] },
			{ pitch: 63, duration: [1, 8], offset: [7, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 1] },
			{ pitch: 66, duration: [1, 8], offset: [9, 8] },
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },
			{ pitch: 70, duration: [1, 4], offset: [11, 8] }
		],
		harmony: BLUES_2BAR,
		difficulty: { level: 25, pitchComplexity: 29, rhythmComplexity: 21, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'call-response', 'rest', 'arch'],
		source: 'curated'
	}
];
