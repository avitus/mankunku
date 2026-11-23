import FFT from 'fft.js';
import type { RoomFilter, RoomSamples } from './room-filter';

/**
 * Fit a short stereo correction to the residual left by the saved calibration.
 * The caller selects the Listen interval: the opening for cue-local verification,
 * or both guarded halves of an already verified cue for the next cue. Forward
 * convolution sums X·H and its adjoint correlates each speaker with the error.
 * Eight conjugate-gradient steps bound both fitting and worker time.
 */
export function fitRoomCorrection(
	samples: RoomSamples, prediction: Float32Array, firstTap: number, availableTaps: number,
	offset: number, gain: number, from: number, to: number
): RoomFilter | null {
	const count = to - from;
	const taps = Math.min(availableTaps, 2 ** Math.ceil(Math.log2(samples.rate * 0.08)), Math.floor(count / 4));
	const start = from - firstTap - offset - taps + 1;
	if (taps < 2 || start < 0) return null;
	const fft = new FFT(2 ** Math.ceil(Math.log2(count + taps - 1)));
	const bins = () => new Float64Array(2 * fft.size);
	const real = new Float64Array(fft.size);
	const work = bins(), time = bins(), error = bins();
	function forward(values: ArrayLike<number>): Float64Array {
		real.fill(0);
		real.set(values);
		const out = bins();
		fft.realTransform(out, real);
		fft.completeSpectrum(out);
		return out;
	}
	const references = [samples.left, samples.right].map(x => forward(x.subarray(start, start + count + taps - 1)));
	let maxEnergy = 0;
	for (const x of [samples.left, samples.right]) {
		let energy = 0;
		for (let i = start + taps - 1; i < start + taps - 1 + count; i++) energy += x[i] * x[i];
		maxEnergy = Math.max(maxEnergy, energy);
	}
	if (maxEnergy < 1e-12) return null;
	const ridge = 0.001 * maxEnergy;
	// The valid convolution occupies [taps-1, taps-1+count). Padding the
	// residual at that same offset gives its exact adjoint at causal lags.
	real.fill(0);
	for (let i = 0; i < count; i++) {
		real[i + taps - 1] = samples.mic[from + i] / gain - prediction[from + i - offset];
	}
	function correlate(out: Float64Array): void {
		fft.realTransform(error, real);
		fft.completeSpectrum(error);
		for (let ch = 0; ch < 2; ch++) {
			const x = references[ch];
			for (let j = 0; j < work.length; j += 2) {
				work[j] = x[j] * error[j] + x[j + 1] * error[j + 1];
				work[j + 1] = x[j] * error[j + 1] - x[j + 1] * error[j];
			}
			fft.inverseTransform(time, work);
			for (let j = 0; j < taps; j++) out[ch * taps + j] = time[2 * j];
		}
	}

	const residual = new Float64Array(2 * taps);
	correlate(residual);
	const direction = residual.slice(), coefficients = new Float64Array(2 * taps);
	const product = new Float64Array(2 * taps);
	let norm = residual.reduce((sum, x) => sum + x * x, 0);
	const stoppingPower = norm * 1e-6;
	for (let step = 0; step < 8 && norm > stoppingPower; step++) {
		error.fill(0);
		for (let ch = 0; ch < 2; ch++) {
			const x = references[ch];
			real.fill(0);
			real.set(direction.subarray(ch * taps, (ch + 1) * taps));
			fft.realTransform(work, real);
			fft.completeSpectrum(work);
			for (let j = 0; j < work.length; j += 2) {
				error[j] += x[j] * work[j] - x[j + 1] * work[j + 1];
				error[j + 1] += x[j] * work[j + 1] + x[j + 1] * work[j];
			}
		}
		fft.inverseTransform(time, error);
		real.fill(0);
		for (let i = taps - 1; i < taps - 1 + count; i++) real[i] = time[2 * i];
		correlate(product);
		let curvature = 0;
		for (let i = 0; i < product.length; i++) {
			product[i] += ridge * direction[i];
			curvature += product[i] * direction[i];
		}
		if (!(curvature > 0)) return null;
		const alpha = norm / curvature;
		let next = 0;
		for (let i = 0; i < residual.length; i++) {
			coefficients[i] += alpha * direction[i];
			residual[i] -= alpha * product[i];
			next += residual[i] * residual[i];
		}
		const beta = next / norm;
		for (let i = 0; i < direction.length; i++) direction[i] = residual[i] + beta * direction[i];
		norm = next;
	}
	return { left: Float32Array.from(coefficients.subarray(0, taps)), right: Float32Array.from(coefficients.subarray(taps)) };
}
