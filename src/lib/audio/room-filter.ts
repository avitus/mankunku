import FFT from 'fft.js';
import { fitRoomCorrection } from './room-refinement';

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
	broadbandOffset: number;
	validationGain: number;
	micRms: number;
	predictedRms: number;
	offset: number;
	gain: number;
	reduction: number;
	accepted: boolean;
	failure: 'timing' | 'reduction' | 'level' | 'attacks' | null;
	/** Earlier verified Listen cues contributed this many observations to the active response. */
	sessionCues?: number;
	/** Start of the closing window in this capture, when a second fit was attempted. */
	closingStartSeconds?: number;
	/** Last gate reached by the closing retry; the main result retains its original meaning. */
	retryStage?: 'insufficient-samples' | 'ending' | 'alignment' | 'correction-power' | 'opening' | 'verified';
	retryOffsetDeltaSamples?: number;
	/** Measurements from the window that rejected the fit. */
	retryWindow?: Pick<RoomTimingCheck, 'failure' | 'reduction' | 'transientReduction' | 'validationGain'>;
	/** The saved calibration level verified after the level fitted on Listen failed. */
	calibratedGain?: true;
	/** The saved calibration's result before a correction passed independent validation. */
	initial?: Pick<RoomTimingCheck, 'reduction' | 'transientReduction' | 'validationGain' | 'failure'>;
}

const minimumReductionDb = 3;
const minimumTransientReductionDb = 1;
const minimumFitSeconds = 0.22;
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
	const samples = new Float32Array(fft.size);
	for (let i = 0; i < samples.length; i++) samples[i] = out[2 * i];
	return samples;
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
export function checkRoomTiming(samples: RoomSamples, filter: RoomFilter, predicted: Float32Array = predictRoom(filter, samples.left, samples.right)): RoomTimingCheck | null {
	const start = filter.left.length;
	const middle = Math.floor((start + predicted.length) / 2);
	const n = middle - start;
	if (n < samples.rate * minimumFitSeconds) return null;
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
	// A pitched cue can put the broadband peak a few samples away from its
	// attacks. Resolve that local ambiguity on the fitting half alone. Give
	// waveform and first-difference errors equal weight after normalization.
	const broadbandOffset = offset;
	const radius = Math.ceil(samples.rate * 0.00035);
	let micPower = 0, micChangePower = 0;
	for (let i = from + 1; i < to; i++) {
		micPower += samples.mic[i] ** 2;
		micChangePower += (samples.mic[i] - samples.mic[i - 1]) ** 2;
	}
	let gain = 1, bestError = Infinity;
	for (let lag = Math.max(-limit, broadbandOffset - radius); lag <= Math.min(limit, broadbandOffset + radius); lag++) {
		let echoPower = 0, echoDot = 0, changePower = 0, changeDot = 0;
		for (let i = from + 1; i < to; i++) {
			const echo = predicted[i - lag];
			const change = echo - predicted[i - lag - 1];
			echoPower += echo * echo;
			echoDot += echo * samples.mic[i];
			changePower += change * change;
			changeDot += change * (samples.mic[i] - samples.mic[i - 1]);
		}
		const level = Math.max(0.6, Math.min(1.6, echoDot / (echoPower + 1e-15)));
		// Omit the microphone energy term, identical for every lag.
		const error = level * (level * echoPower - 2 * echoDot) / (micPower + 1e-15)
			+ level * (level * changePower - 2 * changeDot) / (micChangePower + 1e-15);
		if (error < bestError) {
			bestError = error;
			offset = lag;
			gain = level;
		}
	}
	return validateAlignment(samples, filter, predicted, broadbandOffset, offset, gain);
}

