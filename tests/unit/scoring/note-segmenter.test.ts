import { describe, it, expect } from 'vitest';
import {
	segmentNotes,
	resolveOnsets,
	mergeSamePitchWithoutAttack,
	mergeOctaveBoundariesWithoutAttack,
	getMetronomeBleedOnsets
} from '$lib/audio/note-segmenter';
import type { PitchReading } from '$lib/audio/pitch-detector';
import type { DetectedNote } from '$lib/types/audio';

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

	it('drops a cross-segment ±12 last-sub when next segment is the +12 partner', () => {
		// F4 onset → 14 frames F4 → 4 frames D3 (octave glitch at the D4
		// attack, sitting before the worklet onset boundary) → onset at 0.45
		// → 8 frames D4. The D3 sub of segment 1 must be spliced out
		// post-emit because it's the half-frequency of the next note.
		const readings: PitchReading[] = [];
		for (let i = 0; i < 14; i++) readings.push(makeReading(65, 0.083 + i * 0.017));
		for (let i = 0; i < 4; i++) readings.push(makeReading(50, 0.383 + i * 0.017));
		for (let i = 0; i < 8; i++) readings.push(makeReading(62, 0.45 + i * 0.017));
		const notes = segmentNotes(readings, [0.083, 0.45], 0.6);
		expect(notes.map((n) => n.midi)).toEqual([65, 62]);
		expect(notes[0].onsetTime).toBeCloseTo(0.083, 3);
		expect(notes[1].onsetTime).toBeCloseTo(0.45, 3);
	});

	it('keeps a cross-segment ±12 last-sub when it is long (real grace note)', () => {
		// Same shape but the leading sub of segment 1 is 200ms — above
		// MIN_DURABLE_SUB_DURATION. Must NOT be collapsed: a real D3 grace
		// note before D4 should survive.
		const readings: PitchReading[] = [];
		for (let i = 0; i < 5; i++) readings.push(makeReading(65, 0.0 + i * 0.017));
		for (let i = 0; i < 12; i++) readings.push(makeReading(50, 0.10 + i * 0.017));
		for (let i = 0; i < 8; i++) readings.push(makeReading(62, 0.35 + i * 0.017));
		const notes = segmentNotes(readings, [0.0, 0.35], 0.5);
		expect(notes.map((n) => n.midi)).toEqual([65, 50, 62]);
	});

	it('collapses a stuck-octave artifact sandwiched between same-pitch neighbors', () => {
		// Reproduces the "Fourth–Fifth Push" failure: the user holds a sustained
		// low C, but pitchy locks onto the 2nd harmonic (C5) for ~600ms in the
		// middle. The segmenter sees three notes — C4, C5, C4 — across separate
		// onsets, and DTW then matches the LAST C onset to the expected long-C,
		// blowing up the rhythm score. With the sandwich rule, the C5 should
		// merge into a single continuous C4 note spanning all three segments.
		const readings: PitchReading[] = [];
		// Bb4 quarter note from 0.0 to 0.48
		for (let t = 0.0; t < 0.48; t += 0.017) readings.push(makeReading(58, t));
		// C5 segment 1 (true fundamental, 0.50–1.00)
		for (let t = 0.50; t < 1.00; t += 0.017) readings.push(makeReading(60, t));
		// "C6" segment (octave artifact — pitch detector locked on 2nd harmonic, 1.05–1.65)
		for (let t = 1.05; t < 1.65; t += 0.017) readings.push(makeReading(72, t));
		// C5 segment 2 (back to true fundamental, 1.75–2.40)
		for (let t = 1.75; t < 2.40; t += 0.017) readings.push(makeReading(60, t));
		const onsets = [0.0, 0.5, 1.05, 1.75];
		const notes = segmentNotes(readings, onsets, 2.4);

		// Expect 2 notes: the Bb and one continuous C — NOT 4
		expect(notes.map((n) => n.midi)).toEqual([58, 60]);
		expect(notes[1].onsetTime).toBeCloseTo(0.5, 2);
		// Sustained C duration spans from its first onset to the end of the last C segment
		expect(notes[1].duration).toBeGreaterThan(1.8);
	});

	it('preserves a real ±12 sub between DIFFERENT-pitch neighbors (not a sandwich)', () => {
		// The middle note is ±12 from the LEFT neighbor but the right neighbor
		// is a different pitch — not a sandwich. The middle note must survive
		// (a real octave-displacement figure like C4 → C5 → G5 in fast lines).
		const readings: PitchReading[] = [];
		for (let t = 0.0; t < 0.40; t += 0.017) readings.push(makeReading(60, t));
		for (let t = 0.50; t < 0.90; t += 0.017) readings.push(makeReading(72, t));
		for (let t = 1.00; t < 1.40; t += 0.017) readings.push(makeReading(67, t));
		const notes = segmentNotes(readings, [0.0, 0.5, 1.0], 1.4);

		expect(notes.map((n) => n.midi)).toEqual([60, 72, 67]);
	});

	it('drops sub-segments where every reading is warmup', () => {
		// F3 sustain, then a 3-frame all-warmup C7 burst at the trailing edge
		// (mimics the locrian-descent C7 phantom: a stabilizer reset on a
		// late false-positive worklet onset puts the post-reset frames in
		// warmup, and they don't represent a real note).
		const readings: PitchReading[] = [
			makeReading(53, 1.0),
			makeReading(53, 1.017),
			makeReading(53, 1.033),
			makeReading(53, 1.05),
			makeReading(53, 1.067),
			{ ...makeReading(81, 1.5), warmup: true },
			{ ...makeReading(81, 1.517), warmup: true },
			{ ...makeReading(81, 1.533), warmup: true }
		];
		const notes = segmentNotes(readings, [1.0], 1.6);
		expect(notes.map((n) => n.midi)).toEqual([53]);
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

	it('accepts the LAST gap-flanked stable run when worklet onset provides flanking gap', () => {
		// Locrian-descent shape: C4 sustain → 67ms gap → 2 frames A3 → 89ms
		// gap to worklet onset → G3 sustained after the onset. With
		// nextEventTime threading, A3's gapAfter against the worklet onset is
		// 0.089 ≥ 0.05, so A3 promotes. Distinct MIDI from the post-onset
		// G3, so the MIDI-aware dedup keeps both onsets.
		const readings: PitchReading[] = [
			// C4 sustained
			makeReading(60, 0.617), makeReading(60, 0.633), makeReading(60, 0.65),
			makeReading(60, 0.667), makeReading(60, 0.70), makeReading(60, 0.75),
			makeReading(60, 0.80), makeReading(60, 0.883),
			// A3 (last in pre-onset)
			makeReading(57, 0.95), makeReading(57, 0.967),
			// Post-worklet G3 (different MIDI — must NOT be deduped against A3)
			makeReading(55, 1.20), makeReading(55, 1.217), makeReading(55, 1.233)
		];
		const result = resolveOnsets([1.056], readings);
		expect(result).toContain(0.95);
		expect(result).toContain(1.056);
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

describe('mergeSamePitchWithoutAttack', () => {
	function makeNote(midi: number, onsetTime: number, duration: number, cents = 0, clarity = 0.95): DetectedNote {
		return { midi, cents, onsetTime, duration, clarity };
	}

	it('merges consecutive same-MIDI notes when no worklet onset is near the boundary', () => {
		// Held D split by a pitch-detector glitch — the pitch tracker briefly
		// dropped clarity, segmenter emitted two D segments, but no audio
		// attack happened at the split.
		const notes: DetectedNote[] = [
			makeNote(62, 0.0, 1.05),
			makeNote(62, 1.05, 0.12)
		];
		// Worklet onsets are unrelated to the spurious boundary at 1.05.
		const workletOnsets = [2.84, 3.44];
		const merged = mergeSamePitchWithoutAttack(notes, workletOnsets);

		expect(merged).toHaveLength(1);
		expect(merged[0].midi).toBe(62);
		expect(merged[0].onsetTime).toBe(0.0);
		expect(merged[0].duration).toBeCloseTo(1.17, 5);
	});

	it('preserves consecutive same-MIDI notes when a worklet onset confirms the attack', () => {
		// Two genuinely articulated D quarter notes — the worklet detected an
		// attack at the boundary, so the segments are real re-articulations.
		const notes: DetectedNote[] = [
			makeNote(62, 0.0, 0.5),
			makeNote(62, 0.5, 0.5)
		];
		const workletOnsets = [0.0, 0.5];
		const merged = mergeSamePitchWithoutAttack(notes, workletOnsets);

		expect(merged).toHaveLength(2);
		expect(merged[0].onsetTime).toBe(0.0);
		expect(merged[1].onsetTime).toBe(0.5);
	});

	it('still merges when a worklet onset is far outside the ±window of the boundary', () => {
		// Boundary at 1.0s, onsets at 0.2 and 2.0 — both > window.
		const notes: DetectedNote[] = [
			makeNote(55, 0.0, 1.0),
			makeNote(55, 1.0, 0.5)
		];
		const workletOnsets = [0.2, 2.0];
		const merged = mergeSamePitchWithoutAttack(notes, workletOnsets);

		expect(merged).toHaveLength(1);
	});

	it('preserves a re-articulation when the worklet onset is within ±window', () => {
		// 0.040s after the boundary — well within the 75ms window.
		const notes: DetectedNote[] = [
			makeNote(60, 0.0, 0.3),
			makeNote(60, 0.3, 0.3)
		];
		const workletOnsets = [0.0, 0.340];
		const merged = mergeSamePitchWithoutAttack(notes, workletOnsets);

		expect(merged).toHaveLength(2);
	});

	it('never merges different-MIDI consecutive notes', () => {
		const notes: DetectedNote[] = [
			makeNote(60, 0.0, 0.5),
			makeNote(62, 0.5, 0.5)
		];
		// Even with no worklet onset at the boundary, distinct pitches stay split.
		const merged = mergeSamePitchWithoutAttack(notes, [10.0]);

		expect(merged).toHaveLength(2);
		expect(merged.map((n) => n.midi)).toEqual([60, 62]);
	});

	it('returns input unchanged when workletOnsets is empty', () => {
		// No worklet signal → can't reason about attacks → conservative no-op.
		const notes: DetectedNote[] = [
			makeNote(60, 0.0, 0.5),
			makeNote(60, 0.5, 0.5)
		];
		const merged = mergeSamePitchWithoutAttack(notes, []);

		expect(merged).toHaveLength(2);
	});

	it('chains merges across 3+ consecutive same-MIDI segments', () => {
		// Three same-pitch fragments, no worklet onsets near any boundary —
		// should collapse to one note.
		const notes: DetectedNote[] = [
			makeNote(55, 0.0, 0.5),
			makeNote(55, 0.5, 0.3),
			makeNote(55, 0.8, 0.4)
		];
		const merged = mergeSamePitchWithoutAttack(notes, [5.0]);

		expect(merged).toHaveLength(1);
		expect(merged[0].onsetTime).toBe(0.0);
		expect(merged[0].duration).toBeCloseTo(1.2, 5);
	});

	it('weights merged cents and clarity by duration', () => {
		// Long sustain at +5 cents, brief glitch fragment at +30 cents — the
		// long sustain should dominate the merged cents/clarity.
		const notes: DetectedNote[] = [
			makeNote(62, 0.0, 1.0, 5, 0.99),
			makeNote(62, 1.0, 0.1, 30, 0.5)
		];
		const merged = mergeSamePitchWithoutAttack(notes, []);
		// With empty workletOnsets this returns unchanged (sanity), so retry
		// with a non-empty onset list outside the merge window.
		const mergedReal = mergeSamePitchWithoutAttack(notes, [5.0]);

		expect(merged).toHaveLength(2); // baseline guarantee
		expect(mergedReal).toHaveLength(1);
		// Expected: (5*1.0 + 30*0.1) / 1.1 = 8 → rounded to 7 or 8
		expect(mergedReal[0].cents).toBeCloseTo(7, 0);
		// Clarity: (0.99*1.0 + 0.5*0.1) / 1.1 ≈ 0.945
		expect(mergedReal[0].clarity).toBeCloseTo(0.945, 2);
	});

	it('passes through when fewer than 2 notes', () => {
		expect(mergeSamePitchWithoutAttack([], [1.0])).toEqual([]);
		const one: DetectedNote[] = [makeNote(60, 0.0, 0.5)];
		expect(mergeSamePitchWithoutAttack(one, [1.0])).toEqual(one);
	});

	it('handles unsorted workletOnsets without false-merging real re-articulations', () => {
		// Same boundary as the "preserves a re-articulation" case (onset at
		// 0.340, within ±75ms of the 0.3 boundary) but supplied as an
		// unsorted array. A naive early-return scan would skip the
		// in-window onset and incorrectly merge.
		const notes: DetectedNote[] = [
			makeNote(60, 0.0, 0.3),
			makeNote(60, 0.3, 0.3)
		];
		const unsorted = [2.0, 0.0, 0.340];
		expect(mergeSamePitchWithoutAttack(notes, unsorted)).toHaveLength(2);
	});

	it('does not mutate the caller-supplied workletOnsets array', () => {
		const notes: DetectedNote[] = [
			makeNote(55, 0.0, 0.5),
			makeNote(55, 0.5, 0.5)
		];
		const onsets = [2.0, 5.0, 0.5];
		const before = [...onsets];
		mergeSamePitchWithoutAttack(notes, onsets);
		expect(onsets).toEqual(before);
	});
});

describe('segmentNotes — workletOnsets parameter (attack-evidence merge)', () => {
	function makeReading(midi: number, time: number, cents = 0, clarity = 0.95): PitchReading {
		return { midi, midiFloat: midi + cents / 100, cents, clarity, time, frequency: 440 };
	}

	it('merges a same-MIDI split caused by a reading-gap when the worklet did not fire there', () => {
		// Held D for ~1.2 s with a clarity dropout in the middle — exactly the
		// fixture pattern. Without workletOnsets the old code would emit two
		// notes via splitOnReadingGaps; with the worklet evidence pass, the
		// pieces collapse back into one because there was no real attack.
		const readings: PitchReading[] = [];
		for (let t = 0.0; t < 0.95; t += 0.0167) readings.push(makeReading(62, t));
		// Gap from 0.95 → 1.07 (≥ READING_GAP_SPLIT_THRESHOLD), simulating the
		// pitch tracker losing the signal briefly.
		for (let t = 1.07; t < 1.20; t += 0.0167) readings.push(makeReading(62, t));
		// Single boundary at the start; the split would otherwise come from
		// the internal gap rule.
		const onsets = [0.0];

		// Worklet only saw the initial attack — nothing in the middle.
		const workletOnsets = [0.0];

		const without = segmentNotes(readings, onsets, 1.20);
		const withWorklet = segmentNotes(readings, onsets, 1.20, undefined, undefined, undefined, workletOnsets);

		// Sanity: the gap-split path is actually firing (without workletOnsets,
		// two pieces emerge). With workletOnsets, the merge collapses them.
		expect(without.length).toBeGreaterThanOrEqual(2);
		expect(withWorklet).toHaveLength(1);
		expect(withWorklet[0].midi).toBe(62);
		expect(withWorklet[0].onsetTime).toBeCloseTo(0.0, 3);
	});

	it('does NOT merge a same-MIDI split when the worklet onset confirms a re-articulation', () => {
		// Same shape as above, but the worklet fired at the split moment —
		// a real soft re-tonguing that the pitch tracker also caught via gap.
		const readings: PitchReading[] = [];
		for (let t = 0.0; t < 0.95; t += 0.0167) readings.push(makeReading(53, t));
		for (let t = 1.07; t < 1.50; t += 0.0167) readings.push(makeReading(53, t));
		const onsets = [0.0, 1.07];
		const workletOnsets = [0.0, 1.07];

		const result = segmentNotes(readings, onsets, 1.50, undefined, undefined, undefined, workletOnsets);

		expect(result).toHaveLength(2);
		expect(result[0].midi).toBe(53);
		expect(result[1].midi).toBe(53);
		expect(result[1].onsetTime).toBeCloseTo(1.07, 2);
	});

	it('default (no workletOnsets argument) preserves prior behaviour', () => {
		// The exact same fixture as the merge test — no workletOnsets parameter
		// means no merge pass, so the historical two-note output is preserved
		// for callers that haven't been migrated.
		const readings: PitchReading[] = [];
		for (let t = 0.0; t < 0.95; t += 0.0167) readings.push(makeReading(62, t));
		for (let t = 1.07; t < 1.20; t += 0.0167) readings.push(makeReading(62, t));
		const onsets = [0.0];

		const result = segmentNotes(readings, onsets, 1.20);
		expect(result.length).toBeGreaterThanOrEqual(2);
	});
});

describe('resolveOnsets — MIDI-aware ATTACK_DEDUP', () => {
	it('does NOT replace worklet onset with stable-run start when MIDIs differ', () => {
		// 4 frames of C4 ending at 0.95, worklet onset at 1.0 with E4 readings
		// immediately after. Distance 0.05 < ATTACK_DEDUP_WINDOW (0.15), but
		// the MIDIs differ — distinct attacks, both onsets must remain.
		const readings: PitchReading[] = [
			makeReading(60, 0.90), makeReading(60, 0.917), makeReading(60, 0.934), makeReading(60, 0.950),
			makeReading(64, 1.0), makeReading(64, 1.017), makeReading(64, 1.033)
		];
		const result = resolveOnsets([1.0], readings);
		expect(result).toEqual([0.90, 1.0]);
	});

	it('still dedups when MIDIs match across the boundary', () => {
		// Regression sanity-check for the original same-attack dedup case:
		// MIDIs match (60 → 60), so the worklet onset is replaced by the
		// earlier stable-run start.
		const readings: PitchReading[] = [
			makeReading(60, 0.90), makeReading(60, 0.917), makeReading(60, 0.934), makeReading(60, 0.950),
			makeReading(60, 1.0)
		];
		const result = resolveOnsets([1.0], readings);
		expect(result).toEqual([0.90]);
	});
});

describe('mergeSamePitchWithoutAttack — bleedOnsets evidence', () => {
	function makeNote(midi: number, onsetTime: number, duration: number, cents = 0, clarity = 0.95): DetectedNote {
		return { midi, cents, onsetTime, duration, clarity };
	}

	it('merges same-pitch split when the worklet onset is bleed from a scheduled click', () => {
		// Sustained C broken into two segments by a worklet onset at 1.019,
		// which sits 92 ms after a metronome click at 0.927 — the
		// fingerprint of mic-captured metronome bleed. Without bleedOnsets
		// the function keeps the false split because the worklet "confirmed"
		// an attack; with bleed evidence it correctly collapses.
		const notes: DetectedNote[] = [
			makeNote(60, 0.083, 0.936, 9),
			makeNote(60, 1.019, 0.581, 12)
		];
		const workletOnsets = [1.019];
		const bleedOnsets = [0.327, 0.927, 1.527];

		const merged = mergeSamePitchWithoutAttack(notes, workletOnsets, undefined, bleedOnsets);
		expect(merged).toHaveLength(1);
		expect(merged[0].midi).toBe(60);
		expect(merged[0].onsetTime).toBeCloseTo(0.083, 3);
		expect(merged[0].duration).toBeCloseTo(1.517, 3);
	});

	it('preserves a re-articulation when the worklet onset is too close to a beat to be bleed', () => {
		// Player tongues a fresh C exactly on the beat — worklet detects
		// the real attack ~30 ms after the click. That latency is below
		// BLEED_LATENCY_MIN, so the onset is treated as a genuine attack
		// and the two segments stay split.
		const notes: DetectedNote[] = [
			makeNote(60, 0.0, 0.6),
			makeNote(60, 0.6, 0.6)
		];
		const workletOnsets = [0.0, 0.630]; // 30ms after beat
		const bleedOnsets = [0.0, 0.6];

		const merged = mergeSamePitchWithoutAttack(notes, workletOnsets, undefined, bleedOnsets);
		expect(merged).toHaveLength(2);
	});

	it('preserves a re-articulation when the worklet onset is too far past a beat to be bleed', () => {
		// Worklet onset 300 ms after the previous beat — well past
		// BLEED_LATENCY_MAX. Treated as a real (if late) attack.
		const notes: DetectedNote[] = [
			makeNote(60, 0.0, 0.9),
			makeNote(60, 0.9, 0.5)
		];
		const workletOnsets = [0.0, 0.900];
		const bleedOnsets = [0.0, 0.6, 1.2];

		const merged = mergeSamePitchWithoutAttack(notes, workletOnsets, undefined, bleedOnsets);
		expect(merged).toHaveLength(2);
	});

	it('falls back to legacy behaviour when bleedOnsets is omitted', () => {
		// A worklet onset at the boundary preserves the split when no bleed
		// evidence is supplied, even if the onset happens to coincide with
		// what would be a beat. Existing callers must see identical results.
		const notes: DetectedNote[] = [
			makeNote(60, 0.0, 0.5),
			makeNote(60, 0.5, 0.5)
		];
		const workletOnsets = [0.0, 0.5];

		const merged = mergeSamePitchWithoutAttack(notes, workletOnsets);
		expect(merged).toHaveLength(2);
	});

	it('falls back to legacy behaviour when bleedOnsets is empty', () => {
		const notes: DetectedNote[] = [
			makeNote(60, 0.0, 0.5),
			makeNote(60, 0.5, 0.5)
		];
		const workletOnsets = [0.0, 0.5];

		const merged = mergeSamePitchWithoutAttack(notes, workletOnsets, undefined, []);
		expect(merged).toHaveLength(2);
	});

	it('only flags a worklet onset whose nearest preceding bleed event matches the latency window', () => {
		// Two worklet onsets at the same-pitch boundary. The first (0.300)
		// is 30 ms after the bleed time (below MIN) — counts as a real
		// attack. The second (0.350) is 80 ms after the bleed time (in
		// window) — counts as bleed. The function must spot at least one
		// real attack and preserve the split.
		const notes: DetectedNote[] = [
			makeNote(60, 0.0, 0.32),
			makeNote(60, 0.32, 0.30)
		];
		const workletOnsets = [0.300, 0.350];
		const bleedOnsets = [0.270];

		const merged = mergeSamePitchWithoutAttack(notes, workletOnsets, undefined, bleedOnsets);
		expect(merged).toHaveLength(2);
	});

	it('does not affect different-pitch transitions even when the onset looks like bleed', () => {
		// The worklet onset at 1.6 is 73 ms after the bleed at 1.527 — well
		// inside the bleed window — but the pitches differ across the
		// boundary, so the merge function never tries to merge them.
		const notes: DetectedNote[] = [
			makeNote(60, 0.0, 1.6),
			makeNote(62, 1.6, 0.5)
		];
		const workletOnsets = [1.6];
		const bleedOnsets = [0.6, 1.2, 1.527];

		const merged = mergeSamePitchWithoutAttack(notes, workletOnsets, undefined, bleedOnsets);
		expect(merged).toHaveLength(2);
		expect(merged.map((n) => n.midi)).toEqual([60, 62]);
	});

	// The end-to-end regression that runs the saved diagnostic JSON through
	// resolveOnsets + segmentNotes + scoreAttempt lives in
	// `tests/integration/audio-processing-pipeline.test.ts` under
	// "Flat Seven–Octave metronome-bleed regression".
});

describe('getMetronomeBleedOnsets', () => {
	it('returns beat times in recording-time for the recording window', () => {
		// recordingTransportSeconds = 1.2 (Transport beat 2 at tempo 100),
		// recording is 1.5 s long. With a 250ms lookback, the scan starts
		// at Transport 0.95, so the first beat caught is Transport 1.2 →
		// recording-time 0.0. Subsequent beats every 0.6 s up to the end.
		const result = getMetronomeBleedOnsets(1.2, 100, 1.5);
		expect(result.length).toBeGreaterThan(0);
		// Beats at recording times 0.0, 0.6, 1.2 (still ≤ 1.5).
		expect(result[0]).toBeCloseTo(0.0, 5);
		expect(result[1]).toBeCloseTo(0.6, 5);
		expect(result[2]).toBeCloseTo(1.2, 5);
	});

	it('includes a click that fired just before recording started', () => {
		// recordingTransportSeconds = 1.4 (200 ms past beat 1.2). The beat
		// at Transport 1.2 fired 200 ms before recording start, well inside
		// the 250 ms lookback; its bleed could still reach the mic during
		// the recording window.
		const result = getMetronomeBleedOnsets(1.4, 100, 1.0);
		expect(result[0]).toBeCloseTo(-0.2, 5);
	});

	it('returns an empty array for zero or negative tempo / duration', () => {
		expect(getMetronomeBleedOnsets(0, 0, 1.0)).toEqual([]);
		expect(getMetronomeBleedOnsets(0, 100, 0)).toEqual([]);
		expect(getMetronomeBleedOnsets(0, -1, 1.0)).toEqual([]);
	});

	it('matches the recording from the flat-seven-octave diagnostic', () => {
		// recordingTransportSeconds ≈ 6.273, tempo 100, audio 3.6135 s. The
		// earlier metronome click at Transport 6.0 sits 273 ms before
		// recording — its bleed window (T + 50..200 ms) lands entirely
		// before time 0, so the 250 ms lookback correctly excludes it.
		// The seven beats inside the recording (matching the worklet's
		// observed ~92 ms bleed pattern) are what matter.
		const result = getMetronomeBleedOnsets(6.273, 100, 3.6135);
		expect(result[0]).toBeCloseTo(0.327, 3);
		expect(result[1]).toBeCloseTo(0.927, 3);
		expect(result[2]).toBeCloseTo(1.527, 3);
		expect(result[3]).toBeCloseTo(2.127, 3);
		expect(result[4]).toBeCloseTo(2.727, 3);
		expect(result[5]).toBeCloseTo(3.327, 3);
	});
});

describe('mergeOctaveBoundariesWithoutAttack', () => {
	function makeNote(
		midi: number,
		onsetTime: number,
		duration: number,
		cents = 0,
		clarity = 0.95
	): DetectedNote {
		return { midi, cents, onsetTime, duration, clarity };
	}

	/**
	 * Build a synthetic reading stream where most frames carry one midi but
	 * `lowerFundamentalFrameCount` selected frames have their raw frequency
	 * pulled to a lower octave's pitch. Mirrors the McLeod-stabilizer-locked
	 * fingerprint in the bc-016 fixture.
	 */
	function makeMixedReadings(
		startTime: number,
		endTime: number,
		dominantMidi: number,
		lowerFundamentalMidi: number,
		lowerFundamentalFrameCount: number
	): PitchReading[] {
		const dt = 1 / 60;
		const dominantFreq = 440 * Math.pow(2, (dominantMidi - 69) / 12);
		const lowerFreq = 440 * Math.pow(2, (lowerFundamentalMidi - 69) / 12);
		const out: PitchReading[] = [];
		let lowerEmitted = 0;
		for (let t = startTime; t < endTime - 1e-9; t += dt) {
			const isLower = lowerEmitted < lowerFundamentalFrameCount && Math.floor((t - startTime) / dt) % 4 === 0;
			const freq = isLower ? lowerFreq : dominantFreq;
			out.push({
				midi: dominantMidi,
				midiFloat: dominantMidi + 0.1,
				cents: 10,
				clarity: 0.95,
				time: t,
				frequency: freq
			});
			if (isLower) lowerEmitted++;
		}
		return out;
	}

	it('collapses an octave-up segment when the higher segment shows lower-fundamental evidence', () => {
		// Higher C5 segment (0.0–0.8s) with ≥ 3 raw frames at 263 Hz (rawMidi 60),
		// followed by sustained C4 (0.8–1.6s). No worklet onset at the boundary.
		const readings = [
			...makeMixedReadings(0.0, 0.8, 72, 60, 5),
			...makeMixedReadings(0.8, 1.6, 60, 60, 0)
		];
		const notes: DetectedNote[] = [
			makeNote(72, 0.0, 0.8, 15, 0.95),
			makeNote(60, 0.8, 0.8, 20, 0.9)
		];
		const merged = mergeOctaveBoundariesWithoutAttack(notes, readings, [0.0]);

		expect(merged).toHaveLength(1);
		expect(merged[0].midi).toBe(60);
		expect(merged[0].onsetTime).toBeCloseTo(0.0, 5);
		expect(merged[0].duration).toBeCloseTo(1.6, 5);
		// Duration-weighted cents and clarity (both segments equal duration).
		expect(merged[0].cents).toBe(18); // round((15+20)/2)
	});

	it('preserves a real octave drop when the worklet detected an attack at the boundary', () => {
		const readings = [
			...makeMixedReadings(0.0, 0.8, 72, 60, 5),
			...makeMixedReadings(0.8, 1.6, 60, 60, 0)
		];
		const notes: DetectedNote[] = [
			makeNote(72, 0.0, 0.8),
			makeNote(60, 0.8, 0.8)
		];
		// Worklet onset within 75ms of the 0.8 boundary → real attack.
		const merged = mergeOctaveBoundariesWithoutAttack(notes, readings, [0.0, 0.82]);

		expect(merged).toHaveLength(2);
		expect(merged[0].midi).toBe(72);
		expect(merged[1].midi).toBe(60);
	});

	it('does NOT merge when the higher segment lacks lower-fundamental evidence', () => {
		// Real sustained C5 — audio contains only ~523 Hz, no leakage to 263 Hz.
		// Followed by an isolated C4 segment. Without lower-fundamental
		// evidence in the C5 segment, the merge is unsafe.
		const readings = [
			...makeMixedReadings(0.0, 0.8, 72, 60, 0),
			...makeMixedReadings(0.8, 1.6, 60, 60, 0)
		];
		const notes: DetectedNote[] = [
			makeNote(72, 0.0, 0.8),
			makeNote(60, 0.8, 0.8)
		];
		const merged = mergeOctaveBoundariesWithoutAttack(notes, readings, [0.0]);

		expect(merged).toHaveLength(2);
	});

	it('does NOT merge with only one or two lower-fundamental frames (below threshold)', () => {
		const readings = [
			...makeMixedReadings(0.0, 0.8, 72, 60, 2), // below MIN_LOWER_FUNDAMENTAL_FRAMES (3)
			...makeMixedReadings(0.8, 1.6, 60, 60, 0)
		];
		const notes: DetectedNote[] = [
			makeNote(72, 0.0, 0.8),
			makeNote(60, 0.8, 0.8)
		];
		const merged = mergeOctaveBoundariesWithoutAttack(notes, readings, [0.0]);

		expect(merged).toHaveLength(2);
	});

	it('treats a bleed-coincident worklet onset as not-a-real-attack and still merges', () => {
		const readings = [
			...makeMixedReadings(0.0, 0.8, 72, 60, 5),
			...makeMixedReadings(0.8, 1.6, 60, 60, 0)
		];
		const notes: DetectedNote[] = [
			makeNote(72, 0.0, 0.8),
			makeNote(60, 0.8, 0.8)
		];
		// Worklet onset at 0.79 — metronome bleed firing ~90ms after a click
		// at 0.7. With bleedOnsets supplied, the onset is recognised as bleed
		// and the boundary is treated as having no real attack.
		const workletOnsets = [0.0, 0.79];
		const bleedOnsets = [0.7];
		const merged = mergeOctaveBoundariesWithoutAttack(
			notes,
			readings,
			workletOnsets,
			undefined,
			bleedOnsets
		);

		expect(merged).toHaveLength(1);
		expect(merged[0].midi).toBe(60);
	});

	it('never merges when the pitch difference is not exactly one octave', () => {
		// D4 → C5 (diff 10): not an octave, not subject to this rule
		// regardless of evidence.
		const readings = makeMixedReadings(0.0, 1.6, 72, 60, 10);
		const notes: DetectedNote[] = [
			makeNote(62, 0.0, 0.8),
			makeNote(72, 0.8, 0.8)
		];
		const merged = mergeOctaveBoundariesWithoutAttack(notes, readings, [0.0]);

		expect(merged).toHaveLength(2);
	});

	it('passes through when fewer than 2 notes', () => {
		const readings: PitchReading[] = [];
		expect(mergeOctaveBoundariesWithoutAttack([], readings, [1.0])).toEqual([]);
		const one = [makeNote(60, 0.0, 0.5)];
		expect(mergeOctaveBoundariesWithoutAttack(one, readings, [1.0])).toEqual(one);
	});

	it('passes through when workletOnsets is empty', () => {
		const readings = [...makeMixedReadings(0.0, 0.8, 72, 60, 5)];
		const notes: DetectedNote[] = [
			makeNote(72, 0.0, 0.8),
			makeNote(60, 0.8, 0.8)
		];
		expect(mergeOctaveBoundariesWithoutAttack(notes, readings, [])).toEqual(notes);
	});

	it('passes through when readings is empty', () => {
		const notes: DetectedNote[] = [
			makeNote(72, 0.0, 0.8),
			makeNote(60, 0.8, 0.8)
		];
		expect(mergeOctaveBoundariesWithoutAttack(notes, [], [0.0])).toEqual(notes);
	});

	it('chains correctly after same-pitch merge in segmentNotes', () => {
		// Three fragmented C5 segments (split by stabilizer flips) followed by
		// a low C4 — the bc-016 shape. mergeSamePitchWithoutAttack joins the
		// three C5s into one, then mergeOctaveBoundariesWithoutAttack
		// collapses the combined C5 into the C4.
		const readings = [
			...makeMixedReadings(0.0, 0.4, 72, 60, 2),
			...makeMixedReadings(0.4, 0.8, 72, 60, 2),
			...makeMixedReadings(0.8, 1.2, 72, 60, 2),
			...makeMixedReadings(1.2, 2.0, 60, 60, 0)
		];
		const notes: DetectedNote[] = [
			makeNote(72, 0.0, 0.4),
			makeNote(72, 0.4, 0.4),
			makeNote(72, 0.8, 0.4),
			makeNote(60, 1.2, 0.8)
		];
		const samePitchMerged = mergeSamePitchWithoutAttack(notes, [0.0]);
		expect(samePitchMerged).toHaveLength(2); // three C5s → one C5, then the C4

		const merged = mergeOctaveBoundariesWithoutAttack(samePitchMerged, readings, [0.0]);
		expect(merged).toHaveLength(1);
		expect(merged[0].midi).toBe(60);
		expect(merged[0].onsetTime).toBeCloseTo(0.0, 5);
		expect(merged[0].duration).toBeCloseTo(2.0, 5);
	});
});
