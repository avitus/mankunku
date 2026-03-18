import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the onset detection algorithm.
 *
 * The actual OnsetDetectorProcessor runs in an AudioWorklet, which can't be
 * instantiated in node. Instead, we extract and test the core logic:
 *   - Energy computation
 *   - HFC (high-frequency content) computation
 *   - Adaptive threshold via EMA
 *   - Onset triggering with cooldown
 *
 * We replicate the processor's algorithm here and verify it behaves correctly.
 */

// ─── Algorithm constants (must match onset-worklet.ts) ────────
const ENERGY_SMOOTHING = 0.85;
const ONSET_THRESHOLD = 3.0;
const MIN_ONSET_INTERVAL = 0.06;
const SILENCE_THRESHOLD = 0.001;

// ─── Extracted algorithm (mirrors the worklet logic) ──────────

interface OnsetState {
	smoothedEnergy: number;
	lastOnsetTime: number;
	frameCount: number;
}

function processFrame(
	input: Float32Array,
	state: OnsetState,
	currentTime: number
): { onset: boolean; time: number } | null {
	if (input.length === 0) return null;

	let hfc = 0;
	let energy = 0;
	const n = input.length;

	for (let i = 0; i < n; i++) {
		const s = input[i];
		energy += s * s;
		hfc += Math.abs(s) * (i + 1);
	}

	energy /= n;
	hfc /= n;

	if (energy < SILENCE_THRESHOLD) {
		state.smoothedEnergy *= 0.95;
		state.frameCount++;
		return null;
	}

	if (state.frameCount < 5) {
		state.smoothedEnergy = hfc;
		state.frameCount++;
		return null;
	}

	const ratio = state.smoothedEnergy > 0 ? hfc / state.smoothedEnergy : 0;

	let result: { onset: boolean; time: number } | null = null;
	if (ratio > ONSET_THRESHOLD && currentTime - state.lastOnsetTime > MIN_ONSET_INTERVAL) {
		state.lastOnsetTime = currentTime;
		result = { onset: true, time: currentTime };
	}

	state.smoothedEnergy = ENERGY_SMOOTHING * state.smoothedEnergy + (1 - ENERGY_SMOOTHING) * hfc;
	state.frameCount++;

	return result;
}

function makeState(): OnsetState {
	return { smoothedEnergy: 0, lastOnsetTime: -1, frameCount: 0 };
}

/** Create a frame of silence */
function silentFrame(size = 128): Float32Array {
	return new Float32Array(size);
}

/** Create a frame with constant amplitude */
function constantFrame(amplitude: number, size = 128): Float32Array {
	const frame = new Float32Array(size);
	frame.fill(amplitude);
	return frame;
}

/** Create a loud transient frame (simulates note attack) */
function transientFrame(amplitude: number, size = 128): Float32Array {
	const frame = new Float32Array(size);
	for (let i = 0; i < size; i++) {
		// Ramp up to simulate attack transient
		frame[i] = amplitude * (i / size);
	}
	return frame;
}

// ─── Tests ────────────────────────────────────────────────────

