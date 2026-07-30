import type { Tune } from '$lib/types/tune';
import type { Fraction } from '$lib/types/music';
import { fractionToFloat } from './intervals';
import { approxToFraction, durationToAbc } from './notation';

/**
 * Engraving layout helpers for tune charts: density-aware reflow and jazz
 * slash notation for empty (melody-silent) bars.
 */

/** Default abcjs staff width (user units) — wider than the old 600 for print-like density. */
export const CHART_STAFF_WIDTH = 750;

/** Minimum bars per system (dense 16th-note heads, stacked alterations). */
export const BARS_PER_LINE_MIN = 3;
/** Maximum bars per system (sparse / empty intro stretches). */
export const BARS_PER_LINE_MAX = 6;
/** Classic Real Book default when density is unremarkable. */
export const BARS_PER_LINE_DEFAULT = 4;

/**
 * How many rhythmic slashes a fully empty bar should show.
 * Simple meters: one per beat (4 in 4/4). Compound (6/8, 9/8, 12/8): one per
 * compound beat (2 in 6/8) — the usual jazz chart convention.
 */
export function slashCountForMeter(timeSignature: [number, number]): number {
	const [num, den] = timeSignature;
	if (den === 8 && num % 3 === 0 && num / 3 >= 2) return num / 3;
	return num;
}

/** Whole-note duration of one slash cell in the given meter. */
export function slashCellDuration(timeSignature: [number, number]): Fraction {
	const n = slashCountForMeter(timeSignature);
	const barWhole = timeSignature[0] / timeSignature[1];
	return approxToFraction(barWhole / n);
}

/**
 * ABC tokens for one empty bar of beat-aligned rhythm slashes.
 * abcjs maps `!style=rhythm!` rests to diagonal slash noteheads.
 */
export function slashBarAbc(
	timeSignature: [number, number],
	defaultLength: Fraction = [1, 8]
): string {
	const n = slashCountForMeter(timeSignature);
	const cell = slashCellDuration(timeSignature);
	const dur = durationToAbc(cell, defaultLength);
	return Array.from({ length: n }, () => `!style=rhythm!z${dur}`).join(' ');
}

/**
 * Absolute (form-order) bar indices that have no pitched melody and should
 * engrave as slash bars rather than whole rests.
 */
export function emptyMelodyBars(sheet: Tune): Set<number> {
	const barDuration = sheet.timeSignature[0] / sheet.timeSignature[1];
	const empty = new Set<number>();
	let base = 0;
	for (const sec of sheet.sections) {
		for (let b = 0; b < sec.bars; b++) {
			const barStart = b * barDuration;
			const barEnd = barStart + barDuration;
			const hasPitch = sec.notes.some((n) => {
				if (n.pitch === null) return false;
				const start = fractionToFloat(n.offset);
				const end = start + fractionToFloat(n.duration);
				return start < barEnd - 1e-9 && end > barStart + 1e-9;
			});
			if (!hasPitch) empty.add(base + b);
		}
		base += sec.bars;
	}
	return empty;
}

/**
 * A run of consecutive empty (melody-silent) bars that share at most one
 * chord event at the run start — candidate for a multi-measure rest.
 * Mid-run chord changes keep per-bar slash notation instead.
 */
export interface MultiRestRun {
	/** Absolute form bar where the run starts (inclusive). */
	startAbsBar: number;
	/** Number of bars in the run (≥ 2). */
	bars: number;
	/** Chord text at the run start, if any. */
	chord: string | null;
}

/**
 * Find multi-measure-rest candidates: consecutive empty bars (≥2) with no
 * chord change after the first beat of the run. Chord events strictly inside
 * the run (after its downbeat) disqualify the span — those stay slash bars.
 *
 * `chordEvents` are absolute whole-note offsets with display text (same shape
 * as the tune-notation timeline).
 */
