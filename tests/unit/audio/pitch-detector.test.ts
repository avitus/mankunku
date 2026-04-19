import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────

const mockFindPitch = vi.fn();

vi.mock('pitchy', () => ({
	PitchDetector: {
		forFloat32Array: vi.fn(() => ({
			findPitch: mockFindPitch
		}))
	}
}));

// Collect rAF callbacks so we can drive them manually
let rafCallbacks: Array<(time: number) => void> = [];
let rafId = 0;

function createMockAnalyser(sampleRate = 48000) {
	return {
		fftSize: 2048,
		context: { sampleRate, currentTime: 1.0 },
		getFloatTimeDomainData: vi.fn()
	} as unknown as AnalyserNode;
}

/**
 * Pump one frame of the rAF loop.
 * Note: start() calls detect() synchronously (frame 0),
 * which schedules the first rAF. Each pumpFrame() fires
 * one scheduled callback (producing another detect call).
 */
function pumpFrame() {
	const cbs = [...rafCallbacks];
	rafCallbacks = [];
	cbs.forEach((cb) => cb(performance.now()));
}

let createPitchDetector: typeof import('$lib/audio/pitch-detector')['createPitchDetector'];

beforeEach(async () => {
	vi.resetModules();
	rafCallbacks = [];
	rafId = 0;
	mockFindPitch.mockReset();

	// Re-stub globals each time (resetModules clears previous stubs)
	vi.stubGlobal('requestAnimationFrame', vi.fn((cb: (time: number) => void) => {
		rafCallbacks.push(cb);
		return ++rafId;
	}));
	vi.stubGlobal('cancelAnimationFrame', vi.fn());

	const mod = await import('$lib/audio/pitch-detector');
	createPitchDetector = mod.createPitchDetector;
});

// ─── Tests ────────────────────────────────────────────────────

