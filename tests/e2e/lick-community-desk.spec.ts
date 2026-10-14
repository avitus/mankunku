import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { createStubCloud, installStubCloud, type Row } from './fixtures/stub-cloud';

const user = { id: 'aaaaaaaa-0000-4000-8000-000000000abc', email: 'desk@e2e.dev' };
const author = { id: 'bbbbbbbb-0000-4000-8000-000000000abc', display_name: 'Maya Thompson', avatar_url: null };

/** Dense real phrases, not decorative notation: the full eighth-note run must engrave. */
function row(id: string, name: string, bars: number): Row {
	return {
		id, name, user_id: author.id, key: 'C', time_signature: [4, 4],
		notes: Array.from({ length: bars * 8 }, (_, i) => ({ pitch: [60, 62, 64, 65, 67, 69, 71, 72][i % 8], offset: [i, 8], duration: [1, 8] })),
		harmony: [{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [bars, 1] }],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: bars },
		category: 'major-chord', tags: [], source: 'user-entered', favorite_count: 3,
		deleted_at: null, client_mtime: 1000, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z'
	};
}
const long = row('community-desk-long', 'A little outside, then home', 4);
const short = row('community-desk-short', 'The blue hour', 2);

async function setup(page: import('@playwright/test').Page, baseURL: string, theme = 'dark') {
	const cloud = createStubCloud();
	cloud.seedRow('user_licks', long);
	cloud.seedRow('user_licks', short);
	cloud.seedRow('public_lick_authors', author);
	await installStubCloud(page.context(), cloud, user, baseURL);
	await seedStorage(page, { settings: { ...SETTINGS_ONBOARDED, theme }, 'tour-state': TOUR_DISMISSED });
	// The shared stub supports equality only; model the browse search seam here.
	await page.route('**/rest/v1/user_licks?*', async route => {
		const url = new URL(route.request().url());
		if (url.searchParams.get('or')?.includes('missing-phrase')) {
			await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
		} else await route.fallback();
	});
	await page.goto('/licks/community');
	await expect(page.getByRole('group', { name: 'Choose a lick' }).getByRole('button')).toHaveCount(2);
	await page.getByRole('button', { name: /^A little outside, then home by/ }).click();
	return cloud;
}

test('desk selection shows the complete phrase and keeps controls aligned', async ({ page, baseURL }, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await setup(page, baseURL!);
	const desk = page.getByRole('region', { name: 'Selected lick', exact: true });
	const list = page.getByRole('group', { name: 'Choose a lick' });
	await expect(desk.locator('.abcjs-note')).toHaveCount(32);
	await expect(desk.locator('[data-chart-variant="practice"]')).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('listening-desk.png'), fullPage: true });
	const before = await desk.getByRole('button', { name: /^Listen/ }).boundingBox();
	await list.getByRole('button', { name: /^The blue hour by/ }).click();
	await expect(desk.getByRole('heading', { name: 'The blue hour' })).toBeVisible();
	await expect(desk.locator('.abcjs-note')).toHaveCount(16);
	const after = await desk.getByRole('button', { name: /^Listen/ }).boundingBox();
	expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
	await expect(list.getByRole('button', { name: /^The blue hour by/ })).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByText(/\b[24] bars?\b|Key of/)).toHaveCount(0);
	await expect(desk.getByRole('link', { name: 'View lick details' })).toHaveAttribute('href', '/licks/community-desk-short');
	await expect(list.locator('.progression').first()).toHaveCSS('color', 'rgb(207, 156, 61)');
});

