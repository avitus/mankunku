import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ENERGY_SMOOTHING,
	ONSET_THRESHOLD,
	MIN_ONSET_INTERVAL,
	SILENCE_THRESHOLD,
	SETTLE_FRAMES,
	SILENCE_DECAY,
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

/**
 * The worklet is plain JS that Vite ships as a raw asset, so it cannot
 * import onset-core.ts — it re-declares the algorithm, and every doc says the
 * two are "kept in sync". A drift only ever fails in a browser, so pin the
 * sync here, on the source text.
 */
describe('onset-worklet.js stays in sync with onset-core.ts', () => {
	const audioDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'lib', 'audio');
	const worklet = readFileSync(join(audioDir, 'onset-worklet.js'), 'utf8');
	const core = readFileSync(join(audioDir, 'onset-core.ts'), 'utf8');

	it('declares the same six constants', () => {
		const constant = (name: string): number => {
			const m = worklet.match(new RegExp(`^const ${name} = ([^;]+);`, 'm'));
			expect(m, `${name} missing from the worklet`).not.toBeNull();
			return Number(m![1]);
		};
		expect(constant('ENERGY_SMOOTHING')).toBe(ENERGY_SMOOTHING);
		expect(constant('ONSET_THRESHOLD')).toBe(ONSET_THRESHOLD);
		expect(constant('MIN_ONSET_INTERVAL')).toBe(MIN_ONSET_INTERVAL);
		expect(constant('SILENCE_THRESHOLD')).toBe(SILENCE_THRESHOLD);
		expect(constant('SETTLE_FRAMES')).toBe(SETTLE_FRAMES);
		expect(constant('SILENCE_DECAY')).toBe(SILENCE_DECAY);
	});

	it('re-implements processOnsetFrame token for token (types and comments aside)', () => {
		const bodyOf = (src: string): string => {
			const start = src.indexOf('function processOnsetFrame(');
			expect(start).toBeGreaterThanOrEqual(0);
			const open = src.indexOf('{', start);
			let depth = 0;
			for (let i = open; i < src.length; i++) {
				if (src[i] === '{') depth++;
				else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
			}
			throw new Error('unbalanced braces');
		};
		const normalize = (body: string): string =>
			body
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/\/\/[^\n]*/g, '')
				.replace(/:\s*(Float32Array|OnsetState|number|OnsetEvent \| null)\b/g, '')
				.replace(/\s+/g, ' ')
				.trim();
		expect(normalize(bodyOf(worklet))).toBe(normalize(bodyOf(core)));
	});
});
