import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────

function createMockAnalyser(fftSize = 4096) {
	const buffer = new Float32Array(fftSize);
	return {
		fftSize,
		smoothingTimeConstant: 0,
		getFloatTimeDomainData: vi.fn((out: Float32Array) => {
			out.set(buffer);
		}),
		connect: vi.fn(),
		disconnect: vi.fn(),
		context: { sampleRate: 48000, currentTime: 0 },
		_buffer: buffer
	};
}

function createMockAudioContext(analyserFactory: () => ReturnType<typeof createMockAnalyser>) {
	return {
		createMediaStreamSource: vi.fn(() => ({
			connect: vi.fn(),
			disconnect: vi.fn()
		})),
		createAnalyser: vi.fn(() => analyserFactory()),
		sampleRate: 48000,
		currentTime: 0
	};
}

function createMockStream() {
	const track = { stop: vi.fn(), kind: 'audio' };
	return {
		getTracks: vi.fn(() => [track]),
		_track: track
	};
}

// We need to re-import after mocks are set up, and reset module state between tests
let captureModule: typeof import('$lib/audio/capture.ts');
let mockAnalyserInstance: ReturnType<typeof createMockAnalyser>;
let mockAudioCtx: ReturnType<typeof createMockAudioContext>;

// Mock initAudio before importing capture
vi.mock('$lib/audio/audio-context.ts', () => ({
	initAudio: vi.fn(async () => mockAudioCtx)
}));

beforeEach(async () => {
	vi.resetModules();

	// Re-create mock analyser each test
	mockAnalyserInstance = createMockAnalyser();
	mockAudioCtx = createMockAudioContext(() => mockAnalyserInstance);

	const mockStream = createMockStream();
	vi.stubGlobal('navigator', {
		mediaDevices: {
			getUserMedia: vi.fn(async () => mockStream)
		},
		permissions: {
			query: vi.fn()
		}
	});

	captureModule = await import('$lib/audio/capture.ts');
});

// ─── Tests ────────────────────────────────────────────────────

describe('checkMicPermission', () => {
	it('returns "unavailable" when getUserMedia is missing', async () => {
		vi.stubGlobal('navigator', { mediaDevices: undefined });
		vi.resetModules();
		const mod = await import('$lib/audio/capture.ts');
		expect(await mod.checkMicPermission()).toBe('unavailable');
	});

	it('returns "granted" when permissions query says granted', async () => {
		navigator.permissions.query = vi.fn(async () => ({ state: 'granted' }) as PermissionStatus);
		expect(await captureModule.checkMicPermission()).toBe('granted');
	});

	it('returns "prompt" when permissions query says denied (conservative)', async () => {
		navigator.permissions.query = vi.fn(async () => ({ state: 'denied' }) as PermissionStatus);
		expect(await captureModule.checkMicPermission()).toBe('prompt');
	});

	it('returns "prompt" when permissions query says prompt', async () => {
		navigator.permissions.query = vi.fn(async () => ({ state: 'prompt' }) as PermissionStatus);
		expect(await captureModule.checkMicPermission()).toBe('prompt');
	});

	it('returns "prompt" when permissions.query throws', async () => {
		navigator.permissions.query = vi.fn(async () => { throw new Error('Not supported'); });
		expect(await captureModule.checkMicPermission()).toBe('prompt');
	});
});

describe('startMicCapture', () => {
	it('calls getUserMedia with correct constraints', async () => {
		await captureModule.startMicCapture();

		expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false
			}
		});
	});

	it('creates AnalyserNode with fftSize 4096', async () => {
		const capture = await captureModule.startMicCapture();

		expect(mockAudioCtx.createAnalyser).toHaveBeenCalled();
		expect(capture.analyser.fftSize).toBe(4096);
		expect(capture.analyser.smoothingTimeConstant).toBe(0);
	});

	it('connects source to analyser', async () => {
		const result = await captureModule.startMicCapture();
		expect(result.source.connect).toHaveBeenCalled();
	});

	it('returns same capture on second call (idempotent)', async () => {
		const first = await captureModule.startMicCapture();
		const second = await captureModule.startMicCapture();
		expect(first).toBe(second);
	});
});

describe('stopMicCapture', () => {
	it('stops all tracks and disconnects source', async () => {
		const capture = await captureModule.startMicCapture();
		const track = capture.stream.getTracks()[0];

		captureModule.stopMicCapture();

		expect(track.stop).toHaveBeenCalled();
		expect(capture.source.disconnect).toHaveBeenCalled();
	});

	it('sets capture to null', async () => {
		await captureModule.startMicCapture();
		captureModule.stopMicCapture();
		expect(captureModule.getMicCapture()).toBeNull();
	});

	it('is safe to call when not capturing', () => {
		expect(() => captureModule.stopMicCapture()).not.toThrow();
	});
});

describe('getInputLevel', () => {
	it('returns 0 when not capturing', () => {
		expect(captureModule.getInputLevel()).toBe(0);
	});

	it('returns 0 for silence', async () => {
		await captureModule.startMicCapture();
		// Mock buffer is all zeros by default
		expect(captureModule.getInputLevel()).toBe(0);
	});

	it('returns scaled RMS for a signal', async () => {
		const capture = await captureModule.startMicCapture();

		// Inject a known signal into the analyser
		const analyser = capture.analyser as any;
		const level = 0.1; // RMS ~0.1
		analyser.getFloatTimeDomainData = vi.fn((out: Float32Array) => {
			for (let i = 0; i < out.length; i++) out[i] = level;
		});

		const result = captureModule.getInputLevel();
		// RMS of constant 0.1 = 0.1, scaled by *4 = 0.4
		expect(result).toBeCloseTo(0.4, 1);
	});

	it('clamps to 1.0', async () => {
		const capture = await captureModule.startMicCapture();
		const analyser = capture.analyser as any;
		analyser.getFloatTimeDomainData = vi.fn((out: Float32Array) => {
			for (let i = 0; i < out.length; i++) out[i] = 0.5;
		});

		const result = captureModule.getInputLevel();
		expect(result).toBe(1); // 0.5 * 4 = 2.0, clamped to 1
	});
});
