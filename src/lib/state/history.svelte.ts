/**
 * Long-term progress history — daily aggregates persisted to localStorage.
 *
 * Daily summaries are a PURE DERIVATION of two source-of-truth tables:
 *   - `progress.sessions` (ear-training, capped at MAX_SESSIONS)
 *   - `lick-practice-sessions` (lick session log, capped at MAX_SESSIONS)
 *
 * Every write that affects either source calls `recomputeAllDailySummaries`,
 * which re-derives summaries for all dates present in the sources. The
 * persisted `daily-summaries` blob serves as a cache for past days whose
 * source rows have aged out of the MAX_SESSIONS window — those days survive
 * untouched until the cloud merge brings in newer data.
 *
 * Pure derivation means: replaying a write is a no-op, divergence is
 * self-correcting on the next recompute, and there is no per-attempt
 * mutation path that can race with the rebuild path.
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
import type { LickPracticeSessionLogEntry } from '$lib/persistence/lick-practice-sessions';
import { save, load, remove } from '$lib/persistence/storage';
import { scoreToGrade } from '$lib/scoring/grades';

const SUMMARIES_KEY = 'daily-summaries';
const META_KEY = 'progress-meta';
const ESTIMATED_MINUTES_PER_SESSION = 2;
const PROGRESS_KEY = 'progress';
const LICK_SESSIONS_KEY = 'lick-practice-sessions';

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

// ── Pure derivation ─────────────────────────────────────────────

/**
 * Derive a single day's summary from the two source-of-truth tables.
 * Returns `null` when neither source has activity for the date.
 *
 * Caveat: `notesTotal` / `notesHit` and the `categories` breakdown reflect
 * ear-training only — the lick-practice session log stores per-key scores
 * but not per-key note counts or categories. The calendar's lick-practice
 * cell intensity comes from `lickPracticeSessions`, so this is enough; the
 * downstream readers of notes/categories already display ear-training data.
 *
 * `pitchComplexity` / `rhythmComplexity` is preserved when the caller
 * passes a snapshot — recordAttempt grabs the live adaptive state at write
 * time, since SessionResult itself doesn't carry the snapshot.
 */
export function deriveDailySummary(
	date: string,
	earSessions: SessionResult[],
	lickEntries: LickPracticeSessionLogEntry[],
	preservedComplexity?: { pitch?: number; rhythm?: number }
): DailySummary | null {
	const dayEar = earSessions.filter((s) => dateKey(s.timestamp) === date);
	const dayLick = lickEntries.filter((e) => dateKey(e.timestamp) === date);

	const earCount = dayEar.length;
	const lickCount = dayLick.reduce((sum, e) => sum + e.report.totalAttempts, 0);
	const total = earCount + lickCount;

	if (total === 0) return null;

	let overallSum = 0;
	let pitchSum = 0;
	let rhythmSum = 0;
	let bestScore = 0;
	const grades = emptyGrades();

	for (const s of dayEar) {
		overallSum += s.overall;
		pitchSum += s.pitchAccuracy;
		rhythmSum += s.rhythmAccuracy;
		bestScore = Math.max(bestScore, s.overall);
		grades[gradeKey(s.grade)]++;
	}

	for (const entry of dayLick) {
		for (const lick of entry.report.licks) {
			for (const key of lick.keys) {
				overallSum += key.score;
				pitchSum += key.pitchAccuracy;
				rhythmSum += key.rhythmAccuracy;
				bestScore = Math.max(bestScore, key.score);
				grades[gradeKey(scoreToGrade(key.score))]++;
			}
		}
	}

	const attemptCount = earCount + lickCount;

	let notesTotal = 0;
	let notesHit = 0;
	for (const s of dayEar) {
		notesTotal += s.notesTotal;
		notesHit += s.notesHit;
	}

	const categories: Record<string, number> = {};
	for (const s of dayEar) {
		categories[s.category] = (categories[s.category] ?? 0) + 1;
	}

	const summary: DailySummary = {
		date,
		sessionCount: total,
		earTrainingSessions: earCount,
		lickPracticeSessions: lickCount,
		practiceMinutes: total * ESTIMATED_MINUTES_PER_SESSION,
		avgOverall: overallSum / attemptCount,
		avgPitch: pitchSum / attemptCount,
		avgRhythm: rhythmSum / attemptCount,
		bestScore,
		notesTotal,
		notesHit,
		grades,
		categories
	};

	if (preservedComplexity?.pitch !== undefined) summary.pitchComplexity = preservedComplexity.pitch;
	if (preservedComplexity?.rhythm !== undefined)
		summary.rhythmComplexity = preservedComplexity.rhythm;

	return summary;
}

