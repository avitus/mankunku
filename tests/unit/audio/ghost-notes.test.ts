import { describe, it, expect } from 'vitest';
import { findGhostNotes, segmentNotes } from '$lib/audio/note-segmenter';
import type { PitchReading } from '$lib/audio/pitch-frame';

/**
 * Ghost-note recovery: a softly ghosted note between two confident ones
 * leaves a HOLE in the accepted readings (McLeod clarity 0.54–0.76 on the
 * 2026-09-16 "sharp-9-flat-9-dom" take), but the detector's sub-threshold
 * "weak" frames inside that hole still hold its pitch.
 */

const HOP = 1 / 60;

/** Frequency of a fractional MIDI pitch. */
function hz(midiFloat: number): number {
	return 440 * Math.pow(2, (midiFloat - 69) / 12);
}

/** Confident readings of `midi` from `from` (inclusive) to `to` (exclusive). */
function held(midi: number, from: number, to: number, rms = 0.09): PitchReading[] {
	const out: PitchReading[] = [];
	for (let t = from; t < to - 1e-9; t += HOP) {
		out.push({
			midiFloat: midi,
			midi,
			cents: 0,
			clarity: 0.98,
			time: t,
			frequency: hz(midi),
			rms
		});
	}
	return out;
}

/** Sub-threshold frames, one per entry, starting at `from`, one hop apart. */
function weak(midiFloats: number[], from: number, rms = 0.03, clarity = 0.65): PitchReading[] {
	return midiFloats.map((m, i) => {
		const midi = Math.round(m);
		return {
			midiFloat: m,
			midi,
			cents: Math.round((m - midi) * 100),
			clarity,
			time: from + i * HOP,
			frequency: hz(m),
			rms,
			weak: true
		};
	});
}

describe('findGhostNotes', () => {
	it('recovers a ghosted C between two Ds from the weak frames in the hole', () => {
		const readings = [...held(62, 0, 0.3), ...held(62, 0.45, 0.8)];
		const ghosts = findGhostNotes(readings, weak([60.3, 60.35, 60.25, 60.3], 0.33));
		expect(ghosts).toHaveLength(1);
		expect(ghosts[0].midi).toBe(60);
		expect(ghosts[0].cents).toBe(30);
		expect(ghosts[0].ghost).toBe(true);
		expect(ghosts[0].onsetTime).toBeCloseTo(0.33, 5);
		// The ghost lasts until the note after it is heard again.
		expect(ghosts[0].onsetTime + ghosts[0].duration).toBeCloseTo(readings[18].time, 5);
	});

	it('keeps an ambiguous ghost pitch as measured (half a semitone sharp)', () => {
		const readings = [...held(62, 0, 0.3), ...held(62, 0.45, 0.8)];
		const [ghost] = findGhostNotes(readings, weak([60.6, 60.62, 60.65, 60.68], 0.33));
		expect(ghost.midi + ghost.cents / 100).toBeCloseTo(60.63, 1);
	});

	it('finds nothing without weak frames', () => {
		const readings = [...held(62, 0, 0.3), ...held(62, 0.45, 0.8)];
		expect(findGhostNotes(readings, [])).toEqual([]);
	});

	it('ignores a decay glide that stays within three quarters of a semitone of the note', () => {
		const readings = [...held(62, 0, 0.3), ...held(62, 0.45, 0.8)];
		expect(findGhostNotes(readings, weak([61.5, 61.45, 61.4, 61.4], 0.33))).toEqual([]);
	});

	it('ignores the next note heard early: a plateau on the pitch that follows the hole', () => {
		const readings = [...held(62, 0, 0.3), ...held(59, 0.45, 0.8)];
		expect(findGhostNotes(readings, weak([59.2, 59.1, 59.15, 59.1], 0.33))).toEqual([]);
	});

	it('needs three plateau frames', () => {
		const readings = [...held(62, 0, 0.3), ...held(62, 0.45, 0.8)];
		expect(findGhostNotes(readings, weak([60.3, 60.3], 0.35))).toEqual([]);
	});

	it('needs the plateau frames to be consecutive, not scattered through the hole', () => {
		const readings = [...held(62, 0, 0.3), ...held(62, 0.5, 0.8)];
		const scattered = [
			...weak([60.3], 0.32),
			...weak([60.3], 0.38),
			...weak([60.3], 0.44)
		];
		expect(findGhostNotes(readings, scattered)).toEqual([]);
	});

	it('does not let a stray early frame lead the plateau across a gap (onset is where the run starts)', () => {
		// One weak frame at 0.31 s, then a 70 ms gap, then three consecutive
		// frames from 0.38 s. The first window's leading gap was never checked
		// (only the newest gap was), so the plateau began at 0.31 s and the ghost
		// carved 70 ms it never sounded out of the D before it.
		const readings = [...held(62, 0, 0.3), ...held(62, 0.45, 0.8)];
		const stray = [...weak([60.3], 0.31), ...weak([60.3, 60.35, 60.25], 0.38)];
		const ghosts = findGhostNotes(readings, stray);
		expect(ghosts).toHaveLength(1);
		expect(ghosts[0].onsetTime).toBeCloseTo(0.38, 6);
	});

	it('needs the plateau frames to agree on a pitch', () => {
		const readings = [...held(62, 0, 0.3), ...held(62, 0.45, 0.8)];
		expect(findGhostNotes(readings, weak([60.0, 60.9, 59.9, 60.8], 0.33))).toEqual([]);
	});

	it('ignores a hole too long to be a ghosted note (a rest)', () => {
		const readings = [...held(62, 0, 0.3), ...held(62, 0.9, 1.2)];
		expect(findGhostNotes(readings, weak([60.3, 60.3, 60.3, 60.3], 0.4))).toEqual([]);
	});

	it('ignores a hole too short to hold a note', () => {
		const readings = [...held(62, 0, 0.3), ...held(62, 0.35, 0.8)];
		expect(findGhostNotes(readings, weak([60.3, 60.3, 60.3], 0.3))).toEqual([]);
	});

	it('ignores a plateau 20 dB or more under the notes around it (a click ring, not a note)', () => {
		const readings = [...held(62, 0, 0.3), ...held(62, 0.45, 0.8)];
		expect(findGhostNotes(readings, weak([60.3, 60.3, 60.3, 60.3], 0.33, 0.008))).toEqual([]);
	});

	it('folds a subharmonic pick into the register of the line', () => {
		// 133 Hz is the doubled period of a 266 Hz ghost.
		const readings = [...held(62, 0, 0.3), ...held(62, 0.45, 0.8)];
		const [ghost] = findGhostNotes(readings, weak([48.3, 60.3, 60.25, 48.35], 0.33));
		expect(ghost.midi).toBe(60);
	});

	it('absorbs a confident frame of its own pitch after the hole and ends at the next note', () => {
		// 2026-09-16 third ghost: one of its frames cleared the threshold, so the
		// first reading after the hole was the ghost itself, not the B after it.
		const readings = [
			...held(62, 0, 0.3),
			...held(60, 0.45, 0.46),
			...held(59, 0.45 + HOP, 0.8)
		];
		const [ghost] = findGhostNotes(readings, weak([60.4, 60.45, 60.35], 0.33));
		expect(ghost).toBeDefined();
		expect(ghost.midi).toBe(60);
		expect(ghost.onsetTime + ghost.duration).toBeCloseTo(0.45 + HOP, 5);
	});

	it('does not absorb a run of confident frames — that is the next note itself', () => {
		const readings = [...held(62, 0, 0.3), ...held(60, 0.45, 0.8)];
		expect(findGhostNotes(readings, weak([60.4, 60.45, 60.35], 0.33))).toEqual([]);
	});
});

