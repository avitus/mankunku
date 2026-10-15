import { describe, expect, it } from 'vitest';
import { isInactive, lastSeenDate } from '../../../src/lib/ui/admin-user-filter';

const NOW = Date.parse('2026-10-15T12:00:00Z');

describe('lastSeenDate', () => {
	it('takes the newest date, not the first one present (CodeRabbit on #277)', () => {
		// Visit tracking missed today's sign-in, so the newest practice or visit
		// day is weeks old; the sign-in still says the account was used today.
		expect(
			lastSeenDate({
				lastActiveDate: '2026-08-01',
				lastSignInAt: '2026-10-15T09:30:00Z',
				createdAt: '2026-01-02T10:00:00Z'
			})
		).toBe('2026-10-15');
	});

	it('keeps an activity day newer than the last sign-in', () => {
		expect(
			lastSeenDate({
				lastActiveDate: '2026-10-14',
				lastSignInAt: '2026-09-01T09:30:00Z',
				createdAt: '2026-01-02T10:00:00Z'
			})
		).toBe('2026-10-14');
	});

	it('falls back to the signup date, and is null with no dates at all', () => {
		expect(
			lastSeenDate({ lastActiveDate: null, lastSignInAt: null, createdAt: '2026-03-04T10:00:00Z' })
		).toBe('2026-03-04');
		expect(lastSeenDate({ lastActiveDate: null, lastSignInAt: null, createdAt: null })).toBeNull();
	});
});

describe('isInactive', () => {
	it('does not list a user who signed in today under "No activity in 30 days"', () => {
		const row = {
			lastActiveDate: '2026-08-01',
			lastSignInAt: '2026-10-15T09:30:00Z',
			createdAt: '2026-01-02T10:00:00Z'
		};
		expect(isInactive(row, NOW)).toBe(false);
	});

	it('lists a user whose newest date is more than 30 days old', () => {
		const row = {
			lastActiveDate: '2026-08-01',
			lastSignInAt: '2026-07-20T09:30:00Z',
			createdAt: '2026-01-02T10:00:00Z'
		};
		expect(isInactive(row, NOW)).toBe(true);
	});

	it('never lists a row with no dates', () => {
		expect(isInactive({ lastActiveDate: null, lastSignInAt: null, createdAt: null }, NOW)).toBe(
			false
		);
	});
});