// ── Load ─────────────────────────────────────────────────────────

function loadHistory(): { summaries: DailySummary[]; meta: ProgressMeta } {
	const savedMeta = load<ProgressMeta>(META_KEY);
	const savedSummaries = load<DailySummary[]>(SUMMARIES_KEY);

	if (savedMeta && savedMeta.version >= 2 && savedSummaries) {
		return { summaries: savedSummaries, meta: savedMeta };
	}

	return { summaries: savedSummaries ?? [], meta: savedMeta ?? createDefaultMeta() };
}

const loaded = loadHistory();

// ── Reactive state ───────────────────────────────────────────────

export const dailySummaries = $state<DailySummary[]>(loaded.summaries);
export const progressMeta = $state<ProgressMeta>(loaded.meta);

let summaryMap = new Map<string, DailySummary>(loaded.summaries.map((s) => [s.date, s]));

function saveAll(): void {
	save(SUMMARIES_KEY, dailySummaries);
	save(META_KEY, progressMeta);
}

// ── Public write API ────────────────────────────────────────────

/**
 * Take the per-counter max of derived (from current sources) and any
 * existing cached summary. Counters within a day are monotonic — you
 * can't undo a session — so max protects the cached value against
 * source-table pruning: if the lick log has aged a day's entries out,
 * `derived.lickPracticeSessions` would be 0 but `existing.lickPracticeSessions`
 * still carries the real count. Reset explicitly clears the cache, so
 * max never strands wrong data.
 */
function mergeWithExisting(existing: DailySummary | undefined, derived: DailySummary): DailySummary {
	if (!existing) return derived;
	const ear = Math.max(existing.earTrainingSessions ?? 0, derived.earTrainingSessions ?? 0);
	const lick = Math.max(existing.lickPracticeSessions ?? 0, derived.lickPracticeSessions ?? 0);
	const merged: DailySummary = {
		...derived,
		earTrainingSessions: ear,
		lickPracticeSessions: lick,
		sessionCount: ear + lick,
		practiceMinutes: (ear + lick) * ESTIMATED_MINUTES_PER_SESSION
	};
	// Notes / averages prefer the source with more total attempts on record.
	const derivedTotal = (derived.earTrainingSessions ?? 0) + (derived.lickPracticeSessions ?? 0);
	const existingTotal = (existing.earTrainingSessions ?? 0) + (existing.lickPracticeSessions ?? 0);
	if (existingTotal > derivedTotal) {
		merged.notesTotal = existing.notesTotal;
		merged.notesHit = existing.notesHit;
		merged.avgOverall = existing.avgOverall;
		merged.avgPitch = existing.avgPitch;
		merged.avgRhythm = existing.avgRhythm;
		merged.bestScore = Math.max(existing.bestScore, derived.bestScore);
		merged.grades = existing.grades;
		merged.categories = existing.categories;
	}
	return merged;
}

/**
 * Re-derive daily summaries for every date present in the source tables.
 * Idempotent: safe to call after any write. Past days outside the source
 * window (older than the most recent MAX_SESSIONS attempts) are left
 * untouched — their data lives in the persisted cache until cloud merge
 * brings in newer information.
 *
 * @param complexitySnapshots optional date→{pitch,rhythm} map for adaptive
 *   level snapshots. Caller supplies these at write time because
 *   SessionResult doesn't carry adaptive complexity; supplied values
 *   override any preserved value for that date.
 */
