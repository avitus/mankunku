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

	it('counts a bar as melodic when a note sustains into it from the bar before', () => {
		// Beat 3 of bar 0 through beat 2 of bar 1: both bars carry melody.
		const notes: Note[] = [{ pitch: 60, duration: [1, 1], offset: [1, 2] }];
		const s = sheet({ sections: [section({ bars: 3, notes })] });
		expect([...emptyMelodyBars(s)]).toEqual([2]);
	});
});

describe('suggestBarsPerLine', () => {
	it('allows three bars for an extraordinarily dense sixteenth-note passage', () => {
		const notes: Note[] = Array.from({ length: 16 }, (_, i) => ({
			pitch: 60 + i % 5, offset: [i, 16], duration: [1, 16]
		}));
		expect(suggestBarsPerLine(sheet({ sections: [section({ bars: 8, notes })] }))).toBe(3);
	});

	it('allows three bars for a chord change on every beat', () => {
		const harmony = Array.from({ length: 4 }, (_, beat) => seg('C', '7', [beat, 4], [1, 4]));
		expect(suggestBarsPerLine(sheet({ sections: [section({ bars: 4, harmony })] }))).toBe(3);
	});

	it('returns the default for moderate whole-note density', () => {
		const notes: Note[] = Array.from({ length: 8 }, (_, bar) => ({
			pitch: 60,
			duration: [1, 1] as [number, number],
			offset: [bar, 1] as [number, number]
		}));
		const s = sheet({ sections: [section({ bars: 8, notes })] });
		expect(suggestBarsPerLine(s)).toBe(BARS_PER_LINE_DEFAULT);
	});

	it('keeps four bars/line for ordinary eighth-note runs', () => {
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
		expect(suggestBarsPerLine(s)).toBe(4);
	});

	it('keeps four bars/line when one bar carries three chords', () => {
		const s = sheet({
			sections: [
				section({
					bars: 4,
					harmony: [
						seg('D', 'min7', [0, 1], [1, 4]),
						seg('G', '7', [1, 4], [1, 4]),
						seg('C', 'maj7', [1, 2], [1, 2]),
						seg('C', 'maj7', [1, 1], [3, 1])
					]
				})
			]
		});
		// A passing chord must not change the layout of the whole head.
		expect(suggestBarsPerLine(s)).toBe(4);
	});

	it('keeps four bars/line for silent and mostly-empty charts', () => {
		const chords = (bars: number) =>
			Array.from({ length: bars }, (_, b) => seg('F', '7', [b, 1], [1, 1]));

		// Empty bars retain the same four-bar phrasing.
		const silent = sheet({ sections: [section({ bars: 8, harmony: chords(8) })] });
		expect(suggestBarsPerLine(silent)).toBe(4);

		// Sparse melody must not widen the systems either.
		const mostlyEmpty = sheet({
			sections: [
				section({
					bars: 8,
					harmony: chords(8),
					notes: [
						{ pitch: 65, duration: [1, 8], offset: [0, 8] },
						{ pitch: 65, duration: [1, 8], offset: [8, 8] }
					]
				})
			]
		});
		expect(suggestBarsPerLine(mostlyEmpty)).toBe(4);
	});
});

describe('emptyMelodyBars — pickup bars', () => {
	it('never turns a partial pickup bar into a slash bar', () => {
		// A chords-only pickup prints a rest of its own length, not four slashes.
		const s = sheet({
			sections: [
				section({ label: '', bars: 1, pickupLength: [1, 4], notes: [], harmony: [seg('G', '7', [3, 4], [1, 4])] }),
				section({ label: 'A', bars: 2, notes: [], harmony: [seg('C', 'maj7', [0, 1], [2, 1])] })
			]
		});
		expect([...emptyMelodyBars(s)]).toEqual([1, 2]);
	});
});
