import { describe, it, expect } from 'vitest';
import {
	trimToPerformance,
	rebaseToAnchor,
	dropSubFloorRuns,
	PERFORMANCE_PREROLL_SECONDS,
	PERFORMANCE_FLOOR_DB,
	READING_RUN_GAP_SECONDS,
	ANCHOR_EARLY_TOLERANCE_SECONDS
} from '$lib/audio/capture-window';
import { validateOnsets } from '$lib/audio/note-segmenter';
import type { PitchReading } from '$lib/audio/pitch-frame';

function makeReading(midi: number, time: number, clarity = 0.95, rms = 0.1): PitchReading {
	return { midi, midiFloat: midi, cents: 0, clarity, time, frequency: 440, rms };
}

/** Readings every 1/60 s from `start` to `end`, all on one MIDI note. */
function run(midi: number, start: number, end: number, rms = 0.1): PitchReading[] {
	const out: PitchReading[] = [];
	for (let t = start; t < end; t += 1 / 60) out.push(makeReading(midi, t, 0.95, rms));
	return out;
}

/** A note at `peak` decaying geometrically to `floor` over [start, end). */
function decayingRun(midi: number, start: number, end: number, peak: number, floor: number): PitchReading[] {
	const out: PitchReading[] = [];
	const frames = Math.round((end - start) * 60);
	for (let i = 0; i < frames; i++) {
		const rms = peak * Math.pow(floor / peak, i / (frames - 1));
		out.push(makeReading(midi, start + i / 60, 0.95, rms));
	}
	return out;
}

/** The metronome's ringing tail: a confident, pure, −40 dB-ish trace. */
const RING_RMS = 0.0015;
/** A played note. */
const NOTE_RMS = 0.15;