export function multiRestRuns(
	sheet: Tune,
	emptyBars: Set<number>,
	chordEvents: readonly { at: number; text: string }[]
): MultiRestRun[] {
	const barDuration = sheet.timeSignature[0] / sheet.timeSignature[1];
	const totalBars = [...emptyBars].reduce((m, b) => Math.max(m, b + 1), 0);
	// Prefer section-total if empty set is sparse.
	let formBars = 0;
	for (const sec of sheet.sections) formBars += sec.bars;
	const nBars = Math.max(totalBars, formBars);

	const runs: MultiRestRun[] = [];
	let i = 0;
	while (i < nBars) {
		if (!emptyBars.has(i)) {
			i += 1;
			continue;
		}
		const start = i;
		while (i < nBars && emptyBars.has(i)) i += 1;
		const len = i - start;
		if (len < 2) continue;

		const runStart = start * barDuration;
		const runEnd = (start + len) * barDuration;
		// Chord events strictly after the run downbeat and before the end
		// mean harmony changes mid-rest → keep slash bars.
		const midChange = chordEvents.some(
			(c) => c.at > runStart + 1e-9 && c.at < runEnd - 1e-9
		);
		if (midChange) continue;

		const startChord =
			chordEvents.find((c) => Math.abs(c.at - runStart) < 1e-9)?.text ?? null;
		runs.push({ startAbsBar: start, bars: len, chord: startChord });
	}
	return runs;
}

/** Absolute bars covered by multi-measure rests (first bar of each run only emits Z). */
export function multiRestBarMap(
	runs: readonly MultiRestRun[]
): Map<number, MultiRestRun> {
	const map = new Map<number, MultiRestRun>();
	for (const run of runs) {
		for (let k = 0; k < run.bars; k++) {
			map.set(run.startAbsBar + k, run);
		}
	}
	return map;
}

/**
 * Choose bars-per-system from melody + chord density.
 * Dense bars (many notes or several mid-bar chords) get fewer bars/line so
 * spacing stays readable; sparse / empty stretches get more.
 */
export function suggestBarsPerLine(sheet: Tune): number {
	const barDuration = sheet.timeSignature[0] / sheet.timeSignature[1];
	let totalBars = 0;
	let totalNotes = 0;
	let maxNotes = 0;
	let maxChords = 0;
	let denseBars = 0;
	let sparseBars = 0;

	for (const sec of sheet.sections) {
		for (let b = 0; b < sec.bars; b++) {
			totalBars += 1;
			const barStart = b * barDuration;
			const barEnd = barStart + barDuration;
			let notes = 0;
			for (const n of sec.notes) {
				if (n.pitch === null) continue;
				const start = fractionToFloat(n.offset);
				const end = start + fractionToFloat(n.duration);
				if (start < barEnd - 1e-9 && end > barStart + 1e-9) notes += 1;
			}
			let chords = 0;
			for (const h of sec.harmony) {
				const at = fractionToFloat(h.startOffset);
				if (at >= barStart - 1e-9 && at < barEnd - 1e-9) chords += 1;
			}
			totalNotes += notes;
			if (notes > maxNotes) maxNotes = notes;
			if (chords > maxChords) maxChords = chords;
			if (notes >= 8 || chords >= 3) denseBars += 1;
			// "Sparse" means melody-silent (comp-only) — a single whole note is
			// ordinary lead-sheet density, not a candidate for 5–6 bars/line.
			if (notes === 0) sparseBars += 1;
		}
	}

	if (totalBars === 0) return BARS_PER_LINE_DEFAULT;

	const avg = totalNotes / totalBars;
	const denseShare = denseBars / totalBars;
	const sparseShare = sparseBars / totalBars;

	let bpl = BARS_PER_LINE_DEFAULT;
	if (denseShare >= 0.35 || avg >= 7 || maxNotes >= 12) bpl = 3;
	else if (avg >= 5 || maxChords >= 3) bpl = 3;
	// The dense/medium cases above have already diverted, so anything reaching
	// here is genuinely sparse (avg < 5, no dense bars, maxNotes < 12). Grade the
	// widening on the empty-bar share alone: gating this on `avg === 0` (as it was)
	// made the 5-branch unreachable, since a fully melody-silent chart always has
	// sparseShare === 1 and took the 6-branch. A mostly-empty chart with a few
	// melodic bars still reads as sparse and should widen too.
	else if (sparseShare >= 0.85) bpl = 6;
	else if (sparseShare >= 0.6) bpl = 5;

	return Math.min(BARS_PER_LINE_MAX, Math.max(BARS_PER_LINE_MIN, bpl));
}
