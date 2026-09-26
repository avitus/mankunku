import { describe, expect, it } from 'vitest';
import { readPracticeTime } from '$lib/persistence/practice-time';

const coverage = { sessionCount: 123, earTrainingSessions: 3, lickPracticeSessions: 120 };
const snapshot = { minutes: 25, earTrainingSessions: 3, lickPracticeSessions: 120 };

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
