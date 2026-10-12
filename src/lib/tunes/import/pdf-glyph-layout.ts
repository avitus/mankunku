/** Prefer explicit full-staff vector barlines when a notation font is present. */
import type { SystemGeometry } from './pdf-geometry';
import type { PageTextItem } from './pdf-text-chords';
import type { VectorPath } from './pdf-vector-paths';
export function refineGlyphLayout(
	system: SystemGeometry,
	items: PageTextItem[],
	paths: VectorPath[]
): SystemGeometry {
	const il = system.interline;
	const notes = items.filter(
		(i) =>
			/^[\ue0a2-\ue0a4]$/.test(i.str) &&
			i.y >= system.band.top - 3 * il &&
			i.y <= system.band.bottom + 3 * il
	);
	if (!notes.length) return system;
	const firstNote = Math.min(...notes.map((n) => n.x));
	const candidates = paths
		.filter((p) => !p.curved && p.width < 0.4 * il)
		.flatMap((p) => {
			const xs = p.points.map((a) => a[0]),
				y = p.points.map((a) => a[1]);
			const left = Math.min(...xs),
				right = Math.max(...xs),
				top = Math.min(...y),
				bottom = Math.max(...y);
			if (
				right - left > 0.4 * il ||
				Math.abs(top - system.band.top) > 0.25 * il ||
				Math.abs(bottom - system.band.bottom) > 0.25 * il ||
				right < firstNote
			)
				return [];
			const x = (left + right) / 2;
			if (notes.some((n) => Math.min(Math.abs(x - n.x), Math.abs(x - n.x - n.w)) < 0.3 * il))
				return [];
			return [x];
		})
		.sort((a, b) => a - b);
	const barlines: number[] = [];
	for (const x of candidates) {
		if (barlines.length && x - barlines.at(-1)! < il) barlines[barlines.length - 1] = x;
		else barlines.push(x);
	}
	if (
		!barlines.length ||
		notes.some((n) => n.x >= barlines.at(-1)!) ||
		barlines.some((x, i) => x - (i ? barlines[i - 1] : system.firstBarLeft) < 2 * il)
	)
		return system;
	// Preserve the far pixel edge of thick/double barlines where both
	// sources agree. Moving it to the thin inner stroke can clip a note.
	const aligned = barlines.map((x) => {
		const nearby = system.barlines
			.filter((b) => Math.abs(b - x) < 1.25 * il)
			.sort((a, b) => Math.abs(a - x) - Math.abs(b - x))[0];
		return nearby ?? x;
	});
	return {
		...system,
		barlines: aligned,
		repeatDots: aligned.map(() => ({ left: false, right: false }))
	};
}

/** Pixel spacing can look plausible despite one missing boundary. Add only
 * complete vector boundaries, preserving every existing boundary and repeat.
 */
export function supplementGlyphLayout(
	system: SystemGeometry,
	items: PageTextItem[],
	paths: VectorPath[]
): SystemGeometry {
	const il = system.interline;
	const firstEvent = items
		.filter(
			(i) =>
				/^[\ue0a2-\ue0a4\ue4e3-\ue4e9]$/.test(i.str) &&
				i.h >= 3.4 * il &&
				i.h <= 4.6 * il &&
				i.y >= system.band.top - 3 * il &&
				i.y <= system.band.bottom + 3 * il
		)
		.sort((a, b) => a.x - b.x)[0];
	const clef =
		firstEvent &&
		items.find(
			(i) =>
				/^[\ue050\ue062]$/.test(i.str) &&
				i.x < firstEvent.x - il &&
				i.y >= system.band.top &&
				i.y <= system.band.bottom
		);
	if (clef && firstEvent.x < system.firstBarLeft)
		system = { ...system, firstBarLeft: firstEvent.x - 0.5 * il };
	const refined = refineGlyphLayout(system, items, paths);
	const added = refined.barlines.filter(
		(x) => !system.barlines.some((b) => Math.abs(b - x) < 1.25 * system.interline)
	);
	if (!added.length) return system;
	const barlines = [...system.barlines, ...added].sort((a, b) => a - b);
	if (
		barlines.some((x, i) => x - (i ? barlines[i - 1] : system.firstBarLeft) < 2 * system.interline)
	)
		return system;
	return {
		...system,
		barlines,
		repeatDots: barlines.map(
			(x) => system.repeatDots[system.barlines.indexOf(x)] ?? { left: false, right: false }
		)
	};
}
