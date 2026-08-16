import { describe, it, expect } from 'vitest';
import {
	trimToPerformance,
	rebaseToAnchor,
	PERFORMANCE_PREROLL_SECONDS,
	ANCHOR_EARLY_TOLERANCE_SECONDS
} from '$lib/audio/capture-window';
import type { PitchReading } from '$lib/audio/pitch-frame';

function makeReading(midi: number, time: number, clarity = 0.95): PitchReading {
	return { midi, midiFloat: midi, cents: 0, clarity, time, frequency: 440, rms: 0.1 };
}

/** Readings every 1/60 s from `start` to `end`, all on one MIDI note. */
function run(midi: number, start: number, end: number): PitchReading[] {
	const out: PitchReading[] = [];
	for (let t = start; t < end; t += 1 / 60) out.push(makeReading(midi, t));
	return out;
}

describe('trimToPerformance', () => {
	it('leaves a capture that already starts at the performance untouched', () => {
		const readings = run(60, 0, 0.5);
		const result = trimToPerformance(readings, [0.02], 0.6);

		expect(result.offset).toBe(0);
		expect(result.readings).toBe(readings);
		expect(result.workletOnsets).toEqual([0.02]);
		expect(result.duration).toBe(0.6);
	});

	it('keeps exactly the pre-roll ahead of the first reading', () => {
		// User came in 2 s after the window was armed.
		const readings = run(60, 2.0, 3.0);
		const result = trimToPerformance(readings, [1.99], 3.1);

		expect(result.offset).toBeCloseTo(2.0 - PERFORMANCE_PREROLL_SECONDS, 10);
		expect(result.readings[0].time).toBeCloseTo(PERFORMANCE_PREROLL_SECONDS, 10);
		expect(result.duration).toBeCloseTo(3.1 - result.offset, 10);
	});

	it('keeps the attack onset that sits inside the pre-roll', () => {
		// The worklet fires on the attack ~90 ms before pitch turns confident —
		// the exact evidence the old trigger-armed capture threw away.
		const readings = run(60, 2.0, 3.0);
		const result = trimToPerformance(readings, [1.91], 3.1);

		expect(result.workletOnsets).toHaveLength(1);
		expect(result.workletOnsets[0]).toBeCloseTo(1.91 - result.offset, 10);
		// Still ahead of the first confident reading, as it was in the capture.
		expect(result.workletOnsets[0]).toBeLessThan(result.readings[0].time);
	});

	it('drops onsets that fall in the discarded lead-in', () => {
		const readings = run(60, 2.0, 3.0);
		// A stray click 1.5 s before the user came in — outside the pre-roll.
		const result = trimToPerformance(readings, [0.5, 1.95], 3.1);

		expect(result.workletOnsets).toHaveLength(1);
		expect(result.workletOnsets[0]).toBeCloseTo(1.95 - result.offset, 10);
	});

	it('never rebases a reading to a negative time', () => {
		const readings = run(60, 2.0, 3.0);
		const result = trimToPerformance(readings, [], 3.1);

		for (const r of result.readings) expect(r.time).toBeGreaterThanOrEqual(0);
	});

	it('preserves reading spacing and every non-time field', () => {
		const readings = run(60, 2.0, 2.2);
		const result = trimToPerformance(readings, [], 2.3);

		for (let i = 0; i < readings.length; i++) {
			expect(result.readings[i].time).toBeCloseTo(readings[i].time - result.offset, 10);
			expect(result.readings[i].midi).toBe(readings[i].midi);
			expect(result.readings[i].clarity).toBe(readings[i].clarity);
			expect(result.readings[i].rms).toBe(readings[i].rms);
		}
	});

	it('leaves a silent capture alone so its bleed window still covers the take', () => {
		const result = trimToPerformance([], [0.4, 0.9], 4.0);

		expect(result.offset).toBe(0);
		expect(result.readings).toEqual([]);
		expect(result.workletOnsets).toEqual([0.4, 0.9]);
		expect(result.duration).toBe(4.0);
	});

	it('does not trim when the lead-in is shorter than the pre-roll', () => {
		const readings = run(60, 0.2, 1.0);
		const result = trimToPerformance(readings, [], 1.1);

		expect(result.offset).toBe(0);
		expect(result.readings[0].time).toBeCloseTo(0.2, 10);
	});

	it('is idempotent — trimming an already-trimmed capture is a no-op', () => {
		const once = trimToPerformance(run(60, 2.0, 3.0), [1.95], 3.1);
		const twice = trimToPerformance(once.readings, once.workletOnsets, once.duration);

		expect(twice.offset).toBe(0);
		expect(twice.readings).toBe(once.readings);
		expect(twice.duration).toBe(once.duration);
	});

	it('holds the pre-roll clear of the detection lag it exists to undo', () => {
		// One analyser window (4096/44100 ≈ 93 ms) plus a rAF tick, and clear of
		// the ~250 ms where DTW alignment starts flipping. See capture-window.ts.
		expect(PERFORMANCE_PREROLL_SECONDS).toBeGreaterThan(4096 / 44100 + 1 / 60);
		expect(PERFORMANCE_PREROLL_SECONDS).toBeLessThan(0.5);
	});
});

