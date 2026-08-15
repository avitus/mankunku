/**
 * Rhythmic quantization: converts DetectedNote[] to Note[] with Fraction
 * offsets/durations.
 *
 * Jazz-aware by design: swung eighths are WRITTEN straight, so a lone upbeat
 * landing anywhere in the swing range (straight 0.5 through MAX_SWING, which
 * includes the 2/3 "triplet swing" point) is notated as a straight off-beat
 * eighth. What distinguishes a genuine triplet from a swung pair is never the
 * upbeat itself — it is the onset PATTERN of the beat: only a triplet figure
 * puts a note near the 1/3 point, because no swing feel ever places an upbeat
 * that early. Classification is therefore per beat, not per take, so a bar can
 * mix swung eighths with a real triplet.
 *
 * The output vocabulary per quarter-note beat is {0, 1/3, 1/2, 2/3} on a
 * 48-ticks-per-whole-note grid. Deliberately absent, per how the feature is
 * used (a player recording their own jazz lick over a click):
 * - Sixteenths and finer. A played sixteenth degrades to the nearest allowed
 *   position rather than producing garbage.
 * - Pickup notes ahead of the entrance downbeat: anything surviving the
 *   capture's rebase tolerance clamps to beat 0.
 * The swing-eighth logic assumes a quarter-note beat; the only production
 * caller records in 4/4. The time signature affects only the 8-bar cap.
 */

import type { DetectedNote } from '$lib/types/audio';
import type { Note, Fraction, PitchClass } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import { gcd } from '$lib/music/intervals';
import { MAX_SWING } from '$lib/music/swing';

/** Grid resolution: 48 ticks per whole note */
const GRID = 48;

/** Maximum bars to allow */
const MAX_BARS = 8;

const BEAT_TICKS = 12;
const EIGHTH_TICKS = 6;
const TRIPLET_EIGHTH_TICKS = 4;

/**
 * Beat-fraction zone boundaries — nearest-neighbour midpoints of the allowed
 * vocabulary, except the last, which is a musical judgment: an upbeat heavier
 * than MAX_SWING (plus jitter) is more plausibly a rushed next downbeat than
 * a swing feel the settings knob cannot even express.
 */
const DOWNBEAT_MAX_FRAC = 1 / 6; // midpoint(0, 1/3)
const TRIPLET_MID_MAX_FRAC = 5 / 12; // midpoint(1/3, 1/2)
const TRIPLET_LAST_MIN_FRAC = 7 / 12; // midpoint(1/2, 2/3)
const OFFBEAT_MAX_FRAC = MAX_SWING + 0.05;

type OnsetKind = 'down' | 'trip1' | 'offbeat';

interface LabeledOnset {
	/** Beat the onset counts toward (a ≥ OFFBEAT_MAX_FRAC onset targets k+1). */
	beat: number;
	kind: OnsetKind;
	/** Fraction within the ORIGINAL beat; meaningful for 'offbeat' only. */
	frac: number;
}

/** Simplify a fraction using GCD */
function simplify(num: number, den: number): Fraction {
	if (num === 0) return [0, 1];
	const g = gcd(Math.abs(num), Math.abs(den));
	return [num / g, den / g];
}

function labelOnset(onsetTime: number, beatSec: number): LabeledOnset {
	const exactBeat = onsetTime / beatSec;
	const k = Math.floor(exactBeat);
	const frac = exactBeat - k;

	if (frac < DOWNBEAT_MAX_FRAC) return { beat: k, kind: 'down', frac };
	if (frac < TRIPLET_MID_MAX_FRAC) return { beat: k, kind: 'trip1', frac };
	if (frac < OFFBEAT_MAX_FRAC) return { beat: k, kind: 'offbeat', frac };
	return { beat: k + 1, kind: 'down', frac };
}

/**
 * Decide which beats are triplet beats. A beat is a triplet beat iff:
 * 1. it contains a trip1 onset — only triplet figures (full, or with the
 *    first note tied/rested) put anything near 1/3; or
 * 2. its upbeat sits in the 2/3 sub-window AND the NEXT beat is a triplet
 *    beat with no downbeat onset of its own — the quarter-note-triplet
 *    continuation (onsets at 0, 2/3, 4/3 …), which is why the walk runs
 *    right to left.
 */
function classifyTripletBeats(onsets: LabeledOnset[]): Set<number> {
	const hasTrip1 = new Set<number>();
	const hasDown = new Set<number>();
	const lateOffbeat = new Set<number>();
	for (const o of onsets) {
		if (o.kind === 'trip1') hasTrip1.add(o.beat);
		if (o.kind === 'down') hasDown.add(o.beat);
		if (o.kind === 'offbeat' && o.frac >= TRIPLET_LAST_MIN_FRAC) lateOffbeat.add(o.beat);
	}

	const tripletBeats = new Set<number>(hasTrip1);
	const beatsDesc = [...new Set(onsets.map((o) => o.beat))].sort((a, b) => b - a);
	for (const k of beatsDesc) {
		if (tripletBeats.has(k)) continue;
		if (lateOffbeat.has(k) && tripletBeats.has(k + 1) && !hasDown.has(k + 1)) {
			tripletBeats.add(k);
		}
	}
	return tripletBeats;
}

