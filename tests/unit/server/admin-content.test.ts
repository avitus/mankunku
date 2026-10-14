import { describe, expect, it, vi } from 'vitest';
import { getAdminContent } from '../../../src/lib/server/admin-content';
import { makePhrase } from '../../helpers/lick-builders';

/** Fluent mock that retains pagination and fails selected tables explicitly. */
function client(tables: Record<string, unknown[]>, failedTable?: string) {
	return { from: vi.fn((table: string) => {
		const query: Record<string, unknown> = {};
		for (const method of ['select', 'eq', 'is', 'order']) query[method] = vi.fn(() => query);
		query.range = vi.fn(async (from: number, to: number) => ({ data: (tables[table] ?? []).slice(from, to + 1), error: table === failedTable ? { message: 'offline' } : null }));
		return query;
	}) } as unknown as Parameters<typeof getAdminContent>[0];
}

function lick(id: string) {
	const p = makePhrase({ id });
	return { ...p, user_id: 'owner', time_signature: p.timeSignature, deleted_at: null };
}

describe('admin content inspection', () => {
	it('counts affected people once across licks and tunes and preserves previewable phrases', async () => {
		const content = await getAdminContent(client({
			user_licks: [lick('one'), lick('two')], tunes: [{ id: 'tune', title: 'A tune' }],
			lick_adoptions: [{ user_id: 'a', lick_id: 'one' }, { user_id: 'b', lick_id: 'one' }, { user_id: 'a', lick_id: 'two' }],
			tune_adoptions: [{ user_id: 'a', tune_id: 'tune' }]
		}), 'owner');
		expect(content.affectedUsers).toBe(2);
		expect(content.licks.map(l => l.adoptionCount)).toEqual([2, 1]);
		expect(content.tunes[0].adoptionCount).toBe(1);
		expect(content.licks[0].phrase?.id).toBe('one');
	});
	it('keeps a malformed lick removable without handing it to notation or audio', async () => {
		const content = await getAdminContent(client({ user_licks: [{ ...lick('bad'), notes: [] }] }), 'owner');
		expect(content.licks[0]).toMatchObject({ id: 'bad', phrase: null, adoptionCount: 0 });
		expect(content.licks[0].errors.length).toBeGreaterThan(0);
	});
	it('never treats a failed adoption query as zero affected users', async () => {
		await expect(getAdminContent(client({ user_licks: [lick('one')] }, 'lick_adoptions'), 'owner')).rejects.toMatchObject({ message: 'offline' });
	});
	it('reads beyond the API page cap before declaring adoption impact', async () => {
		const rows = Array.from({ length: 1001 }, (_, i) => ({ user_id: `u-${i}`, lick_id: 'one' }));
		const content = await getAdminContent(client({ user_licks: [lick('one')], lick_adoptions: rows }), 'owner');
		expect(content.affectedUsers).toBe(1001);
	});
});
