/**
 * Format a duration in seconds as a clock readout.
 *
 * Sub-hour durations render as `m:ss` (the minutes field is unpadded, so it
 * reads as a stopwatch rather than a time of day); an hours field appears only
 * once one has actually elapsed, so the common case stays as short as possible.
 * Fractional seconds are truncated and negative input clamps to zero, so a
 * clock driven by wall-clock deltas can never display a negative time.
 */
export function formatDuration(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const s = total % 60;
	const m = Math.floor(total / 60) % 60;
	const h = Math.floor(total / 3600);
	const pad = (n: number): string => n.toString().padStart(2, '0');
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
