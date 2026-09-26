import type { DailySummary } from '$lib/types/progress';

/** Validate persisted provenance before its minutes can override a cached total. */
export function readPracticeTime(
	value: unknown,
	coverage: Pick<DailySummary, 'sessionCount' | 'earTrainingSessions' | 'lickPracticeSessions'>
): DailySummary['practiceTime'] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const snapshot = value as Record<string, unknown>;
	const { minutes, earTrainingSessions, lickPracticeSessions } = snapshot;
	const validCount = (n: unknown): n is number =>
		typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 2147483647;
	if (!validCount(minutes) || !validCount(earTrainingSessions) || !validCount(lickPracticeSessions)) return undefined;
	const total = earTrainingSessions + lickPracticeSessions;
	if (total < 1 || total > 2147483647 ||
		earTrainingSessions > (coverage.earTrainingSessions ?? coverage.sessionCount) ||
		lickPracticeSessions > (coverage.lickPracticeSessions ?? 0)) return undefined;
	return { minutes, earTrainingSessions, lickPracticeSessions };
}
