/**
 * Deterministic note-event detection from a rendered chart page — the pitch
 * counterpart to the barline geometry. A note event is an (x, staff
 * position) anchor:
 *
 *  - STEMMED notes hang their notehead off one end of a thin vertical: an
 *    up-stem's head sits at its bottom-LEFT, a down-stem's at its
 *    top-RIGHT. Requiring one of those two combos rejects accidentals (a
 *    flat's bowl sits bottom-right — an invalid combo; a sharp's strokes
 *    carry too little lateral mass to read as a head).
 *  - WHOLE notes have no stem: a hollow ellipse reads as two short dark
 *    arcs with a light middle, isolated from other ink.
 *
 * Events give the importer per-bar notehead counts, staff positions
 * (≈ pitches, given clef/key), and x anchors for chord-beat assignment —
 * the independent evidence that catches a vision model misreading a staff
 * position.
 */
import type { PageImage, SystemGeometry } from './pdf-geometry';

export interface NoteEvent {
	/** Notehead center x. */
	x: number;
	/**
	 * Staff position in half-steps above the bottom line: 0 = bottom line,
	 * 1 = the space above it, 8 = top line; negative/9+ are ledger
	 * territory.
	 */
	position: number;
	kind: 'stemmed' | 'hollow';
}

interface Band {
	top: number;
	bottom: number;
	il: number;
}

function makeDark(page: PageImage): (x: number, y: number) => boolean {
	const { data, width: W, height: H } = page;
	return (x, y) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return false;
		const i = (y * W + x) * 4;
		return data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128 && data[i + 3] > 0;
	};
}

/** Dark pixel count in a rectangle (inclusive bounds, clamped). */
function massIn(
	dark: (x: number, y: number) => boolean,
	x0: number,
	x1: number,
	y0: number,
	y1: number
): { mass: number; cy: number; cx: number } {
	let mass = 0;
	let sumY = 0;
	let sumX = 0;
	for (let y = Math.round(y0); y <= Math.round(y1); y++) {
		for (let x = Math.round(x0); x <= Math.round(x1); x++) {
			if (dark(x, y)) {
				mass++;
				sumY += y;
				sumX += x;
			}
		}
	}
	return { mass, cy: mass ? sumY / mass : 0, cx: mass ? sumX / mass : 0 };
}

const positionOf = (cy: number, band: Band): number =>
	Math.round((2 * (band.bottom - cy)) / band.il);

/**
 * Find note events in one system. `x0`/`x1` bound the scan (defaults: the
 * measured first-bar left edge to the last barline).
 */
