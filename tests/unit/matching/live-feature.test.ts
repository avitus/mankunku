import { describe, it, expect } from 'vitest';
import type { DetectedNote } from '$lib/types/audio';
import type { Note } from '$lib/types/music';
import { featureFromDetected } from '$lib/matching/live-feature';
import { encodeNotes } from '$lib/matching/encode';
import { fractionToFloat } from '$lib/music/intervals';

function note(midi: number, onsetTime: number, duration = 0.2): DetectedNote {
	return { midi, cents: 0, onsetTime, duration, clarity: 0.95 };
}

describe('featureFromDetected', () => {
	it('quantizes straight eighths at 120 BPM to 2-tick IOIs', () => {
		// 120 BPM → sixteenth = 0.125s; an eighth = 0.25s = 2 ticks.
		const notes = [note(60, 0), note(62, 0.25), note(64, 0.5), note(65, 0.75)];
		const feature = featureFromDetected(notes, 120);
		expect(feature.iois).toEqual([2, 2, 2]);
		expect(feature.intervals).toEqual([2, 2, 1]);
		expect(feature.noteCount).toBe(4);
	});

	it('rounds moderately swung eighths onto the straight grid', () => {
		// 0.6 swing ratio at 120 BPM: 0.3s / 0.2s pairs → both round to 2.
		const notes = [note(60, 0), note(62, 0.3), note(64, 0.5), note(65, 0.8)];
		const feature = featureFromDetected(notes, 120);
		expect(feature.iois).toEqual([2, 2, 2]);
	});

	it('clamps tiny inter-onset gaps to 1 tick', () => {
		const notes = [note(60, 0), note(62, 0.02)];
		expect(featureFromDetected(notes, 120).iois).toEqual([1]);
	});

	it('preserves interval direction and octave leaps', () => {
		const notes = [note(60, 0), note(72, 0.25), note(55, 0.5)];
		expect(featureFromDetected(notes, 120).intervals).toEqual([12, -17]);
	});

	it('round-trips against encodeNotes for the same played line', () => {
		const TEMPO = 100;
		const written: Note[] = [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }
		];
		const secondsPerWhole = 4 * (60 / TEMPO);
		const played = written.map((n) =>
			note(n.pitch!, fractionToFloat(n.offset) * secondsPerWhole, fractionToFloat(n.duration) * secondsPerWhole)
		);
		const expected = encodeNotes(written);
		const live = featureFromDetected(played, TEMPO);
		expect(live.intervals).toEqual(expected.intervals);
		expect(live.iois).toEqual(expected.iois);
		expect(live.noteCount).toBe(expected.noteCount);
		expect(Math.abs(live.totalBeats - expected.totalBeats)).toBeLessThan(0.1);
	});
});