describe('segmentNotes with weak readings', () => {
	const readings = [...held(62, 0, 0.3), ...held(62, 0.45, 0.8)];
	const ghostFrames = weak([60.3, 60.35, 60.25, 60.3], 0.33);

	it('splits the D around the ghosted C', () => {
		const notes = segmentNotes(readings, [0], 0.8, undefined, undefined, undefined, [0], undefined, undefined, ghostFrames);
		expect(notes.map((n) => n.midi)).toEqual([62, 60, 62]);
		expect(notes[1].ghost).toBe(true);
		expect(notes[0].ghost).toBeUndefined();
		expect(notes[0].onsetTime + notes[0].duration).toBeCloseTo(notes[1].onsetTime, 5);
		expect(notes[1].onsetTime + notes[1].duration).toBeCloseTo(notes[2].onsetTime, 5);
		expect(notes[2].onsetTime + notes[2].duration).toBeCloseTo(0.8, 5);
	});

	it('is unchanged when the caller passes no weak readings', () => {
		const notes = segmentNotes(readings, [0], 0.8, undefined, undefined, undefined, [0]);
		expect(notes.map((n) => n.midi)).toEqual([62]);
	});

	it('carves the ghost out of the notes on both sides of a boundary inside the hole', () => {
		// An articulation onset inside the hole already split the D: the ghost
		// takes the end of the first D and the start of the second.
		const notes = segmentNotes(readings, [0, 0.4], 0.8, undefined, undefined, undefined, [0], undefined, [0.4], ghostFrames);
		expect(notes.map((n) => n.midi)).toEqual([62, 60, 62]);
		expect(notes[1].onsetTime).toBeCloseTo(0.33, 5);
		expect(notes[2].onsetTime).toBeCloseTo(0.45, 2);
	});
});
