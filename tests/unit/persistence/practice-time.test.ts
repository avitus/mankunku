import { describe, expect, it } from 'vitest';
import { readPracticeTime, mergePracticeTime, practiceMinutesWithUncovered, availablePracticeMinutes } from '$lib/persistence/practice-time';

const coverage = { sessionCount: 123, earTrainingSessions: 3, lickPracticeSessions: 120 };
const snapshot = { minutes: 25, earTrainingSessions: 3, lickPracticeSessions: 120, earMinutes: 1.5, lickMinutes: 23.5 };

describe('readPracticeTime', () => {
	it('accepts a complete source-derived snapshot', () => {
		expect(readPracticeTime(snapshot, coverage)).toEqual(snapshot);
	});
	it.each([null, [], {}, { ...snapshot, minutes: '25' }, { ...snapshot, minutes: -1 },
		{ ...snapshot, minutes: Infinity }, { ...snapshot, minutes: NaN },
		{ ...snapshot, minutes: 1.5 }, { ...snapshot, minutes: 2147483648 },
		{ ...snapshot, earTrainingSessions: -1 }, { ...snapshot, lickPracticeSessions: 0.5 },
		{ ...snapshot, earTrainingSessions: 0, lickPracticeSessions: 0 }])('ignores invalid persisted provenance: %j', (value) => {
		expect(readPracticeTime(value, coverage)).toBeUndefined();
	});
	it('rejects provenance claiming more source activity than its summary', () => {
		expect(readPracticeTime(snapshot, { ...coverage, lickPracticeSessions: 100 })).toBeUndefined();
	});
	it('accepts a known correction after the summary gains more attempts', () => {
		expect(readPracticeTime(snapshot, { ...coverage, sessionCount: 143, lickPracticeSessions: 140 })).toEqual(snapshot);
	});
});


describe('source coverage convergence', () => {
	const lick = { minutes: 25, earTrainingSessions: 0, lickPracticeSessions: 120, earMinutes: 0, lickMinutes: 25 };
	it('adds only uncovered activity without using the old 240-minute estimate', () => {
		expect(practiceMinutesWithUncovered(lick, { sessionCount: 121, earTrainingSessions: 1, lickPracticeSessions: 120 })).toBe(26);
		expect(practiceMinutesWithUncovered(lick, { sessionCount: 124, earTrainingSessions: 2, lickPracticeSessions: 122 })).toBe(27);
	});
	it('merges incomparable corrections by source in either order', () => {
		const ear = { minutes: 3, earTrainingSessions: 6, lickPracticeSessions: 0, earMinutes: 3, lickMinutes: 0 };
		const combined = { minutes: 28, earTrainingSessions: 6, lickPracticeSessions: 120, earMinutes: 3, lickMinutes: 25 };
		expect(mergePracticeTime(ear, lick)).toEqual(combined);
		expect(mergePracticeTime(lick, ear)).toEqual(combined);
	});
});


describe('available practice time', () => {
	const day = { date: '2026-09-11', ...coverage, sessionCount: 123, practiceMinutes: 246 } as import('$lib/types/progress').DailySummary;
	it('does not treat the obsolete per-attempt estimate as elapsed time', () => {
		expect(availablePracticeMinutes(day)).toBeUndefined();
	});
	it('keeps an unavailable marker after counts change or an old client writes a different scalar', () => {
		expect(availablePracticeMinutes({ ...day, practiceMinutes: 240, practiceTimeUnavailable: true })).toBeUndefined();
	});
	it('keeps usable pre-provenance durations and genuine zero minutes', () => {
		expect(availablePracticeMinutes({ ...day, practiceMinutes: 25 })).toBe(25);
		expect(availablePracticeMinutes({ ...day, sessionCount: 0, practiceMinutes: 0 })).toBe(0);
	});
	it('accepts source evidence even when it happens to equal the old formula', () => {
		const time = { minutes: 246, earMinutes: 1.5, lickMinutes: 244.5, earTrainingSessions: 3, lickPracticeSessions: 120 };
		expect(availablePracticeMinutes({ ...day, practiceTime: time, practiceTimeUnavailable: true })).toBe(246);
	});
});