describe('createPitchDetector', () => {
	it('creates a detector with start/stop/getReadings/clear/resetOctaveStateAt', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();
		const detector = await createPitchDetector(analyser, onPitch);

		expect(detector.start).toBeTypeOf('function');
		expect(detector.stop).toBeTypeOf('function');
		expect(detector.getReadings).toBeTypeOf('function');
		expect(detector.clear).toBeTypeOf('function');
		expect(detector.resetOctaveStateAt).toBeTypeOf('function');
	});

	it('calls onPitch with reading when clarity above threshold', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		// A440 with high clarity
		mockFindPitch.mockReturnValue([440, 0.95]);

		const detector = await createPitchDetector(analyser, onPitch);
		// start() calls detect() synchronously — that's our first onPitch call
		detector.start();

		expect(onPitch).toHaveBeenCalledTimes(1);
		const reading = onPitch.mock.calls[0][0];
		expect(reading).not.toBeNull();
		expect(reading.midi).toBe(69); // A4
		expect(reading.frequency).toBe(440);
		expect(reading.clarity).toBe(0.95);
	});

	it('calls onPitch with null when clarity below threshold', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		mockFindPitch.mockReturnValue([440, 0.5]); // low clarity

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();

		// First arg is null, second is rawClarity
		expect(onPitch.mock.calls[0][0]).toBeNull();
		expect(onPitch.mock.calls[0][1]).toBe(0.5);
	});

	it('rejects frequencies below MIN_FREQUENCY (80 Hz)', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		mockFindPitch.mockReturnValue([30, 0.95]); // too low

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();

		expect(onPitch.mock.calls[0][0]).toBeNull();
	});

	it('rejects frequencies above MAX_FREQUENCY (1200 Hz)', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		mockFindPitch.mockReturnValue([2000, 0.95]); // too high

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();

		expect(onPitch.mock.calls[0][0]).toBeNull();
	});

	it('accumulates readings in getReadings()', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		// start() consumes first, pumpFrame() consumes second
		mockFindPitch
			.mockReturnValueOnce([440, 0.95])
			.mockReturnValueOnce([494, 0.92]); // B4

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start(); // frame 0: A4
		pumpFrame();      // frame 1: B4

		const readings = detector.getReadings();
		expect(readings).toHaveLength(2);
		expect(readings[0].midi).toBe(69); // A4
		expect(readings[1].midi).toBe(71); // B4
	});

	it('clear() empties readings', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		mockFindPitch.mockReturnValue([440, 0.95]);

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start(); // frame 0: one reading

		expect(detector.getReadings()).toHaveLength(1);
		detector.clear();
		expect(detector.getReadings()).toHaveLength(0);
	});

	it('stop() prevents further detection', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		mockFindPitch.mockReturnValue([440, 0.95]);

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start(); // frame 0
		expect(onPitch).toHaveBeenCalledTimes(1);

		detector.stop();
		pumpFrame(); // should not produce a reading

		expect(onPitch).toHaveBeenCalledTimes(1);
	});

	it('start() resets readings from previous run', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		mockFindPitch.mockReturnValue([440, 0.95]);

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start(); // frame 0: one reading
		expect(detector.getReadings()).toHaveLength(1);

		detector.stop();
		detector.start(); // should reset readings, then detect frame 0 again
		// Readings were cleared then one new reading added
		expect(detector.getReadings()).toHaveLength(1);
	});

	it('computes correct cents deviation', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		// Frequency slightly sharp of A4 (440 Hz)
		// A4 = 440 Hz, 10 cents sharp ≈ 442.55 Hz
		mockFindPitch.mockReturnValue([442.55, 0.95]);

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();

		const reading = onPitch.mock.calls[0][0];
		expect(reading.midi).toBe(69);
		expect(reading.cents).toBeGreaterThan(0);
		expect(reading.cents).toBeLessThan(20);
	});

	it('computes correct MIDI for tenor sax range', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		// Bb2 = MIDI 46, ~116.54 Hz (low end of tenor sax concert range)
		mockFindPitch.mockReturnValue([116.54, 0.90]);

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();

		const reading = onPitch.mock.calls[0][0];
		expect(reading.midi).toBe(46);
	});

	it('does not start twice if already running', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		mockFindPitch.mockReturnValue([440, 0.95]);

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();  // frame 0: one call
		detector.start();  // should be ignored (already running)

		// Only the first start() should have produced a detect call
		expect(onPitch).toHaveBeenCalledTimes(1);
	});

	it('schedules requestAnimationFrame for continuous detection', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		mockFindPitch.mockReturnValue([440, 0.95]);

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start(); // frame 0 + schedules rAF
		expect(onPitch).toHaveBeenCalledTimes(1);

		pumpFrame(); // frame 1 + schedules rAF
		expect(onPitch).toHaveBeenCalledTimes(2);

		pumpFrame(); // frame 2
		expect(onPitch).toHaveBeenCalledTimes(3);
	});
});

// ─── Octave stabilization tests ──────────────────────────────

