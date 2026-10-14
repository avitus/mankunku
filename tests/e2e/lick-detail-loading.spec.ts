import { test, expect } from './fixtures/auth';
import { SAMPLE_USER_LICKS, seedOnboardedAnonymous } from './fixtures/storage';
import type { Phrase } from '../../src/lib/types/music';

const phrase = SAMPLE_USER_LICKS[0] as Phrase;
const row = {
	...phrase,
	id: 'community-loading-lick',
	name: 'Another player’s line',
	user_id: '00000000-0000-0000-0000-000000000002',
	time_signature: phrase.timeSignature,
	favorite_count: 0,
	steal_count: 0
};

for (const entry of ['community', 'direct', 'missing'] as const) {
	test(`${entry}: lick detail waits for resolution before showing not found`, async ({ signedInPage: page }) => {
		await seedOnboardedAnonymous(page);
		let release!: () => void;
		const held = new Promise<void>(resolve => { release = resolve; });
		let requested = false;
		await page.route('**/rest/v1/**', async route => {
			const url = new URL(route.request().url());
			let body: unknown = [];
			if (url.pathname.endsWith('/user_licks')) {
				if (url.searchParams.get('id') === `eq.${row.id}`) {
					requested = true;
					await held;
					body = entry === 'missing' ? null : row;
				} else if (url.searchParams.get('user_id')?.startsWith('neq.')) {
					body = [row];
				}
			}
			await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
		});

		try {
			if (entry === 'community') {
				await page.goto('/licks/community');
				await page.getByRole('link', { name: 'View lick details' }).click();
			} else {
				const response = await page.goto(`/licks/${row.id}`);
				// The server cannot resolve user licks: its initial HTML must wait too.
				expect(await response!.text()).not.toContain('Lick not found:');
			}
			await expect.poll(() => requested).toBe(true);
			await expect(page.getByText(/Lick not found:/)).toHaveCount(0);
			await expect(page.getByRole('status')).toHaveText('Loading lick…');
		} finally {
			release();
		}

		if (entry === 'missing') {
			await expect(page.getByText(`Lick not found: ${row.id}`)).toBeVisible();
		} else {
			await expect(page.getByRole('heading', { name: row.name, exact: true })).toBeVisible();
			await expect(page.getByRole('button', { name: /Edit lick|Delete lick/ })).toHaveCount(0);
			await expect(page.getByText(/community copy you don’t own/)).toBeVisible();
		}
		await expect(page.getByText('Loading lick…', { exact: true })).toHaveCount(0);
	});
}
