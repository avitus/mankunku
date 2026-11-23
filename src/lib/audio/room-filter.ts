import FFT from 'fft.js';

/** Original microphone and stereo output captured on a shared sample clock. */
export interface RoomSamples {
	mic: Float32Array;
	left: Float32Array;
	right: Float32Array;
	rate: number;
}

/** Causal impulse responses from each speaker to the microphone, including delay. */
export interface RoomFilter {
	left: Float32Array<ArrayBuffer>;
	right: Float32Array<ArrayBuffer>;
}

/** Alignment and level fitted in Listen, with independent validation of the predicted reduction. */
export interface RoomTimingCheck {
	transientReduction: number;
	offset: number;
	gain: number;
	reduction: number;
	accepted: boolean;
}

const powerOfTwo = (length: number): number => 2 ** Math.ceil(Math.log2(length));
const complex = (fft: FFT): Float64Array<ArrayBuffer> => new Float64Array(2 * fft.size);

/** Zero-pad real samples and return the full complex spectrum for correlation or convolution. */
function spectrum(fft: FFT, samples: ArrayLike<number>): Float64Array<ArrayBuffer> {
	const padded = new Float64Array(fft.size);
	padded.set(samples);
	const out = complex(fft);
	fft.realTransform(out, padded);
	fft.completeSpectrum(out);
	return out;
}

/** Convert a conjugate-symmetric spectrum back to real audio samples. */
function inverse(fft: FFT, bins: Float64Array): Float32Array<ArrayBuffer> {
	const out = complex(fft);
	fft.inverseTransform(out, bins);
	return Float32Array.from({ length: fft.size }, (_, i) => out[2 * i]);
}

/** PHAT correlation locates the direct arrival even with coloured calibration music. */
function arrival(samples: RoomSamples, end: number): number {
	const { rate, left, right, mic } = samples;
	const fft = new FFT(powerOfTwo(end * 2));
	const reference = spectrum(
		fft,
		Float32Array.from(left.subarray(0, end), (x, i) => x + right[i])
	);
	const cross = spectrum(fft, mic.subarray(0, end));
	for (let i = 0; i < cross.length; i += 2) {
		const re = cross[i] * reference[i] + cross[i + 1] * reference[i + 1];
		const im = cross[i + 1] * reference[i] - cross[i] * reference[i + 1];
		const magnitude = Math.max(1e-9, Math.hypot(re, im));
		cross[i] = re / magnitude;
		cross[i + 1] = im / magnitude;
	}
	const correlation = inverse(fft, cross);
	let peak = 0;
	for (let i = 1; i < Math.min(end, rate * 0.4); i++) {
		if (Math.abs(correlation[i]) > Math.abs(correlation[peak])) peak = i;
	}
	// The louder speaker or a strong reflection can arrive after the other
	// direct path. Leave enough leading taps for every significant arrival.
	const threshold = 0.2 * Math.abs(correlation[peak]);
	let first = Math.max(0, peak - Math.round(0.1 * rate));
	while (first < peak && Math.abs(correlation[first]) < threshold) first++;
	return Math.max(0, first - Math.round(0.008 * rate));
}

