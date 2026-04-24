/**
 * Automatic difficulty calculation for licks.
 *
 * Scores four dimensions:
 *   1. Note count — more notes to remember = harder
 *   2. Interval jumps — larger leaps = harder to hear and play
 *   3. Rhythm — syncopation, fast subdivisions, variety
 *   4. Chromaticism — non-diatonic notes are harder to hear
 *
 * Each dimension contributes to pitchComplexity and rhythmComplexity
 * sub-scores (1-100), which combine into an overall level (1-100).
 *
 * A 1.5× scaling factor stretches scores into the usable 1-70 range
 * so the adaptive difficulty system has room to gate content progressively.
 */

import type { Phrase, DifficultyMetadata, Fraction } from '$lib/types/music';

/** C-major pitch classes — the "home" diatonic set */
const DIATONIC_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);

/** Scaling factor applied to raw sub-scores and overall level */
const SCALE = 1.5;

function frac([n, d]: Fraction): number {
	return n / d;
}

/** Normalize value from [lo, hi] → [0, 1], clamped */
function norm(value: number, lo: number, hi: number): number {
	return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

function clamp(value: number): number {
	return Math.max(1, Math.min(100, Math.round(value)));
}

export function calculateDifficulty(phrase: Phrase): DifficultyMetadata {
	const notes = phrase.notes;
	const pitched = notes.filter((n) => n.pitch !== null);
	const pitches = pitched.map((n) => n.pitch!);

	// Compute bar length from note extents
	const maxEnd =
		notes.length > 0
			? Math.max(...notes.map((n) => frac(n.offset) + frac(n.duration)))
			: 1;
	const lengthBars = Math.max(1, Math.ceil(maxEnd));

	// ═══════════════════════════════════════════════════════════════
	//  PITCH COMPLEXITY  (raw 0~65, scaled 0~100)
	// ═══════════════════════════════════════════════════════════════

	// 1. Note count  (max 25 pts)
	//    2 notes = trivial, 14+ = demanding
	const noteCountPts = norm(pitches.length, 2, 14) * 25;

	// 2. Intervals  (max 30 pts)
	const intervals: number[] = [];
	for (let i = 1; i < pitches.length; i++) {
		intervals.push(Math.abs(pitches[i] - pitches[i - 1]));
	}
	const avgInterval =
		intervals.length > 0
			? intervals.reduce((a, b) => a + b, 0) / intervals.length
			: 0;
	const maxInterval = intervals.length > 0 ? Math.max(...intervals) : 0;
	const largeJumps = intervals.filter((i) => i > 7).length; // > P5

	// Thirds and fourths are normal in jazz — difficulty starts at fifths+
	const avgIntervalPts = norm(avgInterval, 3, 8) * 12;
	const maxIntervalPts = norm(maxInterval, 5, 14) * 8;
	const largeJumpPts =
		(intervals.length > 0 ? largeJumps / intervals.length : 0) * 10;

	// 3. Chromaticism  (max 25 pts)
	const pcs = pitches.map((p) => ((p % 12) + 12) % 12);
	const nonDiatonicCount = pcs.filter((pc) => !DIATONIC_PCS.has(pc)).length;
	const chromaticRatio =
		pitches.length > 0 ? nonDiatonicCount / pitches.length : 0;

	// Chromatic runs (≥2 consecutive semitone steps)
	let chromaticRunNotes = 0;
	let runLen = 0;
	for (const iv of intervals) {
		if (iv === 1) {
			runLen++;
		} else {
			if (runLen >= 2) chromaticRunNotes += runLen;
			runLen = 0;
		}
	}
	if (runLen >= 2) chromaticRunNotes += runLen;

	const chromaticPts = chromaticRatio * 15 + norm(chromaticRunNotes, 0, 6) * 10;

	// 4. Range  (max 10 pts)
	const range =
		pitches.length > 1 ? Math.max(...pitches) - Math.min(...pitches) : 0;
	const rangePts = norm(range, 5, 20) * 10;

	const rawPitch =
		noteCountPts +
		avgIntervalPts +
		maxIntervalPts +
		largeJumpPts +
		chromaticPts +
		rangePts;

	// ═══════════════════════════════════════════════════════════════
	//  RHYTHM COMPLEXITY  (raw 0~65, scaled 0~100)
	// ═══════════════════════════════════════════════════════════════

	const durations = notes.map((n) => frac(n.duration));
	const offsets = notes.map((n) => frac(n.offset));

	// 1. Note density  (max 25 pts)
	const notesPerBar = notes.length / lengthBars;
	const densityPts = norm(notesPerBar, 2, 10) * 25;

	// 2. Fastest subdivision  (max 30 pts)
	const minDuration = durations.length > 0 ? Math.min(...durations) : 1;
	let fastestPts: number;
	if (minDuration <= 1 / 16 + 0.001) fastestPts = 30; // sixteenths
	else if (minDuration <= 1 / 12 + 0.001) fastestPts = 21; // triplet eighths
	else if (minDuration <= 1 / 8 + 0.001) fastestPts = 10; // eighths
	else if (minDuration <= 1 / 4 + 0.001) fastestPts = 3; // quarters
	else fastestPts = 0;

	// 3. Off-beat notes  (max 25 pts)
	let offBeatCount = 0;
	for (const offset of offsets) {
		const posInBar = ((offset % 1) + 1) % 1;
		const distToQuarter = Math.min(
			Math.abs(posInBar % 0.25),
			Math.abs(0.25 - (posInBar % 0.25))
		);
		if (distToQuarter > 0.02) offBeatCount++;
	}
	const offBeatPts =
		(notes.length > 0 ? offBeatCount / notes.length : 0) * 25;

	// 4. Rhythmic variety  (max 15 pts)
	//    Count distinct duration values (quantised to 192nds)
	const uniqueDurations = new Set(durations.map((d) => Math.round(d * 192)))
		.size;
	const varietyPts = norm(uniqueDurations, 1, 5) * 15;

	// 5. Rests  (max 5 pts)
	const restCount = notes.filter((n) => n.pitch === null).length;
	const restPts = Math.min(restCount * 2, 5);

	const rawRhythm = densityPts + fastestPts + offBeatPts + varietyPts + restPts;

	// ═══════════════════════════════════════════════════════════════
	//  SCALE AND COMBINE
	// ═══════════════════════════════════════════════════════════════

	const pitchComplexity = clamp(rawPitch * SCALE);
	const rhythmComplexity = clamp(rawRhythm * SCALE);

	// Pitch weighted slightly more — this is a play-by-ear app
	const rawLevel = rawPitch * 0.55 + rawRhythm * 0.45;
	const level = clamp(rawLevel * SCALE);

	return {
		level,
		pitchComplexity,
		rhythmComplexity,
		lengthBars
	};
}
