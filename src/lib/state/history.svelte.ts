/**
 * Long-term progress history — daily aggregates persisted to localStorage.
 *
 * Captures compact daily summaries that survive the 200-session pruning window.
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
} from '$lib/types/progress.ts';
import type { Grade } from '$lib/types/scoring.ts';
import { save, load, remove } from '$lib/persistence/storage.ts';

const SUMMARIES_KEY = 'daily-summaries';
const META_KEY = 'progress-meta';
const ESTIMATED_MINUTES_PER_SESSION = 2;

/** XP per grade (mirrors adaptive.ts XP_TABLE) */
const XP_TABLE: Record<string, number> = {
	perfect: 100,
	great: 75,
	good: 50,
	fair: 25,
	'try-again': 10
};

// ── Helpers ──────────────────────────────────────────────────────

function emptyGrades(): GradeDistribution {
	return { perfect: 0, great: 0, good: 0, fair: 0, tryAgain: 0 };
}

function gradeKey(grade: Grade): keyof GradeDistribution {
	if (grade === 'try-again') return 'tryAgain';
	return grade as keyof GradeDistribution;
}

function localDateStr(d: Date): string {
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
	let xpEarned = 0;

	for (const s of sessions) {
		totalOverall += s.overall;
		totalPitch += s.pitchAccuracy;
		totalRhythm += s.rhythmAccuracy;
		bestScore = Math.max(bestScore, s.overall);
		notesTotal += s.notesTotal;
		notesHit += s.notesHit;
		grades[gradeKey(s.grade)]++;
		categories[s.category] = (categories[s.category] ?? 0) + 1;
		xpEarned += XP_TABLE[s.grade] ?? 10;
	}

	return {
		date,
		sessionCount: n,
		practiceMinutes: n * ESTIMATED_MINUTES_PER_SESSION,
		avgOverall: totalOverall / n,
		avgPitch: totalPitch / n,
		avgRhythm: totalRhythm / n,
		bestScore,
		notesTotal,
		notesHit,
		grades,
		categories,
		xpEarned
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
 * Aggregate a new session into today's daily summary.
 * Called from recordAttempt() in progress.svelte.ts.
 */
export function aggregateSession(session: SessionResult): void {
	const dk = dateKey(session.timestamp);
	const existing = summaryMap.get(dk);

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
		existing.xpEarned += XP_TABLE[session.grade] ?? 10;
	} else {
		const summary = aggregateSessionGroup(dk, [session]);
		dailySummaries.push(summary);
		summaryMap.set(dk, summary);
	}

	progressMeta.allTimeSessionCount++;
	progressMeta.lastAggregationTimestamp = Date.now();

	updateLongestStreak();
	saveAll();
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
 * Re-derive daily summaries from current progress session history when stale.
 *
 * Called after cloud hydration writes progress to localStorage. Computes the
 * expected summaries from the (now cloud-hydrated) sessions and compares them
 * against the existing in-memory summaries. If they differ — different length,
 * or any day's date or sessionCount doesn't match — the existing data is replaced.
 *
 * Limited to the 200-session sync window — history beyond that is not preserved
 * cross-device.
 */
export function rebuildHistoryIfNeeded(): void {
	const progressState = load<UserProgress>('progress');
	if (!progressState || progressState.sessions.length === 0) return;

	const derived = deriveSummaries(progressState.sessions);
	if (derived.summaries.length === 0) return;

	// Check if existing summaries already match the derived data.
	// Compare per-day date + sessionCount to catch mid-range differences
	// (length + latest date alone can miss changed counts on existing dates).
	if (dailySummaries.length === derived.summaries.length) {
		let match = true;
		for (let i = 0; i < dailySummaries.length; i++) {
			if (dailySummaries[i].date !== derived.summaries[i].date
				|| dailySummaries[i].sessionCount !== derived.summaries[i].sessionCount) {
				match = false;
				break;
			}
		}
		if (match) return;
	}

	// Summaries are stale — replace with recomputed data
	dailySummaries.length = 0;
	dailySummaries.push(...derived.summaries);
	summaryMap = new Map(derived.summaries.map(s => [s.date, s]));
	Object.assign(progressMeta, derived.meta);
	saveAll();
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
