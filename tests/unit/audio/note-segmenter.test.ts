import { describe, it, expect } from 'vitest';
import { findReArticulations, mergeWholeNoteOctaveUpLocks } from '$lib/audio/note-segmenter';
import type { DetectedNote } from '$lib/types/audio';
import type { PitchReading } from '$lib/audio/pitch-frame';

function note(midi: number, onsetTime: number, duration: number): DetectedNote {
	return { midi, cents: 0, onsetTime, duration, clarity: 0.95 };
}

function reading(
	midi: number,
	time: number,
	opts: { octaveUp?: boolean; warmup?: boolean } = {}
): PitchReading {
	const r: PitchReading = { midiFloat: midi, midi, cents: 0, clarity: 0.95, time, frequency: 440, rms: 0.1 };
	if (opts.octaveUp) r.octaveUp = true;
	if (opts.warmup) r.warmup = true;
	return r;
}

/** N evenly-spaced readings inside [0,1). */
function frames(specs: Array<{ midi: number; octaveUp?: boolean; warmup?: boolean }>): PitchReading[] {
	return specs.map((s, i) => reading(s.midi, 0.1 + i * 0.05, s));
}

describe('mergeWholeNoteOctaveUpLocks', () => {
	it('drops a whole-note 2nd-harmonic lock an octave (majority of frames flagged)', () => {
		const notes = [note(64, 0, 1)]; // detected E4, actually a locked E3
		const readings = frames([
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true }
		]);
		expect(mergeWholeNoteOctaveUpLocks(notes, readings)[0].midi).toBe(52);
	});

	it('does NOT drop a note an earlier pass already lowered, even if it still holds flagged higher-octave frames', () => {
		// The C1 regression: mergeOctaveBoundariesWithoutAttack merged an E4 lock
		// segment (5 frames, midi 64, flagged) with a true-fundamental E3 segment
		// (2 frames, midi 52) into ONE note voted E3 (52). The flagged E4 frames are
		// a 5/7 majority — without the r.midi === note.midi guard this note would be
		// dropped a SECOND octave to E2 (40).
		const notes = [note(52, 0, 1)];
		const readings = frames([
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 52 },
			{ midi: 52 }
		]);
		expect(mergeWholeNoteOctaveUpLocks(notes, readings)[0].midi).toBe(52);
	});

	it('leaves a genuine note (no flagged frames) untouched', () => {
		const notes = [note(62, 0, 1)];
		const readings = frames([{ midi: 62 }, { midi: 62 }, { midi: 62 }, { midi: 62 }]);
		expect(mergeWholeNoteOctaveUpLocks(notes, readings)[0].midi).toBe(62);
	});

	it('does not judge a note with fewer than the minimum confident frames', () => {
		const notes = [note(64, 0, 1)];
		const readings = frames([{ midi: 64, octaveUp: true }, { midi: 64, octaveUp: true }]);
		expect(mergeWholeNoteOctaveUpLocks(notes, readings)[0].midi).toBe(64);
	});

	it('keeps a note whose flagged fraction is below the majority threshold', () => {
		const notes = [note(64, 0, 1)];
		const readings = frames([
			{ midi: 64, octaveUp: true },
			{ midi: 64, octaveUp: true },
			{ midi: 64 },
			{ midi: 64 },
			{ midi: 64 }
		]); // 2/5 = 0.4 < 0.6
		expect(mergeWholeNoteOctaveUpLocks(notes, readings)[0].midi).toBe(64);
	});

	it('excludes warmup frames — flagged warmup readings do not drive a drop', () => {
		const notes = [note(64, 0, 1)];
		const readings = frames([
			{ midi: 64 },
			{ midi: 64 },
			{ midi: 64 },
			{ midi: 64, octaveUp: true, warmup: true },
			{ midi: 64, octaveUp: true, warmup: true },
			{ midi: 64, octaveUp: true, warmup: true }
		]); // 3 confident (unflagged) + 3 flagged-but-warmup → 0/3 flagged
		expect(mergeWholeNoteOctaveUpLocks(notes, readings)[0].midi).toBe(64);
	});
});

/**
 * Waveform-shape ("reed reset") re-articulation tier — see the SHAPE_* block
 * comment in note-segmenter.ts. These pin the gates directly, so a future
 * change to a threshold fails here with a named reason rather than only as a
 * note-count diff in a WAV fixture.
 */
