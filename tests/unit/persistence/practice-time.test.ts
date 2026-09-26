import { describe, expect, it } from 'vitest';
import { readPracticeTime, mergePracticeTime, practiceMinutesWithUncovered } from '$lib/persistence/practice-time';

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
