import { describe, it, expect, vi } from 'vitest';
import {
	createOctaveStabilizer,
	detectFrame,
	OCTAVE_CONFIRM_FRAMES,
	WARMUP_FRAMES,
	DEFAULT_CLARITY_THRESHOLD,
	DEFAULT_MIN_FREQUENCY,
	DEFAULT_MAX_FREQUENCY,
	measureShapeBreak,
} from '$lib/audio/pitch-frame';

type MockDetector = { findPitch: () => [number, number] };

function makeMockDetector(frequency: number, clarity: number): MockDetector {
	return { findPitch: (): [number, number] => [frequency, clarity] };
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
		function warmUp(stab: ReturnType<typeof createOctaveStabilizer>, midi: number): void {
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

describe('detectFrame octave-up flag', () => {
	const sampleRate = 48000;

	// Weak 165 Hz (E3) fundamental under a dominant 330 Hz (E4) 2nd harmonic plus
	// full odd harmonics — a 2nd-harmonic lock: isOctaveUpLock is true when the
	// detector reports 330 (E4), false when it reports the true 165 (E3).
	function maskedE3Buffer(n = 4096): Float32Array {
		const partials: Array<[number, number]> = [
			[165, 0.02],
			[330, 0.5],
			[495, 0.09],
			[660, 0.05],
			[825, 0.06],
		];
		const out = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			let s = 0;
			for (const [f, a] of partials) s += a * Math.sin((2 * Math.PI * f * i) / sampleRate);
			out[i] = s;
		}
		return out;
	}

	it('flags a steady 2nd-harmonic lock the stabilizer has NOT corrected (midi = rawMidi)', () => {
		const buf = maskedE3Buffer();
		const detector = makeMockDetector(330, 0.95); // reports E4 (64) every frame
		const stab = createOctaveStabilizer();
		// Warm up on the E4 pick, then a steady frame.
		for (let i = 0; i < WARMUP_FRAMES; i++) detectFrame(buf, i * 0.016, detector as any, stab, { sampleRate });
		const steady = detectFrame(buf, 1.0, detector as any, stab, { sampleRate });
		expect(steady.reading!.warmup).toBeUndefined();
		expect(steady.reading!.midi).toBe(64);
		expect(steady.reading!.octaveUp).toBe(true);
	});

	it('does NOT flag a lock frame the stabilizer already pulled down an octave', () => {
		// Regression: if the stabilizer is already holding E3 (52) while the raw
		// pick is the E4 (64) lock, octaveCorrection is -12. Flagging here would let
		// the note-level `mergeWholeNoteOctaveUpLocks` drop take the note a SECOND
		// octave down (E3 → E2). The `octaveCorrection === 0` guard prevents it.
		const buf = maskedE3Buffer();
		const stab = createOctaveStabilizer();
		// Seed a stable E3 (52) via warmup on the true fundamental.
		const e3det = makeMockDetector(165, 0.95);
		for (let i = 0; i < WARMUP_FRAMES; i++) detectFrame(buf, i * 0.016, e3det as any, stab, { sampleRate });
		// A lock frame arrives: raw pick is E4 (64) but the stabilizer holds E3.
		const lockDet = makeMockDetector(330, 0.95);
		const held = detectFrame(buf, 1.0, lockDet as any, stab, { sampleRate });
		expect(held.reading!.midi).toBe(52); // stabilizer held the true octave
		expect(held.reading!.octaveUp).toBeUndefined(); // not flagged → no double drop
	});
});

describe('measureShapeBreak', () => {
	const sampleRate = 44100;
	const f0 = 196; // G3 — the "Climb to Five" pitch

	/**
	 * A three-harmonic reed-ish tone. `breakAt` optionally re-starts the
	 * oscillator there with a different harmonic balance and a phase jump —
	 * what a tongue does to the reed: same pitch, same amplitude, new shape.
	 */
	function tone(
		length: number,
		opts: { breakAt?: number; amplitudeAt?: (i: number) => number } = {}
	): Float32Array {
		const buf = new Float32Array(length);
		for (let i = 0; i < length; i++) {
			const restarted = opts.breakAt != null && i >= opts.breakAt;
			const phase = restarted ? i - opts.breakAt! : i;
			const t = phase / sampleRate;
			const secondWeight = restarted ? 0.45 : 0.2;
			const thirdWeight = restarted ? 0.25 : 0.1;
			buf[i] =
				(opts.amplitudeAt?.(i) ?? 1) *
				(0.3 * Math.sin(2 * Math.PI * f0 * t) +
					secondWeight * Math.sin(2 * Math.PI * f0 * 2 * t) +
					thirdWeight * Math.sin(2 * Math.PI * f0 * 3 * t));
		}
		return buf;
	}

	it('reports near-perfect similarity for a steady tone', () => {
		const result = measureShapeBreak(tone(4096), f0, sampleRate);
		expect(result).not.toBeNull();
		expect(result!.value).toBeGreaterThan(0.99);
	});

	it('stays near-perfect through a crescendo — amplitude change is not a shape break', () => {
		// The signal this tier exists for RISES in amplitude across the
		// articulation, so a loudness ramp on its own must not register.
		const swell = tone(4096, { amplitudeAt: (i) => 0.5 + i / 4096 });
		const result = measureShapeBreak(swell, f0, sampleRate);
		expect(result!.value).toBeGreaterThan(0.98);
	});

	it('drops where the waveform shape restarts, and locates it', () => {
		const breakAt = 2000;
		const result = measureShapeBreak(tone(4096, { breakAt }), f0, sampleRate);
		expect(result!.value).toBeLessThan(0.95);
		// Localized to within a few milliseconds of the true discontinuity.
		expect(result!.offsetSeconds).toBeGreaterThan(breakAt / sampleRate - 0.015);
		expect(result!.offsetSeconds).toBeLessThan(breakAt / sampleRate + 0.015);
	});

	it('tolerates a slow bend — the lag search absorbs local period drift', () => {
		// Without the lag search a 2% period drift decorrelates the upper
		// harmonics and fakes a break on every expressive note.
		const buf = new Float32Array(4096);
		let phase = 0;
		for (let i = 0; i < buf.length; i++) {
			const f = f0 * (1 + 0.02 * (i / buf.length));
			phase += (2 * Math.PI * f) / sampleRate;
			buf[i] = 0.3 * Math.sin(phase) + 0.2 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase);
		}
		expect(measureShapeBreak(buf, f0, sampleRate)!.value).toBeGreaterThan(0.98);
	});

	it('returns null when the pitch is too low for the window to hold a scan', () => {
		expect(measureShapeBreak(tone(1024), 60, sampleRate)).toBeNull();
		expect(measureShapeBreak(tone(4096), 0, sampleRate)).toBeNull();
	});

	it('is deterministic across calls despite the reused scratch buffer', () => {
		const a = tone(4096, { breakAt: 1500 });
		const b = tone(2048);
		const first = measureShapeBreak(a, f0, sampleRate);
		measureShapeBreak(b, f0, sampleRate); // different length, same scratch
		const second = measureShapeBreak(a, f0, sampleRate);
		expect(second).toEqual(first);
	});
});

