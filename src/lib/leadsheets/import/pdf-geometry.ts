/**
 * Deterministic geometry analysis of a rendered chart page — pure functions
 * over pixel/darkness profiles, no ML, no DOM. The browser renders the PDF
 * page to a canvas and `analyzePageGeometry` reduces its RGBA pixels to:
 *
 *  - a ROW profile (fraction of dark pixels per row) → staff systems, via
 *    the arithmetic-progression-of-five-lines signature at the page's
 *    dominant interline;
 *  - a COLUMN profile within each staff band → barlines, via the
 *    Audiveris-style validation battery in `findBarlines`.
 *
 * These give the two quantities the vision model kept getting wrong — how
 * many systems, and how many bars in each — mechanically. Validated exact
 * against all five reference charts in `leadsheet PDFs/` (41/28/32/25/33
 * bars) via a browser probe running this exact module.
 */

export interface StaffBand {
	/** Row of the top staff line. */
	top: number;
	/** Row of the bottom staff line. */
	bottom: number;
	/** Centers of the five staff lines. */
	lines: number[];
}

export interface ColumnProfile {
	/** Fraction of dark pixels in the column, within the staff band. */
	fill: number;
	/** Longest white run within the band, in pixels. */
	maxGap: number;
	/**
	 * True when ONE contiguous dark run (tolerating 1px anti-alias breaks)
	 * covers the band from top line to bottom line. A stem's run ends at
	 * its notehead even when a tie arc below keeps maxGap small.
	 */
	spans: boolean;
	touchesTop: boolean;
	touchesBottom: boolean;
	/** Contiguous dark extension ABOVE the top staff line, in pixels. */
	above: number;
	/** Contiguous dark extension BELOW the bottom staff line, in pixels. */
	below: number;
	/**
	 * Dark pixel count in the staff band EXTENDED 0.9 interline beyond each
	 * side, excluding the staff-line rows themselves. The extension counts
	 * notehead/beam mass hanging just outside the staff (a top-of-staff
	 * down-stem's signature) while staying clear of chord text and lyrics.
	 */
	offLine: number;
}

/** Group consecutive (or near-consecutive) indices into center positions. */
function clusterCenters(indices: number[], maxGap: number): number[] {
	const centers: number[] = [];
	let start = -1;
	let prev = -Infinity;
	for (const i of indices) {
		if (i - prev > maxGap) {
			if (start >= 0) centers.push(Math.round((start + prev) / 2));
			start = i;
		}
		prev = i;
	}
	if (start >= 0) centers.push(Math.round((start + prev) / 2));
	return centers;
}

/**
 * Find five-line staves in a row-darkness profile.
 *
 * Staff lines are the page's dominant horizontal rhythm: the modal gap
 * between dark-row centers is the interline. A staff is any chain of five
 * centers in arithmetic progression at that interline — spurious dark rows
 * BETWEEN lines (long beams, text underlines) are skipped rather than
 * breaking the match, and when a stray row extends the chain (a ledger row
 * one interline outside the staff), the darkest five-window wins, since
 * real staff lines run the full system width.
 */
export function findStaffBands(
	rowDarkness: ArrayLike<number>,
	minDarkness = 0.4
): StaffBand[] {
	// Cluster adjacent dark rows (thick/anti-aliased lines) into centers,
	// keeping each cluster's peak darkness for disambiguation.
	const centers: number[] = [];
	const peaks: number[] = [];
	let start = -1;
	let prev = -Infinity;
	let peak = 0;
	for (let y = 0; y < rowDarkness.length; y++) {
		if (rowDarkness[y] < minDarkness) continue;
		if (y - prev > 2) {
			if (start >= 0) {
				centers.push(Math.round((start + prev) / 2));
				peaks.push(peak);
			}
			start = y;
			peak = 0;
		}
		prev = y;
		peak = Math.max(peak, rowDarkness[y] as number);
	}
	if (start >= 0) {
		centers.push(Math.round((start + prev) / 2));
		peaks.push(peak);
	}
	if (centers.length < 5) return [];

	// Dominant interline = modal gap between consecutive centers.
	const gapCounts = new Map<number, number>();
	for (let i = 1; i < centers.length; i++) {
		const g = centers[i] - centers[i - 1];
		if (g >= 3 && g <= 60) gapCounts.set(g, (gapCounts.get(g) ?? 0) + 1);
	}
	let il = 0;
	let best = 0;
	for (const [g, n] of gapCounts) {
		if (n > best || (n === best && il > 0 && g < il)) {
			best = n;
			il = g;
		}
	}
	if (il < 3) return [];
	const tol = Math.max(2, Math.round(il * 0.25));

	const bands: StaffBand[] = [];
	let i = 0;
	while (i < centers.length) {
		// Grow the longest skip-tolerant chain at the interline from center i.
		const chain = [i];
		let expected = centers[i] + il;
		let j = i + 1;
		while (j < centers.length && centers[j] <= expected + tol) {
			if (Math.abs(centers[j] - expected) <= tol) {
				chain.push(j);
				expected = centers[j] + il;
			}
			j++;
		}
		if (chain.length < 5) {
			i++;
			continue;
		}
		// Darkest five-window: staff lines out-darken ledger/beam strays.
		let bestStart = 0;
		let bestSum = -1;
		for (let w = 0; w + 5 <= chain.length; w++) {
			const sum = chain.slice(w, w + 5).reduce((acc, idx) => acc + peaks[idx], 0);
			if (sum > bestSum) {
				bestSum = sum;
				bestStart = w;
			}
		}
		const lines = chain.slice(bestStart, bestStart + 5).map((idx) => centers[idx]);
		bands.push({ top: lines[0], bottom: lines[4], lines });
		i = chain[bestStart + 4] + 1;
	}
	return bands;
}