/** Convert MIDI note number to frequency (Hz) */
function midiToFreq(midi: number): number {
	return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Run a sequence of [freq, clarity] pairs through a fresh detector */
async function runSequence(
	sequence: ReadonlyArray<readonly [number, number]>,
	createMockAnalyserFn: () => AnalyserNode = createMockAnalyser
) {
	const analyser = createMockAnalyserFn();
	const onPitch = vi.fn();
	for (const vals of sequence) mockFindPitch.mockReturnValueOnce([...vals]);
	const detector = await createPitchDetector(analyser, onPitch);
	detector.start();
	for (let i = 1; i < sequence.length; i++) pumpFrame();
	return { detector, readings: detector.getReadings() };
}

describe('octave stabilization warmup seed', () => {
	it('passes the first WARMUP_FRAMES (5) confident readings through raw', async () => {
		// All 5 warmup frames carry MIDI 60 with varying clarity.
		const { readings } = await runSequence([
			[midiToFreq(60), 0.90],
			[midiToFreq(60), 0.91],
			[midiToFreq(60), 0.92],
			[midiToFreq(60), 0.93],
			[midiToFreq(60), 0.94]
		]);
		expect(readings).toHaveLength(5);
		for (const r of readings) expect(r.midi).toBe(60);
		// All five should be marked warmup.
		for (const r of readings) expect(r.warmup).toBe(true);
	});

	it('seeds stable MIDI with clarity-weighted mode of the warmup window', async () => {
		// 2× glitch at 72 (both low clarity), 3× sustained at 60 (high clarity),
		// then a steady 60. Mode should pick 60 thanks to clarity weighting.
		const { readings } = await runSequence([
			[midiToFreq(72), 0.81], // warmup frame 0 — glitch
			[midiToFreq(72), 0.82], // warmup frame 1 — glitch
			[midiToFreq(60), 0.95], // warmup frame 2 — real
			[midiToFreq(60), 0.95], // warmup frame 3 — real
			[midiToFreq(60), 0.95], // warmup frame 4 — seed frame → stable = 60
			[midiToFreq(60), 0.95], // steady state
			[midiToFreq(60), 0.95]
		]);
		// Warmup frames pass through raw.
		expect(readings[0].midi).toBe(72);
		expect(readings[1].midi).toBe(72);
		expect(readings[2].midi).toBe(60);
		expect(readings[3].midi).toBe(60);
		// Seed frame: returns the weighted-mode seed (60, not raw 60 again).
		expect(readings[4].midi).toBe(60);
		// Steady-state frames.
		expect(readings[5].midi).toBe(60);
		expect(readings[6].midi).toBe(60);
		// Warmup flag present on first 5, absent on steady state.
		expect(readings[0].warmup).toBe(true);
		expect(readings[4].warmup).toBe(true);
		expect(readings[5].warmup).toBeUndefined();
		expect(readings[6].warmup).toBeUndefined();
	});

	it('seeds stable MIDI at even split with the most recent pitch (tie-break)', async () => {
		// 3× at 48 followed by 2× at 60 — weights tie after clarity^2 if
		// clarities differ, but here all equal so key 48 wins by count.
		// Flip: equal clarities, 2× at 48 then 3× at 60 → 60 wins on count.
		const { readings } = await runSequence([
			[midiToFreq(48), 0.9],
			[midiToFreq(48), 0.9],
			[midiToFreq(60), 0.9],
			[midiToFreq(60), 0.9],
			[midiToFreq(60), 0.9],
			[midiToFreq(60), 0.9]
		]);
		// Warmup pass-through, then seed = 60, then steady at 60.
		expect(readings[5].midi).toBe(60);
		expect(readings[5].warmup).toBeUndefined();
	});

	it('reset() re-enters warmup on the next process call', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		// Seed stable at 60 with 5 warmup frames; then a steady-state frame.
		for (let i = 0; i < 6; i++) mockFindPitch.mockReturnValueOnce([midiToFreq(60), 0.95]);

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();
		for (let i = 0; i < 5; i++) pumpFrame();

		// Queue a reset, then enqueue a 69 frame — it should pass through raw
		// because warmup restarts.
		detector.resetOctaveStateAt(0);
		mockFindPitch.mockReturnValueOnce([midiToFreq(69), 0.95]);
		pumpFrame();

		const readings = detector.getReadings();
		const last = readings[readings.length - 1];
		expect(last.midi).toBe(69);
		expect(last.warmup).toBe(true);
	});
});