describe('dropSubFloorRuns', () => {
	it('drops a confident run that never reaches performance level ahead of the note', () => {
		// A click's ringing tail reads as a confident pitch (clarity is
		// amplitude-invariant) at −40 dB, well under the −30 dB floor.
		const ring = run(61, 0.35, 0.67, RING_RMS);
		const note = run(60, 1.5, 2.5, NOTE_RMS);
		expect(dropSubFloorRuns([...ring, ...note])).toEqual(note);
	});

	it('drops a sub-floor run between two notes and after the last one', () => {
		const a = run(60, 0.3, 0.8, NOTE_RMS);
		const restRing = run(61, 1.0, 1.3, RING_RMS);
		const b = run(62, 1.6, 2.1, NOTE_RMS);
		const tailRing = run(61, 2.4, 2.7, RING_RMS);
		expect(dropSubFloorRuns([...a, ...restRing, ...b, ...tailRing])).toEqual([...a, ...b]);
	});

	it('keeps a note whole down to the bottom of its decay', () => {
		// The corpus tracks real decays to −46 dB; the segmenter's tiers were
		// tuned on those tails, so a run that reached performance level keeps
		// every reading, however quiet its end.
		const note = decayingRun(60, 0.5, 1.5, NOTE_RMS, 0.0005);
		expect(dropSubFloorRuns(note)).toBe(note);
	});

	it('does not split a decaying tail off at a short reading hole', () => {
		const loud = decayingRun(60, 0.5, 1.0, NOTE_RMS, 0.01);
		// Two frames of clarity dropout, then the tail continues under the floor.
		const holeEnd = loud[loud.length - 1].time + 3 / 60;
		const tail = run(60, holeEnd, holeEnd + 0.2, 0.002);
		expect(dropSubFloorRuns([...loud, ...tail])).toEqual([...loud, ...tail]);
	});

	it('splits at a hole longer than the run gap', () => {
		const loud = run(60, 0.5, 1.0, NOTE_RMS);
		const later = run(60, 1.0 + READING_RUN_GAP_SECONDS + 0.02, 1.4, 0.002);
		expect(dropSubFloorRuns([...loud, ...later])).toEqual(loud);
	});

	it('returns the same array when nothing is dropped', () => {
		const readings = [...run(60, 0.2, 0.7, NOTE_RMS), ...run(62, 1.0, 1.5, NOTE_RMS * 0.3)];
		expect(dropSubFloorRuns(readings)).toBe(readings);
	});

	it('keeps a soft note that is within the floor of the loudest', () => {
		// A ghost note 20 dB down is still the performance.
		const loud = run(60, 0.2, 0.7, NOTE_RMS);
		const ghost = run(62, 1.0, 1.3, NOTE_RMS * 0.1);
		expect(dropSubFloorRuns([...loud, ...ghost])).toEqual([...loud, ...ghost]);
	});

	it('keeps the loudest run of an all-quiet capture', () => {
		// Nothing was played: the floor is relative, so the loudest trace is
		// the performance by definition and the take scores as it did before.
		const ring = run(61, 0.35, 0.67, RING_RMS);
		expect(dropSubFloorRuns(ring)).toBe(ring);
	});

	it('passes an empty capture through', () => {
		const readings: PitchReading[] = [];
		expect(dropSubFloorRuns(readings)).toBe(readings);
	});

	it('sits between the deepest real decay tail and the loudest measured phantom', () => {
		// The 2026-09-03 tonic-turn take: click ring peaks at 0.0016 against a
		// 0.185 loudest reading (−41 dB); the corpus's softest real note peaks
		// ~15 dB under its take's loudest. −30 dB clears both by > 10 dB.
		expect(PERFORMANCE_FLOOR_DB).toBeLessThanOrEqual(-25);
		expect(PERFORMANCE_FLOOR_DB).toBeGreaterThanOrEqual(-36);
	});
});

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

	it('anchors the pre-roll on the first performance-level reading, not a click ring', () => {
		// The 2026-09-03 tonic-turn shape: the metronome's ringing tail reads
		// as a confident pitch 1.2 s before the user comes in. Anchoring on it
		// put the real first note at 1.6 s and DTW matched three phantom
		// notes against the expected line.
		const ring = run(61, 0.35, 0.67, RING_RMS);
		const note = run(60, 2.0, 3.0, NOTE_RMS);
		const result = trimToPerformance([...ring, ...note], [0.25, 1.91], 3.1);

		expect(result.offset).toBeCloseTo(2.0 - PERFORMANCE_PREROLL_SECONDS, 10);
		expect(result.readings).toHaveLength(note.length);
		expect(result.readings[0].midi).toBe(60);
		expect(result.readings[0].time).toBeCloseTo(PERFORMANCE_PREROLL_SECONDS, 10);
		// The click's onset sat in the discarded lead-in; the attack survives.
		expect(result.workletOnsets).toEqual([expect.closeTo(1.91 - result.offset, 10)]);
	});

	it('drops a sub-floor run after the performance without moving the origin', () => {
		const note = run(60, 0.2, 1.0, NOTE_RMS);
		const ring = run(61, 1.4, 1.7, RING_RMS);
		const result = trimToPerformance([...note, ...ring], [0.19], 2.0);

		expect(result.offset).toBe(0);
		expect(result.readings).toEqual(note);
		expect(result.duration).toBe(2.0);
	});

	it('leaves a dropped ring\'s click onset with nothing to validate it — the run gap and the detector lag together exceed the validation window', () => {
		// The nearest a following note can sit to a click whose ring was
		// dropped: the ring's first confident reading arrives one analyser
		// window (~0.1 s) after the click, the run is a single frame, and the
		// note's first reading lands just past the run gap. The click onset
		// itself survives the trim (it is not in the lead-in), but no kept
		// reading falls inside `validateOnsets`' 0.15 s window after it, so the
		// segmenter never adopts the click time as the note's start — dropping
		// the ring's readings cannot hand its onset to the next note. A note
		// any closer shares the ring's run, which then peaks at the note's
		// level and is kept whole. Pins the arithmetic: raise
		// READING_RUN_GAP_SECONDS or the validation window and this trips.
		const detectorLag = 0.1;
		const click = 5.0;
		const ringStart = click + detectorLag;
		const ring = run(60, ringStart, ringStart + 1 / 60, RING_RMS);
		const noteStart = ringStart + 1 / 60 + READING_RUN_GAP_SECONDS + 0.001;
		const note = run(67, noteStart, noteStart + 0.5, NOTE_RMS);
		const first = run(64, 0.5, 1.0, NOTE_RMS);
		const readings = [...first, ...ring, ...note];

		const trimmed = trimToPerformance(readings, [0.4, click, noteStart - 0.02], noteStart + 1);

		expect(trimmed.readings.some((r) => r.rms === RING_RMS)).toBe(false);
		const clickRebased = click - trimmed.offset;
		expect(trimmed.workletOnsets.some((t) => Math.abs(t - clickRebased) < 1e-9)).toBe(true);
		const validated = validateOnsets(trimmed.workletOnsets, trimmed.readings);
		expect(validated.some((t) => Math.abs(t - clickRebased) < 1e-9)).toBe(false);
		expect(validated.some((t) => Math.abs(t - (noteStart - 0.02 - trimmed.offset)) < 1e-9)).toBe(true);
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
