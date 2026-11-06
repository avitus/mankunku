import { describe, expect, it } from 'vitest';
import type { DetectedNote } from '$lib/types/audio';
import type { PitchReading } from '$lib/audio/pitch-frame';
import { recorderPassingNotes } from '$lib/audio/recorder-passing-notes';
import { ringingRelease } from '$lib/audio/recorder-ending';
import { quantizeRecorderRhythm } from '$lib/audio/recorder-rhythm';

const note = (midi: number, onsetTime: number, duration: number): DetectedNote =>
	({ midi, onsetTime, duration, cents: 0, clarity: 0.99 });
const frame = (midiFloat: number, center: number): PitchReading => ({
	midiFloat, midi: Math.round(midiFloat), frequency: 440 * 2 ** ((midiFloat - 69) / 12),
	time: center + 0.045, analysisWindowSeconds: 0.09, cents: 0, rms: 0.1, clarity: 0.93
});

describe('short passing notes', () => {
	const segments = [note(55, 0, 0.45), note(52, 0.45, 0.6)];
	const around = [frame(55, 0.13), frame(55, 0.18), frame(53.12, 0.24), frame(53.15, 0.26), frame(52, 0.39)];
	it('locates a stationary pitch using corroborating confident and weak windows', () => {
		const passing = recorderPassingNotes(segments, around, [frame(53.16, 0.28)], 140).get(0);
		expect(passing?.midi).toBe(53);
		expect(passing?.onsetTime).toBeCloseTo(0.21);
		expect(passing?.duration).toBeCloseTo(0.24);
	});
	it('rejects a glide, an isolated weak detection and a return to the preceding pitch', () => {
		expect(recorderPassingNotes(segments, around, [frame(53.45, 0.28)], 140).size).toBe(0);
		expect(recorderPassingNotes(segments, around.slice(0, 2), [frame(53, 0.28)], 140).size).toBe(0);
		expect(recorderPassingNotes(segments, [...around, frame(55, 0.41)], [frame(53.16, 0.28)], 140).size).toBe(0);
	});
});

describe('sustained final note', () => {
	const sampleRate = 16000;
	const previous = note(69, 0.1, 0.4);
	const ending = note(69, 0.5, 0.4);
	const readings = Array.from({ length: 50 }, (_, i) => frame(69, 0.1 + i / 60));
	function analyze(kind: 'hold' | 'tongue' | 'new phase') {
		const samples = Float32Array.from({ length: sampleRate }, (_, i) => {
			const t = i / sampleRate;
			const amp = kind === 'tongue' && Math.abs(t - 0.5) < 0.013 ? 0.005 : 0.2;
			const phase = 2 * Math.PI * 440 * t + (kind === 'new phase' && t >= 0.5 ? 2.1 : 0);
			return amp * Math.sin(phase) + (i === sampleRate / 2 ? 0.4 : 0);
		});
		return ringingRelease(ending, previous, { samples, sampleRate, anchorOffset: 0 }, readings);
	}
	it('recognizes a click on a continuous tone, preserving a tongue or restarted phase', () => {
		expect(analyze('hold')).toBeDefined();
		expect(analyze('tongue')).toBeUndefined();
		expect(analyze('new phase')).toBeUndefined();
	});
	it('joins only the final pair without moving earlier notes or the chosen entrance', () => {
		const ns = [note(65, 0.06, 0.22), note(67, 0.28, 0.26), note(69, 0.54, 0.28), note(69, 0.82, 0.3)];
		for (const firstTick of [undefined, 3]) {
			const before = quantizeRecorderRhythm(ns, 120, undefined, firstTick);
			const after = quantizeRecorderRhythm(ns, 120, undefined, firstTick, 1.03);
			expect(after.notes.slice(0, -1)).toEqual(before.notes.slice(0, -2));
			expect(after.notes.at(-1)?.offset).toEqual(before.notes.at(-2)?.offset);
			expect(after.omittedIndices).toEqual([3]);
			expect(after.phaseSeconds).toBe(before.phaseSeconds);
		}
	});
});
