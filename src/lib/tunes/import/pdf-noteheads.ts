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
	 * Bar-binning anchor: the stem x for stemmed notes (a stem always sits
	 * inside its own bar; the head estimate can shift a full head-width on
	 * a side misread), the head x for hollow notes.
	 */
	anchorX: number;
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
): { mass: number; cy: number; cx: number; rowSpan: number } {
	let mass = 0;
	let sumY = 0;
	let sumX = 0;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let y = Math.round(y0); y <= Math.round(y1); y++) {
		for (let x = Math.round(x0); x <= Math.round(x1); x++) {
			if (dark(x, y)) {
				mass++;
				sumY += y;
				sumX += x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}
	return {
		mass,
		cy: mass ? sumY / mass : 0,
		cx: mass ? sumX / mass : 0,
		rowSpan: mass ? maxY - minY + 1 : 0
	};
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
	// Margin past the header end: the chain can stop a hair short of the
	// meter/clef tail, whose strokes otherwise read as stems. Real first
	// notes put their stems ≥2 il into the bar.
	for (let x = Math.max(0, Math.round(x0 + 1.0 * il)); x <= Math.round(x1) + 1; x++) {
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

	// A sharp/natural is a PAIR of thin strokes ~0.35 il apart with SIMILAR
	// length and vertical alignment. A note's down-stem can sit just as
	// close to a preceding accidental's stroke, but it is much longer and
	// differently centered — only true glyph pairs are dropped.
	const paired = new Set<Stem>();
	for (let i = 0; i < stems.length; i++) {
		for (let j = i + 1; j < stems.length; j++) {
			const a = stems[i];
			const b = stems[j];
			const gap = b.x - a.x;
			if (gap <= 0.2 * il || gap >= 0.55 * il) continue;
			const lenA = a.y1 - a.y0;
			const lenB = b.y1 - b.y0;
			const centerA = (a.y0 + a.y1) / 2;
			const centerB = (b.y0 + b.y1) / 2;
			// Jazz-font accidentals offset their two strokes vertically by up
			// to ~1 il; length similarity is the load-bearing test (a note
			// stem outruns an accidental stroke by ≥1 il).
			if (Math.abs(lenA - lenB) > 0.7 * il) continue;
			if (Math.abs(centerA - centerB) > 1.4 * il) continue;
			paired.add(a);
			paired.add(b);
		}
	}

	interface Weighted extends NoteEvent {
		/** Head-window ink mass — used to arbitrate competing claims. */
		w: number;
	}
	const events: Weighted[] = [];
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
		// The head STRADDLES the stem tip (the stem's dark run can end at the
		// head's top edge), so the window reaches past the run end.
		const loA = stem.y1 - 0.6 * il;
		const loB = stem.y1 + 0.7 * il;
		const hiA = stem.y0 - 0.7 * il;
		const hiB = stem.y0 + 0.6 * il;
		const candidates = [
			{
				side: -1,
				window: massIn(dark, stem.x - headW, stem.x - 2, loA, loB)
			},
			{
				side: 1,
				window: massIn(dark, stem.x + 2, stem.x + headW, hiA, hiB)
			}
		].map((c) => ({
			...c,
			// A flag hugs the stem (centroid ~0.35 il out); a notehead's
			// centroid sits ~0.65 il out. Weight the raw mass by lateral
			// reach so heads out-rank flags. A BEAM window is a THIN band
			// (row-span ≤ ~0.7 il even when sloped); a real head spans a
			// full interline — judge the window's own shape, so an
			// accidental behind the head can never veto it.
			score:
				(c.window.rowSpan <= 0.7 * il ? 0 : c.window.mass) *
				Math.min(1, Math.abs(c.window.cx - stem.x) / (0.5 * il))
		}));
		candidates.sort((a, b) => b.score - a.score);
		const winner = candidates[0];
		if (winner.window.mass < minHeadMass || winner.score <= 0) continue;
		if (Math.abs(winner.window.cx - stem.x) < 0.35 * il) continue;
		const headX = winner.side === -1 ? stem.x - headW / 2 : stem.x + headW / 2;
		// A key-signature flat is a single stroke (unpairable) that borrows
		// clef ink as its "head" — any claimed head this close to the header
		// end is header residue, never a note.
		if (headX < x0 + 1.0 * il) continue;
		events.push({
			x: Math.round(headX),
			anchorX: stem.x,
			position: positionOf(winner.window.cy, band),
			kind: 'stemmed',
			w: winner.window.mass
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
	// The header chain can stop inside an ornate clef; give the hollow scan
	// a margin past it (a real whole note starts ≥1.5 il into its bar).
	const hollowX0 = Math.round(x0 + 1.0 * il);
	for (let pos = -2; pos <= 10; pos++) {
		const cy = band.bottom - (pos * il) / 2;
		if (cy < scanTop || cy > scanBottom) continue;
		for (let x = hollowX0; x <= Math.round(x1); x++) {
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
			// ring (two thin verticals, white middle), and REPEAT DOT PAIRS
			// read as a hollow at the middle line now that its center is
			// line-exempt — keep 1.6 interlines clear of any barline (whole
			// notes never hug one).
			if (system.barlines.some((b) => Math.abs(x - b) <= 1.6 * il)) continue;
			const near = stems.some((s) => Math.abs(s.x - x) < 1.2 * il);
			if (near) continue;
			events.push({ x, anchorX: x, position: pos, kind: 'hollow', w: top.mass + bottom.mass });
		}
	}

	// Dedup by claimed head: one physical head yields one event. An
	// accidental stroke that escaped pairing borrows the neighboring note's
	// head (or its own fat crossbars) — the REAL head's claim carries far
	// more ink, so the heavier claim wins. Hollow ring hits merge into any
	// neighbor within ~a head-width (the ring scan fires on adjacent
	// columns, and a half note is found by both its stem and its ring).
	events.sort((a, b) => a.x - b.x);
	const kept: Weighted[] = [];
	for (const e of events) {
		const radius = (d: Weighted): number =>
			e.kind === 'hollow' || d.kind === 'hollow' ? 0.9 * il : 0.8 * il;
		// Accidental strokes claim heads up to two positions off the real
		// note's; genuine adjacent notes keep their stems (hence heads)
		// well over a head-width apart.
		const clash = kept.findIndex(
			(d) => Math.abs(e.x - d.x) < radius(d) && Math.abs(e.position - d.position) <= 2
		);
		if (clash >= 0) {
			if (e.w > kept[clash].w) kept[clash] = e;
			continue;
		}
		kept.push(e);
	}
	// Stacked ring hits at one x are meter digits (a 4/4's two counters),
	// never notes — a whole note stands alone on its position.
	const stacked = new Set<Weighted>();
	for (const a of kept) {
		if (a.kind !== 'hollow') continue;
		for (const b of kept) {
			if (b === a || b.kind !== 'hollow') continue;
			if (Math.abs(a.x - b.x) <= 0.3 * il && Math.abs(a.position - b.position) >= 3) {
				stacked.add(a);
				stacked.add(b);
			}
		}
	}
	return kept
		.filter((e) => !stacked.has(e))
		.sort((a, b) => a.x - b.x)
		.map(({ x, anchorX, position, kind }) => ({ x, anchorX, position, kind }));
}

/** Group events into bars by the system's barlines (bar i ends at
 * barlines[i]); events left of the first bar's content are ignored. */
export function eventsByBar(events: NoteEvent[], system: SystemGeometry): NoteEvent[][] {
	const bars: NoteEvent[][] = system.barlines.map(() => []);
	for (const e of events) {
		let bar = system.barlines.findIndex((b) => e.anchorX < b);
		if (bar < 0) bar = system.barlines.length - 1;
		bars[bar].push(e);
	}
	return bars;
}

/**
 * Treble-clef letter name (no accidental) for a staff position — position
 * 0 is E4 on the bottom line. The model applies key signature and
 * accidentals itself; the letter/octave is what the geometry knows.
 */
export function positionToLetter(position: number): string {
	const abs = 30 + position; // diatonic index, C0-based (E4 = 30)
	return 'CDEFGAB'[((abs % 7) + 7) % 7] + String(Math.floor(abs / 7));
}

/** Per-bar note evidence for the transcription route. */
export interface BarEvidence {
	count: number;
	letters: string[];
}

/** Assemble per-bar evidence (counts + letter names in x order). */
export function barEvidence(events: NoteEvent[], system: SystemGeometry): BarEvidence[] {
	return eventsByBar(events, system).map((bar) => ({
		count: bar.length,
		letters: bar.map((e) => positionToLetter(e.position))
	}));
}