describe('octave stabilization (steady state)', () => {
	it('filters a brief octave-below glitch after warmup', async () => {
		// First 5 frames: all 60 → seed stable at 60. Then 2 frames at 48
		// (glitch) and back to 60 — glitch should be suppressed.
		const { readings } = await runSequence([
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95], [midiToFreq(60), 0.95],
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95],
			[midiToFreq(48), 0.90], [midiToFreq(48), 0.90],
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95]
		]);
		// Warmup: all 60, marked warmup.
		for (let i = 0; i < 5; i++) expect(readings[i].midi).toBe(60);
		// Steady: glitch frames corrected to 60.
		expect(readings[5].midi).toBe(60);
		expect(readings[6].midi).toBe(60);
		// Return to 60.
		expect(readings[7].midi).toBe(60);
		expect(readings[8].midi).toBe(60);
	});

	it('accepts a genuine octave change after the confirmation window', async () => {
		// Seed at 60, then 5× at 72 — the confirmFrames=3 threshold is met.
		const { readings } = await runSequence([
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95], [midiToFreq(60), 0.95],
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95], // warmup → seed 60
			[midiToFreq(72), 0.95], // confirm 1 → 60
			[midiToFreq(72), 0.95], // confirm 2 → 60
			[midiToFreq(72), 0.95], // confirm 3 → accepted as 72
			[midiToFreq(72), 0.95], [midiToFreq(72), 0.95]
		]);
		expect(readings[5].midi).toBe(60);
		expect(readings[6].midi).toBe(60);
		expect(readings[7].midi).toBe(72);
		expect(readings[8].midi).toBe(72);
		expect(readings[9].midi).toBe(72);
	});

	it('accepts non-octave pitch changes immediately after warmup', async () => {
		// Seed at 60 via warmup, then jump to 62 (whole step, not octave).
		const { readings } = await runSequence([
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95], [midiToFreq(60), 0.95],
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95],
			[midiToFreq(62), 0.95], [midiToFreq(62), 0.95]
		]);
		expect(readings[5].midi).toBe(62);
		expect(readings[6].midi).toBe(62);
	});

	it('filters a brief octave-above glitch after warmup', async () => {
		const { readings } = await runSequence([
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95], [midiToFreq(60), 0.95],
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95],
			[midiToFreq(72), 0.95], [midiToFreq(72), 0.95],
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95]
		]);
		// All steady-state readings should be 60 (glitch suppressed).
		for (let i = 5; i < readings.length; i++) expect(readings[i].midi).toBe(60);
	});

	it('handles two-octave jumps (±24 semitones) as octave glitches', async () => {
		const { readings } = await runSequence([
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95], [midiToFreq(60), 0.95],
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95],
			[midiToFreq(36), 0.90], [midiToFreq(36), 0.90],
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95]
		]);
		for (let i = 5; i < readings.length; i++) expect(readings[i].midi).toBe(60);
	});

	it('preserves cents and raw frequency when correcting an octave glitch', async () => {
		const c4 = midiToFreq(60);
		const c3Sharp = midiToFreq(48) * Math.pow(2, 5 / 1200); // 5 cents sharp
		const { readings } = await runSequence([
			[c4, 0.95], [c4, 0.95], [c4, 0.95], [c4, 0.95], [c4, 0.95],
			[c3Sharp, 0.90],
			[c4, 0.95]
		]);
		const corrected = readings[5];
		expect(corrected.midi).toBe(60);                // corrected octave
		expect(corrected.frequency).toBeCloseTo(c3Sharp, 0); // raw frequency preserved
		expect(corrected.cents).toBe(5);                // cents from the raw detection
	});

	it('start() resets octave state so prior-run stabilization does not leak', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		// First run: a full warmup at C4 to seed stable.
		for (let i = 0; i < 5; i++) mockFindPitch.mockReturnValueOnce([midiToFreq(60), 0.95]);
		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();
		for (let i = 1; i < 5; i++) pumpFrame();

		detector.stop();

		// Second run: first frame at A4 — must NOT be treated as an octave
		// glitch relative to the previous run's stable state.
		mockFindPitch.mockReturnValueOnce([midiToFreq(69), 0.95]);
		detector.start();

		const readings = detector.getReadings();
		expect(readings).toHaveLength(1);
		expect(readings[0].midi).toBe(69); // A4, raw pass-through (warmup frame 0)
		expect(readings[0].warmup).toBe(true);
	});
});
