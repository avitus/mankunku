import { describe, it, expect } from 'vitest';
import type { Tune, TuneSection } from '$lib/types/tune';
import type { HarmonicSegment, Note } from '$lib/types/music';
import { flattenTune } from '$lib/tunes/flatten';

function section(overrides: Partial<TuneSection>): TuneSection {
	return {
		label: 'A',
		bars: 4,
		notes: [],
		harmony: [],
		...overrides
	};
}

function sheet(sections: TuneSection[], timeSignature: [number, number] = [4, 4]): Tune {
	return {
		id: 'test-sheet',
		title: 'Test Sheet',
		key: 'C',
		timeSignature,
		tags: [],
		sections,
		source: 'user'
	};
}

const NOTE_AT_ZERO: Note = { pitch: 60, duration: [1, 4], offset: [0, 1] };
const NOTE_AT_HALF: Note = { pitch: 62, duration: [1, 4], offset: [1, 2] };
const CMAJ7: HarmonicSegment = {
	chord: { root: 'C', quality: 'maj7' },
	scaleId: 'major.ionian',
	startOffset: [0, 1],
	duration: [1, 1]
};

describe('flattenTune — sequential concatenation', () => {
	it('passes a single section through unshifted', () => {
		const flat = flattenTune(sheet([
			section({ notes: [NOTE_AT_ZERO, NOTE_AT_HALF], harmony: [CMAJ7] })
		]));
		expect(flat.notes).toEqual([NOTE_AT_ZERO, NOTE_AT_HALF]);
		expect(flat.harmony).toEqual([CMAJ7]);
		expect(flat.totalBars).toBe(4);
	});

	it('shifts the second section by the first section bar count', () => {
		const flat = flattenTune(sheet([
			section({ bars: 4, notes: [NOTE_AT_ZERO] }),
			section({ label: 'B', bars: 4, notes: [NOTE_AT_ZERO, NOTE_AT_HALF], harmony: [CMAJ7] })
		]));
		// 4 bars of 4/4 = 4 whole notes
		expect(flat.notes[1].offset).toEqual([4, 1]);
		expect(flat.notes[2].offset).toEqual([9, 2]);
		expect(flat.harmony[0].startOffset).toEqual([4, 1]);
		expect(flat.totalBars).toBe(8);
	});

	it('shifts in whole-note units for non-4/4 meters', () => {
		const flat = flattenTune(sheet([
			section({ bars: 4 }),
			section({ label: 'B', bars: 4, notes: [NOTE_AT_ZERO, { ...NOTE_AT_ZERO, offset: [1, 4] }] })
		], [3, 4]));
		// 4 bars of 3/4 = 3 whole notes
		expect(flat.notes[0].offset).toEqual([3, 1]);
		expect(flat.notes[1].offset).toEqual([13, 4]);
	});

	it('preserves note properties other than offset', () => {
		const fancy: Note = {
			pitch: 65, duration: [1, 8], offset: [1, 4],
			velocity: 90, articulation: 'accent', tied: true, spelling: 'flat'
		};
		const flat = flattenTune(sheet([
			section({ bars: 2 }),
			section({ bars: 2, notes: [fancy] })
		]));
		expect(flat.notes[0]).toEqual({ ...fancy, offset: [9, 4] });
	});

	it('preserves harmony fields including the raw symbol', () => {
		const seg: HarmonicSegment = { ...CMAJ7, symbol: 'C^7' };
		const flat = flattenTune(sheet([
			section({ bars: 4 }),
			section({ bars: 4, harmony: [seg] })
		]));
		expect(flat.harmony[0].symbol).toBe('C^7');
		expect(flat.harmony[0].duration).toEqual([1, 1]);
	});

	it('does not expand repeats by default', () => {
		const flat = flattenTune(sheet([
			section({ repeatStart: true, repeatEnd: true, notes: [NOTE_AT_ZERO] }),
			section({ label: 'B', bars: 4, notes: [NOTE_AT_ZERO] })
		]));
		expect(flat.notes.map((n) => n.offset)).toEqual([[0, 1], [4, 1]]);
		expect(flat.totalBars).toBe(8);
	});
});

describe('flattenTune — repeat expansion', () => {
	it('plays a repeated section twice when expandRepeats is set', () => {
		const flat = flattenTune(
			sheet([
				section({ repeatStart: true, repeatEnd: true, bars: 4, notes: [NOTE_AT_ZERO], harmony: [CMAJ7] }),
				section({ label: 'B', bars: 4, notes: [NOTE_AT_ZERO] })
			]),
			{ expandRepeats: true }
		);
		expect(flat.notes.map((n) => n.offset)).toEqual([[0, 1], [4, 1], [8, 1]]);
		expect(flat.harmony.map((h) => h.startOffset)).toEqual([[0, 1], [4, 1]]);
		expect(flat.totalBars).toBe(12);
	});

	it('routes first and second endings correctly', () => {
		const a = section({ label: 'A', bars: 4, repeatStart: true, notes: [NOTE_AT_ZERO] });
		const e1 = section({ label: 'A', bars: 2, ending: 1, repeatEnd: true, notes: [{ ...NOTE_AT_ZERO, pitch: 64 }] });
		const e2 = section({ label: 'A', bars: 2, ending: 2, notes: [{ ...NOTE_AT_ZERO, pitch: 67 }] });

		const flat = flattenTune(sheet([a, e1, e2]), { expandRepeats: true });

		// Pass 1: A + ending 1; pass 2: A + ending 2 → A(0) E1(4) A(6) E2(10)
		expect(flat.notes.map((n) => [n.pitch, n.offset])).toEqual([
			[60, [0, 1]],
			[64, [4, 1]],
			[60, [6, 1]],
			[67, [10, 1]]
		]);
		expect(flat.totalBars).toBe(12);
	});

	it('keeps endings sequential when not expanding', () => {
		const a = section({ label: 'A', bars: 4, repeatStart: true });
		const e1 = section({ label: 'A', bars: 2, ending: 1, repeatEnd: true, notes: [NOTE_AT_ZERO] });
		const e2 = section({ label: 'A', bars: 2, ending: 2, notes: [NOTE_AT_ZERO] });

		const flat = flattenTune(sheet([a, e1, e2]));
		expect(flat.notes.map((n) => n.offset)).toEqual([[4, 1], [6, 1]]);
		expect(flat.totalBars).toBe(8);
	});

	it('plays an unbalanced repeatStart once rather than looping', () => {
		const flat = flattenTune(
			sheet([
				section({ repeatStart: true, bars: 4, notes: [NOTE_AT_ZERO] }),
				section({ label: 'B', bars: 4, notes: [NOTE_AT_ZERO] })
			]),
			{ expandRepeats: true }
		);
		expect(flat.notes.map((n) => n.offset)).toEqual([[0, 1], [4, 1]]);
		expect(flat.totalBars).toBe(8);
	});
});