/**
 * Find barline x-positions from a column profile of one staff band, using
 * the validation battery Audiveris applies to its staff projections:
 *
 *  - near-full height, touching both extreme staff lines, with a SINGLE
 *    contiguous ink run covering the band and no internal white gap over
 *    0.3 interline — a barline's ink is continuous, while a staff-spanning
 *    note stem ends at its notehead short of the extreme line (even when a
 *    tie arc below keeps the gaps small);
 *  - contiguous ink extending more than 0.9 interline beyond the staff is
 *    a stem running to a beam or an outside notehead, never a barline —
 *    winged repeat hooks (~0.5 interline) and slurs grazing a barline end
 *    stay under the limit, but mark the column unclean for the
 *    minimum-bar-width tie-break below;
 *  - the CHUNK test: sampling the off-staff-line black mass at ±0.4
 *    interline; a mean above 0.5 interline of residual black means an
 *    attached notehead or beam, i.e. a stem (Audiveris uses 1.2 against a
 *    cumul that includes the beam). Columns that are themselves candidates
 *    are exempt so double barlines don't reject each other;
 *  - candidate clusters wider than 2.2 interline are solid blobs, not
 *    barlines (a final thin+thick pair spans ~1.6); surviving clusters
 *    merge into one boundary;
 *  - boundaries closer than 3 interlines cannot both be barlines (no bar
 *    is that narrow): the cluster whose columns stay inside the staff wins
 *    (a first-beat stem pokes above or below), then the darker one.
 */
export function findBarlines(
	columns: ColumnProfile[],
	interline: number,
	minFill = 0.85
): number[] {
	const isCandidate = columns.map(
		(c) =>
			c.fill >= minFill &&
			c.maxGap <= 0.3 * interline &&
			c.spans &&
			c.touchesTop &&
			c.touchesBottom &&
			c.above <= 0.9 * interline &&
			c.below <= 0.9 * interline
	);

	const chunkAt = Math.max(2, Math.round(interline * 0.4));
	const halfWin = Math.max(1, Math.round(interline * 0.075));
	const chunky = (x: number): boolean => {
		for (const side of [-1, 1]) {
			let mass = 0;
			let n = 0;
			for (let d = chunkAt - halfWin; d <= chunkAt + halfWin; d++) {
				const xi = x + side * d;
				const c = columns[xi];
				if (!c || isCandidate[xi]) continue;
				mass += c.offLine;
				n++;
			}
			if (n > 0 && mass / n > 0.5 * interline) return true;
		}
		return false;
	};

	const candidates: number[] = [];
	for (let x = 0; x < columns.length; x++) {
		if (isCandidate[x] && !chunky(x)) candidates.push(x);
	}

	// Group into boundaries; a group wider than 1.5 il is a blob, not a
	// barline (thick+thin repeat pairs stay comfortably under that).
	interface Boundary {
		x: number;
		clean: boolean;
		fill: number;
	}
	const emit = (start: number, prev: number, out: Boundary[]): void => {
		if (start < 0 || prev - start > 2.2 * interline) return;
		let clean = true;
		let fill = 0;
		let n = 0;
		for (let x = start; x <= prev; x++) {
			if (!isCandidate[x]) continue;
			if (columns[x].above > 0 || columns[x].below > 0) clean = false;
			fill += columns[x].fill;
			n++;
		}
		out.push({ x: Math.round((start + prev) / 2), clean, fill: n ? fill / n : 0 });
	};
	const groups: Boundary[] = [];
	const maxGap = Math.max(4, Math.round(interline * 0.8));
	let start = -1;
	let prev = -Infinity;
	for (const x of candidates) {
		if (x - prev > maxGap) {
			emit(start, prev, groups);
			start = x;
		}
		prev = x;
	}
	emit(start, prev, groups);

	// Minimum bar width: boundaries closer than 3 il cannot both be real.
	const better = (a: Boundary, b: Boundary): boolean =>
		a.clean !== b.clean ? a.clean : a.fill > b.fill;
	const kept: Boundary[] = [];
	for (const g of groups) {
		const last = kept[kept.length - 1];
		if (last && g.x - last.x < 3 * interline) {
			if (better(g, last)) kept[kept.length - 1] = g;
		} else {
			kept.push(g);
		}
	}
	return kept.map((g) => g.x);
}

