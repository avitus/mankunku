import { findStaffBands, type PageImage } from './pdf-geometry';
import { pageInk } from './pdf-raster-heads';

/** Sample short horizontal spans. A staff may curve across a scan even when
 * its five rules are locally parallel. Use their median center estimate so
 * an overlapping beam or note does not move a strip. */
function staffCenters(page: PageImage, x: number, span: number): number[] {
	const rows = new Float32Array(page.height);
	const dark = pageInk(page);
	for (let y = 0; y < page.height; y++) {
		let ink = 0;
		for (let col = x - span; col <= x + span; col++) {
			if (dark(col, y)) ink++;
		}
		rows[y] = ink / (2 * span + 1);
	}
	// A thin tilted rule can straddle two adjacent pixel rows in a strip.
	const coverage = rows.map((value, y) => Math.min(1, value + (rows[y - 1] ?? 0)));
	return findStaffBands(coverage, 0.64).map((band) => {
		const gap = (band.bottom - band.top) / 4;
		const estimates = band.lines.map((y, i) => y + (2 - i) * gap);
		return estimates.sort((a, b) => a - b)[2];
	});
}

/** Straighten a raster page by tracking its five-line staves. Interpolate
 * between measured strips horizontally and between staves vertically, so
 * noteheads, barlines and the crops used for recognition move together. */
export function straightenScan(page: PageImage): Uint8ClampedArray<ArrayBuffer> | null {
	const { width, height } = page;
	if (width < 100) return null;
	const strips = Array.from({ length: 11 }, (_, i) => {
		const x = Math.round(width * (i + 1) / 12);
		return { x, centers: staffCenters(page, x, Math.floor(width / 36)) };
	});
	const middle = strips[5];
	const tracks = middle.centers.flatMap((center) => {
		const points = strips.flatMap(({ x, centers }) => {
			const nearest = centers.reduce((best, y) =>
				Math.abs(y - center) < Math.abs(best - center) ? y : best, Infinity);
			// Restrict to mild skew and avoid matching a neighboring staff.
			return Math.abs(nearest - center) <= Math.abs(x - middle.x) * 0.035 + 4
				? [{ x, shift: nearest - center }] : [];
		});
		return points.length >= 8 ? [{ center, points }] : [];
	});
	if (!tracks.length) return null;

	const source = new Uint32Array(page.data.buffer, page.data.byteOffset, width * height);
	const output = new Uint32Array(width * height);
	for (let x = 0; x < width; x++) {
		const shifts = tracks.map(({ points }) => {
			let right = 1;
			while (right < points.length - 1 && points[right].x < x) right++;
			const a = points[right - 1];
			const b = points[right];
			return a.shift + (b.shift - a.shift) * (x - a.x) / (b.x - a.x);
		});
		let next = 0;
		for (let y = 0; y < height; y++) {
			while (next < tracks.length && tracks[next].center < y) next++;
			let shift = shifts[0];
			if (next === tracks.length) shift = shifts[next - 1];
			else if (next > 0) {
				const fraction = (y - tracks[next - 1].center) / (tracks[next].center - tracks[next - 1].center);
				shift = shifts[next - 1] + fraction * (shifts[next] - shifts[next - 1]);
			}
			const sy = y + Math.round(shift);
			output[y * width + x] = sy >= 0 && sy < height ? source[sy * width + x] : 0xffffffff;
		}
	}
	return new Uint8ClampedArray(output.buffer);
}
