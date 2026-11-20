import { expect, it } from 'vitest';
import {
	fitRoom,
	predictRoom,
	roomReduction,
	validateRoom,
	checkRoomTiming
} from '$lib/audio/room-filter';

it('subtracts independent stereo reflections on held-out audio and preserves added playing', () => {
	const rate = 12000,
		n = rate * 5;
	let seed = 1103;
	const noise = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2147483648 - 1;
	};
	const left = Float32Array.from({ length: n }, () => noise() * 0.1);
	const right = Float32Array.from({ length: n }, () => noise() * 0.1);
	const mic = Float32Array.from(
		left,
		(_, i) => 0.5 * (left[i - 720] ?? 0) + 0.24 * (right[i - 947] ?? 0) - 0.12 * (left[i - 1142] ?? 0)
	);
	const capture = { rate, left, right, mic };
	const model = fitRoom(capture, rate * 3);
	expect(validateRoom(capture, model, rate * 3.5)).toBeGreaterThan(15);
	const played = Float32Array.from(left, (_, i) => 0.015 * Math.sin((2 * Math.PI * 233 * i) / rate));
	const estimate = predictRoom(model, left, right);
	const error = Float32Array.from(mic, (x, i) => x + played[i] - estimate[i] - played[i]);
	const energy = (x: Float32Array) => x.slice(3.5 * rate).reduce((sum, v) => sum + v * v, 0);
	expect(energy(error) / energy(played)).toBeLessThan(0.2);
	const independent = Float32Array.from(left, () => noise() * 0.2);
	expect(validateRoom({ ...capture, mic: independent }, model, rate * 3.5)).toBeLessThan(3);
	expect(roomReduction(mic, new Float32Array(n), rate * 3.5, n)).toBe(0);
	// A changed microphone clock can move the echo either side of the calibrated arrival.
	for (const shift of [-155, 97]) {
		const shifted = Float32Array.from(mic, (_, i) => mic[i - shift] ?? 0);
		expect(checkRoomTiming({ ...capture, mic: shifted }, model)).toMatchObject({
			offset: shift,
			accepted: true
		});
		// Use another room for the held-out half. A good first-half fit must not enable subtraction.
		shifted.set(independent.subarray(n / 2), n / 2);
		expect(checkRoomTiming({ ...capture, mic: shifted }, model)?.accepted).toBe(false);
	}
});
