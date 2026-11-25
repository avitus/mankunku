/** Fraction of the printed bar covered through the current beat. */
export function barBeatProgress(position: number | null, beats: number): number {
	if (position === null || position < 0) return 0;
	return (Math.floor((position % 1) * beats) + 1) / beats;
}
