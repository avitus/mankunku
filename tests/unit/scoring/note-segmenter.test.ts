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
			makeReading(64, 0.7),
			makeReading(64, 0.8)
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

	it('uses clarity-weighted pitch-class vote for outlier robustness', () => {
		const readings: PitchReading[] = [
			makeReading(60, 0.0),
			makeReading(60, 0.1),
			makeReading(72, 0.15), // outlier: different pitch class (C5 vs C4)
			makeReading(60, 0.2),
			makeReading(60, 0.3)
		];
		const notes = segmentNotes(readings, [0.0], 0.5);

		expect(notes).toHaveLength(1);
		expect(notes[0].midi).toBe(60); // C4 wins pitch-class vote
	});

	it('picks the octave with most weight among matching pitch classes', () => {
		// All same pitch class (C), mixed octaves. The sustained octave
		// should win over a subharmonic glitch.
		const readings: PitchReading[] = [
			makeReading(48, 0.0, 0, 0.85), // C3 subharmonic — lower clarity
			makeReading(60, 0.1), // C4 — high clarity
			makeReading(60, 0.2),
			makeReading(60, 0.3),
			makeReading(60, 0.4)
		];
		const notes = segmentNotes(readings, [0.0], 0.5);

		expect(notes).toHaveLength(1);
		expect(notes[0].midi).toBe(60);
	});

	it('down-weights warmup-flagged readings', () => {
		// A steady C4 with a single high-clarity C5 marked as warmup. Warmup
		// weight (0.25x) should prevent it from dominating the short stable
		// section.
		const readings: PitchReading[] = [
			{ ...makeReading(72, 0.0), warmup: true },
			{ ...makeReading(72, 0.02), warmup: true },
			makeReading(60, 0.1),
			makeReading(60, 0.15),
			makeReading(60, 0.2),
			makeReading(60, 0.25)
		];
		const notes = segmentNotes(readings, [0.0], 0.4);

		expect(notes).toHaveLength(1);
		expect(notes[0].midi).toBe(60);
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
			makeReading(60, 0.03),
			makeReading(60, 0.05),
			makeReading(64, 0.11), // short segment
			makeReading(67, 0.25),
			makeReading(67, 0.30),
			makeReading(67, 0.35)
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

	it('skips stale readings after onset (FFT lag)', () => {
		// Simulates D→F transition: onset fires at 0.5s but the FFT buffer
		// still contains D audio, so readings at 0.50–0.57 report D (midi 62).
		// The guard window (80ms) should skip those stale readings.
		const readings: PitchReading[] = [
			// First note: D
			makeReading(62, 0.0),
			makeReading(62, 0.1),
			makeReading(62, 0.2),
			makeReading(62, 0.3),
			// Second note onset at 0.5 — stale D readings from FFT lag
			makeReading(62, 0.50),
			makeReading(62, 0.53),
			makeReading(62, 0.57),
			// Clean F readings after FFT buffer fills
			makeReading(65, 0.59),
			makeReading(65, 0.65),
			makeReading(65, 0.70),
			makeReading(65, 0.80),
			makeReading(65, 0.90)
		];
		const onsets = [0.0, 0.5];
		const notes = segmentNotes(readings, onsets, 1.0);

		expect(notes).toHaveLength(2);
		expect(notes[0].midi).toBe(62); // D
		expect(notes[1].midi).toBe(65); // F, not D
	});

	it('falls back to unguarded for very short segments', () => {
		// A very short note where all readings fall within the 80ms guard window.
		// The fallback should use them rather than dropping the segment.
		const readings: PitchReading[] = [
			makeReading(60, 0.0),
			makeReading(60, 0.1),
			makeReading(60, 0.2),
			makeReading(65, 0.50),
			makeReading(65, 0.53),
			makeReading(65, 0.56)
		];
		const onsets = [0.0, 0.5];
		// Second segment: 0.5–0.6, all readings at 0.50–0.56 are within
		// the 80ms guard, but fallback preserves them.
		const notes = segmentNotes(readings, onsets, 0.6);

		expect(notes).toHaveLength(2);
		expect(notes[1].midi).toBe(65);
	});

	it('drops segments with a single stray reading (no fallback from 1 frame)', () => {
		// First segment: 4 readings (kept via full vote).
		// Second segment: 1 post-guard reading — the short-note fallback
		// requires at least 2 to avoid inventing phantom notes.
		const readings: PitchReading[] = [
			makeReading(60, 0.0),
			makeReading(60, 0.1),
			makeReading(60, 0.2),
			makeReading(60, 0.3),
			makeReading(64, 0.65)
		];
		const onsets = [0.0, 0.5];
		const notes = segmentNotes(readings, onsets, 1.0);

		expect(notes).toHaveLength(1);
		expect(notes[0].midi).toBe(60);
	});

	it('rescues short notes via the highest-clarity fallback (4d)', () => {
		// Second segment has 2 readings — below default minReadings=3 but
		// above the fallback's minimum. Fallback picks the highest-clarity
		// reading and flags lower confidence via halved clarity.
		const readings: PitchReading[] = [
			makeReading(60, 0.0),
			makeReading(60, 0.1),
			makeReading(60, 0.2),
			makeReading(60, 0.3),
			makeReading(64, 0.60, 0, 0.90),
			makeReading(64, 0.65, 0, 0.95)
		];
		const onsets = [0.0, 0.5];
		const notes = segmentNotes(readings, onsets, 1.0);

		expect(notes).toHaveLength(2);
		expect(notes[1].midi).toBe(64);
		// Fallback halves reported clarity as an uncertainty flag.
		expect(notes[1].clarity).toBeCloseTo(0.95 * 0.5, 5);
	});

	it('keeps segments with few readings when minReadings is lowered', () => {
		const readings: PitchReading[] = [
			makeReading(60, 0.0),
			makeReading(60, 0.1),
			makeReading(60, 0.2),
			makeReading(64, 0.60),
			makeReading(64, 0.65)
		];
		const onsets = [0.0, 0.5];
		const notes = segmentNotes(readings, onsets, 1.0, 0.05, 0.08, 1);

		expect(notes).toHaveLength(2);
		expect(notes[1].midi).toBe(64);
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

	it('collapses short octave-artifact sub-segments at legato transitions', () => {
		// Reproduces the A3→C3→C4 failure: one onset (legato transition),
		// A3 sustained, a brief C3 subharmonic glitch, then C4. The C3 run
		// is exactly 12 semitones below C4 and ~0.12 s long — it should be
		// absorbed into the C4 sub-segment, not emitted as its own note.
		const readings: PitchReading[] = [];
		// A3 sustained from 1.25 to 3.08 (~110 readings at 60 fps — use 15 for brevity)
		for (let t = 1.25; t < 3.08; t += 0.12) readings.push(makeReading(57, t));
		// C3 glitch for ~0.12 s (3 frames — exactly PITCH_CHANGE_MIN_HOLD)
		readings.push(makeReading(48, 3.08, 0, 0.93));
		readings.push(makeReading(48, 3.12, 0, 0.93));
		readings.push(makeReading(48, 3.16, 0, 0.93));
		// C4 sustained from 3.20 to 3.65 (~7 readings at ~60 ms hop)
		for (let t = 3.20; t < 3.65; t += 0.06) readings.push(makeReading(60, t));

		const notes = segmentNotes(readings, [1.25], 3.65);

		expect(notes).toHaveLength(2);
		expect(notes[0].midi).toBe(57); // A3
		expect(notes[1].midi).toBe(60); // C4, not C3
		// C4 note absorbs the glitch frames and starts at the transition.
		expect(notes[1].onsetTime).toBeCloseTo(3.08, 2);
	});

	it('preserves short non-octave sub-segments (not octave artifact)', () => {
		// Same structure as the octave-artifact case but the middle run is
		// 7 semitones away (not an octave), so it must NOT be collapsed —
		// a genuine short grace note shouldn't disappear.
		const readings: PitchReading[] = [];
		for (let t = 0; t < 1.0; t += 0.1) readings.push(makeReading(60, t));
		readings.push(makeReading(67, 1.0));
		readings.push(makeReading(67, 1.05));
		readings.push(makeReading(67, 1.10));
		for (let t = 1.2; t < 1.6; t += 0.08) readings.push(makeReading(72, t));

		const notes = segmentNotes(readings, [0], 1.6);

		expect(notes.map((n) => n.midi)).toEqual([60, 67, 72]);
	});

	it('tie-breaks octave by proximity to previous note', () => {
		// First note pins context at C4 (60). Second segment has an equal
		// clarity-weighted vote for C4 and C5 — proximity to C4 should win.
		const readings: PitchReading[] = [
			makeReading(60, 0.0),
			makeReading(60, 0.1),
			makeReading(60, 0.2),
			makeReading(60, 0.3),
			makeReading(72, 0.60), // C5
			makeReading(72, 0.65),
			makeReading(60, 0.70), // C4
			makeReading(60, 0.75)
		];
		const onsets = [0.0, 0.5];
		const notes = segmentNotes(readings, onsets, 1.0);

		expect(notes).toHaveLength(2);
		expect(notes[1].midi).toBe(60);
	});
});
