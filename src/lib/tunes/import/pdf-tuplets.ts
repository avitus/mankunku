/** Resolve printed triplet labels jointly. All selected groups must be disjoint,
 * account for the printed meter, and beat the next assignment geometrically.
 * The bounded search declines complex/ambiguous notation instead of guessing.
 */
export function resolvePrintedTriplets(
	events: Array<{ x: number; center: number; duration: number }>,
	labels: Array<{ x: number; w: number }>,
	beats: number,
	interline: number
): number[] | null {
	const original = events.map((e) => e.duration);
	if (!labels.length) return original;
	if (labels.length > 8 || events.length > 128) return null;
	const candidates = labels.map((label) => {
		const options: Array<{ index: number; distance: number }> = [];
		for (let i = 0; i <= events.length - 3; i++) {
			const group = events.slice(i, i + 3);
			if (
				group.some((e) => Math.abs(e.duration - group[0].duration) > 1e-6) ||
				label.x < group[0].x - interline ||
				label.x > group[2].x + interline
			)
				continue;
			options.push({
				index: i,
				distance: Math.abs((group[0].center + group[2].center) / 2 - label.x - label.w / 2)
			});
		}
		return options;
	});
	if (candidates.some((c) => !c.length)) return null;
	const solutions: Array<{ durations: number[]; distance: number }> = [];
	let visited = 0;
	const visit = (label: number, used: Set<number>, durations: number[], distance: number) => {
		if (++visited > 4096) return;
		if (label === labels.length) {
			if (Math.abs(durations.reduce((s, d) => s + d, 0) - beats) < 1e-5)
				solutions.push({ durations, distance });
			return;
		}
		for (const option of candidates[label]) {
			const indices = [option.index, option.index + 1, option.index + 2];
			if (indices.some((i) => used.has(i))) continue;
			const next = [...durations];
			for (const i of indices) next[i] *= 2 / 3;
			visit(label + 1, new Set([...used, ...indices]), next, distance + option.distance);
		}
	};
	visit(0, new Set(), original, 0);
	if (visited > 4096 || !solutions.length) return null;
	solutions.sort((a, b) => a.distance - b.distance);
	// Different label assignments that produce identical rhythms are equivalent.
	const alternative = solutions.find((s) =>
		s.durations.some((d, i) => Math.abs(d - solutions[0].durations[i]) > 1e-6)
	);
	if (alternative && alternative.distance - solutions[0].distance < 0.5 * interline) return null;
	return solutions[0].durations;
}
