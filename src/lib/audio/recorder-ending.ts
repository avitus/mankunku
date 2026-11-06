import { median } from '$lib/util/median';
import { midiToFrequency } from '$lib/music/intervals';
import type { DetectedNote } from '$lib/types/audio';
import type { RecorderSignal } from './recorder-boundaries';
import type { PitchReading } from './pitch-frame';

/** A click in the microphone can trigger an onset while the horn continues
 * to vibrate. Track its pitched harmonics through the proposed last attack.
 * A new tongue can interrupt amplitude, restart the phase, or brighten the
 * new tone even if the fundamental never loses pitch lock. */
export function ringingRelease(note: DetectedNote, previous: DetectedNote, signal: RecorderSignal, readings: PitchReading[]): number | undefined {
	if (note.midi !== previous.midi || note.ghost || previous.ghost ||
		Math.min(note.duration, previous.duration) < 0.13 || note.onsetTime - (previous.onsetTime + previous.duration) > 0.035) return;
	const near = readings.map(r => ({ r, offset: r.time - (r.analysisWindowSeconds ?? 0.093) / 2 - note.onsetTime }))
		.filter(f => Math.abs(f.offset) <= 0.11);
	if (near.length < 7 || near[0].offset > -0.075 || near[near.length - 1].offset < 0.075 ||
		near.some((f, i) => (f.r.midi - note.midi) % 12 !== 0 || (i > 0 && f.offset - near[i - 1].offset > 0.04))) return;
	const brightness = (sign: number) => near.flatMap(f =>
		sign * f.offset > 0.04 && f.r.brightness != null ? [f.r.brightness] : []);
	const before = brightness(-1);
	const after = brightness(1);
	if (before.length && after.length && median(after) - median(before) > 3.6) return;

	const hz = midiToFrequency(note.midi + note.cents / 100);
	const { sampleRate, samples } = signal;
	const anchor = Math.round((signal.anchorOffset + note.onsetTime) * sampleRate);
	const half = Math.ceil(sampleRate * Math.max(0.012, 2 / hz));
	const hop = Math.round(0.015 * sampleRate);
	if (anchor - 7 * hop - half < 0 || anchor + 7 * hop + half > samples.length || hz * 4 >= sampleRate / 2) return;
	const powers = new Array<number>(15).fill(0);
	let strongest = 0;
	let levels: number[] = [];
	let phases: number[] = [];
	for (let harmonic = 1; harmonic <= 4; harmonic++) {
		const omega = 2 * Math.PI * hz * harmonic / sampleRate;
		const amplitudes = [];
		const angles = [];
		const cosine = new Float64Array(half * 2);
		const sine = new Float64Array(half * 2);
		for (let i = -half; i < half; i++) {
			const window = 0.5 + 0.5 * Math.cos(Math.PI * i / half);
			cosine[i + half] = window * Math.cos(omega * i);
			sine[i + half] = window * Math.sin(omega * i);
		}
		for (let frame = 0; frame < powers.length; frame++) {
			const center = (frame - 7) * hop;
			let re = 0, im = 0;
			for (let i = -half; i < half; i++) {
				const sample = samples[anchor + center + i];
				re += sample * cosine[i + half];
				im -= sample * sine[i + half];
			}
			const power = re * re + im * im;
			powers[frame] += power;
			amplitudes.push(Math.sqrt(power));
			angles.push(Math.atan2(im, re) - omega * center);
		}
		const strength = amplitudes.reduce((a, b) => a + b, 0);
		if (strength > strongest) {
			strongest = strength;
			levels = amplitudes;
			phases = angles;
		}
	}
	if (!strongest) return;
	const steps = phases.slice(1).map((p, i) => {
		const delta = p - phases[i];
		return Math.atan2(Math.sin(delta), Math.cos(delta));
	});
	const typical = median(steps);
	if (steps.some(s => Math.abs(s - typical) > 0.30)) return;
	// Work in amplitude ratios. A steady or dying note can taper past
	// the boundary; a dropout, new attack, or sudden swell must survive.
	for (const envelope of [levels, powers.map(Math.sqrt)]) {
		const left = median(envelope.slice(0, 4));
		const right = median(envelope.slice(-4));
		if (right > left * 1.20 || Math.min(...envelope.slice(4, 11)) < 0.85 * Math.min(left, right) ||
			envelope.some((amp, i) => i && amp > envelope[i - 1] * 1.20)) return;
	}
	// Date the release from the audible body of this confirmed single
	// note. A pitch tracker can follow its faint decay past the written end.
	const end = note.onsetTime + note.duration;
	const body = readings.flatMap(r => {
		const t = r.time - (r.analysisWindowSeconds ?? 0.093) / 2;
		return t >= previous.onsetTime && t <= end && (r.midi - note.midi) % 12 === 0 ? [{ t, rms: r.rms }] : [];
	});
	const floor = 0.20 * Math.max(...body.map(f => f.rms));
	const last = body.findLast(f => f.rms >= floor);
	return last && Math.min(end, last.t + 0.025);
}
