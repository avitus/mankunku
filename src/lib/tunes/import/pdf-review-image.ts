/** Browser adapter for source-only pitch review images. Panels use x anchors, never predicted pitches. */
import type { NoteEvent } from './pdf-noteheads';
import type { SystemGeometry } from './pdf-geometry';

/** Append enlarged note columns while retaining the whole measure for rhythm and accidentals.
 * The model must still read vertical position independently; no detector y/position is drawn.
 * Bound panel count and dimensions so dense measures keep the ordinary review image.
 */
export function appendPitchPanels(
	source: HTMLCanvasElement,
	measure: HTMLCanvasElement,
	system: SystemGeometry,
	notes: NoteEvent[],
	left: number,
	right: number
): HTMLCanvasElement {
	const heads = notes
		.filter((n) => n.anchorX >= left && n.anchorX < right)
		.sort((a, b) => a.x - b.x);
	if (!heads.length || heads.length > 12) return measure;
	const il = system.interline,
		zoom = 2;
	const isolated = heads.length === 1;
	const radius = isolated ? 0.65 : 0.45;
	const spans = heads.map((head) => ({
		x: Math.max(
			left,
			head.x - radius * il,
			isolated && head.kind === 'stemmed' && head.anchorX < head.x
				? head.anchorX + 0.15 * il
				: -Infinity
		),
		end: Math.min(
			right,
			head.x + radius * il,
			isolated && head.kind === 'stemmed' && head.anchorX > head.x
				? head.anchorX - 0.15 * il
				: Infinity
		)
	}));
	if (spans.some(({ x, end }) => end <= x)) return measure;
	const panelWidth = Math.ceil(4 * il + 32),
		panelHeight = Math.ceil(8 * il + 28),
		columns = Math.min(4, heads.length);
	const width = Math.max(measure.width, columns * panelWidth * zoom);
	const height = measure.height + Math.ceil(heads.length / columns) * panelHeight * zoom;
	if (width > 1800 || height > 1800) return measure;
	const output = document.createElement('canvas');
	output.width = width;
	output.height = height;
	const ctx = output.getContext('2d');
	if (!ctx) return measure;
	ctx.fillStyle = 'white';
	ctx.fillRect(0, 0, width, height);
	ctx.drawImage(measure, 0, 0);
	heads.forEach((head, i) => {
		ctx.save();
		ctx.translate(
			(i % columns) * panelWidth * zoom,
			measure.height + Math.floor(i / columns) * panelHeight * zoom
		);
		ctx.scale(zoom, zoom);
		// Isolate heads horizontally, retaining every vertical position. A single-head
		// measure can also exclude its stem; removing stems from multi-note panels
		// reduced accuracy in the scan benchmark.
		// Accidentals and rhythm stay visible in the complete measure above.
		const { x, end } = spans[i];
		ctx.drawImage(
			source,
			x,
			system.band.top - 2 * il,
			end - x,
			8 * il,
			32 + x - (head.x - 2 * il),
			28,
			end - x,
			8 * il
		);
		ctx.fillStyle = '#2452a1';
		ctx.font = '12px sans-serif';
		ctx.fillText(`Note ${i + 1}`, 32, 15);
		ctx.font = '9px sans-serif';
		ctx.textAlign = 'right';
		ctx.textBaseline = 'middle';
		for (let position = -4; position <= 12; position++)
			ctx.fillText(String(position), 26, 28 + 6 * il - (position * il) / 2);
		ctx.restore();
	});
	return output;
}

/** Source crop edge; the first boundary is a content estimate, not a barline. */
export function measureSourceLeft(boundary: number, bar: number, interline: number): number {
	// Opening accidentals can precede the content estimate. Interior boundaries
	// are actual barlines and must never borrow ink from the preceding measure.
	return Math.max(0, Math.floor(boundary - (bar === 0 ? 2 * interline : 0)));
}
