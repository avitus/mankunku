import { test, expect } from './fixtures/auth';
import {
	seedOnboardedAnonymous,
	seedUserLicks,
	seedTunes,
	seedStorage,
	SAMPLE_USER_LICKS,
	SAMPLE_USER_TUNES,
	SETTINGS_ONBOARDED,
	TOUR_DISMISSED
} from './fixtures/storage';

for (const count of [40, 100]) {
	test(`Licks keeps ${count} phrases reachable through paging, search, views and practice filters`, async ({
		page
	}) => {
		await seedOnboardedAnonymous(page);
		const licks = Array.from({ length: count }, (_, index) => ({
			...(SAMPLE_USER_LICKS[0] as Record<string, unknown>),
			id: `studio-lick-${index}`,
			name: `Studio Phrase ${String(index).padStart(3, '0')}`
		}));
		await seedUserLicks(page, licks);
		await seedStorage(page, {
			'user-lick-tags': Object.fromEntries(
				licks.map((lick, index) => [
					lick.id,
					index < 10 ? ['practice', 'prog:ii-V-I-major'] : index < 15 ? ['practice'] : []
				])
			)
		});
		await page.goto('/licks');
		const titles = page.locator('.library-records h3');
		const paging = page.getByRole('navigation', {
			name: 'Top licks pagination'
		});
		await expect(titles).toHaveCount(20);
		const seen = new Set<string>();
		for (let index = 0; index < count / 20; index++) {
			for (const title of await titles.allTextContents()) seen.add(title);
			if (index < count / 20 - 1) await paging.getByRole('button', { name: 'Next page' }).click();
		}
		expect(seen.size).toBe(count);
		await expect(paging.getByRole('button', { name: 'Next page' })).toBeDisabled();
		await page
			.getByLabel('Search licks')
			.fill(`Studio Phrase ${String(count - 1).padStart(3, '0')}`);
		await expect(titles).toHaveCount(1);
		await expect(paging).toHaveCount(0);
		await expect(page.getByLabel('Licks per page')).toHaveCount(0);
		await page.getByLabel('Search licks').fill('');
		await page.getByLabel('Licks per page').selectOption('40');
		await expect(titles).toHaveCount(40);
		await page.getByRole('button', { name: 'Cards', exact: true }).click();
		await expect(page.locator('.library-cards')).toHaveCount(3);
		await page.getByRole('button', { name: 'Compact', exact: true }).click();
		await page
			.getByRole('group', { name: 'Collection filters' })
			.getByRole('button', { name: /^Practice set/ })
			.click();
		await expect(titles).toHaveCount(10);
		await page.getByRole('button', { name: 'Remove', exact: true }).first().click();
		await expect(titles).toHaveCount(9);
		await page
			.getByRole('group', { name: 'Collection filters' })
			.getByRole('button', { name: /^All phrases/ })
			.click();
		await page.getByLabel('Licks per page').selectOption({ label: 'All' });
		await expect(titles).toHaveCount(count);
		await page.getByLabel('Filter by progression').selectOption('ii-V-I-major');
		await expect(titles).toHaveCount(10);
	});
}

test('Tunes keeps a large book searchable and preserves written keys and detail links', async ({
	page
}) => {
	await seedOnboardedAnonymous(page);
	// 98 of the player's own + the two curated tunes = 100.
	await seedTunes(
		page,
		Array.from({ length: 98 }, (_, index) => ({
			...(SAMPLE_USER_TUNES[0] as Record<string, unknown>),
			id: `studio-tune-${index}`,
			title: `Studio Tune ${String(index).padStart(3, '0')}`
		}))
	);
	await page.goto('/tunes');
	const rows = page.locator('.library-tune-card');
	await expect(rows).toHaveCount(20);
	const paging = page.getByRole('navigation', { name: 'Top tunes pagination' });
	await paging.getByRole('button', { name: 'Next page' }).click();
	await page.getByLabel('Search tunes').fill('Studio Tune 096');
	await expect(rows).toHaveCount(1);
	await expect(paging).toContainText('Page 1 of 1');
	await expect(rows.first()).toContainText('Key of D');
	await page.getByLabel('Search tunes').fill('');
	await page.getByLabel('Tunes per page').selectOption({ label: 'All' });
	await expect(rows).toHaveCount(100);
	await page.getByLabel('Filter collection').selectOption('curated');
	await expect(rows).toHaveCount(2);
	await page.getByRole('button', { name: 'Cards', exact: true }).click();
	await expect(page.locator('.library-cards .library-tune-card')).toHaveCount(2);
	await page.getByRole('button', { name: 'Open Rhythm Changes' }).click();
	await expect(page).toHaveURL(/\/tunes\/rhythm-changes$/);
});

