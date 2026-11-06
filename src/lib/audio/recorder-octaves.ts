import type { DetectedNote } from '$lib/types/audio';
import { midiToFrequency } from '$lib/music/intervals';
import { goertzelMagnitude, type PitchReading } from './pitch-frame';
import type { RecorderSignal } from './recorder-boundaries';

interface OctaveCorrection { index: number; originalMidi: number }

/** Look for a lower fundamental AND its third and fifth harmonics. Compare
 * against bins between harmonics so a noisy attack cannot supply the series. */
function supportsLowerOctave(window: Float32Array, upperHz: number, sampleRate: number) {
	const lowerHz = upperHz / 2;
	const magnitude = (partial: number) => goertzelMagnitude(window, lowerHz * partial, sampleRate);
	const upper = magnitude(2);
	const between = [1.5, 2.5, 3.5, 4.5].map(magnitude).sort((a, b) => a - b);
	const floor = (between[1] + between[2]) / 2;
	return upper > 0 && magnitude(1) > Math.max(0.038 * upper, 4 * floor)
		&& magnitude(3) > Math.max(0.025 * upper, 1.75 * floor)
		&& magnitude(5) > Math.max(0.009 * upper, 1.25 * floor);
}

/** A proposed isolated high note can be a low note tracked at its second
 * harmonic. Keep the leap unless multiple pitched windows support folding it.
 * The source segmenter is shared with practice scoring and is left untouched. */
export function recorderOctaveCorrections(notes: DetectedNote[], readings: PitchReading[], signal: RecorderSignal): OctaveCorrection[] {
	const corrections: OctaveCorrection[] = [];
	const halfWindow = Math.round(0.036 * signal.sampleRate);
	for (const [index, note] of notes.entries()) {
		const neighbors = [notes[index - 1], notes[index + 1]].filter(Boolean);
		if (note.ghost || note.midi < 58 || note.midi > 71 || note.duration < 0.09 ||
			!neighbors.length || neighbors.some(n => note.midi - n.midi < 7)) continue;
		let votes = 0;
		let windows = 0;
		for (const reading of readings) {
			if (reading.midi !== note.midi) continue;
			// A segment timestamp can lag the first correctly tracked window.
			const center = reading.time - (reading.analysisWindowSeconds ?? 0.093) / 2;
			if (center < note.onsetTime - 0.065 || center > note.onsetTime + note.duration - 0.015) continue;
			const sample = Math.round((center + signal.anchorOffset) * signal.sampleRate);
			if (sample < halfWindow || sample + halfWindow > signal.samples.length) continue;
			const window = signal.samples.subarray(sample - halfWindow, sample + halfWindow);
			if (supportsLowerOctave(window, midiToFrequency(reading.midiFloat), signal.sampleRate)) votes++;
			windows++;
		}
		if (votes >= 2 && votes >= 0.55 * windows) corrections.push({ index, originalMidi: note.midi });
	}
	return corrections;
}