/** Regularized two-input least-squares estimate from overlapping quiet training frames. */
export function fitRoom(samples: RoomSamples, trainEnd: number): RoomFilter {
	const { rate, left, right, mic } = samples;
	const delay = arrival(samples, trainEnd);
	const fft = new FFT(powerOfTwo(rate * 0.15));
	const taper = Float64Array.from(
		{ length: fft.size },
		(_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fft.size)
	);
	const frame = new Float64Array(fft.size);
	const l = complex(fft),
		r = complex(fft),
		m = complex(fft);
	const ll = new Float64Array(fft.size / 2 + 1),
		rr = new Float64Array(ll.length);
	const lr = complex(fft),
		lm = complex(fft),
		rm = complex(fft);
	function transform(channel: Float32Array, at: number, bins: Float64Array): void {
		for (let i = 0; i < fft.size; i++) frame[i] = channel[at + i] * taper[i];
		fft.realTransform(bins, frame);
	}
	for (let at = 0; at + delay + fft.size <= trainEnd; at += fft.size / 4) {
		transform(left, at, l);
		transform(right, at, r);
		transform(mic, at + delay, m);
		for (let k = 0; k < ll.length; k++) {
			const j = 2 * k,
				a = l[j],
				b = l[j + 1],
				c = r[j],
				d = r[j + 1],
				x = m[j],
				y = m[j + 1];
			ll[k] += a * a + b * b;
			rr[k] += c * c + d * d;
			lr[j] += a * c + b * d;
			lr[j + 1] += a * d - b * c;
			lm[j] += a * x + b * y;
			lm[j + 1] += a * y - b * x;
			rm[j] += c * x + d * y;
			rm[j + 1] += c * y - d * x;
		}
	}
	const peakPower = Math.max(
		ll.reduce((a, b) => Math.max(a, b), 0),
		rr.reduce((a, b) => Math.max(a, b), 0)
	);
	for (let k = 0; k < ll.length; k++) {
		const j = 2 * k,
			ridge = 0.008 * (ll[k] + rr[k]) + 1e-6 * peakPower + 1e-12;
		const a = ll[k] + ridge,
			d = rr[k] + ridge,
			b = lr[j],
			c = lr[j + 1];
		const det = a * d - b * b - c * c;
		l[j] = (d * lm[j] - b * rm[j] + c * rm[j + 1]) / det;
		l[j + 1] = (d * lm[j + 1] - b * rm[j + 1] - c * rm[j]) / det;
		r[j] = (a * rm[j] - b * lm[j] - c * lm[j + 1]) / det;
		r[j + 1] = (a * rm[j + 1] - b * lm[j + 1] + c * lm[j]) / det;
	}
	function impulse(bins: Float64Array): Float32Array<ArrayBuffer> {
		fft.completeSpectrum(bins);
		const h = inverse(fft, bins),
			length = Math.round(rate * 0.12);
		const result = new Float32Array(delay + length);
		for (let i = 0; i < length; i++)
			result[delay + i] = h[i] * Math.min(1, (length - i) / (0.015 * rate));
		return result;
	}
	return { left: impulse(l), right: impulse(r) };
}

/** Linear convolution for validation. The active scoring graph uses native ConvolverNodes. */
export function predictRoom(
	filter: RoomFilter,
	left: Float32Array,
	right: Float32Array
): Float32Array<ArrayBuffer> {
	const fft = new FFT(powerOfTwo(left.length + filter.left.length));
	const sum = complex(fft);
	for (const [input, impulse] of [
		[left, filter.left],
		[right, filter.right]
	]) {
		const x = spectrum(fft, input),
			h = spectrum(fft, impulse);
		for (let j = 0; j < x.length; j += 2) {
			sum[j] += x[j] * h[j] - x[j + 1] * h[j + 1];
			sum[j + 1] += x[j] * h[j + 1] + x[j + 1] * h[j];
		}
	}
	return inverse(fft, sum).subarray(0, left.length);
}

/** Difference in microphone energy in dB after subtracting the prediction over a quiet interval. */
export function roomReduction(
	mic: Float32Array,
	prediction: Float32Array,
	start: number,
	end: number
): number {
	let before = 0,
		after = 0;
	for (let i = start; i < end; i++) {
		before += mic[i] ** 2;
		after += (mic[i] - prediction[i]) ** 2;
	}
	return 10 * Math.log10((before + 1e-15) / (after + 1e-15));
}