for (const width of [1440, 768, 390]) {
	test(`Studio pages fit ${width}px in both themes`, async ({ page }, testInfo) => {
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedTunes(page);
		await page.setViewportSize({ width, height: 1000 });
		for (const theme of ['Light', 'Dark']) {
			await page.goto('/settings');
			await page
				.getByRole('radiogroup', { name: 'Theme' })
				.getByRole('radio', { name: theme })
				.click();
			for (const route of ['/', '/licks', '/tunes', '/lick-practice']) {
				await page.goto(route);
				await expect(page.locator('.studio-desk')).toBeVisible();
				if (process.env.STUDIO_SCREENSHOTS)
					await page.screenshot({
						path: testInfo.outputPath(`${route.replaceAll('/', '') || 'landing'}-${theme}.png`),
						fullPage: true,
						animations: 'disabled'
					});
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
					`${route} at ${width}px in ${theme}`
				).toBe(true);
			}
		}
	});
}

test('Practice setup has one duration dial and an accurate read-only summary', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/lick-practice');
	const time = page.getByRole('slider', { name: 'Practice time' });
	await expect(time).toHaveCount(1);
	await time.press('Home');
	await time.press('ArrowUp');
	await expect(time).toHaveAttribute('aria-valuetext', '4 min');
	const summary = page.getByRole('complementary', { name: 'Your session' });
	await expect(summary).toContainText('4 min');
	await expect(summary).toContainText('No licks queued');
	await page.getByRole('radio', { name: /Focused Session/ }).click();
	await expect(time).toHaveCount(1);
	await expect(time).toHaveAttribute('aria-valuetext', '4 min');
	await page.getByRole('radio', { name: 'Bossa Nova', exact: true }).click();
	await expect(summary).toContainText('Bossa Nova');
	await page.getByRole('radio', { name: /Deep Practice/ }).click();
	await expect(time).toHaveCount(0);
	await expect(summary).toContainText('Open-ended practice');
});

for (const width of [1440, 768, 390]) {
	test(`Signed-in Home fits ${width}px in both themes`, async ({
		signedInPage: page
	}, testInfo) => {
		// The fake signed-in identity has no real profile; keep this layout test local.
		await page.route('**/rest/v1/user_profiles?*', (route) =>
			route.fulfill({ json: { display_name: 'Test Musician' } })
		);
		await seedStorage(page, { settings: SETTINGS_ONBOARDED, 'tour-state': TOUR_DISMISSED });
		await seedUserLicks(page);
		await page.setViewportSize({ width, height: 1000 });
		for (const theme of ['Light', 'Dark']) {
			await page.goto('/settings');
			await page
				.getByRole('radiogroup', { name: 'Theme' })
				.getByRole('radio', { name: theme })
				.click();
			await page.goto('/');
			await expect(page.getByRole('heading', { name: 'Lick Practice', exact: true })).toBeVisible();
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
			).toBe(true);
			if (process.env.STUDIO_SCREENSHOTS)
				await page.screenshot({
					path: testInfo.outputPath(`home-${theme}.png`),
					fullPage: true,
					animations: 'disabled'
				});
		}
	});
}
