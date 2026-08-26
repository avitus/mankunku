/**
 * Format a Date as a local-timezone "YYYY-MM-DD" string.
 *
 * Uses local time, not UTC — a session at 11 PM belongs to that day, and all
 * daily-summary / trend bucketing keys on these strings.
 */
export function localDateStr(d: Date): string {
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}