/** Report the weaker result from the two independently held-out calibration windows. */
export function validateRoom(samples: RoomSamples, filter: RoomFilter, start: number): number {
	const prediction = predictRoom(filter, samples.left, samples.right);
	const middle = Math.floor((start + samples.mic.length) / 2);
	return Math.min(
		roomReduction(samples.mic, prediction, start, middle),
		roomReduction(samples.mic, prediction, middle, samples.mic.length)
	);
}

/** Align a frozen prediction on quiet Listen audio. Only the first half chooses
 * the delay. An independent second half must also benefit from subtraction. */
export function checkRoomTiming(samples: RoomSamples, filter: RoomFilter): RoomTimingCheck | null {
	const predicted = predictRoom(filter, samples.left, samples.right);
	const start = filter.left.length;
	const middle = Math.floor((start + predicted.length) / 2);
	const n = middle - start;
	if (n < samples.rate * 0.22) return null;
	const fft = new FFT(powerOfTwo(2 * n));
	const x = spectrum(fft, predicted.subarray(start, middle));
	// Every candidate delay must explain the same microphone samples. Correlating
	// two whole windows gives short lags more overlap, so a sustained pitched
	// cue can favor a nearby cycle over the actual speaker return.
	const limit = Math.round(samples.rate * 0.02);
	const from = start + limit;
	const to = middle - limit;
	const y = spectrum(fft, samples.mic.subarray(from, to));
	for (let j = 0; j < x.length; j += 2) {
		const re = y[j] * x[j] + y[j + 1] * x[j + 1];
		const im = y[j + 1] * x[j] - y[j] * x[j + 1];
		x[j] = re;
		x[j + 1] = im;
	}
	const correlation = inverse(fft, x);
	// Normalize by the energy of the matching slice of the prediction. The
	// microphone energy is constant. Sweep from latest to earliest slice.
	let power = 0;
	for (let i = from + limit; i < to + limit; i++) power += predicted[i] ** 2;
	let offset = 0;
	let best = -Infinity;
	for (let lag = -limit; lag <= limit; lag++) {
		const dot = correlation[(fft.size + lag - limit) % fft.size];
		const score = dot / Math.sqrt(Math.max(power, 1e-15));
		if (score > best) {
			offset = lag;
			best = score;
		}
		if (lag < limit) power += predicted[from - lag - 1] ** 2 - predicted[to - lag - 1] ** 2;
	}
	// A speaker level or microphone gain change scales both frozen paths.
	// Fit one bounded level on the timing half; assess it on unseen audio.
	let calibrationPower = 0,
		calibrationDot = 0;
	for (let i = start + limit; i < middle - limit; i++) {
		const echo = predicted[i - offset];
		calibrationDot += samples.mic[i] * echo;
		calibrationPower += echo * echo;
	}
	const gain = Math.max(0.6, Math.min(1.6, calibrationDot / (calibrationPower + 1e-15)));
	let transientBefore = 0, transientAfter = 0;
	let before = 0,
		error = 0,
		estimated = 0,
		dot = 0;
	for (let i = middle + limit; i < predicted.length - limit; i++) {
		const observed = samples.mic[i],
			echo = gain * predicted[i - offset];
		before += observed * observed;
		error += (observed - echo) ** 2;
		estimated += echo * echo;
		dot += echo * observed;
		// Emphasize changes between adjacent samples. A loud, repeating bass note can
		// cancel at the wrong delay while the rest of the backing gets louder.
		const change = observed - samples.mic[i - 1];
		const echoChange = echo - gain * predicted[i - offset - 1];
		transientBefore += change * change;
		transientAfter += (change - echoChange) ** 2;
	}
	const reduction = 10 * Math.log10((before + 1e-15) / (error + 1e-15));
	const validationGain = dot / (estimated + 1e-15);
	return {
		transientReduction: 10 * Math.log10((transientBefore + 1e-15) / (transientAfter + 1e-15)),
		offset,
		gain,
		reduction,
		accepted:
			Math.abs(offset) < limit && reduction >= 3 && validationGain >= 0.75 && validationGain <= 1.25
	};
}
