import { describe, it, expect } from 'vitest';
import type { Note } from '$lib/types/music';
import {
	emptyMelodyBars,
	slashBarAbc,
	slashCountForMeter,
	suggestBarsPerLine,
	BARS_PER_LINE_DEFAULT
} from '$lib/music/chart-layout';
import { seg, section, sheet } from '../../helpers/tune-fixtures';

describe('slashCountForMeter', () => {
	it('uses one slash per beat in simple meters', () => {
		expect(slashCountForMeter([4, 4])).toBe(4);
		expect(slashCountForMeter([3, 4])).toBe(3);
		expect(slashCountForMeter([2, 4])).toBe(2);
	});

	it('uses one slash per compound beat in 6/8 and 12/8', () => {
		expect(slashCountForMeter([6, 8])).toBe(2);
		expect(slashCountForMeter([12, 8])).toBe(4);
	});
});

describe('slashBarAbc', () => {
	it('emits four rhythm-style quarter rests for 4/4 with L:1/8', () => {
		const abc = slashBarAbc([4, 4], [1, 8]);
		expect(abc).toBe('!style=rhythm!z2 !style=rhythm!z2 !style=rhythm!z2 !style=rhythm!z2');
	});

	it('emits two compound-beat slashes for 6/8', () => {
		const abc = slashBarAbc([6, 8], [1, 8]);
		// Each compound beat is a dotted quarter = 3 eighths → z3 under L:1/8.
		expect(abc).toBe('!style=rhythm!z3 !style=rhythm!z3');
	});
});

describe('emptyMelodyBars', () => {
	it('marks every bar when the section has no pitched notes', () => {
		const s = sheet({
			sections: [section({ bars: 3, harmony: [seg('C', 'maj7', [0, 1], [3, 1])] })]
		});
		expect([...emptyMelodyBars(s)].sort((a, b) => a - b)).toEqual([0, 1, 2]);
	});

	it('skips bars that contain any pitched melody', () => {
		const notes: Note[] = [{ pitch: 60, duration: [1, 1], offset: [1, 1] }];
		const s = sheet({
			sections: [section({ bars: 3, notes, harmony: [seg('C', 'maj7', [0, 1], [3, 1])] })]
		});
		expect([...emptyMelodyBars(s)].sort((a, b) => a - b)).toEqual([0, 2]);
	});
});

describe('suggestBarsPerLine', () => {
	it('returns the default for moderate whole-note density', () => {
		const notes: Note[] = Array.from({ length: 8 }, (_, bar) => ({
			pitch: 60,
			duration: [1, 1] as [number, number],
			offset: [bar, 1] as [number, number]
		}));
		const s = sheet({ sections: [section({ bars: 8, notes })] });
		expect(suggestBarsPerLine(s)).toBe(BARS_PER_LINE_DEFAULT);
	});

	it('tightens to 3 bars/line for dense eighth-note runs', () => {
		const notes: Note[] = [];
		for (let bar = 0; bar < 4; bar++) {
			for (let i = 0; i < 8; i++) {
				notes.push({
					pitch: 60 + (i % 5),
					duration: [1, 8],
					offset: [bar + i / 8, 1]
				});
			}
		}
		// Fix offsets properly as fractions of whole notes.
		const fixed: Note[] = [];
		for (let bar = 0; bar < 4; bar++) {
			for (let i = 0; i < 8; i++) {
				fixed.push({
					pitch: 60 + (i % 5),
					duration: [1, 8],
					offset: [bar * 8 + i, 8]
				});
			}
		}
		const s = sheet({ sections: [section({ bars: 4, notes: fixed })] });
		expect(suggestBarsPerLine(s)).toBe(3);
	});

	it('widens sparse / empty harmony-only stretches', () => {
		const s = sheet({
			sections: [
				section({
					bars: 8,
					harmony: Array.from({ length: 8 }, (_, b) =>
						seg('F', '7', [b, 1], [1, 1])
					)
				})
			]
		});
		expect(suggestBarsPerLine(s)).toBeGreaterThanOrEqual(5);
	});
});
