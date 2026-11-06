import { expect, it } from 'vitest';
import type { Note } from '$lib/types/music';
import { estimateRecorderEdits as edits } from '../../helpers/recorder-edit-effort';

const quarter = (pitch: number | null, beat: number): Note =>
	({ pitch, offset: [beat, 4], duration: [1, 4] });

it('compares saved notes to the exercise normalized to C, preserving octave', () => {
	const a = [quarter(60, 0), quarter(62, 1)];
	expect(edits(a, [quarter(62, 0), quarter(64, 1)], 'D').total).toBe(0);
	expect(edits(a, [quarter(72, 0), quarter(74, 1)], 'C')).toMatchObject({ total: 1, shift: 12 });
});
it('charges for one leading rest without marking every later onset wrong', () => {
	const a = [quarter(null, 0), quarter(60, 1), quarter(62, 2)];
	expect(edits(a, [quarter(60, 0), quarter(62, 1)], 'C')).toMatchObject({ total: 1, remove: 1 });
	expect(edits(a, [quarter(60, 1), quarter(62, 2), quarter(null, 3)], 'C').total).toBe(0);
});
it('counts a pitch, duration, insertion, or deletion independently', () => {
	const a = [quarter(60, 0)];
	expect(edits(a, [quarter(62, 0)], 'C')).toMatchObject({ total: 1, pitch: 1 });
	expect(edits(a, [{ ...a[0], duration: [1, 2] }], 'C')).toMatchObject({ total: 1, duration: 1 });
	expect(edits([], a, 'C')).toMatchObject({ total: 1, insert: 1 });
	expect(edits(a, [], 'C')).toMatchObject({ total: 1, remove: 1 });
	expect(edits([...a, quarter(60, 1)], a, 'C')).toMatchObject({ total: 1, remove: 1 });
});
