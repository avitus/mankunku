/**
 * Long-term progress history — daily aggregates persisted to localStorage.
 *
 * Captures compact daily summaries that survive the MAX_SESSIONS pruning window.
 * Provides query functions for calendar heatmaps, trend charts, and period comparisons.
 */

import type {
	DailySummary,
	GradeDistribution,
	ProgressMeta,
	PeriodStats,
	PeriodComparison,
	PeriodDelta,
	SessionResult,
	UserProgress
} from '$lib/types/progress';
import type { Grade } from '$lib/types/scoring';
import { save, load, remove } from '$lib/persistence/storage';

const SUMMARIES_KEY = 'daily-summaries';
const META_KEY = 'progress-meta';
const ESTIMATED_MINUTES_PER_SESSION = 2;

// ── Helpers ──────────────────────────────────────────────────────

function emptyGrades(): GradeDistribution {
	return { perfect: 0, great: 0, good: 0, fair: 0, tryAgain: 0 };
}

function gradeKey(grade: Grade): keyof GradeDistribution {
	if (grade === 'try-again') return 'tryAgain';
	return grade as keyof GradeDistribution;
}

export function localDateStr(d: Date): string {
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function dateKey(timestamp: number): string {
	return localDateStr(new Date(timestamp));
}

function createDefaultMeta(): ProgressMeta {
	return {
		version: 2,
		lastAggregationTimestamp: 0,
		longestStreak: 0,
		longestStreakEndDate: '',
		allTimeSessionCount: 0
	};
}

// ── Migration ────────────────────────────────────────────────────

/**
 * Minimal input shape for aggregateSession(). SessionResult satisfies this
 * directly; lick-practice attempts (which don't have a full SessionResult
 * record) build a small ad-hoc object that conforms.
 */
export interface AggregateInput {
	timestamp: number;
	overall: number;
	pitchAccuracy: number;
	rhythmAccuracy: number;
	grade: Grade;
	category: string;
	notesHit: number;
	notesTotal: number;
	source?: 'ear-training' | 'lick-practice';
}

function aggregateSessionGroup(date: string, sessions: SessionResult[]): DailySummary {
	const n = sessions.length;
	const grades = emptyGrades();
	const categories: Record<string, number> = {};
	let totalOverall = 0;
	let totalPitch = 0;
	let totalRhythm = 0;
	let bestScore = 0;
	let notesTotal = 0;
	let notesHit = 0;
	let earCount = 0;
	let lickCount = 0;

	for (const s of sessions) {
		totalOverall += s.overall;
		totalPitch += s.pitchAccuracy;
		totalRhythm += s.rhythmAccuracy;
		bestScore = Math.max(bestScore, s.overall);
		notesTotal += s.notesTotal;
		notesHit += s.notesHit;
		grades[gradeKey(s.grade)]++;
		categories[s.category] = (categories[s.category] ?? 0) + 1;
		// Sessions without `source` predate lick-practice — count as ear-training.
		if (s.source === 'lick-practice') lickCount++;
		else earCount++;
	}

	return {
		date,
		sessionCount: n,
		earTrainingSessions: earCount,
		lickPracticeSessions: lickCount,
		practiceMinutes: n * ESTIMATED_MINUTES_PER_SESSION,
		avgOverall: totalOverall / n,
		avgPitch: totalPitch / n,
		avgRhythm: totalRhythm / n,
		bestScore,
		notesTotal,
		notesHit,
		grades,
		categories
	};
}

function computeStreakInfo(dates: string[]): { longest: number; longestEndDate: string } {
	if (dates.length === 0) return { longest: 0, longestEndDate: '' };

	const sorted = [...dates].sort();
	let longest = 1;
	let longestEnd = sorted[0];
	let current = 1;

	for (let i = 1; i < sorted.length; i++) {
		const prev = new Date(sorted[i - 1]);
		const curr = new Date(sorted[i]);
		const diffDays = (curr.getTime() - prev.getTime()) / 86400000;

		if (Math.abs(diffDays - 1) < 0.01) {
			current++;
			if (current > longest) {
				longest = current;
				longestEnd = sorted[i];
			}
		} else {
			current = 1;
		}
	}

	return { longest, longestEndDate: longestEnd };
}

/** Pure computation: derive daily summaries from session history (no side effects). */
function deriveSummaries(sessions: SessionResult[]): {
	summaries: DailySummary[];
	meta: ProgressMeta;
} {
	if (sessions.length === 0) {
		return { summaries: [], meta: createDefaultMeta() };
	}

	const byDate = new Map<string, SessionResult[]>();
	for (const s of sessions) {
		const dk = dateKey(s.timestamp);
		const group = byDate.get(dk) ?? [];
		group.push(s);
		byDate.set(dk, group);
	}

	const summaries: DailySummary[] = [];
	for (const [date, group] of byDate) {
		summaries.push(aggregateSessionGroup(date, group));
	}
	summaries.sort((a, b) => a.date.localeCompare(b.date));

	const streakInfo = computeStreakInfo(summaries.map(s => s.date));
	return {
		summaries,
		meta: {
			version: 2,
			lastAggregationTimestamp: Date.now(),
			longestStreak: streakInfo.longest,
			longestStreakEndDate: streakInfo.longestEndDate,
			allTimeSessionCount: sessions.length
		}
	};
}

function runMigration(existingProgress: UserProgress | null): {
	summaries: DailySummary[];
	meta: ProgressMeta;
} {
	if (!existingProgress || existingProgress.sessions.length === 0) {
		return { summaries: [], meta: createDefaultMeta() };
	}
	const result = deriveSummaries(existingProgress.sessions);
	save(SUMMARIES_KEY, result.summaries);
	save(META_KEY, result.meta);
	return result;
}

// ── Load ─────────────────────────────────────────────────────────

function loadHistory(): { summaries: DailySummary[]; meta: ProgressMeta } {
	const savedMeta = load<ProgressMeta>(META_KEY);
	const savedSummaries = load<DailySummary[]>(SUMMARIES_KEY);

	if (savedMeta && savedMeta.version >= 2 && savedSummaries) {
		return { summaries: savedSummaries, meta: savedMeta };
	}

	// Need migration
	const existingProgress = load<UserProgress>('progress');
	return runMigration(existingProgress);
}

const loaded = loadHistory();

// ── Reactive state ───────────────────────────────────────────────

export const dailySummaries = $state<DailySummary[]>(loaded.summaries);
export const progressMeta = $state<ProgressMeta>(loaded.meta);

/** Map for O(1) lookup by date */
let summaryMap = new Map<string, DailySummary>(
	loaded.summaries.map(s => [s.date, s])
);

function saveAll(): void {
	save(SUMMARIES_KEY, dailySummaries);
	save(META_KEY, progressMeta);
}

// ── Core operations ──────────────────────────────────────────────

/**
 * Aggregate a single attempt (ear-training or lick-practice) into the day's
 * summary. Called from recordAttempt() and recordLickPracticeAttempt() in
 * progress.svelte.ts.
 *
 * `pitchComplexity` / `rhythmComplexity` snapshots are written only when the
 * caller passes them — lick-practice doesn't change adaptive state, so its
 * caller passes nothing and the existing snapshot (from the most recent
 * ear-training attempt) is preserved.
 *
 * Returns the (possibly newly created) summary so callers can sync the
 * touched day to the cloud without rescanning the array.
 */
export function aggregateSession(
	session: AggregateInput,
	pitchComplexity?: number,
	rhythmComplexity?: number
): DailySummary {
	const dk = dateKey(session.timestamp);
	const existing = summaryMap.get(dk);
	const source = session.source ?? 'ear-training';

	let summary: DailySummary;
	if (existing) {
		const newCount = existing.sessionCount + 1;
		existing.avgOverall = (existing.avgOverall * existing.sessionCount + session.overall) / newCount;
		existing.avgPitch = (existing.avgPitch * existing.sessionCount + session.pitchAccuracy) / newCount;
		existing.avgRhythm = (existing.avgRhythm * existing.sessionCount + session.rhythmAccuracy) / newCount;
		existing.bestScore = Math.max(existing.bestScore, session.overall);
		existing.notesTotal += session.notesTotal;
		existing.notesHit += session.notesHit;
		existing.sessionCount = newCount;
		existing.practiceMinutes += ESTIMATED_MINUTES_PER_SESSION;
		existing.grades[gradeKey(session.grade)]++;
		existing.categories[session.category] = (existing.categories[session.category] ?? 0) + 1;
		// Treat pre-split summaries (undefined counters) as ear-training-only,
		// matching how the calendar reads them, before incrementing.
		const earBase = existing.earTrainingSessions ?? existing.sessionCount - 1;
		const lickBase = existing.lickPracticeSessions ?? 0;
		existing.earTrainingSessions = earBase + (source === 'ear-training' ? 1 : 0);
		existing.lickPracticeSessions = lickBase + (source === 'lick-practice' ? 1 : 0);
		if (pitchComplexity !== undefined) existing.pitchComplexity = pitchComplexity;
		if (rhythmComplexity !== undefined) existing.rhythmComplexity = rhythmComplexity;
		summary = existing;
	} else {
		summary = {
			date: dk,
			sessionCount: 1,
			earTrainingSessions: source === 'ear-training' ? 1 : 0,
			lickPracticeSessions: source === 'lick-practice' ? 1 : 0,
			practiceMinutes: ESTIMATED_MINUTES_PER_SESSION,
			avgOverall: session.overall,
			avgPitch: session.pitchAccuracy,
			avgRhythm: session.rhythmAccuracy,
			bestScore: session.overall,
			notesTotal: session.notesTotal,
			notesHit: session.notesHit,
			grades: { ...emptyGrades(), [gradeKey(session.grade)]: 1 } as GradeDistribution,
			categories: { [session.category]: 1 }
		};
		if (pitchComplexity !== undefined) summary.pitchComplexity = pitchComplexity;
		if (rhythmComplexity !== undefined) summary.rhythmComplexity = rhythmComplexity;
		dailySummaries.push(summary);
		summaryMap.set(dk, summary);
	}

	progressMeta.allTimeSessionCount++;
	progressMeta.lastAggregationTimestamp = Date.now();

	updateLongestStreak();
	saveAll();
	return summary;
}

/**
 * Recompute longest streak from all daily summaries.
 */
export function updateLongestStreak(): void {
	const dates = dailySummaries.map(s => s.date);
	const info = computeStreakInfo(dates);
	if (info.longest > progressMeta.longestStreak) {
		progressMeta.longestStreak = info.longest;
		progressMeta.longestStreakEndDate = info.longestEndDate;
	}
}

/**
 * Clear all aggregation data (called from resetProgress).
 */
export function clearHistory(): void {
	dailySummaries.length = 0;
	summaryMap = new Map();
	Object.assign(progressMeta, createDefaultMeta());
	remove(SUMMARIES_KEY);
	remove(META_KEY);
}

/**
 * Merge a list of cloud-fetched daily summaries into local state.
 *
 * Cloud is authoritative when its sessionCount on a given date is >= local's
 * (covers the cross-device case where one device has more activity logged).
 * Local-only days are preserved untouched (offline writes that haven't synced).
 *
 * Returns the list of summaries the cloud should be told about: any day the
 * cloud is missing entirely, plus any same-date day where local has strictly
 * more activity than cloud (otherwise the cloud would stay stale on that day
 * and a subsequent device pull could restore the smaller summary).
 */
export function mergeCloudSummaries(cloudSummaries: DailySummary[]): DailySummary[] {
	let changed = false;
	const cloudDates = new Set<string>();
	const localWinnerDates = new Set<string>();

	for (const cs of cloudSummaries) {
		cloudDates.add(cs.date);
		const existing = summaryMap.get(cs.date);
		if (!existing) {
			dailySummaries.push(cs);
			summaryMap.set(cs.date, cs);
			changed = true;
			continue;
		}
		// Cloud wins when it has the same or more session activity for the day.
		// "More" comes up when another device practiced the same date and
		// pushed a fuller summary; "same" guards against the migration case
		// where the local copy was derived from the 100-session window and
		// matches the cloud row exactly.
		if (cs.sessionCount >= existing.sessionCount) {
			Object.assign(existing, cs);
			changed = true;
		} else {
			// Local has strictly more sessions for this date — keep local
			// in memory and flag it for upload so the cloud catches up.
			localWinnerDates.add(existing.date);
		}
	}

	if (changed) {
		dailySummaries.sort((a, b) => a.date.localeCompare(b.date));
		saveAll();
	}

	return dailySummaries.filter(
		(s) => !cloudDates.has(s.date) || localWinnerDates.has(s.date)
	);
}

function categoriesMatch(a: Record<string, number>, b: Record<string, number>): boolean {
	const aKeys = Object.keys(a);
	if (aKeys.length !== Object.keys(b).length) return false;
	for (const k of aKeys) {
		if (a[k] !== b[k]) return false;
	}
	return true;
}

function summariesMatch(a: DailySummary, b: DailySummary): boolean {
	// avg* fields are derived two different ways (rolling per-session vs full
	// re-derivation), so FP non-associativity can produce tiny diffs that
	// shouldn't count as a real change.
	const EPS = 1e-6;
	// Pre-split summaries omit ear/lick counters; treat them as
	// ear-training-only so a derive-pass that fills them in doesn't look
	// like a divergence on otherwise identical data.
	const aEar = a.earTrainingSessions ?? a.sessionCount;
	const bEar = b.earTrainingSessions ?? b.sessionCount;
	const aLick = a.lickPracticeSessions ?? 0;
	const bLick = b.lickPracticeSessions ?? 0;
	return (
		a.sessionCount === b.sessionCount &&
		aEar === bEar &&
		aLick === bLick &&
		a.practiceMinutes === b.practiceMinutes &&
		Math.abs(a.avgOverall - b.avgOverall) < EPS &&
		Math.abs(a.avgPitch - b.avgPitch) < EPS &&
		Math.abs(a.avgRhythm - b.avgRhythm) < EPS &&
		a.bestScore === b.bestScore &&
		a.notesTotal === b.notesTotal &&
		a.notesHit === b.notesHit &&
		JSON.stringify(a.grades) === JSON.stringify(b.grades) &&
		categoriesMatch(a.categories, b.categories)
	);
}

/**
 * Re-derive daily summaries from current progress session history when stale.
 *
 * Called after cloud hydration writes progress to localStorage. The session
 * log is pruned to MAX_SESSIONS recent sessions, so derivation only
 * sees the last MAX_SESSIONS sessions' worth of days. This function is therefore
 * additive: it upserts derived days into the existing summaries but never
 * deletes a day that exists locally and isn't in the derived set — that
 * day's sessions are simply outside the sync window.
 */
export function rebuildHistoryIfNeeded(): void {
	const progressState = load<UserProgress>('progress');
	if (!progressState || progressState.sessions.length === 0) return;

	const derived = deriveSummaries(progressState.sessions);
	if (derived.summaries.length === 0) return;

	// Fast-path: if every derived day already matches the existing summary
	// across all aggregate fields, there's nothing to persist.
	//
	// The earliest derived date is special: if some of that day's sessions
	// were pruned out of the MAX_SESSIONS window before derivation ran, the
	// derived summary undercounts the day. Skip the overwrite when the
	// existing summary has strictly larger totals — the local copy is the
	// authoritative one.
	const earliestDerivedDate = derived.summaries[0]?.date;
	let changed = false;
	for (const derivedSummary of derived.summaries) {
		const existing = summaryMap.get(derivedSummary.date);
		if (!existing) {
			dailySummaries.push(derivedSummary);
			summaryMap.set(derivedSummary.date, derivedSummary);
			changed = true;
			continue;
		}
		if (
			derivedSummary.date === earliestDerivedDate &&
			(existing.sessionCount > derivedSummary.sessionCount ||
				existing.notesTotal > derivedSummary.notesTotal ||
				existing.notesHit > derivedSummary.notesHit)
		) {
			continue;
		}
		if (!summariesMatch(existing, derivedSummary)) {
			Object.assign(existing, derivedSummary);
			changed = true;
		}
	}

	if (changed) dailySummaries.sort((a, b) => a.date.localeCompare(b.date));

	// allTimeSessionCount must never shrink — older sessions outside the
	// sync window still count. longestStreak likewise only grows.
	if (derived.meta.allTimeSessionCount > progressMeta.allTimeSessionCount) {
		progressMeta.allTimeSessionCount = derived.meta.allTimeSessionCount;
		changed = true;
	}

	if (changed) {
		progressMeta.lastAggregationTimestamp = derived.meta.lastAggregationTimestamp;
		updateLongestStreak();
		saveAll();
	}
}

// ── Query functions ──────────────────────────────────────────────

/**
 * Get summaries in a date range (inclusive).
 */
export function getSummariesInRange(start: string, end: string): DailySummary[] {
	return dailySummaries.filter(s => s.date >= start && s.date <= end);
}

/**
 * Compute aggregate stats for a date range.
 */
function computePeriodStats(start: string, end: string): PeriodStats {
	const summaries = getSummariesInRange(start, end);
	if (summaries.length === 0) {
		return { sessionCount: 0, avgOverall: 0, avgPitch: 0, avgRhythm: 0, practiceMinutes: 0, practiceDays: 0 };
	}

	let totalSessions = 0;
	let weightedOverall = 0;
	let weightedPitch = 0;
	let weightedRhythm = 0;
	let totalMinutes = 0;

	for (const s of summaries) {
		totalSessions += s.sessionCount;
		weightedOverall += s.avgOverall * s.sessionCount;
		weightedPitch += s.avgPitch * s.sessionCount;
		weightedRhythm += s.avgRhythm * s.sessionCount;
		totalMinutes += s.practiceMinutes;
	}

	return {
		sessionCount: totalSessions,
		avgOverall: weightedOverall / totalSessions,
		avgPitch: weightedPitch / totalSessions,
		avgRhythm: weightedRhythm / totalSessions,
		practiceMinutes: totalMinutes,
		practiceDays: summaries.length
	};
}

/**
 * Compare two periods (e.g., this week vs last week).
 */
export function comparePeriods(
	currentStart: string,
	currentEnd: string,
	previousStart: string,
	previousEnd: string
): PeriodComparison {
	const current = computePeriodStats(currentStart, currentEnd);
	const previous = computePeriodStats(previousStart, previousEnd);

	const delta: PeriodDelta = {
		sessionCount: current.sessionCount - previous.sessionCount,
		avgOverall: current.avgOverall - previous.avgOverall,
		avgPitch: current.avgPitch - previous.avgPitch,
		avgRhythm: current.avgRhythm - previous.avgRhythm,
		practiceMinutes: current.practiceMinutes - previous.practiceMinutes,
		practiceDays: current.practiceDays - previous.practiceDays
	};

	return { current, previous, delta };
}

/**
 * Get year heatmap data — one entry per day with practice data.
 */
export function getYearHeatmap(): Map<string, { sessionCount: number; avgOverall: number }> {
	const now = new Date();
	const yearAgo = new Date(now);
	yearAgo.setFullYear(yearAgo.getFullYear() - 1);
	const start = localDateStr(yearAgo);
	const end = localDateStr(now);

	const result = new Map<string, { sessionCount: number; avgOverall: number }>();
	for (const s of getSummariesInRange(start, end)) {
		result.set(s.date, { sessionCount: s.sessionCount, avgOverall: s.avgOverall });
	}
	return result;
}

/**
 * Get practice days in the last N days (for streak display).
 */
export function getLast30Days(): Map<string, boolean> {
	const result = new Map<string, boolean>();
	const now = new Date();
	for (let i = 0; i < 30; i++) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const dk = localDateStr(d);
		result.set(dk, summaryMap.has(dk));
	}
	return result;
}