describe('findReArticulations: waveform-shape tier', () => {
	/** A steady same-MIDI run at 60 fps, optionally broken at one reading. */
	function shapeRun(opts: {
		breakIndex?: number;
		breakValue?: number;
		baseline?: number;
		rmsAfter?: number;
		frames?: number;
		/**
		 * Positive for replay's window-START anchor, negative for the live
		 * path's window-END anchor (offset − fftSize/sampleRate). Both are
		 * exercised: the gates must not depend on which one produced them.
		 */
		shapeBreakAt?: number;
	}): PitchReading[] {
		const baseline = opts.baseline ?? 0.99;
		const shapeBreakAt = opts.shapeBreakAt ?? 0.045;
		const frames = opts.frames ?? 45; // 0.75 s — comfortably past the settle gate
		const out: PitchReading[] = [];
		for (let i = 0; i < frames; i++) {
			const broken = i === opts.breakIndex;
			out.push({
				midiFloat: 55,
				midi: 55,
				cents: 0,
				clarity: 0.98,
				time: 0.1 + i * (1 / 60),
				frequency: 196,
				rms: opts.breakIndex != null && i > opts.breakIndex ? (opts.rmsAfter ?? 0.12) : 0.1,
				hfRms: 0.008,
				rmsMin: 0.095,
				shapeBreak: broken ? (opts.breakValue ?? 0.955) : baseline,
				shapeBreakAt
			});
		}
		return out;
	}

	it('splits a shallow break on a clean run — the legato-tongue signature', () => {
		const onsets = findReArticulations(shapeRun({ breakIndex: 30 }), []);
		expect(onsets).toHaveLength(1);
		// Anchored at the measured discontinuity, not the reading grid.
		expect(onsets[0]).toBeCloseTo(0.1 + 30 / 60 + 0.045, 3);
	});

	it('does NOT split a steady run', () => {
		expect(findReArticulations(shapeRun({}), [])).toEqual([]);
	});

	it('does NOT split a DEEP break — destroyed periodicity is impulsive contamination', () => {
		// The crux of the tier. A click/thump/handling noise adds an
		// uncorrelated signal and drives similarity toward zero; a legato
		// tongue only reshapes an oscillation that never stops. Blue Monk's
		// held E reads 0.33 here and must stay one note.
		expect(findReArticulations(shapeRun({ breakIndex: 30, breakValue: 0.33 }), [])).toEqual([]);
	});

	it('does NOT split when the run is too noisy for the measure to mean anything', () => {
		// A breathy tone's own similarity floor is lower than the effect being
		// measured (the sustained-C fixture sits at 0.81).
		expect(
			findReArticulations(shapeRun({ breakIndex: 30, baseline: 0.9, breakValue: 0.88 }), [])
		).toEqual([]);
	});

	it('does NOT split while the tone is still settling after the note attack', () => {
		// A breathy attack blooms for 100-200 ms and reads as a shape break.
		expect(findReArticulations(shapeRun({ breakIndex: 6 }), [])).toEqual([]);
	});

	it('does NOT split in the wake of an onset another tier already found', () => {
		const readings = shapeRun({ breakIndex: 30 });
		const breakTime = 0.1 + 30 / 60 + 0.045;
		expect(findReArticulations(readings, [breakTime - 0.1])).toEqual([]);
	});

	it('does NOT split when energy falls across the break — that is a release', () => {
		expect(
			findReArticulations(shapeRun({ breakIndex: 30, rmsAfter: 0.08 }), [])
		).toEqual([]);
	});

	it('does NOT split inside a scheduled metronome click window', () => {
		const readings = shapeRun({ breakIndex: 30 });
		const breakTime = 0.1 + 30 / 60 + 0.045;
		expect(findReArticulations(readings, [], [breakTime - 0.05])).toEqual([]);
	});

	it('ignores readings with no shapeBreak (pre-2026-07-30 diagnostic JSON)', () => {
		const readings = shapeRun({ breakIndex: 30 }).map(({ shapeBreak, shapeBreakAt, ...r }) => {
			void shapeBreak;
			void shapeBreakAt;
			return r as PitchReading;
		});
		expect(findReArticulations(readings, [])).toEqual([]);
	});
});

/**
 * The same tier under the LIVE path's window-END anchor, where `shapeBreakAt`
 * is negative so a break's time precedes the reading that reported it. The
 * run-exit gates must not quietly become inert there — the live score is what
 * the player sees first, before the authoritative rescore.
 */
describe('findReArticulations: waveform-shape tier under the live window-end anchor', () => {
	const LIVE_ANCHOR = 0.045 - 4096 / 44100; // ≈ −0.048 s

	function liveRun(opts: {
		breakIndex?: number;
		breakValue?: number;
		frames?: number;
	}): PitchReading[] {
		const frames = opts.frames ?? 45;
		const out: PitchReading[] = [];
		for (let i = 0; i < frames; i++) {
			const broken = i === opts.breakIndex;
			out.push({
				midiFloat: 55,
				midi: 55,
				cents: 0,
				clarity: 0.98,
				time: 0.1 + i * (1 / 60),
				frequency: 196,
				rms: opts.breakIndex != null && i > opts.breakIndex ? 0.12 : 0.1,
				hfRms: 0.008,
				rmsMin: 0.095,
				shapeBreak: broken ? (opts.breakValue ?? 0.955) : 0.99,
				shapeBreakAt: LIVE_ANCHOR
			});
		}
		return out;
	}

	it('still splits a shallow mid-run break', () => {
		const onsets = findReArticulations(liveRun({ breakIndex: 30 }), []);
		expect(onsets).toHaveLength(1);
		expect(onsets[0]).toBeCloseTo(0.1 + 30 / 60 + LIVE_ANCHOR, 3);
	});

	it('does NOT split at the run exit', () => {
		// Two independent gates cover this, which is why the tier survived the
		// anchor bug the run-exit filter used to carry: the trailing-frames
		// guard (now counted by reading INDEX, so it holds under either
		// anchor — a `breakTime <= lastReadingTime` test excluded nothing here,
		// since breakTime precedes its reading) AND the energy-sustain gate,
		// which finds no readings after the break and so measures no sustain.
		// The sustain gate is what actually rejects these two cases; the index
		// guard is the structural statement of the same requirement.
		expect(findReArticulations(liveRun({ breakIndex: 44 }), [])).toEqual([]);
		expect(findReArticulations(liveRun({ breakIndex: 43 }), [])).toEqual([]);
	});

	it('still rejects a deep break', () => {
		expect(findReArticulations(liveRun({ breakIndex: 30, breakValue: 0.33 }), [])).toEqual([]);
	});
});
