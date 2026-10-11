import type { NoteResult, Score } from '$lib/types/scoring';

export interface TuningAlert {
	direction: 'sharp' | 'flat';
	/** Signed median offset, giving each pitch class equal weight. */
	cents: number;
}

/** One clean note: the concert MIDI it was played at and its signed cents. */
export interface TuningSample {
	midi: number;
	cents: number;
}

interface PitchClassSample {
	pitchClass: number;
	cents: number;
}

// Conservative feedback policy, independent of pitch grading. A short or
// uncertain take cannot diagnose tuning; repeated notes cannot outweigh the
// rest of the scale. Keep only recent takes so an adjustment can take effect.
//
// The verdict is read off the WINDOW's pooled evidence — one median per pitch
// class, as the fader bank reads the run — never off each take alone. Take
// medians scatter about ±5 ¢ around a player's centre, so a per-take gate at
// the alert offset fails half the takes of a player centred exactly there;
// replayed over 1943 production takes the old per-take rule fired once
// (2026-10-10). Takes and the latest take only have to LEAN the same way.
const WINDOW_TAKES = 5;
const MIN_TAKES = 3;
const MIN_NOTES_PER_TAKE = 2;
const MIN_PITCH_CLASSES = 3;
const MIN_CLARITY = 0.9;
const MIN_DURATION = 0.12;
/** The offset the sharp/flat cue speaks at; the per-note panel's full colour. */
export const ALERT_CENTS = 12;
/** A take, or a pitch class, leans the cue's way when its median sits this far on that side. */
const LEAN_CENTS = 5;
const MIN_AGREEMENT = 0.8;
const MAX_MEDIAN_SPREAD = 10;

/** Median without mutating the caller's observations. Requires a nonempty list. */
function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Use only confidently matched notes, never a wrong semitone's signed cents.
 * Shared by the sharp/flat cue and the per-note panel, so both read the same
 * evidence.
 */
export function cleanTuningSamples(results: NoteResult[]): TuningSample[] {
	return results.flatMap(({ expected, detected, missed, extra }) => {
		if (missed || extra || !detected || expected.pitch === null || detected.ghost ||
			detected.midi !== expected.pitch || !Number.isInteger(detected.midi) ||
			!Number.isFinite(detected.cents) || Math.abs(detected.cents) > 50 ||
			!Number.isFinite(detected.clarity) || detected.clarity < MIN_CLARITY ||
			!Number.isFinite(detected.duration) || detected.duration < MIN_DURATION) return [];
		return [{ midi: detected.midi, cents: detected.cents }];
	});
}

/** The cue judges the scale, so octaves of one note share a vote. */
function samplesFor(results: NoteResult[]): PitchClassSample[] {
	return cleanTuningSamples(results).map(({ midi, cents }) => ({ pitchClass: ((midi % 12) + 12) % 12, cents }));
}

/**
 * Find a directional offset in the pitch-class medians, rejecting scattered
 * intonation (a 10/25/48 spread is not one tuning) and a lone bent note.
 */
function consistentOffset(cents: number[]): number | null {
	if (cents.length === 0) return null;
	const center = median(cents);
	if (Math.abs(center) < ALERT_CENTS) return null;
	const sign = Math.sign(center);
	const agreement = cents.filter(c => c * sign >= LEAN_CENTS).length / cents.length;
	const spread = median(cents.map(c => Math.abs(c - center)));
	return agreement >= MIN_AGREEMENT && spread <= MAX_MEDIAN_SPREAD ? center : null;
}

/** A take's lean: its median offset, zero for a take too short to read. */
function takeLean(take: PitchClassSample[]): number {
	return take.length >= MIN_NOTES_PER_TAKE ? median(take.map(s => s.cents)) : 0;
}

/**
 * Page-local tuning feedback from FINAL ear-training scores only. Call once per
 * completed take, after replay/fallback selection, and reset on a new run.
 * Nothing is persisted and no pitch scores or detected notes are adjusted.
 */
export function createTuningMonitor(): {
	record: (score: Pick<Score, 'noteResults'>) => TuningAlert | null;
	reset: () => void;
} {
	let takes: PitchClassSample[][] = [];
	return {
		/** Discard evidence when a new practice run or tuning context begins. */
		reset() { takes = []; },
		/** Add one final take and return a cue only while recent evidence agrees. */
		record(score) {
			const current = samplesFor(score.noteResults);
			takes = [...takes, current].slice(-WINDOW_TAKES);
			// Clear immediately when the latest take no longer leans the cue's
			// way, including silence/uncertain input, rather than showing stale
			// advice: a player who has just retuned sees it go.
			const latest = takeLean(current);
			if (Math.abs(latest) < LEAN_CENTS) return null;
			const sign = Math.sign(latest);
			const reliableTakes = takes.filter(t => t.length >= MIN_NOTES_PER_TAKE);
			if (reliableTakes.length < MIN_TAKES) return null;
			// Each take gets a vote too: a long phrase must not manufacture a
			// pattern across several takes by outnumbering two short, in-tune ones.
			const leaningTakes = reliableTakes.filter(t => takeLean(t) * sign >= LEAN_CENTS).length;
			if (leaningTakes * 2 <= reliableTakes.length) return null;
			const byPitch = new Map<number, number[]>();
			for (const sample of reliableTakes.flat()) {
				const values = byPitch.get(sample.pitchClass) ?? [];
				values.push(sample.cents);
				byPitch.set(sample.pitchClass, values);
			}
			if (byPitch.size < MIN_PITCH_CLASSES) return null;
			const pitchOffset = consistentOffset([...byPitch.values()].map(median));
			if (pitchOffset === null || Math.sign(pitchOffset) !== sign) return null;
			return { direction: pitchOffset > 0 ? 'sharp' : 'flat', cents: Math.round(pitchOffset) };
		}
	};
}
