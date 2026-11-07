import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks } from './fixtures/storage';
import type { Phrase } from '../../src/lib/types/music';

const lick: Phrase = {
	id: 'user-naming', name: 'My custom name', key: 'C', timeSignature: [4, 4],
	notes: [60, 62, 65, 64, 67, 63].map((pitch, i) => ({ pitch, offset: [i, 8], duration: [1, 8] })),
	harmony: [], category: 'user', tags: ['user-entered'], source: 'user-entered',
	difficulty: { level: 1, lengthBars: 1, pitchComplexity: 1, rhythmComplexity: 1 }
};
const match = { kind: 'wjazzd', sourceId: 'test', label: 'Art Pepper — Stardust, bar -1',
	suggestedName: 'Art Pepper - Stardust', attribution: 'Weimar Jazz Database: Art Pepper — Stardust',
	license: 'CC-BY-NC-SA', confidence: 'quote', score: 1 };

test('editor offers optional song names, numbers duplicates and preserves custom edits', async ({ page }, info) => {
	await seedOnboardedAnonymous(page);
	await seedUserLicks(page, [lick, { ...lick, id: 'user-existing', name: 'Art Pepper - Stardust' }]);
	let requests = 0;
	await page.route('**/api/lick-match', route => { requests++; return route.fulfill({ json: { matches: [match] } }); });
	await page.goto('/licks/editor?edit=user-naming');
	const title = page.getByRole('textbox', { name: 'Lick title' });
	const suggestion = page.getByRole('button', { name: /Art Pepper - Stardust/ });
	await expect(suggestion).toBeVisible();
	await expect(title).toHaveValue('My custom name');
	for (const width of [1440, 768, 390]) {
		await page.setViewportSize({ width, height: 1000 });
		await expect(suggestion).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		await info.attach(`Naming at ${width}px`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
	}
	await suggestion.click();
	await expect(title).toHaveValue('Art Pepper - Stardust 2');
	await title.fill('A completely personal name');
	await expect(page.getByText('Suggestion — not verified', { exact: true })).toHaveCount(0);
	await page.waitForTimeout(800);
	expect(requests).toBe(1); // Naming alone must not restart lookup.
	await page.getByRole('button', { name: 'Update lick', exact: true }).click();
	await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-licks') ?? '[]')
		.find((row: { id: string }) => row.id === 'user-naming')?.name)).toBe('A completely personal name');
});

for (const unavailable of [false, true]) {
	test(`editor accepts a custom name when lookup ${unavailable ? 'fails' : 'finds nothing'}`, async ({ page }) => {
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page, [lick]);
		await page.route('**/api/lick-match', route => route.fulfill(unavailable
			? { status: 200, body: 'invalid json' }
			: { json: { matches: [] } }));
		await page.goto('/licks/editor?edit=user-naming');
		const title = page.getByRole('textbox', { name: 'Lick title' });
		await expect(page.getByText(unavailable ? 'Song suggestions are unavailable. Enter your own name.' : 'No song match found. Enter your own name.', { exact: true })).toBeVisible();
		await expect(page.locator('#lick-name-help')).toContainText('Artist - Song Name');
		await title.fill('   ');
		await page.getByRole('button', { name: 'Update lick', exact: true }).click();
		await expect(title).toBeFocused();
		await title.fill('My own melody');
		await page.getByRole('button', { name: 'Update lick', exact: true }).click();
		await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-licks') ?? '[]')[0]?.name)).toBe('My own melody');
	});
}

test('a new editor draft requires a name rather than saving a generated fallback', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/licks/editor');
	const quarter = page.getByRole('button', { name: 'Quarter Note' });
	await expect(async () => {
		await quarter.click();
		await expect(quarter).toHaveAttribute('aria-pressed', 'true', { timeout: 250 });
	}).toPass({ timeout: 10_000 });
	await page.keyboard.press('c');
	const title = page.getByRole('textbox', { name: 'Lick title' });
	await expect(title).toHaveValue('');
	await page.getByRole('button', { name: 'Save lick', exact: true }).click();
	await expect(title).toBeFocused();
	expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-licks') ?? '[]'))).toHaveLength(0);
	await title.fill('My melody');
	await page.getByRole('button', { name: 'Save lick', exact: true }).click();
	await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-licks') ?? '[]')[0]?.name)).toBe('My melody');
});


test('choosing the current song title while editing does not add a number', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedUserLicks(page, [{ ...lick, name: 'Art Pepper - Stardust' }]);
	await page.route('**/api/lick-match', route => route.fulfill({ json: { matches: [match] } }));
	await page.goto('/licks/editor?edit=user-naming');
	await page.getByRole('button', { name: /Art Pepper - Stardust/ }).click();
	await expect(page.getByRole('textbox', { name: 'Lick title' })).toHaveValue('Art Pepper - Stardust');
});
