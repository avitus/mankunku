import { describe, it, expect } from 'vitest';
import { PITCH_CLASSES } from '$lib/types/music';
import { midiToFrequency } from '$lib/music/intervals';
import { inferRecorderKey } from '$lib/audio/recorder-key';
import { recorderOctaveCorrections } from '$lib/audio/recorder-octaves';
import type { PitchReading } from '$lib/audio/pitch-frame';

describe('recorder tonic', () => {
	it.each([
		[0, 2, 4, 7, 7, 7, 4, 2, 0],
		[2, 3, 5, 8, 7, 5, 8, 11, 9, 7, 5, 3, 11, 0]
	])('recognizes a cadence across all twelve practice keys', (...degrees) => {
		for (const [tonic, key] of PITCH_CLASSES.entries()) {
			expect(inferRecorderKey(degrees.map(d => ({ midi: 60 + tonic + d })))).toBe(key);
		}
	});
	it('handles a silent take and a single note', () => {
		expect(inferRecorderKey([])).toBe('C');
		expect(inferRecorderKey([{ midi: 66 }])).toBe('F#');
	});
});

describe('recorder octave evidence', () => {
	const sampleRate = 44100;
	const upperHz = midiToFrequency(68);
	const notes = [53, 68, 56].map((midi, i) => ({ midi, onsetTime: i * 0.2, duration: 0.2, cents: 0, clarity: 0.99 }));
	const frames: PitchReading[] = [0.25, 0.29, 0.34].map(center => ({
		midi: 68, midiFloat: 68, frequency: upperHz, time: center + 0.0465, analysisWindowSeconds: 0.093,
		clarity: 0.99, rms: 0.2, cents: 0
	}));
	function signal(oddPartials: number) {
		const anchorOffset = 0.5;
		const samples = Float32Array.from({ length: sampleRate }, (_, i) => {
			const t = i / sampleRate - anchorOffset;
			if (t < 0.2 || t > 0.4) return 0;
			const phase = Math.PI * upperHz * t;
			return 0.5 * Math.sin(2 * phase) + 0.06 * Math.sin(phase) +
				oddPartials * (Math.sin(3 * phase) + 0.6 * Math.sin(5 * phase));
		});
		return { samples, sampleRate, anchorOffset };
	}
	it('folds a tracked second harmonic when multiple windows contain the lower harmonic series', () => {
		expect(recorderOctaveCorrections(notes, frames, signal(0.055))).toEqual([{ index: 1, originalMidi: 68 }]);
	});
	it('preserves a real leap with a weak subharmonic and a single noisy window', () => {
		expect(recorderOctaveCorrections(notes, frames, signal(0))).toEqual([]);
		expect(recorderOctaveCorrections(notes, frames.slice(0, 1), signal(0.055))).toEqual([]);
	});
});