export function detectNoteEvents(
	page: PageImage,
	system: SystemGeometry,
	x0 = system.firstBarLeft,
	x1 = system.barlines.length ? system.barlines[system.barlines.length - 1] : page.width
): NoteEvent[] {
	const dark = makeDark(page);
	const il = system.interline;
	const band: Band = { top: system.band.top, bottom: system.band.bottom, il };
	const scanTop = Math.max(0, Math.round(band.top - 3 * il));
	const scanBottom = Math.min(page.height - 1, Math.round(band.bottom + 3 * il));

	// ── stems: thin verticals with a long contiguous run ──────────────────
	const minStemRun = 2.2 * il;
	const runOf = (x: number): { y0: number; y1: number } | null => {
		let best: { y0: number; y1: number } | null = null;
		let start = -1;
		let white = 0;
		for (let y = scanTop; y <= scanBottom + 2; y++) {
			if (y <= scanBottom && dark(x, y)) {
				if (start < 0) start = y;
				white = 0;
			} else if (start >= 0 && ++white > 1) {
				const end = y - white;
				if (!best || end - start > best.y1 - best.y0) best = { y0: start, y1: end };
				start = -1;
				white = 0;
			}
		}
		return best && best.y1 - best.y0 >= minStemRun ? best : null;
	};

	const nearBarline = (x: number): boolean =>
		system.barlines.some((b) => Math.abs(x - b) <= 0.3 * il);

	interface Stem {
		x: number;
		y0: number;
		y1: number;
	}
	const stems: Stem[] = [];
	let clusterStart = -1;
	let prevRun: { y0: number; y1: number } | null = null;
	for (let x = Math.max(0, Math.round(x0)); x <= Math.round(x1) + 1; x++) {
		const run = x <= x1 ? runOf(x) : null;
		if (run && clusterStart < 0) clusterStart = x;
		if (!run && clusterStart >= 0) {
			const width = x - clusterStart;
			const cx = Math.round((clusterStart + x - 1) / 2);
			// Stems are hairlines; accidental strokes come in wider clusters
			// or pairs, barlines are excluded by position.
			if (width <= 0.3 * il && !nearBarline(cx) && prevRun) {
				stems.push({ x: cx, y0: prevRun.y0, y1: prevRun.y1 });
			}
			clusterStart = -1;
		}
		if (run) prevRun = run;
	}

	// A sharp/natural is a PAIR of thin strokes ~0.35 il apart — drop both.
	const paired = new Set<Stem>();
	for (let i = 0; i < stems.length; i++) {
		for (let j = i + 1; j < stems.length; j++) {
			const gap = stems[j].x - stems[i].x;
			if (gap > 0.2 * il && gap < 0.55 * il) {
				paired.add(stems[i]);
				paired.add(stems[j]);
			}
		}
	}

	const events: NoteEvent[] = [];
	const headW = 1.3 * il;
	const headH = 1.2 * il;
	// A real notehead is a solid blob ≈ 0.7 il² of ink; lateral clutter
	// (accidental strokes, dots) stays well under this.
	const minHeadMass = 0.35 * il * il;

	for (const stem of stems) {
		if (paired.has(stem)) continue;
		// Two legal attachments: up-stem head bottom-LEFT, down-stem head
		// top-RIGHT. Pick the heavier; beams masquerade as top mass but
		// CONTINUE beyond the head window — penalize continuation.
		const candidates = [
			{
				side: -1,
				window: massIn(dark, stem.x - headW, stem.x - 2, stem.y1 - headH, stem.y1),
				beyond: massIn(dark, stem.x - 2 * headW, stem.x - headW - 1, stem.y1 - headH, stem.y1)
			},
			{
				side: 1,
				window: massIn(dark, stem.x + 2, stem.x + headW, stem.y0, stem.y0 + headH),
				beyond: massIn(dark, stem.x + headW + 1, stem.x + 2 * headW, stem.y0, stem.y0 + headH)
			}
		].map((c) => ({
			...c,
			// A flag hugs the stem (centroid ~0.35 il out); a notehead's
			// centroid sits ~0.65 il out. Weight the raw mass by lateral
			// reach so heads out-rank flags; beams are zeroed when they
			// continue past the window.
			score:
				(c.beyond.mass >= 0.6 * c.window.mass ? 0 : c.window.mass) *
				Math.min(1, Math.abs(c.window.cx - stem.x) / (0.5 * il))
		}));
		candidates.sort((a, b) => b.score - a.score);
		const winner = candidates[0];
		if (winner.window.mass < minHeadMass || winner.score <= 0) continue;
		if (Math.abs(winner.window.cx - stem.x) < 0.35 * il) continue;
		const headX = winner.side === -1 ? stem.x - headW / 2 : stem.x + headW / 2;
		events.push({
			x: Math.round(headX),
			position: positionOf(winner.window.cy, band),
			kind: 'stemmed'
		});
	}

	// ── whole notes: hollow isolated ellipses, no stem ─────────────────────
	// Scan half-position steps over the melody's practical range; a hit
	// needs dark arcs above and below a light center, VERTICAL isolation
	// beyond the ring (whole notes stand alone — chord text and lyric
	// glyphs continue vertically), and no stem or barline adjoining. Staff
	// lines are exempt from the isolation mass.
	const nearLine = (y: number): boolean =>
		system.band.lines.some((l) => Math.abs(y - l) <= 3);
	const isoMass = (x: number, ya: number, yb: number): number => {
		let mass = 0;
		for (let y = Math.round(ya); y <= Math.round(yb); y++) {
			if (nearLine(y)) continue;
			for (let dx = -Math.round(0.4 * il); dx <= Math.round(0.4 * il); dx++) {
				if (dark(x + dx, y)) mass++;
			}
		}
		return mass;
	};
	for (let pos = -2; pos <= 10; pos++) {
		const cy = band.bottom - (pos * il) / 2;
		if (cy < scanTop || cy > scanBottom) continue;
		for (let x = Math.round(x0); x <= Math.round(x1); x++) {
			const top = massIn(dark, x - 0.5 * il, x + 0.5 * il, cy - 0.55 * il, cy - 0.2 * il);
			const bottom = massIn(dark, x - 0.5 * il, x + 0.5 * il, cy + 0.2 * il, cy + 0.55 * il);
			if (top.mass < 0.18 * il * il || bottom.mass < 0.18 * il * il) continue;
			// The hollow center must be light — but a whole note sitting ON a
			// staff line legitimately has the line crossing its middle.
			let centerMass = 0;
			for (let y = Math.round(cy - 0.12 * il); y <= Math.round(cy + 0.12 * il); y++) {
				if (nearLine(y)) continue;
				for (let dx = -Math.round(0.25 * il); dx <= Math.round(0.25 * il); dx++) {
					if (dark(x + dx, y)) centerMass++;
				}
			}
			if (centerMass > 0.05 * il * il) continue;
			// A real hollow ellipse has solid SIDE WALLS; tie arcs, flags,
			// and arc-over-line sandwiches do not.
			const leftWall = massIn(dark, x - 0.7 * il, x - 0.35 * il, cy - 0.3 * il, cy + 0.3 * il);
			const rightWall = massIn(dark, x + 0.35 * il, x + 0.7 * il, cy - 0.3 * il, cy + 0.3 * il);
			if (leftWall.mass < 0.08 * il * il || rightWall.mass < 0.08 * il * il) continue;
			// A tie may arc over ONE side of a real whole note; chord/lyric
			// glyphs continue on BOTH sides.
			const isoAbove = isoMass(x, cy - 1.3 * il, cy - 0.75 * il) > 0.08 * il * il;
			const isoBelow = isoMass(x, cy + 0.75 * il, cy + 1.3 * il) > 0.08 * il * il;
			if (isoAbove && isoBelow) continue;
			// Reject if a stem-like run adjoins (then it's a half note,
			// already found via its stem). Double/final barlines mimic the
			// ring (two thin verticals, white middle) — keep a full
			// interline clear of any barline.
			if (system.barlines.some((b) => Math.abs(x - b) <= 1.0 * il)) continue;
			const near = stems.some((s) => Math.abs(s.x - x) < 1.2 * il);
			if (near) continue;
			events.push({ x, position: pos, kind: 'hollow' });
		}
	}

	// Dedup: the hollow scan fires on several adjacent columns, and a half
	// note is found by BOTH its stem and its ring — merge hollows into any
	// neighbor. Two STEMMED events are always distinct (one stem each).
	events.sort((a, b) => a.x - b.x);
	const deduped: NoteEvent[] = [];
	for (const e of events) {
		if (e.kind === 'hollow') {
			const near = deduped.some(
				(d) => Math.abs(e.x - d.x) < 0.9 * il && Math.abs(e.position - d.position) <= 1
			);
			if (near) continue;
		}
		deduped.push(e);
	}
	// A stem can also land after its hollow head in x order: fold stemmed
	// duplicates of a hollow neighbor the other way around.
	return deduped.filter(
		(e, i) =>
			e.kind === 'stemmed' ||
			!deduped.some(
				(d, j) =>
					j !== i &&
					d.kind === 'stemmed' &&
					Math.abs(e.x - d.x) < 0.9 * il &&
					Math.abs(e.position - d.position) <= 1
			)
	);
}

/** Group events into bars by the system's barlines (bar i ends at
 * barlines[i]); events left of the first bar's content are ignored. */
export function eventsByBar(events: NoteEvent[], system: SystemGeometry): NoteEvent[][] {
	const bars: NoteEvent[][] = system.barlines.map(() => []);
	for (const e of events) {
		let bar = system.barlines.findIndex((b) => e.x < b);
		if (bar < 0) bar = system.barlines.length - 1;
		bars[bar].push(e);
	}
	return bars;
}
