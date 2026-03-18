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
