import { expect, it } from 'vitest';
import { quantizeRecorderRhythm } from '$lib/audio/recorder-rhythm';
import { applySwingToBeats } from '$lib/music/swing';

// Input times are in quarter beats at 120 BPM. Compare integer sixth-beat
// positions so that triplets, eighths and sustained notes are all exact.
function transcribe(attacks: number[], end: number, releases = [...attacks.slice(1), end]) {
	const take = attacks.map((beat, i) => ({
		midi: 60 + i, cents: 0, clarity: 0.98, onsetTime: beat / 2, duration: (releases[i] - beat) / 2
	}));
	const { notes, collisions } = quantizeRecorderRhythm(take, 120);
	expect(collisions).toBe(0);
	return notes.map(n => [n.pitch, 24 * n.offset[0] / n.offset[1], 24 * n.duration[0] / n.duration[1]]);
}

it.each([0.5, 0.62, 2 / 3, 0.77])('writes a delayed run of eighths at swing %d', swing => {
	const attacks = Array.from({ length: 8 }, (_, i) => applySwingToBeats(i / 2, swing) + 0.18);
	expect(transcribe(attacks, 4.18)).toEqual(attacks.map((_, i) => [60 + i, 3 * i, 3]));
});

it('preserves a swung offbeat entry and a measured rest', () => {
	expect(transcribe([0.67, 1, 3], 4, [0.98, 2.03, 4])).toEqual([
		[null, 0, 3], [60, 3, 3], [61, 6, 6], [null, 12, 6], [62, 18, 6]
	]);
});

it('switches from swing to an even triplet group within the bar', () => {
	expect(transcribe([0, 2/3, 1, 4/3, 5/3, 2], 4)).toEqual([
		[60, 0, 3], [61, 3, 3], [62, 6, 2], [63, 8, 2], [64, 10, 2], [65, 12, 12]
	]);
});

it('keeps the missing first attack of a rested triplet', () => {
	expect(transcribe([1/3, 2/3, 1], 2)).toEqual([
		[null, 0, 2], [60, 2, 2], [61, 4, 2], [62, 6, 6]
	]);
});

it('recognizes quarter-note triplets across beats', () => {
	const attacks = Array.from({ length: 6 }, (_, i) => i * 2 / 3);
	expect(transcribe(attacks, 4)).toEqual(attacks.map((_, i) => [60 + i, 4 * i, 4]));
});

it.each([2, 4, 2.5])('keeps a final sustain of %d beats', length => {
	expect(transcribe([0, 0.5, 1.5], 1.5 + length).at(-1)).toEqual([62, 9, 6 * length]);
});

it('caps the phrase and reports attacks lost to the same slot', () => {
	const detected = [31.98, 31.99, 32, 33].map(beat => ({
		onsetTime: beat, duration: 0.8, midi: 60, cents: 0, clarity: 1
	}));
	const { notes, collisions } = quantizeRecorderRhythm(detected, 60);
	expect(notes.every(n => n.offset[0]/n.offset[1] + n.duration[0]/n.duration[1] <= 8)).toBe(true);
	expect(notes.filter(n => n.pitch !== null).length + collisions).toBe(2);
});
