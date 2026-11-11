import type { DailySummary } from '$lib/types/progress';
import { localDateStr } from './local-date';

type PracticeDay = Pick<DailySummary, 'date' | 'sessionCount' | 'earTrainingSessions' | 'lickPracticeSessions'>;

/** Count distinct active calendar dates, including today and the preceding 364 days.
 * Match the Progress calendar's two activity halves, including pre-split history.
 * Calendar arithmetic (not elapsed milliseconds) preserves the window across DST.
 */
export function countRecentPracticeDays(summaries: readonly PracticeDay[], today: string): number {
	const start = new Date(`${today}T12:00:00`);
	start.setDate(start.getDate() - 364);
	const firstDay = localDateStr(start);
	const dates = new Set<string>();
	for (const summary of summaries) {
		if (summary.date < firstDay || summary.date > today) continue;
		if ((summary.earTrainingSessions ?? summary.sessionCount) > 0 ||
			(summary.lickPracticeSessions ?? 0) > 0) {
			dates.add(summary.date);
		}
	}
	return dates.size;
}
