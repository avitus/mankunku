/**
 * Unit tests for selectAllRows — the range-paginated fetch that keeps the
 * admin dashboard's aggregates truthful past PostgREST's max_rows cap.
 */

import { describe, it, expect, vi } from 'vitest';
import { selectAllRows } from '../../../src/lib/server/select-all';

function pagedSource(rows: number[], serverPageSize: number) {
	return vi.fn(async (from: number, to: number) => ({
		data: rows.slice(from, Math.min(to + 1, from + serverPageSize)),
		error: null
	}));
}

describe('selectAllRows', () => {
	it('concatenates pages until a short page arrives', async () => {
		const rows = Array.from({ length: 2500 }, (_, i) => i);
		const fetchPage = pagedSource(rows, 1000);

		const result = await selectAllRows(fetchPage);

		expect(result).toEqual(rows);
		expect(fetchPage).toHaveBeenCalledTimes(3);
		expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 999);
		expect(fetchPage).toHaveBeenNthCalledWith(2, 1000, 1999);
		expect(fetchPage).toHaveBeenNthCalledWith(3, 2000, 2999);
	});

	it('returns a single short page without a second request', async () => {
		const fetchPage = pagedSource([1, 2, 3], 1000);
		expect(await selectAllRows(fetchPage)).toEqual([1, 2, 3]);
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});

	it('handles an empty table', async () => {
		const fetchPage = pagedSource([], 1000);
		expect(await selectAllRows(fetchPage)).toEqual([]);
	});

	it('treats null data as an empty page', async () => {
		const fetchPage = vi.fn(async () => ({ data: null, error: null }));
		expect(await selectAllRows(fetchPage)).toEqual([]);
	});

	it('throws the page error instead of returning partial rows', async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => i), error: null })
			.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

		await expect(selectAllRows(fetchPage)).rejects.toEqual({ message: 'boom' });
	});

	it('throws rather than silently truncating at the page cap', async () => {
		// A source that always returns full pages would loop forever; the cap
		// turns that into a loud failure, never quietly-partial aggregates.
		const fetchPage = vi.fn(async (from: number, to: number) => ({
			data: Array.from({ length: to - from + 1 }, (_, i) => from + i),
			error: null
		}));

		await expect(selectAllRows(fetchPage)).rejects.toThrow(/page cap/i);
	});
});
