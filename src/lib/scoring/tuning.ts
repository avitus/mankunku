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
const WINDOW_TAKES = 5;
const MIN_TAKES = 3;
const MIN_NOTES_PER_TAKE = 2;
const MIN_PITCH_CLASSES = 3;
const MIN_CLARITY = 0.9;
const MIN_DURATION = 0.12;
/** The offset the sharp/flat cue speaks at; the per-note panel's full colour. */
export const ALERT_CENTS = 15;
const AGREEMENT_CENTS = 10;
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

/** Find a directional offset, rejecting scattered intonation and isolated bends. */
function consistentOffset(cents: number[]): number | null {
	if (cents.length === 0) return null;
	const center = median(cents);
	if (Math.abs(center) < ALERT_CENTS) return null;
	const sign = Math.sign(center);
	const agreement = cents.filter(c => c * sign >= AGREEMENT_CENTS).length / cents.length;
	const spread = median(cents.map(c => Math.abs(c - center)));
	return agreement >= MIN_AGREEMENT && spread <= MAX_MEDIAN_SPREAD ? center : null;
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
			// Clear immediately when the latest take no longer supports the cue,
			// including silence/uncertain input, rather than showing stale advice.
			if (current.length < MIN_NOTES_PER_TAKE) return null;
			const latestOffset = consistentOffset(current.map(s => s.cents));
			if (latestOffset === null) return null;
			const reliableTakes = takes.filter(t => t.length >= MIN_NOTES_PER_TAKE);
			if (reliableTakes.length < MIN_TAKES) return null;
			// Each take gets a vote too: a long phrase must not manufacture a
			// pattern across several takes by outnumbering two short, in-tune ones.
			const agreeingTakes = reliableTakes.filter(t => {
				const offset = consistentOffset(t.map(s => s.cents));
				return offset !== null && Math.sign(offset) === Math.sign(latestOffset);
			}).length;
			if (agreeingTakes < MIN_TAKES || agreeingTakes / reliableTakes.length < MIN_AGREEMENT) return null;
			const samples = reliableTakes.flat();
			const byPitch = new Map<number, number[]>();
			for (const sample of samples) {
				const values = byPitch.get(sample.pitchClass) ?? [];
				values.push(sample.cents);
				byPitch.set(sample.pitchClass, values);
			}
			if (byPitch.size < MIN_PITCH_CLASSES) return null;
			const noteOffset = consistentOffset(samples.map(s => s.cents));
			const pitchOffset = consistentOffset([...byPitch.values()].map(median));
			if (noteOffset === null || pitchOffset === null ||
				Math.sign(noteOffset) !== Math.sign(latestOffset) ||
				Math.sign(pitchOffset) !== Math.sign(latestOffset)) return null;
			return { direction: pitchOffset > 0 ? 'sharp' : 'flat', cents: Math.round(pitchOffset) };
		}
	};
}
