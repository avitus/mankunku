import { describe, expect, it, afterEach, vi } from 'vitest';
import { countRecentPracticeDays } from '$lib/util/practice-days';
import { localDateStr } from '$lib/util/local-date';

describe('home practice days', () => {
	afterEach(() => vi.unstubAllEnvs());
	it('counts a mixed or repeated practice date once and includes legacy and lick-only days', () => {
		expect(countRecentPracticeDays([
			{ date: '2026-11-10', sessionCount: 90, earTrainingSessions: 10, lickPracticeSessions: 80 },
			{ date: '2026-11-10', sessionCount: 110 },
			{ date: '2026-11-09', sessionCount: 25, earTrainingSessions: 0, lickPracticeSessions: 25 },
			{ date: '2026-11-08', sessionCount: 6 },
			{ date: '2026-11-07', sessionCount: 0 }
		], '2026-11-10')).toBe(3);
	});
	it.each(['UTC', 'America/Los_Angeles', 'Pacific/Auckland'])('includes exactly 365 local dates in %s', (zone) => {
		vi.stubEnv('TZ', zone);
		expect(countRecentPracticeDays([
			{ date: '2025-11-10', sessionCount: 1 }, // 365 days ago: outside
			{ date: '2025-11-11', sessionCount: 1 }, // first included day
			{ date: '2026-11-10', sessionCount: 1 }, // today
			{ date: '2026-11-11', sessionCount: 1 } // future
		], '2026-11-10')).toBe(2);
	});
	it('handles leap day without turning the window into a calendar year', () => {
		expect(countRecentPracticeDays([
			{ date: '2023-03-02', sessionCount: 1 },
			{ date: '2023-03-03', sessionCount: 1 },
			{ date: '2024-02-29', sessionCount: 1 },
			{ date: '2024-03-01', sessionCount: 1 }
		], '2024-03-01')).toBe(3);
	});
	it('keeps a full year of activity beyond the recent-session cache', () => {
		const summaries = Array.from({ length: 400 }, (_, offset) => {
			const day = new Date(2026, 10, 10, 12);
			day.setDate(day.getDate() - offset);
			return { date: localDateStr(day), sessionCount: 50 };
		});
		expect(countRecentPracticeDays(summaries, '2026-11-10')).toBe(365);
		expect(countRecentPracticeDays([], '2026-11-10')).toBe(0);
	});
	it('drops the oldest date when the local day rolls over', () => {
		const summaries = [{ date: '2025-11-11', sessionCount: 5 }];
		expect(countRecentPracticeDays(summaries, '2026-11-10')).toBe(1);
		expect(countRecentPracticeDays(summaries, '2026-11-11')).toBe(0);
	});
});
