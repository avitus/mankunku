/**
 * Abstract rhythmic templates — timing slots independent of pitch.
 *
 * All offsets and durations are fractions of a whole note:
 *   [1,4] = quarter note / beat 1 in 4/4
 *   [1,8] = eighth note
 *   [3,8] = dotted quarter
 *
 * Each pattern fills one bar of 4/4.
 */
import type { RhythmPattern } from '$lib/types/combinatorial';

export const RHYTHM_PATTERNS: RhythmPattern[] = [
	// ── 3-note patterns ─────────────────────────────────────────────
	{
		id: 'rp-3-quarters',
		name: 'Three Quarters',
		noteCount: 3,
		slots: [
			{ offset: [0, 1], duration: [1, 4] },
			{ offset: [1, 4], duration: [1, 4] },
			{ offset: [1, 2], duration: [1, 4] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['simple', 'quarters']
	},
	{
		id: 'rp-3-half-start',
		name: 'Half Then Quarters',
		noteCount: 3,
		slots: [
			{ offset: [0, 1], duration: [1, 2] },
			{ offset: [1, 2], duration: [1, 4] },
			{ offset: [3, 4], duration: [1, 4] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['simple', 'long-start']
	},
	{
		id: 'rp-3-resolve',
		name: 'Quarters To Half',
		noteCount: 3,
		slots: [
			{ offset: [0, 1], duration: [1, 4] },
			{ offset: [1, 4], duration: [1, 4] },
			{ offset: [1, 2], duration: [1, 2] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['simple', 'resolve']
	},
	{
		id: 'rp-3-dotted',
		name: 'Dotted Quarter Feel',
		noteCount: 3,
		slots: [
			{ offset: [0, 1], duration: [3, 8] },
			{ offset: [3, 8], duration: [1, 8] },
			{ offset: [1, 2], duration: [1, 2] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['dotted', 'eighth']
	},

	// ── 4-note patterns ─────────────────────────────────────────────
	{
		id: 'rp-4-quarters',
		name: 'Four Quarters',
		noteCount: 4,
		slots: [
			{ offset: [0, 1], duration: [1, 4] },
			{ offset: [1, 4], duration: [1, 4] },
			{ offset: [1, 2], duration: [1, 4] },
			{ offset: [3, 4], duration: [1, 4] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['simple', 'quarters']
	},
	{
		id: 'rp-4-eighths-hold',
		name: 'Eighth Run + Hold',
		noteCount: 4,
		slots: [
			{ offset: [0, 1], duration: [1, 8] },
			{ offset: [1, 8], duration: [1, 8] },
			{ offset: [1, 4], duration: [1, 8] },
			{ offset: [3, 8], duration: [5, 8] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['eighths', 'hold']
	},
	{
		id: 'rp-4-dotted',
		name: 'Dotted Quarter + Eighths',
		noteCount: 4,
		slots: [
			{ offset: [0, 1], duration: [3, 8] },
			{ offset: [3, 8], duration: [1, 8] },
			{ offset: [1, 2], duration: [1, 4] },
			{ offset: [3, 4], duration: [1, 4] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['dotted', 'mixed']
	},
	{
		id: 'rp-4-synco',
		name: 'Syncopated',
		noteCount: 4,
		slots: [
			{ offset: [1, 8], duration: [1, 8] },
			{ offset: [1, 4], duration: [1, 4] },
			{ offset: [5, 8], duration: [1, 8] },
			{ offset: [3, 4], duration: [1, 4] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['syncopated', 'off-beat']
	},
	{
		id: 'rp-4-half-eighths',
		name: 'Half Then Eighths',
		noteCount: 4,
		slots: [
			{ offset: [0, 1], duration: [1, 2] },
			{ offset: [1, 2], duration: [1, 8] },
			{ offset: [5, 8], duration: [1, 8] },
			{ offset: [3, 4], duration: [1, 4] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['mixed', 'half-note']
	},

	// ── 5-note patterns ─────────────────────────────────────────────
	{
		id: 'rp-5-q-88-q-q',
		name: 'Quarter-Eighths-Quarters',
		noteCount: 5,
		slots: [
			{ offset: [0, 1], duration: [1, 4] },
			{ offset: [1, 4], duration: [1, 8] },
			{ offset: [3, 8], duration: [1, 8] },
			{ offset: [1, 2], duration: [1, 4] },
			{ offset: [3, 4], duration: [1, 4] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['mixed', 'eighths']
	},
	{
		id: 'rp-5-eighths-hold',
		name: 'Four Eighths + Hold',
		noteCount: 5,
		slots: [
			{ offset: [0, 1], duration: [1, 8] },
			{ offset: [1, 8], duration: [1, 8] },
			{ offset: [1, 4], duration: [1, 8] },
			{ offset: [3, 8], duration: [1, 8] },
			{ offset: [1, 2], duration: [1, 2] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['eighths', 'hold']
	},
	{
		id: 'rp-5-88-q-88',
		name: 'Eighths-Quarter-Eighths',
		noteCount: 5,
		slots: [
			{ offset: [0, 1], duration: [1, 8] },
			{ offset: [1, 8], duration: [1, 8] },
			{ offset: [1, 4], duration: [1, 4] },
			{ offset: [1, 2], duration: [1, 8] },
			{ offset: [5, 8], duration: [3, 8] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['eighths', 'mixed']
	},

	// ── 6-note patterns ─────────────────────────────────────────────
	{
		id: 'rp-6-eighths',
		name: 'Six Eighths + Hold',
		noteCount: 6,
		slots: [
			{ offset: [0, 1], duration: [1, 8] },
			{ offset: [1, 8], duration: [1, 8] },
			{ offset: [1, 4], duration: [1, 8] },
			{ offset: [3, 8], duration: [1, 8] },
			{ offset: [1, 2], duration: [1, 8] },
			{ offset: [5, 8], duration: [3, 8] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['eighths', 'run']
	},
	{
		id: 'rp-6-q-8888-q',
		name: 'Quarter-Eighths-Quarter',
		noteCount: 6,
		slots: [
			{ offset: [0, 1], duration: [1, 4] },
			{ offset: [1, 4], duration: [1, 8] },
			{ offset: [3, 8], duration: [1, 8] },
			{ offset: [1, 2], duration: [1, 8] },
			{ offset: [5, 8], duration: [1, 8] },
			{ offset: [3, 4], duration: [1, 4] }
		],
		timeSignature: [4, 4],
		bars: 1,
		tags: ['mixed', 'eighths']
	}
];
