import { expect, it } from 'vitest';
import {
	fitRoom,
	learnRoomSession,
	predictRoom,
	roomReduction,
	validateRoom,
	verifyRoom,
	type RoomTimingCheck,
	type RoomSamples
} from '$lib/audio/room-filter';

const verifyTiming = (...args: Parameters<typeof verifyRoom>): RoomTimingCheck | null => verifyRoom(...args).check;

it('subtracts independent stereo reflections on held-out audio and preserves added playing', () => {
	const rate = 12000,
		n = rate * 5;
	let seed = 1103;
	const noise = (): number => {
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
	const energy = (x: Float32Array): number => x.slice(3.5 * rate).reduce((sum, v) => sum + v * v, 0);
	expect(energy(error) / energy(played)).toBeLessThan(0.2);
	const independent = Float32Array.from(left, () => noise() * 0.2);
	expect(validateRoom({ ...capture, mic: independent }, model, rate * 3.5)).toBeLessThan(3);
	expect(roomReduction(mic, new Float32Array(n), rate * 3.5, n)).toBe(0);
	// A changed microphone clock can move the echo either side of the calibrated arrival.
	for (const shift of [-155, 97]) {
		const shifted = Float32Array.from(mic, (_, i) => mic[i - shift] ?? 0);
		expect(verifyTiming({ ...capture, mic: shifted }, model)).toMatchObject({
			offset: shift,
			accepted: true
		});
		// Use another room for the held-out half. A good first-half fit must not enable subtraction.
		const heldOutStart = Math.floor((model.left.length + n) / 2);
		shifted.set(independent.subarray(heldOutStart), heldOutStart);
		expect(verifyTiming({ ...capture, mic: shifted }, model)).toMatchObject({
			offset: shift,
			accepted: false
		});
	}
});

it('distinguishes a shared bass pitch from an aligned speaker path after reopening practice', () => {
	const rate = 12000;
	let seed = 27;
	const left = Float32Array.from({length: 3 * rate}, (_, i) => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return 0.3 * Math.sin(2 * Math.PI * 200 * i / rate) + 0.06 * (seed / 2147483648 - 1);
	});
	const filter = {left: Float32Array.of(1), right: Float32Array.of(0)};
	const right = new Float32Array(left.length);
	const same = verifyTiming({rate, left, right, mic: left}, filter);
	expect(same?.transientReduction).toBeGreaterThan(10);
	// Ten whole bass periods outside the adjustable delay range. The pitch still cancels.
	const mic = Float32Array.from(left, (_, i) => left[i - 600] ?? 0);
	const changed = verifyTiming({rate, left, right, mic}, filter);
	expect(changed?.reduction).toBeGreaterThan(3);
	expect(changed?.transientReduction).toBeLessThan(1);
	expect(changed?.accepted).toBe(false);
});

it('recovers the speaker delay on a sustained pitched cue with a quiet nonrepeating component', () => {
	const rate = 12000;
	let seed = 71;
	const left = Float32Array.from({ length: rate * 2 }, (_, i) => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return 0.3 * Math.sin(2 * Math.PI * 100 * i / rate) + 0.029 * (seed / 2147483648 - 1);
	});
	const right = new Float32Array(left.length);
	const calibratedDelay = 400;
	const taps = new Float32Array(calibratedDelay + 1);
	taps[calibratedDelay] = 1;
	const filter = { left: taps, right: new Float32Array(taps.length) };
	for (const shift of [-185, 185]) {
		const mic = Float32Array.from(left, (_, i) => left[i - calibratedDelay - shift] ?? 0);
		const check = verifyTiming({ rate, left, right, mic }, filter);
		expect(check?.transientReduction).toBeGreaterThan(1);
		expect(check).toMatchObject({ offset: shift, accepted: true });
	}
});

it('aligns the attacks when pitched notes put the broadband peak a few samples early', () => {
	const rate = 12000;
	let seed = 9315;
	const noise = Float32Array.from({ length: rate * 1.25 }, () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return 0.08 * (seed / 2147483648 - 1);
	});
	const tone = Float32Array.from(noise, (_, i) =>
		0.4 * Math.sin(2 * Math.PI * 380 * i / rate) + 0.2 * Math.sin(2 * Math.PI * 511 * i / rate));
	const left = Float32Array.from(tone, (x, i) => x + noise[i]);
	const mic = Float32Array.from(tone, (x, i) => x + (noise[i - 2] ?? 0));
	const check = verifyTiming({ rate, left, right: new Float32Array(left.length), mic },
		{ left: Float32Array.of(1), right: Float32Array.of(0) });
	expect(check).toMatchObject({ broadbandOffset: 0, offset: 2, accepted: true });
	expect(check!.transientReduction).toBeGreaterThan(9);
	expect(check!.reduction).toBeGreaterThan(3);
});