export function recomputeAllDailySummaries(
	complexitySnapshots?: Map<string, { pitch: number; rhythm: number }>
): DailySummary[] {
	const earSessions = load<UserProgress>(PROGRESS_KEY)?.sessions ?? [];
	const lickEntries = load<LickPracticeSessionLogEntry[]>(LICK_SESSIONS_KEY) ?? [];

	const dates = new Set<string>();
	for (const s of earSessions) dates.add(dateKey(s.timestamp));
	for (const e of lickEntries) dates.add(dateKey(e.timestamp));

	const touched: DailySummary[] = [];

	for (const date of dates) {
		const existing = summaryMap.get(date);
		const snapshot =
			complexitySnapshots?.get(date) ??
			(existing ? { pitch: existing.pitchComplexity, rhythm: existing.rhythmComplexity } : undefined);

		const derived = deriveDailySummary(date, earSessions, lickEntries, snapshot);
		if (derived === null) continue;
		const merged = mergeWithExisting(existing, derived);

		if (existing) {
			Object.assign(existing, merged);
			touched.push(existing);
		} else {
			dailySummaries.push(merged);
			summaryMap.set(date, merged);
			touched.push(merged);
		}
	}

	if (touched.length > 0) {
		dailySummaries.sort((a, b) => a.date.localeCompare(b.date));
	}

	const allTime = Math.max(
		progressMeta.allTimeSessionCount,
		dailySummaries.reduce((sum, s) => sum + s.sessionCount, 0)
	);
	if (allTime !== progressMeta.allTimeSessionCount) {
		progressMeta.allTimeSessionCount = allTime;
	}
	progressMeta.lastAggregationTimestamp = Date.now();
	updateLongestStreak();
	saveAll();

	return touched;
}

/**
 * Recompute the summary for a single date. Equivalent to
 * `recomputeAllDailySummaries` filtered to one day; offered as a hot-path
 * helper for callers that know exactly which date they touched.
 */
export function recomputeDailySummary(
	date: string,
	complexitySnapshot?: { pitch: number; rhythm: number }
): DailySummary | null {
	const earSessions = load<UserProgress>(PROGRESS_KEY)?.sessions ?? [];
	const lickEntries = load<LickPracticeSessionLogEntry[]>(LICK_SESSIONS_KEY) ?? [];

	const existing = summaryMap.get(date);
	const snapshot =
		complexitySnapshot ??
		(existing ? { pitch: existing.pitchComplexity, rhythm: existing.rhythmComplexity } : undefined);

	const derived = deriveDailySummary(date, earSessions, lickEntries, snapshot);
	if (derived === null) return existing ?? null;
	const merged = mergeWithExisting(existing, derived);

	if (existing) {
		Object.assign(existing, merged);
	} else {
		dailySummaries.push(merged);
		summaryMap.set(date, merged);
		dailySummaries.sort((a, b) => a.date.localeCompare(b.date));
	}

	const allTime = Math.max(
		progressMeta.allTimeSessionCount,
		dailySummaries.reduce((sum, s) => sum + s.sessionCount, 0)
	);
	if (allTime !== progressMeta.allTimeSessionCount) {
		progressMeta.allTimeSessionCount = allTime;
	}
	progressMeta.lastAggregationTimestamp = Date.now();
	updateLongestStreak();
	saveAll();

	return existing ?? merged;
}

/**
 * Recompute longest streak from current daily summaries. Only grows —
 * historical peaks survive even after pruning.
 */