test('favorite and book actions survive selection and update the real library cache', async ({ page, baseURL }) => {
	const cloud = await setup(page, baseURL!);
	const favorite = page.getByRole('button', { name: `Favorite ${long.name}`, exact: true });
	await favorite.click();
	await expect(favorite).toBeEnabled();
	await expect(favorite).toHaveAttribute('aria-pressed', 'true');
	expect(cloud.rows('lick_favorites')).toHaveLength(1);
	await page.getByRole('button', { name: `Add ${long.name} to My Licks`, exact: true }).click();
	const remove = page.getByRole('button', { name: `Remove ${long.name} from My Licks`, exact: true });
	await expect(remove).toBeEnabled();
	expect(cloud.rows('lick_adoptions')).toHaveLength(1);
	await page.getByRole('link', { name: 'My Licks', exact: false }).last().click();
	await expect(page.getByRole('button', { name: new RegExp(String(long.name)) }).first()).toBeVisible();
	await page.getByRole('link', { name: /Browse Community/ }).click();
	await page.getByRole('button', { name: /^A little outside, then home by/ }).click();
	await expect(remove).toBeVisible();
	await remove.click();
	await expect(page.getByRole('button', { name: `Add ${long.name} to My Licks`, exact: true })).toBeEnabled();
	expect(cloud.rows('lick_adoptions')).toHaveLength(0);
});

test('search, sort, and advanced filters remain connected to the corpus query', async ({ page, baseURL }) => {
	await setup(page, baseURL!);
	const requests: URL[] = [];
	page.on('request', request => { if (request.url().includes('/rest/v1/user_licks?')) requests.push(new URL(request.url())); });
	await page.getByRole('searchbox', { name: 'Search licks' }).fill('missing-phrase');
	await expect(page.getByText('No licks match your search or filters.')).toBeVisible();
	await page.getByRole('button', { name: 'Reset filters' }).click();
	await expect(page.getByRole('searchbox', { name: 'Search licks' })).toHaveValue('');
	await page.getByRole('combobox', { name: 'Sort licks' }).selectOption('newest');
	await expect.poll(() => requests.some(url => url.searchParams.get('order') === 'created_at.desc')).toBe(true);
	await page.getByRole('button', { name: 'Filters', exact: true }).click();
	await page.getByLabel('Author', { exact: true }).fill('nobody');
	await expect(page.getByText('No licks match your search or filters.')).toBeVisible();
	await page.getByLabel('Max difficulty').selectOption('20');
	await expect.poll(() => requests.some(url => url.searchParams.get("(difficulty->>'level')::int") === 'lte.20')).toBe(true);
});

for (const theme of ['dark', 'light']) {
	test(`phone ${theme}: score scrolls within the desk and list stays compact`, async ({ page, baseURL }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await setup(page, baseURL!, theme);
		const score = page.getByRole('region', { name: /^Sheet music/ });
		await expect(score.locator('.abcjs-note')).toHaveCount(32);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
		expect((await page.locator('.dense-row').first().boundingBox())!.height).toBe(76);
		await page.getByRole('button', { name: /^The blue hour by/ }).click();
		await expect(score.locator('.abcjs-note')).toHaveCount(16);
		await expect(page.getByRole('button', { name: /^Add The blue hour/ })).toBeVisible();
	});
}


test('changing filters discards an older load-more response', async ({ page, baseURL }) => {
	await setup(page, baseURL!);
	const batch = Array.from({ length: 50 }, (_, i) => row(`page-one-${i}`, `Community phrase ${i}`, 2));
	let release!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	let requested = false;
	await page.route('**/rest/v1/user_licks?*', async route => {
		const url = new URL(route.request().url());
		if (!url.searchParams.get('user_id')?.startsWith('neq.')) return route.fallback();
		let rows = batch;
		if (url.searchParams.get('offset') === '50') {
			requested = true;
			await held;
			rows = [row('stale-page', 'Stale next page', 2)];
		} else if (url.searchParams.get('category') === 'eq.blues') rows = [short];
		await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
	});
	await page.getByRole('combobox', { name: 'Sort licks' }).selectOption('newest');
	const list = page.getByRole('group', { name: 'Choose a lick' });
	await expect(list.getByRole('button')).toHaveCount(50);
	await page.getByRole('button', { name: 'Load more' }).click();
	await expect.poll(() => requested).toBe(true);
	const staleResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('offset') === '50');
	try {
		await page.getByRole('combobox', { name: 'Progression or style' }).selectOption('blues');
		await expect(list.getByRole('button')).toHaveCount(1);
	} finally {
		release();
	}
	await (await staleResponse).finished();
	await expect(list.getByRole('button')).toHaveCount(1);
	await expect(page.getByRole('heading', { name: String(short.name), exact: true })).toBeVisible();
	await expect(page.getByText('Stale next page', { exact: true })).toHaveCount(0);
});