describe('detectFrame shapeBreak window anchoring', () => {
	const sampleRate = 44100;

	function brokenTone(): Float32Array {
		const buf = new Float32Array(4096);
		for (let i = 0; i < buf.length; i++) {
			const restarted = i >= 2000;
			const t = (restarted ? i - 2000 : i) / sampleRate;
			buf[i] =
				0.3 * Math.sin(2 * Math.PI * 196 * t) +
				(restarted ? 0.45 : 0.2) * Math.sin(2 * Math.PI * 392 * t);
		}
		return buf;
	}

	it('points at the same instant of audio under either window anchor', () => {
		const buf = brokenTone();
		const det = makeMockDetector(196, 0.95);
		// Replay: `time` is the window START, so the same physical window is
		// timestamped windowSeconds later when anchored at its END.
		const windowSeconds = buf.length / sampleRate;
		const fromStart = detectFrame(buf, 1.0, det as any, null, { sampleRate });
		const fromEnd = detectFrame(buf, 1.0 + windowSeconds, det as any, null, {
			sampleRate,
			windowAnchor: 'end'
		});

		expect(fromStart.reading!.shapeBreak).toBeCloseTo(fromEnd.reading!.shapeBreak!, 10);
		const startEvent = fromStart.reading!.time + fromStart.reading!.shapeBreakAt!;
		const endEvent = fromEnd.reading!.time + fromEnd.reading!.shapeBreakAt!;
		expect(endEvent).toBeCloseTo(startEvent, 10);
		// And it really is where the waveform restarted.
		expect(startEvent).toBeGreaterThan(1.0 + 2000 / sampleRate - 0.015);
		expect(startEvent).toBeLessThan(1.0 + 2000 / sampleRate + 0.015);
	});
});

describe('measureShapeBreak silence handling', () => {
	const sampleRate = 44100;

	it('never reports an unmeasurable position as a real similarity', () => {
		// A note ending into hard digital silence: positions whose LAGGED span
		// is all zeros have no valid lag at all. Reporting the -1 sentinel for
		// those would be a fabricated "total shape break" — and would drag the
		// run's baseline median down, silently disabling the tier.
		const buf = new Float32Array(4096);
		for (let i = 0; i < 2200; i++) {
			buf[i] = 0.3 * Math.sin((2 * Math.PI * 196 * i) / sampleRate);
		}
		const result = measureShapeBreak(buf, 196, sampleRate);
		expect(result).not.toBeNull();
		expect(result!.value).toBeGreaterThan(-1);
		expect(Number.isFinite(result!.value)).toBe(true);
	});

	it('returns null when nothing in the buffer is measurable', () => {
		expect(measureShapeBreak(new Float32Array(4096), 196, sampleRate)).toBeNull();
	});
});