export function updateLongestStreak(): void {
	const dates = dailySummaries.filter((s) => s.sessionCount > 0).map((s) => s.date);
	const info = computeStreakInfo(dates);
	if (info.longest > progressMeta.longestStreak) {
		progressMeta.longestStreak = info.longest;
		progressMeta.longestStreakEndDate = info.longestEndDate;
	}
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

/**
 * Clear all aggregation data — called from resetProgress.
 */
export function clearHistory(): void {
	dailySummaries.length = 0;
	summaryMap = new Map();
	Object.assign(progressMeta, createDefaultMeta());
	remove(SUMMARIES_KEY);
	remove(META_KEY);
}

// ── Cloud merge ────────────────────────────────────────────────

/**
 * Reconcile cloud summaries with local. Summaries are a PURE derivation of the
 * source logs, so once sessions sync by union every device re-derives the same,
 * correct combined summary for any date whose source rows it still holds. This
 * reconcile therefore branches on whether THIS device can derive the date:
 *
 *  - DERIVABLE (source rows present locally): the fresh local re-derivation is
 *    authoritative — the cloud row is ignored, and the local summary is pushed
 *    (overwrite). This is what fixes the old clobber / undercount / equal-count
 *    deadlock: two devices' same-day activity both land in the unioned sources
 *    and are counted once, and the derivation always wins over a stale cloud row.
 *  - AGED-OUT (no local source rows to derive from): the day is finalized, so a
 *    per-counter MAX merge is safe and monotonic — the most-complete derivation
 *    ever recorded wins and can't be lowered.
 *
 * Returns the dates the cloud must be told about (derivable dates + local-only
 * days + aged-out local winners), for `syncAllDailySummariesToCloud`.
 */
export function reconcileCloudSummaries(cloudSummaries: DailySummary[]): DailySummary[] {
	const earSessions = load<UserProgress>(PROGRESS_KEY)?.sessions ?? [];
	const lickEntries = load<LickPracticeSessionLogEntry[]>(LICK_SESSIONS_KEY) ?? [];
	const derivable = new Set<string>();
	for (const s of earSessions) derivable.add(dateKey(s.timestamp));
	for (const e of lickEntries) derivable.add(dateKey(e.timestamp));

	const cloudDates = new Set<string>();
	const localWinners = new Set<string>();
	let changed = false;

	for (const cs of cloudSummaries) {
		cloudDates.add(cs.date);
		// Derivable dates: local re-derivation is authoritative — never let a
		// stale cloud row modify it; it will be pushed (overwrite) below.
		if (derivable.has(cs.date)) continue;

		// Aged-out date: MAX-merge into local (safe: finalized, monotonic).
		const existing = summaryMap.get(cs.date);
		if (!existing) {
			dailySummaries.push(cs);
			summaryMap.set(cs.date, cs);
			changed = true;
			continue;
		}
		if (existing.sessionCount > cs.sessionCount) {
			localWinners.add(existing.date);
		}
		const merged = mergeWithExisting(existing, cs);
		Object.assign(existing, merged);
		changed = true;
	}

	if (changed) {
		dailySummaries.sort((a, b) => a.date.localeCompare(b.date));
		saveAll();
	}

	return dailySummaries.filter(
		(s) => derivable.has(s.date) || !cloudDates.has(s.date) || localWinners.has(s.date)
	);
}

/**
 * Outbox flush handler: reconcile against the cloud and push local-authoritative
 * summaries. Throws when the cloud read fails (so it retries offline); the push
 * itself is best-effort (every session re-enqueues, so it self-heals).
 */
export async function flushDailySummariesToCloud(
	supabase: import('@supabase/supabase-js').SupabaseClient<import('$lib/supabase/types').Database>
): Promise<void> {
	const { loadDailySummariesFromCloud, syncAllDailySummariesToCloud } = await import(
		'$lib/persistence/sync'
	);
	const cloud = await loadDailySummariesFromCloud(supabase);
	if (cloud == null) throw new Error('daily summaries load failed — deferring push');
	const toPush = reconcileCloudSummaries(cloud);
	if (toPush.length > 0) await syncAllDailySummariesToCloud(supabase, toPush);
}

// ── Query functions ──────────────────────────────────────────────

export function getSummariesInRange(start: string, end: string): DailySummary[] {
	return dailySummaries.filter((s) => s.date >= start && s.date <= end);
}

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

function getWeekStart(date: Date): Date {
	const d = new Date(date);
	const day = d.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	d.setDate(d.getDate() + diff);
	d.setHours(0, 0, 0, 0);
	return d;
}

function toDateStr(d: Date): string {
	return localDateStr(d);
}

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
