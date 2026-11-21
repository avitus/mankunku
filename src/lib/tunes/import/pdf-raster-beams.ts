import type { PageImage, SystemGeometry } from './pdf-geometry';
import { eventsByBar, positionToLetter, type NoteEvent } from './pdf-noteheads';
import { pageInk, staffLineThickness, type InkReader } from './pdf-raster-heads';

interface StemTip {
	x: number;
	y: number;
	direction: 1 | -1;
}

/** Follow the shaft away from the head, allowing a single antialiasing gap. */
function stemTip(event: NoteEvent, system: SystemGeometry, dark: InkReader): StemTip | undefined {
	if (event.kind !== 'stemmed' || event.x === event.anchorX) return;
	const gap = system.interline;
	const direction = event.anchorX < event.x ? 1 : -1;
	const headY = system.band.bottom - event.position * gap / 2;
	const start = Math.round(headY + direction * gap / 2);
	const radius = Math.round(gap * 0.22);
	let longest = gap * 1.5;
	let tip: StemTip | undefined;
	for (let dx = -radius; dx <= radius; dx++) {
		const x = event.anchorX + dx;
		let missing = 0;
		let end = 0;
		for (let step = 1; step <= gap * 6; step++) {
			if (dark(x, start + step * direction)) {
				end = step;
				missing = 0;
			} else if (++missing === 2) break;
		}
		if (end > longest) {
			longest = end;
			tip = { x, y: start + direction * end, direction };
		}
	}
	return tip;
}

/** Trace the primary beam between adjacent stems. A thin staff line alone cannot join them. */
function beamBetween(a: StemTip, b: StemTip, gap: number, rule: number, dark: InkReader): NoteEvent['beamFromPrevious'] {
	const span = b.x - a.x;
	if (span < gap || span > 12 * gap) return;
	if (a.direction !== b.direction) {
		// Opposed stems with separated tips end on different sides of these notes.
		if (Math.abs(a.y - b.y) > Math.max(gap * 2.5, span * 0.6)) return 'break';
		return;
	}
	if (Math.abs(a.y - b.y) > span * 0.6) return;
	let thick = 0;
	let empty = 0;
	for (let i = 1; i <= 7; i++) {
		const x = a.x + span * i / 8;
		const y = a.y + (b.y - a.y) * i / 8;
		let ink = 0;
		for (let dy = 0; dy < gap * 0.5; dy++) ink += Number(dark(x, y - a.direction * dy));
		if (ink > Math.max(rule + 1, gap * 0.22)) thick++;
		if (ink <= 1) empty++;
	}
	if (thick >= 6 && !empty) return 'join';
	if (empty >= 4) return 'break';
}

/** Enrich independent raster evidence in place. The assembler checks its staff positions against the melody. */
export function readRasterBeams(events: NoteEvent[], page: PageImage, system: SystemGeometry): void {
	const dark = pageInk(page);
	const rule = staffLineThickness(page, system);
	for (const bar of eventsByBar(events, system)) {
		let previous: StemTip | undefined;
		for (const head of bar) {
			const tip = stemTip(head, system, dark);
			if (previous && tip) {
				const beam = beamBetween(previous, tip, system.interline, rule, dark);
				if (beam) head.beamFromPrevious = beam;
			}
			previous = tip;
		}
	}
}

/** Transfer only measured joins and gaps between short notes in a bar whose
 * complete written melody agrees with the independent treble staff positions. */
export function matchPrintedBeams(
	notes: Array<{ name: string; length: number }>, events: NoteEvent[] | undefined
): Array<[number, 'join' | 'break']> {
	if (!events?.some(event => event.beamFromPrevious) || notes.length !== events.length) return [];
	if (notes.some((note, i) => note.name.replace(/[#b]/g, '') !== positionToLetter(events[i].position))) return [];
	const marks: Array<[number, 'join' | 'break']> = [];
	for (let i = 1; i < notes.length; i++) {
		const beam = events[i].beamFromPrevious;
		if (beam && notes[i - 1].length <= 1 / 8 && notes[i].length <= 1 / 8) marks.push([i, beam]);
	}
	return marks;
}
