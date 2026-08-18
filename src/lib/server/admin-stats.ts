/**
 * Pure assembly logic for the /admin dashboard: joins auth users with their
 * profile, activity summaries, content counts and sync recency, and computes
 * the headline totals. All I/O lives in the route; this module takes plain
 * row arrays so it runs in Node tests (same pattern as health.ts).
 *
 * Timezone note: daily_summaries.date is a YYYY-MM-DD string in the USER'S
 * LOCAL timezone (written client-side), compared here against a UTC cutoff —
 * up to ±1 day of skew at timezone extremes, acceptable for a dashboard.
 */

/** Minimal shape of a Supabase auth user — kept local so this module stays dependency-free. */
export interface AdminAuthUser {
	id: string;
	email?: string;
	created_at?: string;
	last_sign_in_at?: string;
	email_confirmed_at?: string;
}

export interface AdminStatsInput {
	authUsers: AdminAuthUser[];
	profiles: { id: string; display_name: string | null; is_admin: boolean }[];
	summaries: { user_id: string; date: string; session_count: number; practice_minutes: number }[];
	/** One entry per live (deleted_at IS NULL) lick row — the query does the filtering. */
	lickOwners: string[];
	/** One entry per live tune row. */
	tuneOwners: string[];
	settings: { user_id: string; updated_at: string }[];
}

export interface AdminUserRow {
	id: string;
	email: string | null;
	displayName: string | null;
	isAdmin: boolean;
	createdAt: string | null;
	lastSignInAt: string | null;
	emailConfirmedAt: string | null;
	/** Newest daily_summaries.date (user-local YYYY-MM-DD) — the truthful activity signal. */
	lastActiveDate: string | null;
	sessionCount: number;
	practiceMinutes: number;
	lickCount: number;
	tuneCount: number;
	lastSyncAt: string | null;
}

export interface AdminTotals {
	totalUsers: number;
	signupsThisWeek: number;
	activeThisWeek: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** UTC YYYY-MM-DD of `now` minus 6 days — 7 calendar days including today. */
export function weekCutoffDateStr(now: Date): string {
	return new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function countByOwner(owners: string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const id of owners) counts.set(id, (counts.get(id) ?? 0) + 1);
	return counts;
}

export function buildAdminUserRows(input: AdminStatsInput): AdminUserRow[] {
	const profiles = new Map(input.profiles.map((p) => [p.id, p]));
	const settings = new Map(input.settings.map((s) => [s.user_id, s]));
	const lickCounts = countByOwner(input.lickOwners);
	const tuneCounts = countByOwner(input.tuneOwners);

	const activity = new Map<
		string,
		{ lastActiveDate: string; sessionCount: number; practiceMinutes: number }
	>();
	for (const s of input.summaries) {
		const entry = activity.get(s.user_id);
		if (!entry) {
			activity.set(s.user_id, {
				lastActiveDate: s.date,
				sessionCount: s.session_count,
				practiceMinutes: s.practice_minutes
			});
		} else {
			// Lexicographic max is chronological max on YYYY-MM-DD strings.
			if (s.date > entry.lastActiveDate) entry.lastActiveDate = s.date;
			entry.sessionCount += s.session_count;
			entry.practiceMinutes += s.practice_minutes;
		}
	}

	const rows = input.authUsers.map((u): AdminUserRow => {
		const profile = profiles.get(u.id);
		const act = activity.get(u.id);
		return {
			id: u.id,
			email: u.email ?? null,
			displayName: profile?.display_name ?? null,
			isAdmin: profile?.is_admin ?? false,
			createdAt: u.created_at ?? null,
			lastSignInAt: u.last_sign_in_at ?? null,
			emailConfirmedAt: u.email_confirmed_at ?? null,
			lastActiveDate: act?.lastActiveDate ?? null,
			sessionCount: act?.sessionCount ?? 0,
			practiceMinutes: act?.practiceMinutes ?? 0,
			lickCount: lickCounts.get(u.id) ?? 0,
			tuneCount: tuneCounts.get(u.id) ?? 0,
			lastSyncAt: settings.get(u.id)?.updated_at ?? null
		};
	});

	// Newest signup first; undated rows sink to the end.
	return rows.sort((a, b) => {
		const ta = a.createdAt ? Date.parse(a.createdAt) : Number.NEGATIVE_INFINITY;
		const tb = b.createdAt ? Date.parse(b.createdAt) : Number.NEGATIVE_INFINITY;
		return tb - ta;
	});
}

export function buildAdminTotals(rows: AdminUserRow[], now: Date): AdminTotals {
	const signupCutoff = now.getTime() - WEEK_MS;
	const activeCutoff = weekCutoffDateStr(now);

	let signupsThisWeek = 0;
	let activeThisWeek = 0;
	for (const row of rows) {
		if (row.createdAt && Date.parse(row.createdAt) >= signupCutoff) signupsThisWeek++;
		if (row.lastActiveDate && row.lastActiveDate >= activeCutoff) activeThisWeek++;
	}

	return { totalUsers: rows.length, signupsThisWeek, activeThisWeek };
}
