import type { DetectedNote } from '$lib/types/audio';
import type { PitchReading } from './pitch-frame';

interface PitchWindow {
	time: number;
	reading: PitchReading;
	confident: boolean;
}

/** Look for a stationary intermediate pitch at the end of a segment that
 * already spans two subdivisions. A brief smooth slide crosses the pitch,
 * whereas a played note can repeat essentially the same frequency in both
 * the confident and the weak stream. */
function passingNote(left: DetectedNote, right: DetectedNote, frames: PitchWindow[], beat: number): DetectedNote | undefined {
	const span = right.onsetTime - left.onsetTime;
	if (span < 0.7 * beat || span > 1.7 * beat || right.onsetTime - (left.onsetTime + left.duration) > 0.06) return;
	const lower = Math.min(left.midi, right.midi);
	const higher = Math.max(left.midi, right.midi);
	if (higher - lower < 2 || higher - lower > 5) return;
	const window = frames.filter(f => f.time >= left.onsetTime && f.time < right.onsetTime + 0.06);
	const first = window.findIndex(f => f.reading.midi > lower && f.reading.midi < higher);
	if (first < 1 || window[first - 1].reading.midi !== left.midi) return;
	const pitch = window[first].reading.midi;
	let end = first + 1;
	while (end < window.length && window[end].reading.midi === pitch) end++;
	if (window[end]?.reading.midi !== right.midi || window.slice(end).some(f => f.reading.midi === left.midi)) return;
	const plateau = window.slice(first, end);
	if (plateau.length < 3 || plateau.filter(f => f.confident).length < 2) return;
	const midis = plateau.map(f => f.reading.midiFloat);
	if (midis.some(m => Math.abs(m - pitch) > 0.35) || Math.max(...midis) - Math.min(...midis) > 0.16 || plateau.some((f, i) => i > 0 && f.time - plateau[i - 1].time > 0.035)) return;
	const last = plateau[plateau.length - 1];
	const before = window[first - 1];
	if (last.time - plateau[0].time < 0.028 || plateau[0].time - before.time > 0.12 || window[end].time - last.time > 0.12) return;
	const onsetTime = (before.time + plateau[0].time) / 2;
	const duration = right.onsetTime - onsetTime;
	if (Math.min(onsetTime - left.onsetTime, duration) < Math.max(0.075, beat * 0.25)) return;
	return { midi: pitch, onsetTime, duration,
		cents: (midis.reduce((sum, p) => sum + p, 0) / midis.length - pitch) * 100,
		clarity: Math.max(...plateau.map(f => f.reading.clarity)) };
}

/** Index identifies the original segment whose tail contains the passing note. */
export function recorderPassingNotes(notes: DetectedNote[], readings: PitchReading[], weak: PitchReading[], tempo: number) {
	const windows = (input: PitchReading[], confident: boolean) => input.map(reading => ({
		reading, confident: confident && !reading.warmup, time: reading.time - (reading.analysisWindowSeconds ?? 0.093) / 2
	}));
	const frames = [...windows(readings, true), ...windows(weak, false)].sort((a, b) => a.time - b.time);
	const additions = new Map<number, DetectedNote>();
	for (let i = 0; i + 1 < notes.length; i++) {
		const note = passingNote(notes[i], notes[i + 1], frames, 60 / tempo);
		if (note) additions.set(i, note);
	}
	return additions;
}
