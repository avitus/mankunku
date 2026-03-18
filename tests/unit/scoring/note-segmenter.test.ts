import { describe, it, expect } from 'vitest';
import { segmentNotes } from '$lib/audio/note-segmenter.ts';
import type { PitchReading } from '$lib/audio/pitch-detector.ts';

function makeReading(midi: number, time: number, cents = 0, clarity = 0.95): PitchReading {
	return { midi, midiFloat: midi + cents / 100, cents, clarity, time, frequency: 440 };
}

describe('segmentNotes', () => {
	it('segments readings at onset boundaries', () => {
		const readings: PitchReading[] = [
			makeReading(60, 0.0),
			makeReading(60, 0.1),
			makeReading(60, 0.2),
			makeReading(64, 0.5),
			makeReading(64, 0.6),
			makeReading(64, 0.7)
		];
		const onsets = [0.0, 0.5];
		const notes = segmentNotes(readings, onsets, 1.0);

		expect(notes).toHaveLength(2);
		expect(notes[0].midi).toBe(60);
		expect(notes[0].onsetTime).toBe(0.0);
		expect(notes[0].duration).toBeCloseTo(0.5);
		expect(notes[1].midi).toBe(64);
		expect(notes[1].onsetTime).toBe(0.5);
		expect(notes[1].duration).toBeCloseTo(0.5);
	});

	it('uses median MIDI for outlier robustness', () => {
		const readings: PitchReading[] = [
			makeReading(60, 0.0),
			makeReading(60, 0.1),
			makeReading(72, 0.15), // outlier
			makeReading(60, 0.2),
			makeReading(60, 0.3)
		];
		const notes = segmentNotes(readings, [0.0], 0.5);

		expect(notes).toHaveLength(1);
		expect(notes[0].midi).toBe(60); // median, not outlier
	});

	it('treats all readings as one note when no onsets', () => {
		const readings: PitchReading[] = [
			makeReading(67, 0.1),
			makeReading(67, 0.2),
			makeReading(67, 0.3)
		];
		const notes = segmentNotes(readings, [], 0.5);

		expect(notes).toHaveLength(1);
		expect(notes[0].midi).toBe(67);
	});

	it('filters notes shorter than minNoteDuration', () => {
		const readings: PitchReading[] = [
			makeReading(60, 0.0),
			makeReading(60, 0.05),
			makeReading(64, 0.11), // short segment
			makeReading(67, 0.15),
			makeReading(67, 0.25)
		];
		const onsets = [0.0, 0.1, 0.15];
		const notes = segmentNotes(readings, onsets, 0.4, 0.08);

		// First: 0.0 to 0.1 = 0.10s (kept), Second: 0.1 to 0.15 = 0.05s (filtered), Third: 0.15 to 0.4 = 0.25s (kept)
		expect(notes).toHaveLength(2);
		expect(notes[0].midi).toBe(60);
		expect(notes[1].midi).toBe(67);
	});

	it('returns empty for no readings', () => {
		expect(segmentNotes([], [0.0, 0.5], 1.0)).toEqual([]);
	});

	it('includes cents deviation from median matching readings', () => {
		const readings: PitchReading[] = [
			makeReading(60, 0.0, 10),
			makeReading(60, 0.1, 15),
			makeReading(60, 0.2, 20)
		];
		const notes = segmentNotes(readings, [0.0], 0.5);

		expect(notes[0].cents).toBe(15); // median of [10, 15, 20]
	});
});