function validateAlignment(samples: RoomSamples, filter: RoomFilter, predicted: Float32Array,
	broadbandOffset: number, offset: number, gain: number, openingEnd?: number): RoomTimingCheck {
	const middle = Math.floor((filter.left.length + predicted.length) / 2);
	const limit = Math.round(samples.rate * 0.02);
	let transientBefore = 0, transientAfter = 0;
	let before = 0,
		error = 0,
		estimated = 0,
		dot = 0;
	const from = (openingEnd === undefined ? middle : filter.left.length) + limit;
	const to = (openingEnd ?? predicted.length) - limit;
	for (let i = from; i < to; i++) {
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
	const transientReduction = 10 * Math.log10((transientBefore + 1e-15) / (transientAfter + 1e-15));
	const firstTap = filter.left.findIndex((value, i) => value !== 0 || filter.right[i] !== 0);
	let failure: RoomTimingCheck['failure'] = null;
	if (firstTap < 0 || firstTap + offset < 0 || Math.max(Math.abs(broadbandOffset), Math.abs(offset)) >= limit) failure = 'timing';
	else if (!(reduction >= minimumReductionDb)) failure = 'reduction';
	else if (!(validationGain >= 0.75 && validationGain <= 1.25)) failure = 'level';
	else if (!(transientReduction >= minimumTransientReductionDb)) failure = 'attacks';
	return {
		transientReduction,
		broadbandOffset,
		validationGain,
		micRms: Math.sqrt(before / (to - from)),
		predictedRms: Math.sqrt(estimated / (to - from)),
		offset,
		gain,
		reduction,
		accepted: failure === null,
		failure
	};
}

/** A graph-local average of corrections measured against the saved response at its original level. */
export interface RoomSession {
	correction: RoomFilter;
	cues: number;
}

/** Called after an accepted Listen has finished scoring verification. Learn only from
 * that demonstration, using its verified clock offset. Play never enters this fit. */
export function learnRoomSession(samples: RoomSamples, filter: RoomFilter, offset: number, previous?: RoomSession): RoomSession | undefined {
	const first = filter.left.findIndex((v, i) => v !== 0 || filter.right[i] !== 0);
	if (first < 0) return;
	const guard = Math.round(samples.rate * 0.02);
	const delta = fitRoomCorrection(samples, predictRoom(filter, samples.left, samples.right),
		first, filter.left.length - first, offset, 1, filter.left.length + guard, samples.mic.length - guard);
	if (!delta) return;
	const cues = (previous?.cues ?? 0) + 1;
	// Average the first four estimates, then give the latest cue one quarter of the weight.
	// Short captures can estimate fewer taps. Keep the earlier tail in that case.
	if (previous) {
		for (const side of ['left', 'right'] as const) {
			const old = previous.correction[side];
			const update = delta[side];
			const mean = new Float32Array(Math.max(old.length, update.length));
			mean.set(old);
			for (let i = 0; i < update.length; i++) mean[i] += (update[i] - mean[i]) / Math.min(cues, 4);
			delta[side] = mean;
		}
	}
	return { cues, correction: delta };
}

/** Reuse the correction buffer for the candidate prediction, shifting causal taps in place. */
function addSavedPrediction(extra: Float32Array, saved: Float32Array, first: number): void {
	for (let i = saved.length - 1; i >= first; i--) extra[i] = saved[i] + extra[i - first];
	extra.set(saved.subarray(0, first));
}

/** On the same held-out samples used by the gate, keep calibration the primary predictor. */
function correctionWithinRoom(saved: Float32Array, combined: Float32Array, length: number, rate: number, offset: number, openingEnd?: number): boolean {
	const guard = Math.round(rate * 0.02);
	const middle = Math.floor((length + saved.length) / 2);
	let roomPower = 0, correctionPower = 0;
	const from = (openingEnd === undefined ? middle : length) + guard - offset;
	const to = (openingEnd ?? saved.length) - guard - offset;
	for (let i = from; i < to; i++) {
		roomPower += saved[i] ** 2;
		correctionPower += (combined[i] - saved[i]) ** 2;
	}
	return correctionPower < roomPower;
}

interface RoomVerification {
	check: RoomTimingCheck | null;
	correction?: RoomFilter;
}

/** Verify the saved response first. A cue-local correction can rescue a
 * recognizable return only if it also passes every gate on unheard audio. */
function verifyPrediction(samples: RoomSamples, filter: RoomFilter, predicted: Float32Array, session?: RoomSession): RoomVerification {
	const initial = checkRoomTiming(samples, filter, predicted);
	if (!initial || !initial.failure || initial.failure === 'timing') return { check: initial };
	const first = filter.left.findIndex((v, i) => v !== 0 || filter.right[i] !== 0);
	const { reduction, transientReduction, validationGain, failure } = initial;
	const original = { reduction, transientReduction, validationGain, failure };
	const middle = Math.floor((filter.left.length + predicted.length) / 2);
	if (session) {
		const learned = predictRoom(session.correction, samples.left, samples.right);
		addSavedPrediction(learned, predicted, first);
		const aligned = checkRoomTiming(samples, filter, learned);
		// Both predictions must locate the same physical return. A musical pitch
		// alone can correlate at a different cycle even when the speakers moved.
		if (aligned && aligned.failure !== 'timing' && Math.abs(aligned.offset - initial.offset) <= samples.rate * 0.001) {
			let check = aligned;
			// A loud opening note can bias the fitted gain. The level learned on
			// previous cues is an independent candidate: require both halves to pass at unity.
			if (aligned.failure === 'level' && validateAlignment(samples, filter, learned,
				aligned.broadbandOffset, aligned.offset, 1, middle).accepted) {
				check = validateAlignment(samples, filter, learned, aligned.broadbandOffset, aligned.offset, 1);
			}
			if (check.accepted && correctionWithinRoom(predicted, learned, filter.left.length, samples.rate, check.offset)) {
				return { check: { ...check, initial: original, sessionCues: session.cues }, correction: session.correction };
			}
		}
	}
	if (initial.reduction < 1) return { check: initial };
	const guard = Math.round(samples.rate * 0.02);
	const correction = fitRoomCorrection(samples, predicted, first, filter.left.length - first,
		initial.offset, initial.gain, filter.left.length + guard, middle - guard);
	if (!correction) return { check: initial };
	const combined = predictRoom(correction, samples.left, samples.right);
	addSavedPrediction(combined, predicted, first);
	if (!correctionWithinRoom(predicted, combined, filter.left.length, samples.rate, initial.offset)) return { check: initial };
	const check = validateAlignment(samples, filter, combined, initial.broadbandOffset, initial.offset, initial.gain);
	if (check.failure) return { check: initial };
	check.initial = original;
	return { check, correction };
}

/** Check the full cue first. When there is no time for another capture, a
 * closing-window candidate must also pass on the independent opening. */
export function verifyRoom(samples: RoomSamples, filter: RoomFilter, session?: RoomSession, retryClosing = false): RoomVerification {
	const predicted = predictRoom(filter, samples.left, samples.right);
	const full = verifyPrediction(samples, filter, predicted, session);
	const original = full.check;
	if (!original?.failure || original.failure === 'timing') return full;

	// One loud note can bias the level fitted on the opening. The calibration's
	// own gain was fixed before this cue. Require it to suppress both energy
	// and attacks on the opening, then pass every gate on the held-out ending.
	const middle = Math.floor((filter.left.length + predicted.length) / 2);
	if (original.gain !== 1) {
		const calibrated = validateAlignment(samples, filter, predicted, original.broadbandOffset, original.offset, 1);
		if (calibrated.accepted) {
			const opening = validateAlignment(samples, filter, predicted, original.broadbandOffset, original.offset, 1, middle);
			if (opening.reduction >= minimumReductionDb && opening.transientReduction >= minimumTransientReductionDb) {
				const { reduction, transientReduction, validationGain, failure } = original;
				return { check: { ...calibrated, calibratedGain: true, initial: { reduction, transientReduction, validationGain, failure } } };
			}
		}
	}
	if (!retryClosing) return full;

	// Reserve at least one second for the closing fit and validation, and
	// enough independent opening audio after convolution warm-up and lag guards.
	const split = Math.min(middle, predicted.length - samples.rate);
	if (split - filter.left.length - 2 * Math.round(samples.rate * 0.02) < samples.rate * minimumFitSeconds) return full;
	const closing = {
		rate: samples.rate, mic: samples.mic.subarray(split),
		left: samples.left.subarray(split), right: samples.right.subarray(split)
	};
	const retry = verifyPrediction(closing, filter, predicted.subarray(split), session);
	const closingStartSeconds = split / samples.rate;
	original.closingStartSeconds = closingStartSeconds;
	const check = retry.check;
	if (!check) {
		original.retryStage = 'insufficient-samples';
		return full;
	}
	const offsetDelta = check.offset - original.offset;
	original.retryOffsetDeltaSamples = offsetDelta;
	const rejectedWindow = (stage: 'ending' | 'opening', window: RoomTimingCheck): RoomVerification => {
		const { failure, reduction, transientReduction, validationGain } = window;
		original.retryStage = stage;
		original.retryWindow = { failure, reduction, transientReduction, validationGain };
		return full;
	};
	if (!check.accepted) return rejectedWindow('ending', check);
	if (Math.abs(offsetDelta) > samples.rate * 0.001) {
		original.retryStage = 'alignment';
		return full;
	}

	let combined = predicted;
	if (retry.correction) {
		combined = predictRoom(retry.correction, samples.left, samples.right);
		const first = filter.left.findIndex((v, i) => v !== 0 || filter.right[i] !== 0);
		addSavedPrediction(combined, predicted, first);
		if (!correctionWithinRoom(predicted, combined, filter.left.length, samples.rate, check.offset, split)) {
			original.retryStage = 'correction-power';
			return full;
		}
	}
	const opening = validateAlignment(samples, filter, combined, check.broadbandOffset, check.offset, check.gain, split);
	if (!opening.accepted) return rejectedWindow('opening', opening);
	check.retryStage = 'verified';
	check.retryOffsetDeltaSamples = offsetDelta;
	check.closingStartSeconds = closingStartSeconds;
	return retry;
}
