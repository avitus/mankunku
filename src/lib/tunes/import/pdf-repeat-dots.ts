/** Pixel-only repeat evidence, kept separate from barline and melody detection. */
import type { StaffBand } from './pdf-geometry';
export function createRepeatDotReader(
	dark: (x: number, y: number) => boolean,
	W: number,
	H: number,
	band: StaffBand,
	il: number
): (boundary: number, side: -1 | 1) => boolean {
	const nearLine = (y: number) => band.lines.some((l) => Math.abs(y - l) <= 3);
	// Repeat dots: two compact blobs centered in spaces 2 and 3 beside
	// the barline, with white clearance on at least one side of the middle line — a
	// notehead straddling the line fills that clearance and is rejected.
	const c2 = Math.round((band.lines[1] + band.lines[2]) / 2);
	const c3 = Math.round((band.lines[2] + band.lines[3]) / 2);
	const gapOff = Math.max(2, Math.round(0.2 * il));
	const nearWin = Math.max(1, Math.round(0.1 * il));
	// A dot is a SHORT blob: the dark run through each space center must
	// stay under 0.8 il (noteheads run ~1 il, stems far more).
	const maxDotRun = 0.8 * il;
	const isDotColumn = (x: number): boolean => {
		if (x < 0 || x >= W) return false;
		const shortRunAt = (c: number): boolean => {
			let hit = -1;
			for (let y = c - nearWin; y <= c + nearWin; y++) {
				if (dark(x, y)) {
					hit = y;
					break;
				}
			}
			if (hit < 0) return false;
			// Exclude staff ink before measuring a dot: blur can join a dot
			// to a thick line without making it a long vertical stroke.
			let top = hit;
			while (top > 0 && !nearLine(top - 1) && dark(x, top - 1)) top--;
			let bottom = hit;
			while (bottom < H - 1 && !nearLine(bottom + 1) && dark(x, bottom + 1)) bottom++;
			return bottom - top + 1 <= maxDotRun;
		};
		if (
			!shortRunAt(c2) ||
			!shortRunAt(c3) ||
			(dark(x, band.lines[2] - gapOff) && dark(x, band.lines[2] + gapOff))
		) {
			return false;
		}
		// Purity: a real dot column holds NOTHING but staff lines and the
		// two dots. A hollow whole note on the middle line mimics the two
		// short runs at its edge columns, but drags ties/arcs/ring ink
		// elsewhere in the band.
		const dotWin = Math.round(0.35 * il);
		for (let y = band.top - 2; y <= band.bottom + 2; y++) {
			if (!dark(x, y)) continue;
			const onLine = band.lines.some((l) => Math.abs(y - l) <= 3);
			const inDot = Math.abs(y - c2) <= dotWin || Math.abs(y - c3) <= dotWin;
			if (!onLine && !inDot) return false;
		}
		return true;
	};
	// The window reaches 2.2 il: a winged repeat's accepted boundary
	// center skews away from its dots. Dots are also NARROW — a hollow
	// whole note straddling the middle line shows the same two-short-runs
	// column pattern, but its arcs run 1.5+ il wide, so only a compact
	// run of dot-columns (2px to 0.8 il) counts.
	const dotsOnSide = (bx: number, side: -1 | 1): boolean => {
		const from = Math.round(0.3 * il);
		const to = Math.round(2.2 * il);
		let run = 0;
		let bestRun = 0;
		for (let d = from; d <= to + 1; d++) {
			if (d <= to && isDotColumn(bx + side * d)) {
				run++;
			} else {
				if (run > bestRun) bestRun = run;
				run = 0;
			}
		}
		return bestRun >= 2 && bestRun <= 0.8 * il;
	};
	return dotsOnSide;
}
