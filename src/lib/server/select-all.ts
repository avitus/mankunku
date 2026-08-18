/**
 * Range-paginated select that fetches EVERY row of a query.
 *
 * PostgREST caps any single response at max_rows (1000 in this project's
 * Supabase config), silently — a bare .select() over a grown table returns a
 * truncated result with no error, which for the admin dashboard would mean
 * quietly under-reported activity sums. Callers pass a page fetcher
 * (typically `(from, to) => query.order(...).range(from, to)`; the order
 * matters — unordered range pagination may skip or repeat rows).
 */

const PAGE_SIZE = 1000;

/**
 * Beyond this many pages something is structurally wrong with the query (or
 * the product has outgrown fetch-everything dashboards); failing loudly beats
 * the silent truncation this helper exists to remove.
 */
const MAX_PAGES = 100;

export async function selectAllRows<T>(
	fetchPage: (
		from: number,
		to: number
	) => PromiseLike<{ data: T[] | null; error: unknown | null }>
): Promise<T[]> {
	const rows: T[] = [];
	for (let page = 0; page < MAX_PAGES; page++) {
		const from = page * PAGE_SIZE;
		const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
		if (error) throw error;
		const batch = data ?? [];
		rows.push(...batch);
		if (batch.length < PAGE_SIZE) return rows;
	}
	throw new Error(`selectAllRows: page cap (${MAX_PAGES} × ${PAGE_SIZE}) exceeded`);
}
