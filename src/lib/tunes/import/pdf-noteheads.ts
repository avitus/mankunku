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
import { detectStemNoteEvents } from './pdf-stem-noteheads';
import {
	rasterHeadCandidates,
	attachedStem,
	pageInk,
	hasLedgerSupport,
	staffLineThickness
} from './pdf-raster-heads';

/** Replaceable pixel detector contract; observations contain geometry, never inferred accidentals. */
export type NoteEventDetector = (
	page: PageImage,
	system: SystemGeometry,
	x0?: number,
	x1?: number
) => NoteEvent[];

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

/** Detect only compact head shapes with a legal stem, or isolated hollow whole notes.
 * The resulting observations remain soft QA evidence, never automatic pitch corrections.
 */
export function detectNoteEvents(
	page: PageImage,
	system: SystemGeometry,
	x0 = system.firstBarLeft,
	x1 = system.barlines.at(-1) ?? page.width
): NoteEvent[] {
	const il = system.interline;
	// Thin staff lines preserve the stem detector's mass estimates. Thick scan lines
	// overwhelm those estimates: use staff-masked shape/whitespace matching instead.
	if (staffLineThickness(page, system) <= 0.15 * il)
		return detectStemNoteEvents(page, system, x0, x1);
	const dark = pageInk(page);
	const candidates = rasterHeadCandidates(page, system, x0, x1).filter((head) =>
		hasLedgerSupport(head, dark, system)
	);
	const events: Array<NoteEvent & { score: number }> = [];
	for (const head of candidates) {
		const stem = attachedStem(head, dark, il);
		if (stem !== null) {
			if (system.barlines.some((b) => Math.abs(stem - b) <= 0.3 * il)) continue;
			const competing = events.findIndex(
				(e) => e.kind === 'stemmed' && Math.abs(e.anchorX - stem) < 0.3 * il
			);
			if (competing >= 0) {
				if (events[competing].score >= head.score) continue;
				events.splice(competing, 1);
			}
			events.push({
				x: head.x,
				anchorX: stem,
				position: head.position,
				kind: 'stemmed',
				score: head.score
			});
		} else if (head.hollow && head.position >= -2 && head.position <= 10) {
			if (system.barlines.some((b) => Math.abs(head.x - b) <= 1.6 * il)) continue;
			// Stacked rings are usually meter digits, not a monophonic whole note.
			if (
				candidates.some(
					(other) =>
						other !== head &&
						Math.abs(other.x - head.x) <= 0.3 * il &&
						Math.abs(other.position - head.position) >= 3
				)
			)
				continue;
			events.push({
				x: head.x,
				anchorX: head.x,
				position: head.position,
				kind: 'hollow',
				score: head.score
			});
		}
	}
	return events.sort((a, b) => a.x - b.x).map(({ score: _score, ...event }) => event);
}

/** Group events into bars by the system's barlines (bar i ends at
 * barlines[i]); events left of the first bar's content are ignored. */
export function eventsByBar(events: NoteEvent[], system: SystemGeometry): NoteEvent[][] {
	// extractPdfSystems computes evidence for every detected system before
	// rejecting barline-less ones — an empty geometry must not index bars[-1].
	if (system.barlines.length === 0) return [];
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
