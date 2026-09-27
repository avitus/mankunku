import type { DailySummary } from '$lib/types/progress';

type Coverage = Pick<DailySummary, 'sessionCount' | 'earTrainingSessions' | 'lickPracticeSessions'>;
export type PracticeTime = NonNullable<DailySummary['practiceTime']> & { earMinutes: number; lickMinutes: number };

/** Validate persisted provenance before its minutes can override a cached total. */
export function readPracticeTime(value: unknown, coverage: Coverage): PracticeTime | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const snapshot = value as Record<string, unknown>;
	const { minutes, earTrainingSessions, lickPracticeSessions } = snapshot;
	const validNumber = (n: unknown): n is number =>
		typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 2147483647;
	const validCount = (n: unknown): n is number => validNumber(n) && Number.isInteger(n);
	if (!validCount(minutes) || !validCount(earTrainingSessions) || !validCount(lickPracticeSessions)) return undefined;
	const total = earTrainingSessions + lickPracticeSessions;
	if (total < 1 || total > 2147483647 ||
		earTrainingSessions > (coverage.earTrainingSessions ?? coverage.sessionCount) ||
		lickPracticeSessions > (coverage.lickPracticeSessions ?? 0)) return undefined;
	// Compatibility with the first provenance format: keep its total intact.
	const legacy = snapshot.earMinutes === undefined && snapshot.lickMinutes === undefined;
	const earMinutes = legacy
		? (lickPracticeSessions === 0 ? minutes : Math.min(minutes, earTrainingSessions * 0.5))
		: snapshot.earMinutes;
	const lickMinutes = legacy ? minutes - (earMinutes as number) : snapshot.lickMinutes;
	if (!validNumber(earMinutes) || !validNumber(lickMinutes) || Math.round(earMinutes + lickMinutes) !== minutes ||
		(earTrainingSessions === 0 && earMinutes !== 0) || (lickPracticeSessions === 0 && lickMinutes !== 0)) return undefined;
	return { minutes, earTrainingSessions, lickPracticeSessions, earMinutes, lickMinutes };
}

/** Merge each source independently so incomparable corrections preserve both. */
export function mergePracticeTime(a: PracticeTime | undefined, b: PracticeTime | undefined): PracticeTime | undefined {
	if (!a) return b;
	if (!b) return a;
	const ear = a.earTrainingSessions > b.earTrainingSessions ||
		(a.earTrainingSessions === b.earTrainingSessions && a.earMinutes >= b.earMinutes) ? a : b;
	const lick = a.lickPracticeSessions > b.lickPracticeSessions ||
		(a.lickPracticeSessions === b.lickPracticeSessions && a.lickMinutes >= b.lickMinutes) ? a : b;
	return {
		minutes: Math.round(ear.earMinutes + lick.lickMinutes),
		earMinutes: ear.earMinutes, lickMinutes: lick.lickMinutes,
		earTrainingSessions: ear.earTrainingSessions, lickPracticeSessions: lick.lickPracticeSessions
	};
}

/** Estimate only attempts beyond verified coverage; never reuse a stale total. */
export function practiceMinutesWithUncovered(time: PracticeTime, coverage: Coverage): number {
	const ear = Math.max(0, (coverage.earTrainingSessions ?? coverage.sessionCount) - time.earTrainingSessions);
	const lick = Math.max(0, (coverage.lickPracticeSessions ?? 0) - time.lickPracticeSessions);
	return Math.round(time.earMinutes + time.lickMinutes + (ear + lick) * 0.5);
}

/**
 * Read usable time without treating the retired two-minutes-per-attempt formula
 * as a duration. Keep the raw summary for recovery if source logs later arrive.
 * A validated source snapshot takes precedence, even if its duration happens to
 * equal that formula. Without source evidence that coincidence is ambiguous, so
 * report it as unavailable rather than silently inventing a replacement time.
 */
export function availablePracticeMinutes(summary: DailySummary): number | undefined {
	const time = readPracticeTime(summary.practiceTime, summary);
	if (time) return practiceMinutesWithUncovered(time, summary);
	if (summary.practiceTimeUnavailable || (summary.sessionCount > 0 && summary.practiceMinutes === summary.sessionCount * 2)) return undefined;
	return summary.practiceMinutes;
}
