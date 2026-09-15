import { describe, expect, it } from 'vitest';
import {
	enclosureCanvasLayout,
	enclosureDisplayPitch,
	enclosureParametersWithCount,
	enclosureStaffPosition
} from '$lib/ui/enclosure-canvas';
import type { Fraction } from '$lib/types/music';

describe('enclosure canvas presentation', () => {
	it('places accidentals on their spelled staff line across an octave', () => {
		expect(enclosureStaffPosition('Eb4')).toBe(enclosureStaffPosition('E4'));
		expect(enclosureStaffPosition('D#4')).toBe(enclosureStaffPosition('E4') - 1);
		expect(enclosureStaffPosition('C5')).toBe(enclosureStaffPosition('B4') + 1);
	});

	it('spells the pickup as an approach to the arrival, not the previous chord', () => {
		const result = enclosureDisplayPitch(61, {
			chordRoot: 'D', chordQuality: 'min7b5', scaleId: 'harmonic-minor.locrian-sharp6'
		}, 'C', 0, 'minor');
		// C# leads into D; the preceding C-minor chord would instead suggest Db.
		expect(result.name).toBe('C#4');
		expect(result.label).toBe('C♯');
	});

	it('spells a diminished fifth in the tenor saxophone written key', () => {
		const result = enclosureDisplayPitch(68, {
			chordRoot: 'D', chordQuality: 'min7b5', scaleId: 'harmonic-minor.locrian-sharp6'
		}, 'D', 14, 'minor');
		// Concert D–Ab becomes written E–Bb, retaining the diminished-fifth role.
		expect(result.name).toBe('Bb5');
		expect(result.label).toBe('B♭');
	});

	it('resolves a transposed minor seventh from the destination key signature', () => {
		const result = enclosureDisplayPitch(78, {
			chordRoot: 'Ab', chordQuality: 'min7', scaleId: 'major.dorian'
		}, 'Ab', 0, 'minor');
		// The app reads canonical Ab minor as G# minor: its seventh is F#, not stale Gb.
		expect(result.name).toBe('F#5');
	});

	it.each([262, 320, 736, 1024])('keeps beat one fixed while shifting the target at width %i', (width) => {
		/** Equal staff heights expose hit-area collisions that diagonal notes could hide. */
		const note = (offset: Fraction) => ({ offset, staffPosition: 30 });
		const on = enclosureCanvasLayout([note([5, 8]), note([3, 4]), note([7, 8]), note([1, 1])], 3, [1, 1], width);
		const off = enclosureCanvasLayout([note([3, 4]), note([7, 8]), note([1, 1]), note([9, 8])], 3, [1, 1], width);
		expect(on.beatOneX).toBe(off.beatOneX);
		expect(on.points[3].x).toBe(on.beatOneX);
		expect(off.points[2].x).toBe(off.beatOneX);
		expect(off.points[3].x).toBeGreaterThan(off.beatOneX);
		for (const point of [...on.points, ...off.points]) {
			expect(point.x).toBeGreaterThanOrEqual(26);
			expect(point.x).toBeLessThanOrEqual(width - 26);
		}
		// Even equal-letter notes retain nonoverlapping 44px approach / 56px target circles.
		expect(on.points[3].x - on.points[2].x).toBeGreaterThanOrEqual(50);
	});

	it('changes only count and its compatible shape', () => {
		const params = { type: 'minor', noteCount: '3', shape: 'above-below', targetTone: 'seventh', beatPlacement: 'offbeat' };
		const single = enclosureParametersWithCount(params, '1');
		expect(single).toEqual({ ...params, noteCount: '1', shape: 'scale-above' });
		expect(enclosureParametersWithCount(single, '2')).toEqual({ ...params, noteCount: '2' });
		expect(enclosureParametersWithCount({ ...params, shape: 'double-chromatic' }, '1').shape).toBe('chromatic-below');
	});

});
