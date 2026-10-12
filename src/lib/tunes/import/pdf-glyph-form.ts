/** Structural marks from embedded glyphs and vector brackets. */
import type { PageTextItem, SystemTexts } from './pdf-text-chords';
import type { SystemGeometry } from './pdf-geometry';
import type { VectorPath } from './pdf-vector-paths';
export function readGlyphForm(
	system: SystemGeometry,
	items: PageTextItem[],
	texts: SystemTexts,
	paths: VectorPath[]
): { geometry: SystemGeometry; texts: SystemTexts } {
	const il = system.interline,
		position = (y: number) => ((system.band.bottom - y) * 2) / il;
	if (
		!items.some(
			(i) =>
				/^[\ue0a2-\ue0a4]$/.test(i.str) &&
				i.y >= system.band.top - 3 * il &&
				i.y <= system.band.bottom + 3 * il
		)
	)
		return { geometry: system, texts };
	const dots = items.filter(
		(i) =>
			i.str === '\ue044' && (Math.abs(position(i.y) - 3) < 0.3 || Math.abs(position(i.y) - 5) < 0.3)
	);
	const geometry = {
		...system,
		initialRepeat: false,
		repeatDots: system.barlines.map(() => ({ left: false, right: false }))
	};
	for (const dot of dots) {
		if (
			!dots.some(
				(other) =>
					other !== dot &&
					Math.abs(other.x - dot.x) < 0.2 * il &&
					Math.abs(Math.abs(position(other.y) - position(dot.y)) - 2) < 0.3
			)
		)
			continue;
		const x = dot.x + dot.w / 2;
		const b = system.barlines
			.map((x, i) => ({ x, i }))
			.sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
		if (b && Math.abs(b.x - x) < 2 * il) {
			geometry.repeatDots[b.i][x < b.x ? 'left' : 'right'] = true;
		} else if (x < system.barlines[0] && x < system.firstBarLeft + 2 * il)
			geometry.initialRepeat = true;
	}
	const lines = paths
		.filter((p) => !p.curved && !p.filled)
		.flatMap((p) =>
			p.points
				.slice(1)
				.map((to, i) => ({
					x0: Math.min(p.points[i][0], to[0]),
					x1: Math.max(p.points[i][0], to[0]),
					y: p.points[i][1],
					dy: Math.abs(p.points[i][1] - to[1])
				}))
		)
		.filter((p) => p.dy < 0.1 * il && p.y < system.band.top - il && p.y > system.band.top - 9 * il);
	const bracket = (x: number) =>
		lines
			.filter((p) => p.x0 <= x + 0.6 * il && p.x0 >= x - il && p.x1 > x + il)
			.sort((a, b) => b.y - a.y)[0];
	const labels = [...texts.endings];
	for (const item of items) {
		if (
			!/^[12]$/.test(item.str.trim()) ||
			item.y >= system.band.top - il ||
			item.y < system.band.top - 9 * il
		)
			continue;
		const line = bracket(item.x);
		if (
			line &&
			item.y > line.y &&
			item.y < line.y + 3 * il &&
			!labels.some((e) => Math.abs(e.x - item.x) < il)
		)
			labels.push({ x: item.x, n: Number(item.str) });
	}
	const endings = labels
		.map((e) => {
			const line = bracket(e.x);
			return line ? { ...e, endX: line.x1 } : e;
		})
		.sort((a, b) => a.x - b.x);
	return { geometry, texts: { ...texts, endings } };
}
