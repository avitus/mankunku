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

	it('does NOT lift a genuine low note whose fundamental is fully masked', () => {
		// The 2026-07-14 Third–Fifth Rise regression: a real low E3 (165 Hz) on
		// tenor sax whose fundamental radiates almost nothing — mag(f)/mag(2f)
		// sat at 0.02–0.06, inside the old rule's "subharmonic" band, so every
		// correctly-detected frame was doubled to E4. What still separates it
		// from an artifact is the ODD harmonics: 3f and 5f are full-rank
		// harmonics of a genuine 165 Hz note. Amplitudes below mirror the
		// measured frame profile (normalized to the 2nd harmonic).
		const buf = makeTone([
			[165, 0.02], // fundamental ~4% of the 2nd harmonic — spectrally absent
			[330, 0.5],
			[495, 0.09], // real 3rd harmonic
			[660, 0.05],
			[825, 0.06] // real 5th harmonic
		]);
		expect(correctSubharmonic(buf, 165, SR)).toBe(165);
	});

	it('still lifts a subharmonic even when period-doubling adds half-harmonic sidebands', () => {
		// Worst measured frame of the 2026-06-30 Fifth–Sixth Step artifact
		// (t≈0.75s): real reed period-doubling puts SOME energy at 0.5F and
		// 1.5F of the true F3, so the reported 88 Hz "note" shows nonzero odd
		// bins — but they stay far below true-harmonic rank, and 4f (the real
		// note's 2nd harmonic) towers over everything. Must still double.
		const buf = makeTone([
			[88, 0.0075], // reported fundamental: leakage-level
			[176, 0.25], // true F3 fundamental
			[264, 0.039], // half-harmonic sideband (1.5 × 176)
			[352, 0.87], // true F3 2nd harmonic — dominant
			[440, 0.017] // half-harmonic sideband (2.5 × 176)
		]);
		expect(correctSubharmonic(buf, 88, SR)).toBeCloseTo(176, 0);
	});

	it('does not engage above the low-register bound', () => {
		// Even with the spectral shape of a subharmonic, high frequencies are
		// left alone (subharmonic locks only occur on low sustained tones).
		const buf = makeTone([[1600, 0.5]]);
		expect(correctSubharmonic(buf, 800, SR)).toBe(800);
	});
});
