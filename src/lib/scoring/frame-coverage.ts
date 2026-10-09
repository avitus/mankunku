/**
 * The audio check: a frame-level reading of a take against the written line,
 * computed from the pitch detector's own readings — no segmentation, no
 * pairing. Shown beside the score, never a grade.
 *
 *   precision — of the frames that sounded inside the line's window, the
 *               share whose pitch was the note written for that moment.
 *               Extras, wrong notes and fumbles lower it; it is what the note
 *               score cannot see, since that score averages over the written
 *               notes only (see `extras.ts` for what it charges now).
 *   recall    — of the written notes, weighted by notated length, the share
 *               that sounded at their pitch for at least a few frames inside
 *               their slot. A missed or wrong note lowers it; a note released
 *               early does not (a held note's length never costs, Andy,
 *               2026-10-07).
 *
 * Why it exists (research/audio-scoring/REPORT.md, 2026-10-07): the note
 * score is a recall measure and pairs notes, so it is blind to extras and one
 * false note can re-pair its neighbours; a frame measure never pairs. On the
 * recorded-take corpus and 378 Firefox takes it ranked with what was actually
 * played at 0.6–0.8, read the two inflated Wail takes at 0.52 / 0.74
 * precision against >= 0.86 on clean takes, and caught a production take the
 * pairing cascade had saved as 3 of 9 with eight notes audible. The two
 * measures disagree exactly where one of them is wrong, which is the point
 * of showing both.
 */

import type { Note } from '$lib/types/music';
import type { PitchReading } from '$lib/audio/pitch-frame';
import { fractionToFloat } from '$lib/music/intervals';
import { applySwingToBeats } from '$lib/music/swing';

export interface AudioCheck {
	/** Share of sounded frames inside the line's window that were the written pitch. */
	precision: number;
	/** Length-weighted share of written notes that sounded at their pitch in their slot. */
	recall: number;
	/** Readings inside the window that precision was read over. */
	soundedFrames: number;
	/** Written notes the recall was read over. */
	expectedNotes: number;
}

/** A reading is the written note when within this many semitones of it (nearest-semitone rule). */
export const AUDIO_CHECK_TOLERANCE_SEMITONES = 0.5;
/** A note's own pitch still sounding this long after its notated end is its release, not an extra. */
export const AUDIO_CHECK_RELEASE_SECONDS = 0.12;
/** Readings this far before the first note are still the take (a slightly early entry). */
const WINDOW_LEAD_SECONDS = 0.25;
/** Readings up to one beat after the line are still the take (the window closes a beat after it). */
const WINDOW_TAIL_BEATS = 1;
/** A note counts as sounded once this many of its frames carried its pitch. */
const MIN_COVER_FRAMES = 3;

interface Slot {
	pitch: number;
	start: number;
	end: number;
	weight: number;
}

/**
 * The line's pitched notes as time slots on the phrase clock (seconds, swing
 * applied to onsets), each weighted by its written length. Rests are skipped.
 */
function slots(expected: Note[], tempo: number, swing: number): Slot[] {
	const beat = 60 / tempo;
	const out: Slot[] = [];
	for (const n of expected) {
		if (n.pitch === null) continue;
		const start = applySwingToBeats(fractionToFloat(n.offset) * 4, swing) * beat;
		const length = fractionToFloat(n.duration) * 4 * beat;
		out.push({ pitch: n.pitch, start, end: start + length, weight: length });
	}
	return out;
}

/**
 * Whether a fractional-MIDI reading is the slot's pitch: within
 * AUDIO_CHECK_TOLERANCE_SEMITONES, after folding the difference into ±6
 * semitones when the session ignores octaves.
 */
function pitchMatchesSlot(midiFloat: number, pitch: number, octaveInsensitive: boolean): boolean {
	let diff = midiFloat - pitch;
	if (octaveInsensitive) diff = ((((diff + 6) % 12) + 12) % 12) - 6;
	return Math.abs(diff) <= AUDIO_CHECK_TOLERANCE_SEMITONES;
}

/**
 * @param readings - the detector's confident readings on the recording clock
 * @param expected - the line's sounding notes (rests are ignored)
 * @param lagSeconds - where phrase offset 0 sits on the recording clock: the
 *   scorer's latency correction, or the window's bar line
 * @param octaveInsensitive - the scorer's octave policy for this session
 */
export function frameCoverage(
	readings: PitchReading[],
	expected: Note[],
	tempo: number,
	swing: number,
	lagSeconds: number,
	octaveInsensitive: boolean
): AudioCheck {
	const line = slots(expected, tempo, swing);
	if (line.length === 0) return { precision: 0, recall: 0, soundedFrames: 0, expectedNotes: 0 };
	const beat = 60 / tempo;
	const windowStart = Math.min(...line.map((s) => s.start)) - WINDOW_LEAD_SECONDS;
	const windowEnd = Math.max(...line.map((s) => s.end)) + WINDOW_TAIL_BEATS * beat;

	let sounded = 0;
	let matched = 0;
	const covered = new Array<number>(line.length).fill(0);
	for (const r of readings) {
		const t = r.time - lagSeconds;
		if (t < windowStart || t > windowEnd) continue;
		sounded++;
		let hit = false;
		for (let i = 0; i < line.length; i++) {
			const s = line[i];
			if (t < s.start || t > s.end + AUDIO_CHECK_RELEASE_SECONDS) continue;
			if (!pitchMatchesSlot(r.midiFloat, s.pitch, octaveInsensitive)) continue;
			hit = true;
			if (t <= s.end) covered[i]++;
		}
		if (hit) matched++;
	}
	const totalWeight = line.reduce((a, s) => a + s.weight, 0);
	const coveredWeight = line.reduce((a, s, i) => a + (covered[i] >= MIN_COVER_FRAMES ? s.weight : 0), 0);
	return {
		precision: sounded > 0 ? matched / sounded : 0,
		recall: totalWeight > 0 ? coveredWeight / totalWeight : 0,
		soundedFrames: sounded,
		expectedNotes: line.length
	};
}
