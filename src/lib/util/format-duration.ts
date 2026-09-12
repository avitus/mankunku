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

/**
 * Format a total in whole minutes the way a person says it — "43m",
 * "1h 12m", "2h".
 *
 * Distinct from `formatDuration` on purpose: that one is a running clock, read
 * a second at a time, so it pads and keeps every field. This is a total read at
 * a glance (a day's practice, a week's), where a seconds field is noise and
 * "1h 0m" is worse than "1h". Input is rounded, not truncated — a summary of
 * fractional minutes should say 5m rather than 4m — and negatives clamp to
 * zero, since a total can't be negative.
 */
export function formatMinutes(minutes: number): string {
	const total = Math.max(0, Math.round(minutes));
	const h = Math.floor(total / 60);
	const m = total % 60;
	if (h === 0) return `${m}m`;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
