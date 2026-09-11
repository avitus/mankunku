/**
 * `localDateStr` is the key every daily summary and trend bucket is filed
 * under. It must be the LOCAL calendar day — a session at 11 PM belongs to
 * that day, not to the UTC date it happens to fall on — and it must be
 * zero-padded so the strings sort chronologically as plain text.
 */
import { describe, it, expect } from 'vitest';
import { localDateStr } from '$lib/util/local-date';

describe('localDateStr', () => {
	it('zero-pads month and day', () => {
		// Constructed in local time, so the answer is the same in every zone.
		expect(localDateStr(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
		expect(localDateStr(new Date(2026, 11, 25, 12, 0, 0))).toBe('2026-12-25');
	});

	it('keeps a late-evening session on its local day, even across a year boundary', () => {
		// 23:59 local on New Year's Eve: any UTC-based formatting would file
		// this under the next year in zones west of Greenwich, and a minute
		// past midnight under the previous year east of it. The zone is pinned
		// per case because CI runs in UTC, where local and UTC agree and the
		// assertion could never fail. Node re-reads process.env.TZ on assignment.
		const originalTz = process.env.TZ;
		try {
			process.env.TZ = 'America/Los_Angeles';
			expect(localDateStr(new Date(2026, 11, 31, 23, 59, 30))).toBe('2026-12-31');
			process.env.TZ = 'Pacific/Auckland';
			expect(localDateStr(new Date(2027, 0, 1, 0, 0, 30))).toBe('2027-01-01');
		} finally {
			if (originalTz === undefined) delete process.env.TZ;
			else process.env.TZ = originalTz;
		}
	});

	it('sorts chronologically as plain strings', () => {
		const days = [
			new Date(2026, 8, 9, 12),
			new Date(2026, 9, 1, 12),
			new Date(2026, 8, 10, 12),
			new Date(2025, 11, 31, 12)
		].map(localDateStr);
		expect([...days].sort()).toEqual(['2025-12-31', '2026-09-09', '2026-09-10', '2026-10-01']);
	});
});
