import { describe, it, expect, vi } from 'vitest';
import {
	createOctaveStabilizer,
	detectFrame,
	OCTAVE_CONFIRM_FRAMES,
	WARMUP_FRAMES,
	DEFAULT_CLARITY_THRESHOLD,
	DEFAULT_MIN_FREQUENCY,
	DEFAULT_MAX_FREQUENCY,
} from '$lib/audio/pitch-frame.ts';

function makeMockDetector(frequency: number, clarity: number) {
	return { findPitch: () => [frequency, clarity] as [number, number] };
}

describe('createOctaveStabilizer', () => {
	describe('warmup phase', () => {
		it('passes through raw MIDI during first 4 frames with warmup=true', () => {
			const stab = createOctaveStabilizer(OCTAVE_CONFIRM_FRAMES, 5);
			for (let i = 0; i < 4; i++) {
				const result = stab.process(60, 0.9);
				expect(result.midi).toBe(60);
				expect(result.warmup).toBe(true);
			}
		});

		it('all warmup frames have warmup=true', () => {
			const stab = createOctaveStabilizer(OCTAVE_CONFIRM_FRAMES, 5);
			for (let i = 0; i < 5; i++) {
				const result = stab.process(60, 0.9);
				expect(result.warmup).toBe(true);
			}
		});

		it('on frame 5 (last warmup) returns stabilized MIDI with warmup=true', () => {
			const stab = createOctaveStabilizer(OCTAVE_CONFIRM_FRAMES, 5);
			// First 4 frames pass through
			for (let i = 0; i < 4; i++) {
				stab.process(60, 0.9);
			}
			// 5th frame triggers warmup finish
			const result = stab.process(60, 0.9);
			expect(result.warmup).toBe(true);
			// After warmup, stableMidi is set so next frame is steady-state
			const next = stab.process(60, 0.9);
			expect(next.warmup).toBe(false);
		});

		it('when all warmup frames have the same MIDI, stable MIDI matches', () => {
			const stab = createOctaveStabilizer(OCTAVE_CONFIRM_FRAMES, 5);
			for (let i = 0; i < 5; i++) {
				stab.process(60, 0.9);
			}
			// Steady-state: returns same MIDI
			const result = stab.process(60, 0.9);
			expect(result.midi).toBe(60);
			expect(result.warmup).toBe(false);
		});

		it('higher-clarity frames dominate via clarity-squared weighting', () => {
			const stab = createOctaveStabilizer(OCTAVE_CONFIRM_FRAMES, 5);
			// 2 frames at MIDI 60, clarity 0.5 => weight 0.25 each => total 0.50
			stab.process(60, 0.5);
			stab.process(60, 0.5);
			// 3 frames at MIDI 72, clarity 0.8 => weight 0.64 each => total 1.92
			stab.process(72, 0.8);
			stab.process(72, 0.8);
			const last = stab.process(72, 0.8);
			// weightedMode should pick 72 (1.92 > 0.50)
			expect(last.midi).toBe(72);
			// After warmup, stable MIDI is 72
			const next = stab.process(72, 0.9);
			expect(next.midi).toBe(72);
			expect(next.warmup).toBe(false);
		});
	});

	describe('steady state', () => {
		function warmUp(stab: ReturnType<typeof createOctaveStabilizer>, midi: number) {
			for (let i = 0; i < WARMUP_FRAMES; i++) {
				stab.process(midi, 0.9);
			}
		}

		it('returns same MIDI when input matches stable MIDI', () => {
			const stab = createOctaveStabilizer();
			warmUp(stab, 60);
			const result = stab.process(60, 0.9);
			expect(result.midi).toBe(60);
			expect(result.warmup).toBe(false);
		});

		it('accepts non-octave pitch change immediately', () => {
			const stab = createOctaveStabilizer();
			warmUp(stab, 60);
			const result = stab.process(65, 0.9);
			expect(result.midi).toBe(65);
			expect(result.warmup).toBe(false);
		});

		it('suppresses +12 octave jump for first 2 frames', () => {
			const stab = createOctaveStabilizer(3);
			warmUp(stab, 60);
			// Frame 1: suppressed
			const r1 = stab.process(72, 0.9);
			expect(r1.midi).toBe(60);
			// Frame 2: still suppressed (need 3 consecutive)
			const r2 = stab.process(72, 0.9);
			expect(r2.midi).toBe(60);
		});

		it('accepts +12 octave jump after 3 consecutive frames at new pitch', () => {
			const stab = createOctaveStabilizer(3);
			warmUp(stab, 60);
			stab.process(72, 0.9); // count=1
			stab.process(72, 0.9); // count=2
			const r3 = stab.process(72, 0.9); // count=3 => accepted
			expect(r3.midi).toBe(72);
		});

		it('suppresses -12 octave jump until confirmed', () => {
			const stab = createOctaveStabilizer(3);
			warmUp(stab, 72);
			const r1 = stab.process(60, 0.9);
			expect(r1.midi).toBe(72);
			const r2 = stab.process(60, 0.9);
			expect(r2.midi).toBe(72);
			const r3 = stab.process(60, 0.9);
			expect(r3.midi).toBe(60);
		});

		it('suppresses +24 double-octave jump until confirmed', () => {
			const stab = createOctaveStabilizer(3);
			warmUp(stab, 48);
			const r1 = stab.process(72, 0.9);
			expect(r1.midi).toBe(48);
			const r2 = stab.process(72, 0.9);
			expect(r2.midi).toBe(48);
			const r3 = stab.process(72, 0.9);
			expect(r3.midi).toBe(72);
		});

		it('resets confirm counter when octave jump direction changes', () => {
			const stab = createOctaveStabilizer(3);
			warmUp(stab, 60);
			// Start jumping to 72 (+12)
			stab.process(72, 0.9); // count=1 for 72
			stab.process(72, 0.9); // count=2 for 72
			// Change direction: now jump to 48 (-12)
			const r = stab.process(48, 0.9); // resets to count=1 for 48
			expect(r.midi).toBe(60); // still suppressed
			// Continue at 48: needs 2 more
			stab.process(48, 0.9); // count=2
			const r3 = stab.process(48, 0.9); // count=3 => accepted
			expect(r3.midi).toBe(48);
		});

		it('non-octave change during octave confirmation resets and accepts immediately', () => {
			const stab = createOctaveStabilizer(3);
			warmUp(stab, 60);
			// Start octave jump confirmation for 72
			stab.process(72, 0.9); // count=1
			stab.process(72, 0.9); // count=2
			// Non-octave change interrupts: 65 is not +-12 or +-24 from 60
			const r = stab.process(65, 0.9);
			expect(r.midi).toBe(65);
			expect(r.warmup).toBe(false);
		});
	});

	describe('reset', () => {
		it('returns to warmup phase after reset()', () => {
			const stab = createOctaveStabilizer();
			// Complete warmup
			for (let i = 0; i < WARMUP_FRAMES; i++) {
				stab.process(60, 0.9);
			}
			// Verify steady state
			const steady = stab.process(60, 0.9);
			expect(steady.warmup).toBe(false);

			stab.reset();

			// First frame after reset is warmup
			const result = stab.process(60, 0.9);
			expect(result.warmup).toBe(true);
		});

		it('after reset, next warmupFrames frames are warmup=true', () => {
			const stab = createOctaveStabilizer(OCTAVE_CONFIRM_FRAMES, 3);
			// Complete warmup with 3 frames
			for (let i = 0; i < 3; i++) {
				stab.process(60, 0.9);
			}
			// Steady state
			expect(stab.process(60, 0.9).warmup).toBe(false);

			stab.reset();

			// All 3 warmup frames should have warmup=true
			for (let i = 0; i < 3; i++) {
				const result = stab.process(60, 0.9);
				expect(result.warmup).toBe(true);
			}
			// After warmup completes, steady state
			const post = stab.process(60, 0.9);
			expect(post.warmup).toBe(false);
		});
	});
});

