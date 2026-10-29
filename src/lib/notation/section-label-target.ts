export interface LabelBarTarget {
	bar: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Pick the closest staff below the pointer, then its closest bar horizontally. */
export function nearestLabelBar(bars: LabelBarTarget[], x: number, y: number): LabelBarTarget | null {
	if (!bars.length) return null;
	const below = bars.filter(b => b.y + b.height >= y);
	const candidates = below.length ? below : bars;
	const row = candidates.reduce((best, b) => Math.abs(b.y - y) < Math.abs(best.y - y) ? b : best);
	return candidates.filter(b => Math.abs(b.y - row.y) < 0.01).reduce((best, b) => {
		const distance = (v: LabelBarTarget) => Math.max(v.x - x, 0, x - v.x - v.width);
		return distance(b) < distance(best) ? b : best;
	});
}
