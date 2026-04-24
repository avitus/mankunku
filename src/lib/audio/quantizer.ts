/**
 * Rhythmic quantization: converts DetectedNote[] to Note[] with Fraction offsets/durations.
 *
 * Uses a 1/48 whole-note grid (LCM of 4, 8, 16, 6, 12, 24) to support both
 * straight and triplet subdivisions. Disambiguates swing vs. straight by
 * trying multiple grids and picking the one with lowest total snap error.
 */

import type { DetectedNote } from '$lib/types/audio';
import type { Note, Fraction, PitchClass } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import { gcd } from '$lib/music/intervals';

/** Grid resolution: 48 ticks per whole note */
const GRID = 48;

/** Maximum bars to allow */
const MAX_BARS = 8;

/** Simplify a fraction using GCD */
function simplify(num: number, den: number): Fraction {
	if (num === 0) return [0, 1];
	const g = gcd(Math.abs(num), Math.abs(den));
	return [num / g, den / g];
}

/** Snap a time (in seconds) to a grid of given subdivision */
function snapToGrid(timeSec: number, wholeNoteSec: number, gridSize: number): number {
	return Math.round((timeSec / wholeNoteSec) * gridSize);
}

/** Total snap error for a set of notes against a grid */
function gridError(detected: DetectedNote[], wholeNoteSec: number, gridSize: number): number {
	let totalError = 0;
	for (const note of detected) {
		const exact = (note.onsetTime / wholeNoteSec) * gridSize;
		const snapped = Math.round(exact);
		totalError += Math.abs(exact - snapped);
	}
	return totalError;
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

	const wholeNoteSec = 240 / tempo;
	const beatsPerBar = timeSignature[0];
	const beatUnit = timeSignature[1];
	// Whole notes per bar: e.g. 4/4 = 1, 3/4 = 0.75
	const wholeNotesPerBar = beatsPerBar / beatUnit;
	const maxGridPos = MAX_BARS * GRID * wholeNotesPerBar;

	// Disambiguate: try straight (1/16 = grid 12), triplet (1/12 = grid 16), combined (grid 48)
	const grids = [
		{ size: 12, label: 'straight-16' },
		{ size: 16, label: 'triplet-12' },
		{ size: GRID, label: 'combined' }
	];

	let bestGrid = GRID;
	let bestError = Infinity;
	for (const g of grids) {
		const err = gridError(detected, wholeNoteSec, g.size);
		if (err < bestError) {
			bestError = err;
			bestGrid = g.size;
		}
	}

	// Snap all onsets to the best grid, then convert to 1/48 space
	const scaleFactor = GRID / bestGrid;
	const gridPositions: number[] = detected.map((note) => {
		const pos = snapToGrid(note.onsetTime, wholeNoteSec, bestGrid) * scaleFactor;
		return Math.max(0, Math.min(pos, maxGridPos));
	});

	// Clamp first note to 0
	if (gridPositions.length > 0 && gridPositions[0] < 0) {
		gridPositions[0] = 0;
	}

	const notes: Note[] = [];

	for (let i = 0; i < detected.length; i++) {
		const gridPos = gridPositions[i];

		// Duration: distance to next note's grid position, or snap the detected duration
		let gridDuration: number;
		if (i < detected.length - 1) {
			gridDuration = gridPositions[i + 1] - gridPos;
		} else {
			// Last note: snap detected duration to grid
			gridDuration = Math.max(1,
				Math.round((detected[i].duration / wholeNoteSec) * bestGrid) * scaleFactor
			);
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