// ── Date helpers ─────────────────────────────────────────────────

/** Get Monday of the week containing a date */
function getWeekStart(date: Date): Date {
	const d = new Date(date);
	const day = d.getDay();
	const diff = day === 0 ? -6 : 1 - day; // Monday = start
	d.setDate(d.getDate() + diff);
	d.setHours(0, 0, 0, 0);
	return d;
}

/** Get "YYYY-MM-DD" for a Date (local time) */
function toDateStr(d: Date): string {
	return localDateStr(d);
}

/**
 * Get this-week and last-week date ranges.
 */
export function getWeekRanges(): {
	currentStart: string;
	currentEnd: string;
	previousStart: string;
	previousEnd: string;
} {
	const now = new Date();
	const thisMonday = getWeekStart(now);
	const lastMonday = new Date(thisMonday);
	lastMonday.setDate(lastMonday.getDate() - 7);
	const lastSunday = new Date(thisMonday);
	lastSunday.setDate(lastSunday.getDate() - 1);

	return {
		currentStart: toDateStr(thisMonday),
		currentEnd: toDateStr(now),
		previousStart: toDateStr(lastMonday),
		previousEnd: toDateStr(lastSunday)
	};
}

/**
 * Get this-month and last-month date ranges.
 */
export function getMonthRanges(): {
	currentStart: string;
	currentEnd: string;
	previousStart: string;
	previousEnd: string;
} {
	const now = new Date();
	const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
	const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
	const lastMonthEnd = new Date(thisMonthStart);
	lastMonthEnd.setDate(lastMonthEnd.getDate() - 1);

	return {
		currentStart: toDateStr(thisMonthStart),
		currentEnd: toDateStr(now),
		previousStart: toDateStr(lastMonthStart),
		previousEnd: toDateStr(lastMonthEnd)
	};
}