function onsetTick(o: LabeledOnset, tripletBeats: Set<number>): number {
	if (o.kind === 'down') return o.beat * BEAT_TICKS;
	if (o.kind === 'trip1') return o.beat * BEAT_TICKS + TRIPLET_EIGHTH_TICKS;
	if (tripletBeats.has(o.beat)) {
		// On a triplet beat the ambiguity resolves to the triplet grid.
		return o.beat * BEAT_TICKS + (o.frac < 0.5 ? TRIPLET_EIGHTH_TICKS : 2 * TRIPLET_EIGHTH_TICKS);
	}
	// The swung-pair collapse: 0.5 through MAX_SWING all notate straight.
	return o.beat * BEAT_TICKS + EIGHTH_TICKS;
}

/**
 * Convert detected notes into quantized Note[] with Fraction offsets and durations.
 *
 * @param detected - Notes from segmentNotes() with onset times in seconds
 * @param tempo - BPM
 * @param timeSignature - e.g. [4, 4]
 * @returns Quantized notes with fraction-based offsets and durations
 */
export function quantizeNotes(
	detected: DetectedNote[],
	tempo: number,
	timeSignature: [number, number]
): Note[] {
	if (detected.length === 0) return [];

	const beatSec = 60 / tempo;
	const beatsPerBar = timeSignature[0];
	const beatUnit = timeSignature[1];
	// Whole notes per bar: e.g. 4/4 = 1, 3/4 = 0.75
	const wholeNotesPerBar = beatsPerBar / beatUnit;
	const maxGridPos = MAX_BARS * GRID * wholeNotesPerBar;

	const labeled = detected.map((n) => labelOnset(n.onsetTime, beatSec));
	const tripletBeats = classifyTripletBeats(labeled);

	// Out-of-scope input (e.g. two sixteenths inside one zone) can collide on
	// one position; the zero-duration skip below then drops the earlier note.
	const gridPositions: number[] = labeled.map((o) =>
		Math.max(0, Math.min(onsetTick(o, tripletBeats), maxGridPos))
	);

	const notes: Note[] = [];

	for (let i = 0; i < detected.length; i++) {
		const gridPos = gridPositions[i];

		// Duration: distance to next note's grid position, or snap the detected duration
		let gridDuration: number;
		if (i < detected.length - 1) {
			gridDuration = gridPositions[i + 1] - gridPos;
		} else {
			// Last note: round the detected duration to its beat's own unit, so
			// a short swung final note still reads as a full eighth rather than
			// leaking sub-vocabulary ticks like 1/48.
			const unit = tripletBeats.has(labeled[i].beat) ? TRIPLET_EIGHTH_TICKS : EIGHTH_TICKS;
			const durTicks = (detected[i].duration / beatSec) * BEAT_TICKS;
			gridDuration = Math.max(unit, Math.round(durTicks / unit) * unit);
		}

		// Skip zero-duration notes
		if (gridDuration <= 0) continue;

		// Cap at max position
		if (gridPos >= maxGridPos) continue;
		if (gridPos + gridDuration > maxGridPos) {
			gridDuration = maxGridPos - gridPos;
		}

		// Check for rest: gap between previous note end and this note's onset
		if (i > 0) {
			const prevEnd = gridPositions[i - 1] + (notes.length > 0
				? notes[notes.length - 1].duration[0] * (GRID / notes[notes.length - 1].duration[1])
				: 0);
			const gap = gridPos - prevEnd;
			// Insert rest if gap > 1.5 grid ticks
			if (gap > 1.5) {
				const restOffset = simplify(Math.round(prevEnd), GRID);
				const restDuration = simplify(Math.round(gap), GRID);
				notes.push({
					pitch: null,
					offset: restOffset,
					duration: restDuration
				});
			}
		}

		notes.push({
			pitch: detected[i].midi,
			offset: simplify(gridPos, GRID),
			duration: simplify(gridDuration, GRID)
		});
	}

	return notes;
}

/**
 * Detect the key of a set of detected notes using pitch-class histogram.
 * Returns the most frequent pitch class.
 */
export function detectKey(detected: DetectedNote[]): PitchClass {
	if (detected.length === 0) return 'C';

	const histogram = new Array(12).fill(0);
	for (const note of detected) {
		const pc = ((note.midi % 12) + 12) % 12;
		histogram[pc]++;
	}

	let maxCount = 0;
	let maxPC = 0;
	for (let i = 0; i < 12; i++) {
		if (histogram[i] > maxCount) {
			maxCount = histogram[i];
			maxPC = i;
		}
	}

	return PITCH_CLASSES[maxPC];
}
