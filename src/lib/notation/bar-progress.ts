/** Fraction of the printed bar covered through the current beat. */
export function barBeatProgress(position: number | null, beats: number, silentBeats = 0): number {
	if (position === null || position < 0) return 0;
	const beat = (position % 1) * beats;
	if (beat < silentBeats) return 0;
	return (Math.floor(beat) + 1 - silentBeats) / (beats - silentBeats);
}
