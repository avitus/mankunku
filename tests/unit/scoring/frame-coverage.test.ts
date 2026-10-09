import { describe, it, expect } from 'vitest';
import { frameCoverage, AUDIO_CHECK_TOLERANCE_SEMITONES, AUDIO_CHECK_RELEASE_SECONDS } from '$lib/scoring/frame-coverage';
import type { Note } from '$lib/types/music';
import type { PitchReading } from '$lib/audio/pitch-frame';

/**
 * The audio check: how much of what sounded was the written line (precision)
 * and how much of the line sounded (recall), read frame by frame from the
 * detector's own pitch readings against the expected piano roll — no
 * segmentation, no pairing. Assessed 2026-10-07 on the recorded-take corpus
 * and 378 Firefox takes (research/audio-scoring/REPORT.md): it ranks with
 * what was actually played at 0.6–0.8 and reads the inflated Wail takes at
 * 0.57 / 0.83 precision against a clean-take p10 of 0.95 (this rule,
 * re-measured 2026-10-08). A badge beside the score, never a grade: the two
 * disagree exactly where one is wrong.
 */

const TEMPO = 120; // a beat is 0.5 s; an eighth 0.25 s
const line: Note[] = [
	{ pitch: 60, offset: [0, 1], duration: [1, 8] },
	{ pitch: 62, offset: [1, 8], duration: [1, 8] },
	{ pitch: 64, offset: [1, 4], duration: [1, 4] }
];

/** A pitch reading at `time` seconds of fractional MIDI `midiFloat`: nearest MIDI plus cents, its frequency (A4 = 440 Hz), clarity 0.95 by default and rms 0.1. */
function reading(time: number, midiFloat: number, clarity = 0.95): PitchReading {
	const midi = Math.round(midiFloat);
	return { time, midiFloat, midi, cents: Math.round((midiFloat - midi) * 100), clarity, frequency: 440 * 2 ** ((midiFloat - 69) / 12), rms: 0.1 };
}

/** One reading every 16.7 ms (60 fps) holding `midi` from `from` to `to`. */
function held(midi: number, from: number, to: number): PitchReading[] {
	const out: PitchReading[] = [];
	for (let t = from; t < to; t += 1 / 60) out.push(reading(t, midi));
	return out;
}

describe('frameCoverage', () => {
	it('reads a clean take as full precision and recall', () => {
		const readings = [...held(60, 0, 0.25), ...held(62, 0.25, 0.5), ...held(64, 0.5, 1.0)];
		const c = frameCoverage(readings, line, TEMPO, 0.5, 0, false);
		expect(c.precision).toBeGreaterThan(0.97);
		expect(c.recall).toBeGreaterThan(0.97);
		expect(c.soundedFrames).toBe(readings.length);
	});

	it('charges an extra note as lost precision but not recall', () => {
		// the line, then an extra G held for 0.5 s inside the window after it
		const readings = [...held(60, 0, 0.25), ...held(62, 0.25, 0.5), ...held(64, 0.5, 1.0), ...held(67, 1.0, 1.5)];
		const c = frameCoverage(readings, line, TEMPO, 0.5, 0, false);
		expect(c.recall).toBeGreaterThan(0.97);
		expect(c.precision).toBeCloseTo(2 / 3, 1);
	});

	it('charges a wrong note in both', () => {
		const readings = [...held(60, 0, 0.25), ...held(63, 0.25, 0.5), ...held(64, 0.5, 1.0)];
		const c = frameCoverage(readings, line, TEMPO, 0.5, 0, false);
		expect(c.precision).toBeCloseTo(0.75, 1);
		expect(c.recall).toBeCloseTo(0.75, 1);
	});

	it('a missed note costs recall only', () => {
		const readings = [...held(60, 0, 0.25), ...held(64, 0.5, 1.0)];
		const c = frameCoverage(readings, line, TEMPO, 0.5, 0, false);
		expect(c.precision).toBeGreaterThan(0.97);
		expect(c.recall).toBeCloseTo(0.75, 1);
	});

	it('is duration-blind: a note released early costs nothing (2026-10-07 decision)', () => {
		const readings = [...held(60, 0, 0.25), ...held(62, 0.25, 0.5), ...held(64, 0.5, 0.6)];
		const c = frameCoverage(readings, line, TEMPO, 0.5, 0, false);
		expect(c.precision).toBeGreaterThan(0.97);
		expect(c.recall).toBeGreaterThan(0.97);
	});

	it('reads the readings on the recording clock through the lag the scorer found', () => {
		const lag = 0.4;
		const readings = [...held(60, 0.4, 0.65), ...held(62, 0.65, 0.9), ...held(64, 0.9, 1.4)];
		expect(frameCoverage(readings, line, TEMPO, 0.5, lag, false).precision).toBeGreaterThan(0.97);
		expect(frameCoverage(readings, line, TEMPO, 0.5, 0, false).precision).toBeLessThan(0.7);
	});

	it('tolerates the release tail of a note that has just ended', () => {
		const readings = [...held(60, 0, 0.25 + AUDIO_CHECK_RELEASE_SECONDS - 0.02), ...held(62, 0.25, 0.5), ...held(64, 0.5, 1.0)];
		expect(frameCoverage(readings, line, TEMPO, 0.5, 0, false).precision).toBeGreaterThan(0.97);
	});

	it('judges pitch by the nearest semitone: a reading over half a semitone off is not the note', () => {
		const flat = [...held(60, 0, 0.25), ...held(62 - AUDIO_CHECK_TOLERANCE_SEMITONES - 0.1, 0.25, 0.5), ...held(64, 0.5, 1.0)];
		expect(frameCoverage(flat, line, TEMPO, 0.5, 0, false).precision).toBeCloseTo(0.75, 1);
	});

	it('follows the octave policy', () => {
		const up = [...held(72, 0, 0.25), ...held(74, 0.25, 0.5), ...held(76, 0.5, 1.0)];
		expect(frameCoverage(up, line, TEMPO, 0.5, 0, true).precision).toBeGreaterThan(0.97);
		expect(frameCoverage(up, line, TEMPO, 0.5, 0, false).precision).toBeLessThan(0.05);
	});

	it('ignores readings before the line and after its window, and reports empty takes honestly', () => {
		const readings = [...held(55, -1.0, -0.5), ...held(60, 0, 0.25), ...held(62, 0.25, 0.5), ...held(64, 0.5, 1.0), ...held(55, 3.0, 3.5)];
		const c = frameCoverage(readings, line, TEMPO, 0.5, 0, false);
		expect(c.precision).toBeGreaterThan(0.97);
		const none = frameCoverage([], line, TEMPO, 0.5, 0, false);
		expect(none.precision).toBe(0);
		expect(none.recall).toBe(0);
		expect(none.soundedFrames).toBe(0);
	});
});
