import type { PrintedEndingBracket } from '$lib/types/tune';
import type { InkReader } from './pdf-raster-heads';

/** Measure a short, open volta above a bar. Its roof starts over the left
 * barline and has a descending hook only at that end. A model must separately
 * read the ending number before this geometry can affect the score. */
export function readOpenEndingBracket(
	dark: InkReader, left: number, right: number, top: number, gap: number, cropTop: number
): PrintedEndingBracket | undefined {
	const hookDepth = (start: number, end: number, y: number) => {
		let deepest = 0;
		for (let x = start; x <= end; x++) {
			let depth = 0;
			while (depth < gap * 9 && dark(x, y + depth)) depth++;
			deepest = Math.max(deepest, depth);
		}
		return deepest;
	};
	const maxWidth = Math.min(14 * gap, (right - left) * 0.72);
	let best: PrintedEndingBracket | undefined;
	for (let y = Math.max(cropTop, Math.round(top - 10 * gap)); y < top - 2 * gap; y++) {
		for (let x = Math.round(left - gap); x < left + gap; x++) {
			if (!dark(x, y) || dark(x - 1, y)) continue;
			const start = x;
			while (x + 1 < right && dark(x + 1, y)) x++;
			const width = x - start + 1;
			if (width < 3 * gap || width > maxWidth || (best && width <= best.width * gap)) continue;
			const depth = hookDepth(start, start + Math.round(gap * 0.5), y);
			if (depth < 1.5 * gap || depth > 8 * gap || hookDepth(x - Math.round(gap * 0.4), x, y) >= gap) continue;
			best = { width: width / gap, height: depth / gap };
		}
	}
	return best;
}

/** A handwritten instruction can end in a dashed line and a vertical stop
 * above the barline. Require three separated dashes leading into that stop. */
export function hasDashedEndingDirection(
	dark: InkReader, left: number, right: number, top: number, gap: number, cropTop: number
): boolean {
	const halfStop = Math.max(2, Math.round(0.45 * gap));
	for (let y = Math.max(cropTop + halfStop, Math.round(top - 5 * gap)); y < top - gap; y++) {
		for (let x = Math.round(right - gap * 0.9); x <= right + gap * 0.9; x++) {
			if (!dark(x, y) || !dark(x, y - halfStop) || !dark(x, y + halfStop)) continue;
			let dy = -halfStop;
			while (dy <= halfStop && dark(x, y + dy)) dy++;
			if (dy <= halfStop) continue;
			let cursor = x;
			while (cursor > left && dark(cursor, y)) cursor--;
			let dashes = 0;
			while (cursor > left) {
				const end = cursor;
				while (cursor > left && !dark(cursor, y)) cursor--;
				const space = end - cursor;
				if (space < 0.22 * gap || space > 1.9 * gap) break;
				const dash = cursor;
				while (cursor > left && dark(cursor, y)) cursor--;
				const width = dash - cursor;
				if (width < 0.5 * gap || width > 2.2 * gap) break;
				if (++dashes >= 3) return true;
			}
		}
	}
	return false;
}
