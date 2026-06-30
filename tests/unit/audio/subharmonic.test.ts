import { describe, it, expect } from 'vitest';
import { correctSubharmonic, goertzelMagnitude } from '$lib/audio/pitch-frame';

const SR = 44100;
const N = 4096;

/** Sum of sinusoidal partials: [freq, amplitude][] over an N-sample window. */
function makeTone(partials: Array<[number, number]>): Float32Array {
	const out = new Float32Array(N);
	for (let i = 0; i < N; i++) {
		let s = 0;
		for (const [f, a] of partials) s += a * Math.sin((2 * Math.PI * f * i) / SR);
		out[i] = s;
	}
	return out;
}

describe('goertzelMagnitude', () => {
	it('peaks at the tone frequency and is near-zero an octave up', () => {
		const buf = makeTone([[220, 0.5]]); // pure A3
		const atFundamental = goertzelMagnitude(buf, 220, SR);
		const atOctaveUp = goertzelMagnitude(buf, 440, SR);
		expect(atFundamental).toBeGreaterThan(0);
		// A pure tone has no energy at the octave above; only window leakage.
		expect(atOctaveUp).toBeLessThan(atFundamental * 0.1);
	});

	it('returns 0 for degenerate frequencies', () => {
		const buf = makeTone([[220, 0.5]]);
		expect(goertzelMagnitude(buf, 0, SR)).toBe(0);
		expect(goertzelMagnitude(buf, SR, SR)).toBe(0); // ≥ Nyquist
	});
});

describe('correctSubharmonic', () => {
	it('lifts a pure octave-up tone reported at its subharmonic back to the fundamental', () => {
		// The detector reported 88 Hz (F2) but the audio is a pure 176 Hz (F3):
		// no real energy at 88 Hz, so this is a period-doubling subharmonic.
		const buf = makeTone([[176, 0.5]]);
		expect(correctSubharmonic(buf, 88, SR)).toBeCloseTo(176, 0);
	});

	it('leaves a correctly-detected fundamental untouched', () => {
		const buf = makeTone([[176, 0.5]]);
		// Reported frequency already matches the audio — there is strong energy
		// at 176 and little at 352, so no correction.
		expect(correctSubharmonic(buf, 176, SR)).toBe(176);
	});

	it('does NOT lift a genuine low note that merely has a strong 2nd harmonic', () => {
		// A real low note (88 Hz) with a 2nd harmonic LOUDER than its fundamental
		// — the weak-fundamental shape that fools autocorrelation. The fundamental
		// is still present, so the spectral test must keep it at 88 Hz.
		const buf = makeTone([
			[88, 0.25], // present, but quieter than the 2nd harmonic
			[176, 0.5],
			[264, 0.15]
		]);
		expect(correctSubharmonic(buf, 88, SR)).toBe(88);
	});

	it('does not engage above the low-register bound', () => {
		// Even with the spectral shape of a subharmonic, high frequencies are
		// left alone (subharmonic locks only occur on low sustained tones).
		const buf = makeTone([[1600, 0.5]]);
		expect(correctSubharmonic(buf, 800, SR)).toBe(800);
	});
});
