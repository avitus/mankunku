import { describe, it, expect } from 'vitest';
import {
	ONSET_THRESHOLD,
	createOnsetState,
	processOnsetFrame
} from '$lib/audio/onset-core';

/**
 * Tests for the onset detection algorithm.
 *
 * The AudioWorkletProcessor wrapper in `onset-worklet.ts` can't be
 * instantiated in node, but its entire algorithm lives in `onset-core.ts`
 * as pure functions. We exercise those directly.
 */

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

// ─── Tests ────────────────────────────────────────────────────

describe('onset detection algorithm', () => {
	describe('silence handling', () => {
		it('does not trigger onset on silence', () => {
			const state = createOnsetState();
			for (let i = 0; i < 20; i++) {
				const result = processOnsetFrame(silentFrame(), state, i * 0.003);
				expect(result).toBeNull();
			}
		});

		it('decays smoothed energy during silence', () => {
			const state = createOnsetState();
			state.smoothedEnergy = 1.0;
			state.frameCount = 10;

			processOnsetFrame(silentFrame(), state, 0);
			expect(state.smoothedEnergy).toBeCloseTo(0.95, 2);

			processOnsetFrame(silentFrame(), state, 0.003);
			expect(state.smoothedEnergy).toBeLessThan(0.95);
		});
	});

	describe('EMA settling', () => {
		it('does not trigger onsets during first 5 frames', () => {
			const state = createOnsetState();
			const loud = constantFrame(0.5);

			for (let i = 0; i < 5; i++) {
				const result = processOnsetFrame(loud, state, i * 0.003);
				expect(result).toBeNull();
			}
			expect(state.frameCount).toBe(5);
		});

		it('sets smoothedEnergy to HFC during settling period', () => {
			const state = createOnsetState();
			const frame = constantFrame(0.1);

			processOnsetFrame(frame, state, 0);
			expect(state.smoothedEnergy).toBeGreaterThan(0);
		});
	});

	describe('onset triggering', () => {
		it('detects onset when energy jumps after quiet period', () => {
			const state = createOnsetState();
			// Amplitude must produce energy above SILENCE_THRESHOLD (0.001)
			// 0.04^2 = 0.0016 > 0.001
			const quiet = constantFrame(0.04);
			const loud = constantFrame(0.3);

			// Settle with quiet frames
			for (let i = 0; i < 10; i++) {
				processOnsetFrame(quiet, state, i * 0.003);
			}

			// Loud frame should trigger onset
			const result = processOnsetFrame(loud, state, 0.1);
			expect(result).not.toBeNull();
			expect(result!.onset).toBe(true);
		});

		it('respects cooldown between onsets', () => {
			const state = createOnsetState();
			const quiet = constantFrame(0.04);
			const loud = constantFrame(0.5);

			// Settle
			for (let i = 0; i < 10; i++) {
				processOnsetFrame(quiet, state, i * 0.003);
			}

			// First onset
			const first = processOnsetFrame(loud, state, 0.1);
			expect(first?.onset).toBe(true);

			// Reset EMA to something low so ratio would be high again
			state.smoothedEnergy = 0.001;

			// Too soon — within MIN_ONSET_INTERVAL (60ms)
			const tooSoon = processOnsetFrame(loud, state, 0.12);
			expect(tooSoon).toBeNull();

			// After cooldown
			state.smoothedEnergy = 0.001;
			const afterCooldown = processOnsetFrame(loud, state, 0.2);
			expect(afterCooldown?.onset).toBe(true);
		});

		it('does not trigger when ratio is below threshold', () => {
			const state = createOnsetState();
			const steady = constantFrame(0.1);

			// Settle with same volume
			for (let i = 0; i < 10; i++) {
				processOnsetFrame(steady, state, i * 0.003);
			}

			// Same volume frame — ratio should be ~1, well below threshold of 3
			const result = processOnsetFrame(steady, state, 0.1);
			expect(result).toBeNull();
			expect(ONSET_THRESHOLD).toBeGreaterThan(1);
		});
	});

	describe('realistic note sequence', () => {
		it('detects onsets for two notes separated by silence', () => {
			const state = createOnsetState();
			const silence = silentFrame();
			const note = constantFrame(0.15);
			const attack = constantFrame(0.4);
			const onsets: number[] = [];
			let t = 0;
			const dt = 0.003; // ~128 samples at 48kHz

			// Settle period with low noise (energy must be > SILENCE_THRESHOLD 0.001)
			const noise = constantFrame(0.04);
			for (let i = 0; i < 6; i++) {
				processOnsetFrame(noise, state, t);
				t += dt;
			}

			// First note attack
			const r1 = processOnsetFrame(attack, state, t);
			if (r1?.onset) onsets.push(r1.time);
			t += dt;

			// Sustain
			for (let i = 0; i < 30; i++) {
				const r = processOnsetFrame(note, state, t);
				if (r?.onset) onsets.push(r.time);
				t += dt;
			}

			// Silence gap
			for (let i = 0; i < 30; i++) {
				processOnsetFrame(silence, state, t);
				t += dt;
			}

			// Second note attack
			const r2 = processOnsetFrame(attack, state, t);
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
			const state = createOnsetState();
			expect(processOnsetFrame(new Float32Array(0), state, 0)).toBeNull();
		});
	});
});
