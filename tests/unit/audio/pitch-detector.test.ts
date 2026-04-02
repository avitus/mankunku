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

let createPitchDetector: typeof import('$lib/audio/pitch-detector.ts')['createPitchDetector'];

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

	const mod = await import('$lib/audio/pitch-detector.ts');
	createPitchDetector = mod.createPitchDetector;
});

// ─── Tests ────────────────────────────────────────────────────

describe('createPitchDetector', () => {
	it('creates a detector with start/stop/getReadings/clear', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();
		const detector = await createPitchDetector(analyser, onPitch);

		expect(detector.start).toBeTypeOf('function');
		expect(detector.stop).toBeTypeOf('function');
		expect(detector.getReadings).toBeTypeOf('function');
		expect(detector.clear).toBeTypeOf('function');
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

describe('octave stabilization', () => {
	it('filters transient octave-below glitch', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		// C3 (MIDI 48) for 2 frames — subharmonic glitch — then C4 (MIDI 60) for 5 frames
		const sequence = [
			[midiToFreq(48), 0.95],
			[midiToFreq(48), 0.95],
			[midiToFreq(60), 0.95],
			[midiToFreq(60), 0.95],
			[midiToFreq(60), 0.95],
			[midiToFreq(60), 0.95],
			[midiToFreq(60), 0.95],
		] as const;

		for (const vals of sequence) {
			mockFindPitch.mockReturnValueOnce([...vals]);
		}

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start(); // frame 0
		for (let i = 1; i < sequence.length; i++) pumpFrame();

		const readings = detector.getReadings();
		expect(readings).toHaveLength(7);
		// First reading accepted as-is (no prior stable note), but all
		// subsequent readings that would be an octave jump are corrected.
		// Frame 0: 48 (first, accepted). Frames 1: 48 (same, accepted).
		// Frames 2-6: 60 is +12 from stable 48. Needs 3 confirms.
		// Frame 2: confirm 1 → corrected to 48
		// Frame 3: confirm 2 → corrected to 48
		// Frame 4: confirm 3 → accepted as 60, stable updated
		// Frames 5-6: 60 (matches new stable)
		expect(readings[0].midi).toBe(48);
		expect(readings[1].midi).toBe(48);
		expect(readings[2].midi).toBe(48); // corrected
		expect(readings[3].midi).toBe(48); // corrected
		expect(readings[4].midi).toBe(60); // confirmed
		expect(readings[5].midi).toBe(60);
		expect(readings[6].midi).toBe(60);
	});

	it('filters octave-below glitch at note onset', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		// Simulates the reported bug: first detect C3 briefly, then correct to C4.
		// Stable starts at C4, brief drop to C3, back to C4.
		const c4 = midiToFreq(60);
		const c3 = midiToFreq(48);
		const sequence = [
			[c4, 0.95], [c4, 0.95], [c4, 0.95], // stable at C4
			[c3, 0.90], [c3, 0.90],               // brief octave-below glitch
			[c4, 0.95], [c4, 0.95], [c4, 0.95],   // corrects back
		] as const;

		for (const vals of sequence) {
			mockFindPitch.mockReturnValueOnce([...vals]);
		}

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();
		for (let i = 1; i < sequence.length; i++) pumpFrame();

		const readings = detector.getReadings();
		// All readings should be MIDI 60 — the 2-frame dip to 48 is suppressed
		expect(readings.every(r => r.midi === 60)).toBe(true);
		// Raw frequency is preserved (for debugging)
		expect(readings[3].frequency).toBeCloseTo(c3, 0);
	});

	it('accepts genuine octave change after confirmation window', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		const c4 = midiToFreq(60);
		const c5 = midiToFreq(72);
		// 3 frames at C4, then 5 frames at C5 (genuine octave change)
		const sequence = [
			[c4, 0.95], [c4, 0.95], [c4, 0.95],
			[c5, 0.95], [c5, 0.95], [c5, 0.95], [c5, 0.95], [c5, 0.95],
		] as const;

		for (const vals of sequence) {
			mockFindPitch.mockReturnValueOnce([...vals]);
		}

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();
		for (let i = 1; i < sequence.length; i++) pumpFrame();

		const readings = detector.getReadings();
		expect(readings[0].midi).toBe(60);
		expect(readings[1].midi).toBe(60);
		expect(readings[2].midi).toBe(60);
		// Frames 3-4: confirming (corrected to 60)
		expect(readings[3].midi).toBe(60);
		expect(readings[4].midi).toBe(60);
		// Frame 5: 3rd confirm → accepted as 72
		expect(readings[5].midi).toBe(72);
		expect(readings[6].midi).toBe(72);
		expect(readings[7].midi).toBe(72);
	});

	it('accepts non-octave pitch changes immediately', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		// C4 → D4 (2 semitones, different pitch class)
		const sequence = [
			[midiToFreq(60), 0.95], [midiToFreq(60), 0.95], [midiToFreq(60), 0.95],
			[midiToFreq(62), 0.95], [midiToFreq(62), 0.95],
		] as const;

		for (const vals of sequence) {
			mockFindPitch.mockReturnValueOnce([...vals]);
		}

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();
		for (let i = 1; i < sequence.length; i++) pumpFrame();

		const readings = detector.getReadings();
		expect(readings[2].midi).toBe(60);
		expect(readings[3].midi).toBe(62); // accepted immediately, no delay
		expect(readings[4].midi).toBe(62);
	});

	it('filters octave-above glitch', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		const c4 = midiToFreq(60);
		const c5 = midiToFreq(72);
		// Stable at C4, brief jump to C5 (2 frames), back to C4
		const sequence = [
			[c4, 0.95], [c4, 0.95], [c4, 0.95],
			[c5, 0.95], [c5, 0.95],
			[c4, 0.95], [c4, 0.95],
		] as const;

		for (const vals of sequence) {
			mockFindPitch.mockReturnValueOnce([...vals]);
		}

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();
		for (let i = 1; i < sequence.length; i++) pumpFrame();

		const readings = detector.getReadings();
		// All should be 60 — the brief C5 is suppressed
		expect(readings.every(r => r.midi === 60)).toBe(true);
	});

	it('resets octave state on start()', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		// First run: establish stable at C4, begin glitch
		mockFindPitch
			.mockReturnValueOnce([midiToFreq(60), 0.95])  // start frame
			.mockReturnValueOnce([midiToFreq(48), 0.95]); // octave glitch (1 confirm)

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();
		pumpFrame();

		detector.stop();

		// Second run: start fresh at A4 — should not carry over C4 stable state
		mockFindPitch.mockReturnValueOnce([midiToFreq(69), 0.95]);
		detector.start();

		const readings = detector.getReadings();
		expect(readings).toHaveLength(1);
		expect(readings[0].midi).toBe(69); // A4, accepted as-is
	});

	it('handles two-octave jump (±24 semitones)', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		const c4 = midiToFreq(60);
		const c2 = midiToFreq(36);
		// Stable at C4, brief 2-octave drop, back to C4
		const sequence = [
			[c4, 0.95], [c4, 0.95], [c4, 0.95],
			[c2, 0.90], [c2, 0.90],
			[c4, 0.95], [c4, 0.95],
		] as const;

		for (const vals of sequence) {
			mockFindPitch.mockReturnValueOnce([...vals]);
		}

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();
		for (let i = 1; i < sequence.length; i++) pumpFrame();

		const readings = detector.getReadings();
		expect(readings.every(r => r.midi === 60)).toBe(true);
	});

	it('preserves cents and raw frequency when correcting octave', async () => {
		const analyser = createMockAnalyser();
		const onPitch = vi.fn();

		const c4 = midiToFreq(60);
		// Slightly sharp C3 — raw frequency preserved, midi/midiFloat corrected
		const c3Sharp = midiToFreq(48) * Math.pow(2, 5 / 1200); // 5 cents sharp

		const sequence = [
			[c4, 0.95], [c4, 0.95], [c4, 0.95],
			[c3Sharp, 0.90], // octave glitch, slightly sharp
			[c4, 0.95],
		] as const;

		for (const vals of sequence) {
			mockFindPitch.mockReturnValueOnce([...vals]);
		}

		const detector = await createPitchDetector(analyser, onPitch);
		detector.start();
		for (let i = 1; i < sequence.length; i++) pumpFrame();

		const readings = detector.getReadings();
		const corrected = readings[3];
		expect(corrected.midi).toBe(60); // corrected octave
		expect(corrected.frequency).toBeCloseTo(c3Sharp, 0); // raw frequency preserved
		expect(corrected.cents).toBe(5); // cents preserved from raw detection
	});
});
