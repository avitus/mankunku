import { describe, it, expect } from 'vitest';
import { mergeWholeNoteOctaveUpLocks } from '$lib/audio/note-segmenter';
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
