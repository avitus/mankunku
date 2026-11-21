/**
 * Calendar-day activity filters for the admin user list. Pure, so the date
 * choices are Node-testable outside the Svelte page.
 */

/** The dates an admin user row carries that say when the account was last used. */
export interface AdminSeenDates {
	/** Newest practice or signed-in visit day (YYYY-MM-DD). */
	lastActiveDate: string | null;
	lastSignInAt: string | null;
	createdAt: string | null;
}

const INACTIVE_DAYS = 30;
const ACTIVE_DAYS = 14;

/**
 * Newest day the account shows any sign of use: the latest of its last
 * practice/visit day, its last sign-in and its signup, as YYYY-MM-DD. The
 * newest, not the first one present — visit tracking can miss a sign-in, and
 * an older practice day must not hide it. Null with no dates at all.
 */
export function lastSeenDate(row: AdminSeenDates): string | null {
	const days = [row.lastActiveDate, row.lastSignInAt, row.createdAt]
		.filter((date): date is string => !!date)
		.map((date) => date.slice(0, 10));
	return days.length ? days.sort().at(-1)! : null;
}

/**
 * True when the newest sign of use reaches the day two weeks before `nowMs`
 * (UTC), inclusive. Practice dates are local, so they can be a day ahead of
 * UTC today; use the same lower-bound comparison as the weekly totals.
 */
export function isActive(row: AdminSeenDates, nowMs: number): boolean {
	const seen = lastSeenDate(row);
	const cutoff = new Date(nowMs - ACTIVE_DAYS * 86_400_000).toISOString().slice(0, 10);
	return !!seen && seen >= cutoff;
}

/**
 * True when the row's newest date falls on a calendar day earlier than the
 * day 30 days before `nowMs` (UTC). Days compare as days: the dates are kept to
 * the day, so a sign-in late on the cutoff day is still within the window.
 * A row with no dates is never inactive.
 */
export function isInactive(row: AdminSeenDates, nowMs: number): boolean {
	const seen = lastSeenDate(row);
	const cutoff = new Date(nowMs - INACTIVE_DAYS * 86_400_000).toISOString().slice(0, 10);
	return !!seen && seen < cutoff;
}
