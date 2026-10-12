/** Layout policy shared by canvas extraction and corpus evaluation. No browser or model dependencies. */
import type { SystemGeometry } from './pdf-geometry';

/** Keep the chord row above a staff and exclude the next system's chord row. */
export function systemCropBounds(
	systems: SystemGeometry[],
	index: number,
	height: number
): [number, number] {
	const { band, interline } = systems[index];
	const previous = systems[index - 1];
	const next = systems[index + 1];
	const splitBefore = previous
		? previous.band.bottom + (band.top - previous.band.bottom) * 0.35
		: 0;
	const splitAfter = next ? band.bottom + (next.band.top - band.bottom) * 0.35 : height;
	return [
		Math.max(0, Math.round(Math.max(splitBefore, band.top - 10 * interline))),
		Math.min(height, Math.round(Math.min(splitAfter, band.bottom + 4 * interline)))
	];
}

/** Refuse a fixed bar-count skeleton when missing boundaries would force invented music. */
export function layoutIssues(systems: SystemGeometry[]): string[] {
	const issues: string[] = [];
	for (const [i, system] of systems.entries()) {
		const widths = system.barlines.slice(1).map((x, j) => x - system.barlines[j]);
		if (!system.barlines.length) issues.push(`line ${i + 1}: no measure boundaries detected`);
		if (widths.length > 1 && Math.max(...widths) > 2.8 * Math.min(...widths)) {
			issues.push(`line ${i + 1}: measure boundaries are uncertain`);
		}
		// A barline touching the header with a very wide following span is
		// typically an opening repeat, with obscured internal boundaries.
		if (
			system.barlines[0] - system.firstBarLeft < system.interline &&
			widths.some((w) => w > 35 * system.interline)
		) {
			issues.push(`line ${i + 1}: opening boundary or hidden barlines need a layout reread`);
		}
	}
	return issues;
}