describe('rebaseToAnchor', () => {
	it('discards the count-in and re-origins the take on the anchor', () => {
		// Detector running from the top of a 2-bar count-in; entrance at 4.8 s.
		const readings = [...run(64, 1.0, 1.5), ...run(60, 5.0, 6.0)];
		const result = rebaseToAnchor(readings, [1.02, 5.01], 4.8);

		expect(result.readings[0].midi).toBe(60);
		expect(result.readings[0].time).toBeCloseTo(5.0 - 4.8, 10);
		expect(result.workletOnsets).toEqual([expect.closeTo(0.21, 10)]);
	});

	it('keeps an attack just ahead of the anchor at a negative time', () => {
		// An on-the-downbeat entrance: the worklet fires on the transient a
		// hair before the scheduled beat. Kept, not clipped — the quantizer
		// clamps it to beat 0.
		const readings = run(60, 4.78, 5.5);
		const result = rebaseToAnchor(readings, [4.75], 4.8);

		expect(result.workletOnsets).toEqual([expect.closeTo(-0.05, 10)]);
		expect(result.readings[0].time).toBeCloseTo(-0.02, 10);
	});

	it('drops events beyond the early tolerance', () => {
		const readings = run(60, 5.0, 5.5);
		const early = 4.8 - ANCHOR_EARLY_TOLERANCE_SECONDS - 0.01;
		const result = rebaseToAnchor(readings, [early, 5.02], 4.8);

		expect(result.workletOnsets).toHaveLength(1);
		expect(result.workletOnsets[0]).toBeCloseTo(0.22, 10);
	});

	it('lands an event exactly on the anchor at time zero', () => {
		const result = rebaseToAnchor([makeReading(60, 4.8)], [4.8], 4.8);

		expect(result.readings[0].time).toBe(0);
		expect(result.workletOnsets).toEqual([0]);
	});

	it('passes empty captures through', () => {
		expect(rebaseToAnchor([], [], 4.8)).toEqual({ readings: [], workletOnsets: [] });
	});

	it('keeps the tolerance above attack scale and under a beat at 240 BPM', () => {
		expect(ANCHOR_EARLY_TOLERANCE_SECONDS).toBeGreaterThan(0.08);
		expect(ANCHOR_EARLY_TOLERANCE_SECONDS).toBeLessThan(60 / 240);
	});

	it('honors an explicit tolerance argument', () => {
		// The same event survives a wide tolerance and is dropped by a tight
		// one — pins that the parameter actually reaches the cutoff.
		const readings = run(60, 4.7, 5.0);
		const wide = rebaseToAnchor(readings, [4.7], 4.8, 0.2);
		const tight = rebaseToAnchor(readings, [4.7], 4.8, 0.05);

		expect(wide.workletOnsets).toEqual([expect.closeTo(-0.1, 10)]);
		expect(tight.workletOnsets).toHaveLength(0);
		expect(tight.readings.length).toBeGreaterThan(0);
		expect(tight.readings.length).toBeLessThan(wide.readings.length);
		expect(Math.min(...tight.readings.map((r) => r.time))).toBeGreaterThanOrEqual(-0.05 - 1e-9);
	});
});