/**
 * Map a chord symbol's x-position to its bar and nearest half-beat within a
 * system whose barline boundaries are known. Returns null outside them.
 * `contentPad` shifts the interpolation origin right of each barline —
 * a bar's beat-1 note sits ~0.75 interline in, past clef-side spacing.
 */
export function assignChordBeat(
	x: number,
	boundaries: number[],
	beatsPerBar: number,
	contentPad = 0
): { bar: number; beat: number } | null {
	if (boundaries.length < 2) return null;
	if (x < boundaries[0] || x > boundaries[boundaries.length - 1]) return null;
	let bar = boundaries.length - 2;
	for (let b = 0; b + 1 < boundaries.length; b++) {
		if (x < boundaries[b + 1]) {
			bar = b;
			break;
		}
	}
	const barStart = boundaries[bar] + contentPad;
	const barWidth = boundaries[bar + 1] - barStart;
	if (barWidth <= 0) return null;
	const raw = Math.max(0, ((x - barStart) / barWidth) * beatsPerBar);
	const beat = Math.min(Math.round(raw * 2) / 2, beatsPerBar - 0.5);
	return { bar, beat };
}

export interface PageImage {
	/** RGBA pixels, 4 bytes per pixel, row-major (canvas ImageData layout). */
	data: Uint8ClampedArray | Uint8Array;
	width: number;
	height: number;
}

export interface SystemGeometry {
	band: StaffBand;
	interline: number;
	/** Barline x-positions, left to right. On single-staff systems there is
	 * no initial barline, so each bar ENDS at one: bars = barlines.length. */
	barlines: number[];
}

/**
 * Full page analysis: staff systems and their barlines from raw RGBA
 * pixels. Ink is black — a pixel is dark only when EVERY channel is dark,
 * so colored highlight boxes (chord-tone coloring) are ignored.
 */
export function analyzePageGeometry(page: PageImage, minRowDarkness = 0.3): SystemGeometry[] {
	const { data, width: W, height: H } = page;
	const dark = (x: number, y: number): boolean => {
		const i = (y * W + x) * 4;
		return data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128 && data[i + 3] > 0;
	};

	const rows = new Float32Array(H);
	for (let y = 0; y < H; y++) {
		let d = 0;
		for (let x = 0; x < W; x++) if (dark(x, y)) d++;
		rows[y] = d / W;
	}

	const systems: SystemGeometry[] = [];
	for (const band of findStaffBands(rows, minRowDarkness)) {
		const il = (band.bottom - band.top) / 4;
		const bandH = band.bottom - band.top + 1;
		const nearLine = (y: number): boolean => band.lines.some((l) => Math.abs(y - l) <= 3);
		const extLo = Math.max(0, Math.round(band.top - 0.9 * il));
		const extHi = Math.min(H - 1, Math.round(band.bottom + 0.9 * il));

		const cols: ColumnProfile[] = [];
		for (let x = 0; x < W; x++) {
			let fillCount = 0;
			let maxGap = 0;
			let gap = 0;
			for (let y = band.top; y <= band.bottom; y++) {
				if (dark(x, y)) {
					fillCount++;
					gap = 0;
				} else {
					gap++;
					if (gap > maxGap) maxGap = gap;
				}
			}
			let offLine = 0;
			for (let y = extLo; y <= extHi; y++) {
				if (dark(x, y) && !nearLine(y)) offLine++;
			}
			// Longest dark run over the band, merging across 1px AA breaks.
			let runStart = -1;
			let bestRunStart = -1;
			let bestRunEnd = -2;
			let white = 0;
			for (let y = band.top; y <= band.bottom + 2; y++) {
				const d = y <= band.bottom && dark(x, y);
				if (d) {
					if (runStart < 0) runStart = y;
					white = 0;
				} else if (runStart >= 0 && ++white > 1) {
					if (y - white - runStart > bestRunEnd - bestRunStart) {
						bestRunStart = runStart;
						bestRunEnd = y - white;
					}
					runStart = -1;
					white = 0;
				}
			}
			const spans =
				bestRunStart >= 0 && bestRunStart <= band.top + 2 && bestRunEnd >= band.bottom - 2;
			const touch = (line: number): boolean =>
				dark(x, Math.max(0, line - 1)) || dark(x, line) || dark(x, Math.min(H - 1, line + 1));
			let above = 0;
			for (let y = band.top - 2; y >= 0; y--) {
				if (!dark(x, y)) break;
				above++;
			}
			let below = 0;
			for (let y = band.bottom + 2; y < H; y++) {
				if (!dark(x, y)) break;
				below++;
			}
			cols.push({
				fill: fillCount / bandH,
				maxGap,
				spans,
				touchesTop: touch(band.top),
				touchesBottom: touch(band.bottom),
				above,
				below,
				offLine
			});
		}
		systems.push({ band, interline: il, barlines: findBarlines(cols, il) });
	}
	return systems;
}