describe('onset detection algorithm', () => {
	describe('energy computation', () => {
		it('silence has energy below threshold', () => {
			const frame = silentFrame();
			let energy = 0;
			for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
			energy /= frame.length;

			expect(energy).toBe(0);
			expect(energy).toBeLessThan(SILENCE_THRESHOLD);
		});

		it('non-zero signal has energy above threshold', () => {
			const frame = constantFrame(0.1);
			let energy = 0;
			for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
			energy /= frame.length;

			expect(energy).toBeCloseTo(0.01, 4);
			expect(energy).toBeGreaterThan(SILENCE_THRESHOLD);
		});
	});

	describe('HFC (high-frequency content)', () => {
		it('weights later samples more heavily', () => {
			const frame = constantFrame(0.1, 128);
			let hfc = 0;
			for (let i = 0; i < frame.length; i++) {
				hfc += Math.abs(frame[i]) * (i + 1);
			}
			hfc /= frame.length;

			// For constant signal: sum of 0.1 * (1+2+...+128) / 128
			// = 0.1 * (128*129/2) / 128 = 0.1 * 64.5 = 6.45
			expect(hfc).toBeCloseTo(6.45, 1);
		});

		it('transient has higher HFC than steady-state', () => {
			const steady = constantFrame(0.1, 128);
			const transient = transientFrame(0.2, 128);

			let hfcSteady = 0, hfcTransient = 0;
			for (let i = 0; i < 128; i++) {
				hfcSteady += Math.abs(steady[i]) * (i + 1);
				hfcTransient += Math.abs(transient[i]) * (i + 1);
			}

			expect(hfcTransient).toBeGreaterThan(hfcSteady);
		});
	});

	describe('silence handling', () => {
		it('does not trigger onset on silence', () => {
			const state = makeState();
			for (let i = 0; i < 20; i++) {
				const result = processFrame(silentFrame(), state, i * 0.003);
				expect(result).toBeNull();
			}
		});

		it('decays smoothed energy during silence', () => {
			const state = makeState();
			state.smoothedEnergy = 1.0;
			state.frameCount = 10;

			processFrame(silentFrame(), state, 0);
			expect(state.smoothedEnergy).toBeCloseTo(0.95, 2);

			processFrame(silentFrame(), state, 0.003);
			expect(state.smoothedEnergy).toBeLessThan(0.95);
		});
	});

	describe('EMA settling', () => {
		it('does not trigger onsets during first 5 frames', () => {
			const state = makeState();
			const loud = constantFrame(0.5);

			for (let i = 0; i < 5; i++) {
				const result = processFrame(loud, state, i * 0.003);
				expect(result).toBeNull();
			}
			expect(state.frameCount).toBe(5);
		});

		it('sets smoothedEnergy to HFC during settling period', () => {
			const state = makeState();
			const frame = constantFrame(0.1);

			processFrame(frame, state, 0);
			expect(state.smoothedEnergy).toBeGreaterThan(0);
		});
	});

	describe('onset triggering', () => {
		it('detects onset when energy jumps after quiet period', () => {
			const state = makeState();
			// Amplitude must produce energy above SILENCE_THRESHOLD (0.001)
			// 0.04^2 = 0.0016 > 0.001
			const quiet = constantFrame(0.04);
			const loud = constantFrame(0.3);

			// Settle with quiet frames
			for (let i = 0; i < 10; i++) {
				processFrame(quiet, state, i * 0.003);
			}

			// Loud frame should trigger onset
			const result = processFrame(loud, state, 0.1);
			expect(result).not.toBeNull();
			expect(result!.onset).toBe(true);
		});

		it('respects cooldown between onsets', () => {
			const state = makeState();
			const quiet = constantFrame(0.04);
			const loud = constantFrame(0.5);

			// Settle
			for (let i = 0; i < 10; i++) {
				processFrame(quiet, state, i * 0.003);
			}

			// First onset
			const first = processFrame(loud, state, 0.1);
			expect(first?.onset).toBe(true);

			// Reset EMA to something low so ratio would be high again
			state.smoothedEnergy = 0.001;

			// Too soon — within MIN_ONSET_INTERVAL (60ms)
			const tooSoon = processFrame(loud, state, 0.12);
			expect(tooSoon?.onset).toBeUndefined();

			// After cooldown
			state.smoothedEnergy = 0.001;
			const afterCooldown = processFrame(loud, state, 0.2);
			expect(afterCooldown?.onset).toBe(true);
		});

		it('does not trigger when ratio is below threshold', () => {
			const state = makeState();
			const steady = constantFrame(0.1);

			// Settle with same volume
			for (let i = 0; i < 10; i++) {
				processFrame(steady, state, i * 0.003);
			}

			// Same volume frame — ratio should be ~1, well below threshold of 3
			const result = processFrame(steady, state, 0.1);
			expect(result?.onset).toBeUndefined();
		});
	});

	describe('realistic note sequence', () => {
		it('detects onsets for two notes separated by silence', () => {
			const state = makeState();
			const silence = silentFrame();
			const note = constantFrame(0.15);
			const attack = constantFrame(0.4);
			const onsets: number[] = [];
			let t = 0;
			const dt = 0.003; // ~128 samples at 48kHz

			// Settle period with low noise (energy must be > SILENCE_THRESHOLD 0.001)
			const noise = constantFrame(0.04);
			for (let i = 0; i < 6; i++) {
				processFrame(noise, state, t);
				t += dt;
			}

			// First note attack
			const r1 = processFrame(attack, state, t);
			if (r1?.onset) onsets.push(r1.time);
			t += dt;

			// Sustain
			for (let i = 0; i < 30; i++) {
				const r = processFrame(note, state, t);
				if (r?.onset) onsets.push(r.time);
				t += dt;
			}

			// Silence gap
			for (let i = 0; i < 30; i++) {
				processFrame(silence, state, t);
				t += dt;
			}

			// Second note attack
			const r2 = processFrame(attack, state, t);
			if (r2?.onset) onsets.push(r2.time);
			t += dt;

			expect(onsets.length).toBeGreaterThanOrEqual(2);
			// The two onsets should be well-separated
			if (onsets.length >= 2) {
				expect(onsets[onsets.length - 1] - onsets[0]).toBeGreaterThan(0.1);
			}
		});
	});

	describe('empty input handling', () => {
		it('returns null for empty input', () => {
			const state = makeState();
			expect(processFrame(new Float32Array(0), state, 0)).toBeNull();
		});
	});
});