describe('detectFrame', () => {
	const sampleRate = 48000;
	const buffer = new Float32Array(2048);
	const baseOpts = { sampleRate };

	it('returns null reading when clarity is below threshold', () => {
		const detector = makeMockDetector(440, 0.5);
		const result = detectFrame(buffer, 0, detector as any, null, baseOpts);
		expect(result.reading).toBeNull();
		expect(result.rawClarity).toBe(0.5);
	});

	it('returns null reading when frequency is below minFrequency', () => {
		const detector = makeMockDetector(50, 0.95);
		const result = detectFrame(buffer, 0, detector as any, null, baseOpts);
		expect(result.reading).toBeNull();
	});

	it('returns null reading when frequency is above maxFrequency', () => {
		const detector = makeMockDetector(1500, 0.95);
		const result = detectFrame(buffer, 0, detector as any, null, baseOpts);
		expect(result.reading).toBeNull();
	});

	it('rawClarity is always populated even when reading is null', () => {
		const detector = makeMockDetector(50, 0.42);
		const result = detectFrame(buffer, 0, detector as any, null, baseOpts);
		expect(result.reading).toBeNull();
		expect(result.rawClarity).toBe(0.42);
	});

	it('produces correct midi for A4 (440 Hz)', () => {
		const detector = makeMockDetector(440, 0.95);
		const result = detectFrame(buffer, 1.0, detector as any, null, baseOpts);
		expect(result.reading).not.toBeNull();
		expect(result.reading!.midi).toBe(69);
		expect(result.reading!.cents).toBe(0);
		expect(result.reading!.frequency).toBe(440);
		expect(result.reading!.time).toBe(1.0);
	});

	it('produces correct midi for C4 (261.63 Hz)', () => {
		const detector = makeMockDetector(261.63, 0.95);
		const result = detectFrame(buffer, 0.5, detector as any, null, baseOpts);
		expect(result.reading).not.toBeNull();
		expect(result.reading!.midi).toBe(60);
		expect(result.reading!.frequency).toBe(261.63);
	});

	it('applies stabilizer when provided', () => {
		const detector = makeMockDetector(440, 0.95);
		const stabilizer = createOctaveStabilizer();
		const processSpy = vi.spyOn(stabilizer, 'process');

		const result = detectFrame(buffer, 0, detector as any, stabilizer, baseOpts);
		expect(processSpy).toHaveBeenCalledWith(69, 0.95);
		expect(result.reading).not.toBeNull();
	});

	it('passes through raw MIDI when stabilizer is null', () => {
		const detector = makeMockDetector(440, 0.95);
		const result = detectFrame(buffer, 0, detector as any, null, baseOpts);
		expect(result.reading).not.toBeNull();
		expect(result.reading!.midi).toBe(69);
		expect(result.reading!.warmup).toBeUndefined();
	});

	it('warmup flag propagated from stabilizer to reading', () => {
		const detector = makeMockDetector(440, 0.95);
		const stabilizer = createOctaveStabilizer();
		// First frame is warmup
		const result = detectFrame(buffer, 0, detector as any, stabilizer, baseOpts);
		expect(result.reading).not.toBeNull();
		expect(result.reading!.warmup).toBe(true);
	});

	it('uses custom thresholds from opts when provided', () => {
		// Frequency 90 is above default min (80) but below custom min (100)
		const detector = makeMockDetector(90, 0.95);
		const result = detectFrame(buffer, 0, detector as any, null, {
			sampleRate,
			minFrequency: 100,
		});
		expect(result.reading).toBeNull();

		// With default opts, 90 Hz passes
		const result2 = detectFrame(buffer, 0, detector as any, null, baseOpts);
		expect(result2.reading).not.toBeNull();
	});
});
