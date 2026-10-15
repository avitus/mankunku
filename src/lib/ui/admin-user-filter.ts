/**
 * The admin user table's "No activity in 30 days" filter. Pure, so the date
 * choice is Node-testable outside the Svelte page.
 */

/** The dates an admin user row carries that say when the account was last used. */
export interface AdminSeenDates {
	/** Newest practice or signed-in visit day (YYYY-MM-DD). */
	lastActiveDate: string | null;
	lastSignInAt: string | null;
	createdAt: string | null;
}

const INACTIVE_DAYS = 30;

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

/** True when the row's newest date is more than 30 days before `nowMs`; a row with no dates is never inactive. */
export function isInactive(row: AdminSeenDates, nowMs: number): boolean {
	const seen = lastSeenDate(row);
	return !!seen && Date.parse(seen) < nowMs - INACTIVE_DAYS * 86_400_000;
}
