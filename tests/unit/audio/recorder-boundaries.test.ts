import { expect, it } from 'vitest';
import { recorderBoundaries } from '$lib/audio/recorder-boundaries';
import { quantizeRecorderRhythm } from '$lib/audio/recorder-rhythm';
import type { PitchReading } from '$lib/audio/pitch-frame';

const note = (midi: number, onsetTime: number, duration: number) => ({
	midi, onsetTime, duration, clarity: 0.98, cents: 0
});
const frame = (midi: number, center: number): PitchReading => ({
	midi, midiFloat: midi, frequency: 440 * 2 ** ((midi - 69) / 12), cents: 0, clarity: 0.98,
	time: center + 0.05, analysisWindowSeconds: 0.10, rms: 0.1, bandRmsMin: 0.09, shapeBreak: 1
});

it('distinguishes a tracked short note and ghost from an unsupported pitch excursion', () => {
	const notes = [note(60, 0, 0.21), note(62, 0.21, 0.065), note(64, 0.275, 0.30)];
	const frames = Array.from({ length: 35 }, (_, i) => frame(i < 17 ? 60 : 64, i / 60));
	const cost = () => recorderBoundaries(notes, frames, 120).skipCosts[1];
	expect(cost()).toBeLessThan(Infinity);
	expect(recorderBoundaries(notes.map((n, i) => i === 1 ? { ...n, ghost: true } : n), frames, 120).skipCosts[1]).toBe(Infinity);
	for (const i of [14, 15, 16]) frames[i] = frame(62, i / 60);
	expect(cost()).toBe(Infinity);
});

it('can join a steady tone, but protects a reed reset and a tongue-stop dip', () => {
	const notes = [note(60, 0, 0.25), note(60, 0.25, 0.25)];
	const frames = Array.from({ length: 30 }, (_, i) => frame(60, i / 60));
	expect(recorderBoundaries(notes, frames, 120).reasons[1]).toBe('continuous tone');
	const reset = frames.map((f, i) => ({ ...f, brightness: i < 15 ? -16 : -10, brightnessLift: i === 15 ? 5 : 0 }));
	expect(recorderBoundaries(notes, reset, 120).skipCosts[1]).toBe(Infinity);
	frames[15].bandRmsMin = 0.02;
	expect(recorderBoundaries(notes, frames, 120).skipCosts[1]).toBe(Infinity);
});

it('trims a long silent tail using centered audio windows without moving the source segment', () => {
	const source = [note(60, 0, 1.35)];
	const frames = Array.from({ length: 30 }, (_, i) => frame(60, i / 60));
	expect(recorderBoundaries(source, frames, 120).notes[0].duration).toBeCloseTo(29 / 60 + 0.025);
	expect(source[0].duration).toBe(1.35);
});

it('moves the whole figure when the musician supplies an offbeat entrance', () => {
	const notes = [0.18, 0.43, 0.68].map((t, i) => note(60 + i, t, 0.25));
	const result = quantizeRecorderRhythm(notes, 120, undefined, 3);
	expect(result.notes.filter(n => n.pitch !== null).map(n => n.offset)).toEqual([[1, 8], [1, 4], [3, 8]]);
	expect(result.notes[0]).toEqual({ pitch: null, offset: [0, 1], duration: [1, 8] });
});

it('distinguishes a stream phase jump on a held pitch from a tongued repeat with an energy stop', () => {
	const sampleRate = 44100;
	const anchorOffset = 0.25;
	const samples = new Float32Array(sampleRate);
	const splice = Math.round((anchorOffset + 0.52) * sampleRate);
	const signal = { samples, sampleRate, anchorOffset };
	for (let i = 0; i < samples.length; i++) {
		const phase = i < splice ? 0 : 1.2;
		samples[i] = 0.3 * Math.sin(2 * Math.PI * 293.665 * i / sampleRate + phase);
	}
	const frames = Array.from({ length: 45 }, (_, i) => ({
		...frame(62, i / 60), shapeBreak: i >= 29 && i <= 32 ? 0.84 : 1
	}));
	const notes = [note(62, 0, 0.5), note(62, 0.5, 0.25)];
	const clean = recorderBoundaries(notes, frames, 120, signal);
	expect(clean.reasons[1]).toBe('sample discontinuity');
	expect(quantizeRecorderRhythm(clean.notes, 120, clean.skipCosts).omittedIndices).toEqual([1]);
	samples.fill(0, splice - Math.round(0.02 * sampleRate), splice);
	expect(recorderBoundaries(notes, frames, 120, signal).skipCosts[1]).toBe(Infinity);
});

it('identifies a short zero-filled microphone packet only when the waveform resumes across it', () => {
	const sampleRate = 44100;
	const cut = 22050;
	const gap = 441;
	const signal = { samples: new Float32Array(sampleRate), sampleRate, anchorOffset: 0 };
	for (let i = 0; i < sampleRate; i++) {
		if (i >= cut && i < cut + gap) continue;
		const uninterrupted = i < cut ? i : i - gap;
		signal.samples[i] = 0.2 * Math.cos(2 * Math.PI * 300 * uninterrupted / sampleRate);
	}
	const notes = [note(62, 0, 0.57), note(62, 0.57, 0.25)];
	const frames = Array.from({ length: 50 }, (_, i) => ({ ...frame(62, i / 60), shapeBreak: 0.8 }));
	expect(recorderBoundaries(notes, frames, 120, signal).reasons[1]).toBe('sample discontinuity');
	// An attack starting from silence instead of continuing the waveform.
	for (let i = 0; i < 220; i++) signal.samples[cut + gap + i] *= i / 220;
	expect(recorderBoundaries(notes, frames, 120, signal).skipCosts[1]).toBe(Infinity);
});
