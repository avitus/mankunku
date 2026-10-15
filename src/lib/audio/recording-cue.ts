/** Whole beat at the audible transport position; -1 while audio is preparing.
 * Call with getTicksAtTime(Tone.immediate()), never the look-ahead clock.
 */
export function recordingBeatAt(ticks: number, ppq: number, started: boolean): number {
	if (!started || !Number.isFinite(ticks) || !Number.isFinite(ppq) || ppq <= 0) return -1;
	return Math.max(0, Math.floor(ticks / ppq));
}
