import { describe, it, expect } from 'vitest';
import {
	trimToPerformance,
	PERFORMANCE_PREROLL_SECONDS
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