it('corrects a changed stereo balance on Listen and rejects a path that changes again during validation', () => {
	const rate = 12000;
	let seed = 291;
	const noise = (): number => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2147483648 - 1;
	};
	const left = Float32Array.from({length: rate * 3}, noise);
	const right = Float32Array.from(left, noise);
	const delay = 247;
	const filter = {left: new Float32Array(600), right: new Float32Array(600)};
	filter.left[delay] = 1;
	filter.right[delay] = 1;
	const mic = new Float32Array(left.length);
	// The opening favors the left speaker. The validation half favors the right.
	// A scalar gain inferred from the opening cannot transfer across that change.
	for (let i = 0; i < left.length / 2; i++) right[i] *= 0.25;
	for (let i = left.length / 2; i < left.length; i++) left[i] *= 0.25;
	for (let i = 0; i < mic.length; i++) mic[i] = 1.3 * (left[i - delay] ?? 0) + 0.8 * (right[i - delay] ?? 0);
	const capture = {rate, left, right, mic};
	const stable = verifyRoom(capture, filter);
	expect(stable.check?.accepted).toBe(true);
	expect(stable.correction).toBeDefined();
	expect(stable.check?.initial?.failure).toBeTruthy();
	expect(stable.check!.reduction).toBeGreaterThan(10);
	const independent = Float32Array.from(mic, noise);
	mic.set(independent.subarray(19000), 19000);
	expect(verifyRoom(capture, filter)).toMatchObject({check: {accepted: false}});
	expect(verifyRoom({...capture, mic: new Float32Array(mic.length)}, filter).correction).toBeUndefined();
});


it('learns stereo balance on an earlier cue and rechecks it on the next cue before use', () => {
	const rate = 12000, delay = 250;
	const saved = {left: new Float32Array(600), right: new Float32Array(600)};
	saved.left[delay] = saved.right[delay] = 1;
	let seed = 761;
	function noise(): number {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2147483648 - 1;
	}
	function cue(alternate: boolean): RoomSamples {
		const left = Float32Array.from({length: 3 * rate}, noise), right = Float32Array.from(left, noise);
		if (alternate) {
			right.fill(0, 0, left.length / 2 + delay);
			left.fill(0, left.length / 2 + delay);
		}
		const mic = Float32Array.from(left, (_, i) => 1.3 * (left[i-delay] ?? 0) + 0.65 * (right[i-delay] ?? 0));
		return {rate, left, right, mic};
	}
	const first = cue(false);
	const accepted = verifyRoom(first, saved).check!;
	expect(accepted.accepted).toBe(true);
	const session = learnRoomSession(first, saved, accepted.offset)!;
	const next = cue(true);
	expect(verifyRoom(next, saved).check?.accepted).toBe(false);
	expect(verifyRoom(next, saved, session).check).toMatchObject({accepted: true, sessionCues: 1});
	const silent = {...next, mic: new Float32Array(next.mic.length)};
	expect(verifyRoom(silent, saved, session).check?.accepted).toBe(false);
	next.mic.set(Float32Array.from(next.mic.subarray(19000), noise), 19000);
	expect(verifyRoom(next, saved, session).check?.accepted).toBe(false);
	expect(session.cues).toBe(1);
});

it('bypasses a learned correction more powerful than the saved speaker response on the current cue', () => {
	const rate = 12000;
	let seed = 713;
	const left = Float32Array.from({length: rate * 2}, () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2147483648 - 1;
	});
	const mic = Float32Array.from(left, x => 4 * x);
	const saved = {left: Float32Array.of(1), right: Float32Array.of(0)};
	const session = {cues: 1, correction: {left: Float32Array.of(3), right: Float32Array.of(0)}};
	const result = verifyRoom({rate, left, mic, right: new Float32Array(left.length)}, saved, session);
	expect(result.check).toMatchObject({accepted: false, failure: 'level'});
	expect(result.correction).toBeUndefined();
});
