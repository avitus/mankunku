import { describe, it, expect } from 'vitest';
import { segmentNotes, resolveOnsets } from '$lib/audio/note-segmenter';
import type { PitchReading } from '$lib/audio/pitch-detector';

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
		// A3 sustained from 1.25 to 3.08 at ~60fps (16ms steps)
		for (let t = 1.25; t < 3.08; t += 0.016) readings.push(makeReading(57, t));
		// C3 glitch for ~0.12 s (3 frames — exactly PITCH_CHANGE_MIN_HOLD)
		readings.push(makeReading(48, 3.08, 0, 0.93));
		readings.push(makeReading(48, 3.12, 0, 0.93));
		readings.push(makeReading(48, 3.16, 0, 0.93));
		// C4 sustained from 3.20 to 3.65 at ~60fps (16ms steps)
		for (let t = 3.20; t < 3.65; t += 0.016) readings.push(makeReading(60, t));

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
		for (let t = 0; t < 1.0; t += 0.016) readings.push(makeReading(60, t));
		readings.push(makeReading(67, 1.0));
		readings.push(makeReading(67, 1.05));
		readings.push(makeReading(67, 1.10));
		for (let t = 1.2; t < 1.6; t += 0.016) readings.push(makeReading(72, t));

		const notes = segmentNotes(readings, [0], 1.6);

		expect(notes.map((n) => n.midi)).toEqual([60, 67, 72]);
	});

	it('splits same-MIDI re-articulations on internal reading gaps', () => {
		// F3 sustained but with two clarity-dropout gaps simulating soft re-tonguing.
		// Three articulations → three notes, even though pitch never changes.
		const readings: PitchReading[] = [
			// First F3 (90ms)
			makeReading(53, 1.50),
			makeReading(53, 1.5167),
			makeReading(53, 1.5333),
			makeReading(53, 1.55),
			makeReading(53, 1.5833),
			// Gap (84ms) — re-tongue
			makeReading(53, 1.6667),
			makeReading(53, 1.6833),
			makeReading(53, 1.70),
			makeReading(53, 1.85),
			makeReading(53, 2.00),
			makeReading(53, 2.1667),
			// Gap (100ms) — re-tongue
			makeReading(53, 2.2667),
			makeReading(53, 2.30),
			makeReading(53, 2.50),
			makeReading(53, 2.70)
		];
		// Single onset at the start; no other onsets — re-articulations are
		// entirely gap-driven, simulating the worklet missing soft tongues.
		const onsets = [1.50];
		const notes = segmentNotes(readings, onsets, 2.8);

		expect(notes).toHaveLength(3);
		expect(notes.map((n) => n.midi)).toEqual([53, 53, 53]);
		expect(notes[0].onsetTime).toBeCloseTo(1.50, 2);
		expect(notes[1].onsetTime).toBeCloseTo(1.6667, 2);
		expect(notes[2].onsetTime).toBeCloseTo(2.2667, 2);
	});

	it('does NOT split same-MIDI run on small clarity blips (< gap threshold)', () => {
		// Single F3 sustain with a 33ms blip (typical sustain noise) — should NOT split.
		const readings: PitchReading[] = [
			makeReading(53, 1.50),
			makeReading(53, 1.5167),
			makeReading(53, 1.5333),
			makeReading(53, 1.55),
			// 33ms blip — too short to count as articulation
			makeReading(53, 1.5833),
			makeReading(53, 1.60),
			makeReading(53, 1.65),
			makeReading(53, 1.70)
		];
		const notes = segmentNotes(readings, [1.50], 1.8);

		expect(notes).toHaveLength(1);
		expect(notes[0].midi).toBe(53);
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

describe('resolveOnsets — octave-artifact collapse for pre-onset stable runs', () => {
	it('drops a brief ±12 stable run preceding a longer one (D4 attack glitch)', () => {
		// Mimics the Locrian-Descent fixture: F4 sustained, then 4 frames of
		// D3 (Pitchy octave-half glitch at D4 attack) followed by sustained D4.
		// The D3 portion has only 4 frames (~67ms) — shorter than D4 — and
		// is exactly 12 semitones below D4. Should collapse, not produce
		// a phantom onset.
		const readings: PitchReading[] = [
			// F4 sustained (10 frames)
			makeReading(65, 0.083), makeReading(65, 0.10), makeReading(65, 0.117),
			makeReading(65, 0.133), makeReading(65, 0.15), makeReading(65, 0.167),
			makeReading(65, 0.20), makeReading(65, 0.25), makeReading(65, 0.28), makeReading(65, 0.30),
			// D3 octave-glitch (4 frames, 67ms)
			makeReading(50, 0.383), makeReading(50, 0.40), makeReading(50, 0.417), makeReading(50, 0.433),
			// D4 sustained (8 frames)
			makeReading(62, 0.45), makeReading(62, 0.467), makeReading(62, 0.483),
			makeReading(62, 0.50), makeReading(62, 0.517), makeReading(62, 0.533),
			makeReading(62, 0.55), makeReading(62, 0.567),
			// New note at the worklet onset (validates the 1.0 onset survives validateOnsets)
			makeReading(69, 1.0), makeReading(69, 1.017), makeReading(69, 1.033)
		];
		// Worklet found nothing in the pre-onset region, then a real onset later.
		const workletOnsets = [1.0];
		const resolved = resolveOnsets(workletOnsets, readings);

		// Expect: F4 stable start, D4 stable start, and the worklet onset.
		// The D3 phantom must NOT appear.
		const preOnsetStarts = resolved.filter((t) => t < 1.0);
		expect(preOnsetStarts).toHaveLength(2);
		expect(preOnsetStarts[0]).toBeCloseTo(0.083, 2); // F4
		expect(preOnsetStarts[1]).toBeCloseTo(0.45, 2);  // D4 (NOT 0.383)
	});

	it('keeps a ±12 stable run when it is the longer one (genuine octave change)', () => {
		// Inverse case: a SHORT F4 attack glitch followed by a LONG F3 sustain.
		// We do NOT want to collapse because the longer run IS the real note,
		// and dropping the shorter one is correct behavior (already handled).
		// This is a sanity-check that the rule is "drop the shorter of the
		// ±12 pair", not "drop the second one".
		const readings: PitchReading[] = [
			// Brief F4 (3 frames, 33ms) — attack-transient glitch
			makeReading(65, 0.0), makeReading(65, 0.0167), makeReading(65, 0.0333),
			// Long F3 sustain (12 frames)
			makeReading(53, 0.05), makeReading(53, 0.067), makeReading(53, 0.083),
			makeReading(53, 0.10), makeReading(53, 0.117), makeReading(53, 0.133),
			makeReading(53, 0.15), makeReading(53, 0.167), makeReading(53, 0.183),
			makeReading(53, 0.20), makeReading(53, 0.217), makeReading(53, 0.233),
			// New note at the worklet onset (validates the 1.0 onset survives validateOnsets)
			makeReading(69, 1.0), makeReading(69, 1.017), makeReading(69, 1.033)
		];
		const resolved = resolveOnsets([1.0], readings);
		const preOnsetStarts = resolved.filter((t) => t < 1.0);

		// Only F3 should remain — the brief F4 collapses into it.
		expect(preOnsetStarts).toHaveLength(1);
		expect(preOnsetStarts[0]).toBeCloseTo(0.05, 2);
	});
});

describe('resolveOnsets — gap-flanked brief stable runs', () => {
	it('accepts a 2-frame stable run flanked by clarity gaps as a real note', () => {
		// Mimics the Locrian-Descent A3: C4 sustained, gap (~67ms), 2 frames
		// of A3, gap (~183ms), G3 sustained. The A3 is real but Pitchy
		// dropped most of its frames below clarity threshold.
		const readings: PitchReading[] = [
			// C4 sustained (8 frames)
			makeReading(60, 0.617), makeReading(60, 0.633), makeReading(60, 0.65),
			makeReading(60, 0.667), makeReading(60, 0.70), makeReading(60, 0.75),
			makeReading(60, 0.80), makeReading(60, 0.883),
			// Gap of 67ms (clarity dropout) — then 2 frames of A3
			makeReading(57, 0.95), makeReading(57, 0.967),
			// Gap of 183ms — then G3 sustained
			makeReading(55, 1.15), makeReading(55, 1.167), makeReading(55, 1.183),
			makeReading(55, 1.20), makeReading(55, 1.25), makeReading(55, 1.30),
			// New note at the worklet onset (validates the 2.0 onset survives validateOnsets)
			makeReading(62, 2.0), makeReading(62, 2.017), makeReading(62, 2.033)
		];
		const resolved = resolveOnsets([2.0], readings); // worklet onset way later

		const preOnsetStarts = resolved.filter((t) => t < 2.0);
		// Expect 3 stable starts: C4, A3, G3 — the A3 must appear.
		expect(preOnsetStarts).toHaveLength(3);
		expect(preOnsetStarts[0]).toBeCloseTo(0.617, 2);
		expect(preOnsetStarts[1]).toBeCloseTo(0.95, 2);
		expect(preOnsetStarts[2]).toBeCloseTo(1.15, 2);
	});

	it('rejects a 2-frame run NOT flanked by gaps (suppresses sustain glitches)', () => {
		// Mimics a fast vibrato or detector wobble: F4 sustained with a brief
		// 2-frame F#4 in the middle, no surrounding gaps. Must NOT promote.
		const readings: PitchReading[] = [
			// F4 sustained
			makeReading(65, 0.0), makeReading(65, 0.0167), makeReading(65, 0.0333),
			makeReading(65, 0.05), makeReading(65, 0.067),
			// 2 frames of F#4 — wobble, no gaps
			makeReading(66, 0.083), makeReading(66, 0.10),
			// Back to F4
			makeReading(65, 0.117), makeReading(65, 0.133), makeReading(65, 0.15),
			makeReading(65, 0.167), makeReading(65, 0.183), makeReading(65, 0.20),
			// New note at the worklet onset (validates the 1.0 onset survives validateOnsets)
			makeReading(62, 1.0), makeReading(62, 1.017), makeReading(62, 1.033)
		];
		const resolved = resolveOnsets([1.0], readings);
		const preOnsetStarts = resolved.filter((t) => t < 1.0);

		// Only F4 should be a stable start — the F#4 wobble does NOT promote.
		expect(preOnsetStarts).toHaveLength(1);
		expect(preOnsetStarts[0]).toBeCloseTo(0.0, 2);
	});
});
