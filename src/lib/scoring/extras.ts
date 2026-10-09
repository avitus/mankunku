/**
 * Which extra notes count against the score.
 *
 * The scorer is a recall measure by construction — pitch and rhythm are
 * averaged over the EXPECTED notes — so until 2026-10-07 a note the player
 * sounded that the aligner could not pair cost nothing (the docs had
 * promised the opposite since the first scorer commit). That is what let a
 * Deep Practice take with its last bar fumbled save as "great" (Wail,
 * 2026-10-06). Charging EVERY extra is not the fix either: measured over
 * 1943 production sessions and 356 lick-practice windows with their audio,
 * most extras on a perfect take are detector artefacts — slivers, a held
 * note split in two, the window-open click read as a 0.2 s pitch, a scooped
 * attack cut into three notes — and the naive rule charged those on the
 * corpus's own correct takes.
 *
 * So an extra counts as a zero in both accuracies only when it looks like a
 * note the player made:
 *   - long enough (`EXTRA_MIN_DURATION`) and confident (`EXTRA_MIN_CLARITY`),
 *     and not a ghost — the segmenter's own thresholds for a real note;
 *   - not sharing its pitch class with the detected note beside it in time
 *     (a false split of a held note, in any octave);
 *   - inside the written line: not after its end, and not more than
 *     `EXTRA_PRE_ENTRY_SECONDS` before its first note (lick-practice blobs
 *     open on a click the detector can read as a low pitch; a real pickup
 *     played just before the entry still counts);
 *   - not a short transition beside a PAIRED note within
 *     `TRANSITION_MAX_SEMITONES` — a scoop into the note or a crack off it
 *     (`TRANSITION_MAX_SECONDS`). This also frees a short chromatic slip
 *     next to a correct note, the least costly error; a longer or more
 *     distant stray is charged.
 *
 * Measured effect (research/audio-scoring/results/fix_impact.md): 255 of
 * 1943 production sessions move down a grade (39 of 809 perfect); the
 * remaining charges on takes the audio reads as clean are quarter-tone-flat
 * notes the detector read as the neighbouring semitone, which count as
 * wrong by the 2026-09-16 rule. Wail (a) 0.878 → 0.638, Wail (b) 0.934.
 */

import type { Note } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';
import { fractionToFloat, midiToPitchClass } from '$lib/music/intervals';
import { applySwingToBeats } from '$lib/music/swing';

/** Shortest extra that can count; the segmenter's own minimum for a real note. */
export const EXTRA_MIN_DURATION = 0.15;
/** Least detector clarity for an extra to count (the confident-reading threshold). */
export const EXTRA_MIN_CLARITY = 0.8;
/** An extra starting earlier than this before the line's first note is free. */
export const EXTRA_PRE_ENTRY_SECONDS = 0.1;
/** A transition (scoop, crack, slip) beside a paired note is free up to this length... */
export const TRANSITION_MAX_SECONDS = 0.25;
/** ...when it sits within this many semitones of that note. */
export const TRANSITION_MAX_SEMITONES = 2;

/** Where a written note starts on the phrase clock, in seconds, swing applied. */
function onsetSeconds(note: Note, tempo: number, swing: number): number {
	return applySwingToBeats(fractionToFloat(note.offset) * 4, swing) * (60 / tempo);
}

/**
 * Indices (into `detected`) of the extras that count, given the aligner's
 * verdict: `extraIdx` the detected notes left unpaired, `pairedIdx` those
 * paired with an expected note. `detected` onsets are on the phrase clock
 * (latency already removed), `expected` the sounding notes of the line.
 */
export function chargeableExtras(
	detected: DetectedNote[],
	extraIdx: Iterable<number>,
	pairedIdx: Set<number>,
	expected: Note[],
	tempo: number,
	swing = 0.5
): number[] {
	const pitched = expected.filter((n) => n.pitch !== null);
	if (pitched.length === 0) return [];
	const beat = 60 / tempo;
	const lineStart = Math.min(...pitched.map((n) => onsetSeconds(n, tempo, swing)));
	const lineEnd = Math.max(
		...pitched.map((n) => onsetSeconds(n, tempo, swing) + fractionToFloat(n.duration) * 4 * beat)
	);
	const byTime = detected
		.map((d, idx) => ({ d, idx }))
		.sort((a, b) => a.d.onsetTime - b.d.onsetTime);
	const position = new Map(byTime.map((x, k) => [x.idx, k]));

	const charged: number[] = [];
	for (const idx of extraIdx) {
		const d = detected[idx];
		if (d.ghost || d.duration < EXTRA_MIN_DURATION || d.clarity < EXTRA_MIN_CLARITY) continue;
		if (d.onsetTime >= lineEnd) continue;
		if (d.onsetTime < lineStart - EXTRA_PRE_ENTRY_SECONDS) continue;
		const k = position.get(idx)!;
		const neighbours = [byTime[k - 1], byTime[k + 1]].filter((n) => n !== undefined);
		if (neighbours.some((n) => midiToPitchClass(n.d.midi) === midiToPitchClass(d.midi))) continue;
		const transition =
			d.duration < TRANSITION_MAX_SECONDS &&
			neighbours.some(
				(n) => pairedIdx.has(n.idx) && Math.abs(n.d.midi - d.midi) <= TRANSITION_MAX_SEMITONES
			);
		if (transition) continue;
		charged.push(idx);
	}
	return charged;
}
