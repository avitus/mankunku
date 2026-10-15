import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import {
	seedOnboardedAnonymous,
	seedStorage,
	SETTINGS_ONBOARDED,
	TOUR_DISMISSED
} from './fixtures/storage';
import { createStubCloud, installStubCloud } from './fixtures/stub-cloud';
import type { E2ETestUser } from './fixtures/auth';

/**
 * /tunes/community — the tune browse page.
 *
 * Anonymous visitors get a sign-in prompt and no browse UI. Signed in, the
 * page lists shared tunes from the `tunes` table (with author names joined
 * from `public_tune_authors`); the browser Supabase client is intercepted at
 * the REST layer and answered with one deterministic shared sheet, so the
 * card rendering is what's under test — no real backend.
 */

const OTHER_AUTHOR_ID = '00000000-0000-0000-0000-00000000beef';

/** One shared four-bar sheet in concert C, authored by another user. */
const COMMUNITY_TUNE_ROW = {
	id: 'e2e-community-tune-1',
	user_id: OTHER_AUTHOR_ID,
	title: 'Community Test Tune',
	composer: 'E2E Composer',
	key: 'C',
	time_signature: [4, 4],
	style: 'Medium Swing',
	tags: ['e2e'],
	sections: [
		{
			label: 'A',
			bars: 4,
			notes: [
				{ pitch: 60, duration: [1, 1], offset: [0, 1] },
				{ pitch: 64, duration: [1, 1], offset: [1, 1] },
				{ pitch: 67, duration: [1, 1], offset: [2, 1] },
				{ pitch: 72, duration: [1, 1], offset: [3, 1] }
			],
			harmony: [
				{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [4, 1], symbol: 'Cmaj7' }
			]
		}
	],
	difficulty: null,
	source: 'user',
	pdf_url: null,
	favorite_count: 2,
	deleted_at: null,
	client_mtime: 0,
	created_at: '2026-09-01T00:00:00.000Z',
	updated_at: '2026-09-01T00:00:00.000Z'
};

const COMMUNITY_AUTHOR_ROW = {
	id: OTHER_AUTHOR_ID,
	display_name: 'Test Author',
	avatar_url: null
};

/**
 * A route handler answering a Supabase REST call with `body` as a 200 JSON
 * list, `content-range` included so supabase-js reads it as a page.
 */
function jsonRoute(body: unknown) {
	return async (route: import('@playwright/test').Route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'content-range': '0-0/*' },
			body: JSON.stringify(body)
		});
	};
}

/** Empty cloud for everything, then the two tables the browse page reads. */
async function stubCommunityRows(page: Page, tunes: unknown[]): Promise<void> {
	// Later-registered routes take precedence, so the catch-all goes first.
	await page.route('**/rest/v1/**', jsonRoute([]));
	await page.route('**/rest/v1/tunes?*', jsonRoute(tunes));
	await page.route('**/rest/v1/public_tune_authors?*', jsonRoute([COMMUNITY_AUTHOR_ROW]));
}

test.describe('tune community — anonymous gate', () => {
	test('shows a sign-in prompt instead of the browse UI', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await seedOnboardedAnonymous(page);
		await page.goto('/tunes/community');

		await expect(page.getByRole('heading', { name: 'Community Tunes' })).toBeVisible();
		await expect(page.getByText('Sign in to browse community tunes.')).toBeVisible();
		await expect(page.locator('main').getByRole('link', { name: /sign in/i })).toHaveAttribute(
			'href',
			'/auth'
		);
		await expect(page.getByPlaceholder(/search by title/i)).toHaveCount(0);
	});
});

test.describe('tune community — authed browse', () => {
	test.beforeEach(async ({ signedInPage }) => {
		await seedOnboardedAnonymous(signedInPage);
	});

	test('lists a shared sheet with its author, written key and adopt action', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await stubCommunityRows(signedInPage, [COMMUNITY_TUNE_ROW]);
		await signedInPage.goto('/tunes/community');

		// The session-gated browse UI.
		await expect(signedInPage.getByPlaceholder(/search by title/i)).toBeVisible();
		await expect(signedInPage.getByRole('combobox', { name: 'Sort community tunes' })).toHaveValue('popular');
		await expect(signedInPage.getByText('Sign in to browse community tunes.')).toHaveCount(0);

		// One card, counted in the header, opening the sheet.
		await expect(signedInPage.getByText('1–1 of 1 shared tunes', { exact: true })).toBeVisible();
		const card = signedInPage.getByRole('button', { name: 'Preview Community Test Tune' });
		await expect(card).toBeVisible();
		await expect(card).toContainText('E2E Composer');
		await expect(card).toContainText('by Test Author');
		// Concert C on the seeded tenor reads D — keys are never shown concert.
		await expect(signedInPage.getByRole('combobox', { name: 'Preview written key' })).toHaveValue('D');
		await expect(signedInPage.locator('.ct-preview')).toContainText('4 bars');
		await expect(card).toContainText('Medium Swing');

		// Another player's sheet: favourite count and the adopt action, no
		// "My sheet" badge.
		await expect(
			signedInPage.getByRole('button', { name: 'Favorite Community Test Tune' })
		).toContainText('2');
		await expect(
			signedInPage.getByRole('button', { name: 'Add Community Test Tune to my book' })
		).toBeVisible();
		await expect(signedInPage.getByText('My sheet')).toHaveCount(0);
	});

	// 2026-10-01: a user shared Blue Bossa; its card opened "Tune not found:
	// sheet-…", because the detail route resolved only the viewer's own book
	// (curated + own + adopted) and never looked a shared tune up.
	test('opening a card shows the shared sheet, offering to add it', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await stubCommunityRows(signedInPage, [COMMUNITY_TUNE_ROW]);
		await signedInPage.goto('/tunes/community');

		// The app's own click — a client-side navigation, not a reload.
		await signedInPage.getByRole('link', { name: 'View full chart' }).click();
		await expect(signedInPage).toHaveURL(/\/tunes\/e2e-community-tune-1$/);

		await expect(signedInPage.getByRole('heading', { name: 'Community Test Tune' })).toBeVisible();
		await expect(signedInPage.getByText('shared by Test Author')).toBeVisible();
		await expect(signedInPage.getByText(/Tune not found/)).toHaveCount(0);
		await expect(signedInPage.locator('.abcjs-container svg').first()).toBeVisible();

		// Not in the book yet: the page offers to add it, and practice waits
		// for that — practice resolves tunes from the book.
		await expect(signedInPage.getByRole('button', { name: 'Add to my book' })).toBeVisible();
		await expect(signedInPage.getByRole('button', { name: 'Practice licks' })).toHaveCount(0);
	});

	test('a cold deep link to a shared tune opens it', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await stubCommunityRows(signedInPage, [COMMUNITY_TUNE_ROW]);
		await signedInPage.goto('/tunes/e2e-community-tune-1');

		await expect(signedInPage.getByRole('heading', { name: 'Community Test Tune' })).toBeVisible();
		await expect(signedInPage.getByRole('button', { name: 'Add to my book' })).toBeVisible();
		await expect(signedInPage.getByText(/Tune not found/)).toHaveCount(0);
	});

	test('an unknown id still reads as not found', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await stubCommunityRows(signedInPage, []);
		await signedInPage.goto('/tunes/sheet-0-nope');

		await expect(signedInPage.getByText('Tune not found: sheet-0-nope')).toBeVisible();
	});

	test('an empty corpus shows the first-to-share prompt', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await stubCommunityRows(signedInPage, []);
		await signedInPage.goto('/tunes/community');

		await expect(signedInPage.getByText('No shared tunes yet.')).toBeVisible();
		await expect(signedInPage.getByText('0 shared tunes', { exact: true })).toBeVisible();
		await expect(signedInPage.locator('main').getByRole('link', { name: /add a tune/i })).toHaveAttribute(
			'href',
			'/tunes/add'
		);
	});
});

/**
 * Adding from the detail page needs a browser-side Supabase session (adoption
 * calls `getUser()`), which only the stub cloud fabricates.
 */
test.describe('tune community — add from the detail page', () => {
	const ADOPTER: E2ETestUser = { id: 'aaaaaaaa-0000-4000-8000-0000000ad097', email: 'adopter@e2e.dev' };

	test('an adoption with no cached sheet can be repaired from the detail page', async ({ page, baseURL }) => {
		const cloud = createStubCloud();
		cloud.seedRow('tunes', COMMUNITY_TUNE_ROW);
		cloud.seedRow('public_tune_authors', COMMUNITY_AUTHOR_ROW);
		cloud.seedRow('tune_adoptions', { user_id: ADOPTER.id, tune_id: COMMUNITY_TUNE_ROW.id });
		await installStubCloud(page.context(), cloud, ADOPTER, baseURL as string);
		await seedStorage(page, {
			settings: SETTINGS_ONBOARDED,
			'tour-state': TOUR_DISMISSED,
			'tune-adoptions': [COMMUNITY_TUNE_ROW.id]
		});
		// Hydration can recover the adoption ID but fail to cache its payload.
		// The independent detail lookup and subsequent repair remain available.
		await page.route('**/rest/v1/tunes?*', async (route) => {
			if (!new URL(route.request().url()).searchParams.get('id')?.startsWith('in.')) {
				return route.fallback();
			}
			await route.fulfill({
				status: 404,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Hydrated payload unavailable' })
			});
		});
		await page.goto('/tunes/e2e-community-tune-1');
		await expect(page.getByText('shared by Test Author')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Practice licks' })).toHaveCount(0);
		await page.getByRole('button', { name: 'Add to my book' }).click();
		await expect(page.getByRole('button', { name: 'Practice licks' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Return to community' })).toBeVisible();
		expect(cloud.rows('tune_adoptions')).toHaveLength(1);
	});

	test('a failed post-adoption fetch keeps the viewed sheet available for practice', async ({
		page,
		baseURL
	}) => {
		const cloud = createStubCloud();
		cloud.seedRow('tunes', COMMUNITY_TUNE_ROW);
		cloud.seedRow('public_tune_authors', COMMUNITY_AUTHOR_ROW);
		await installStubCloud(page.context(), cloud, ADOPTER, baseURL as string);
		await seedStorage(page, { settings: SETTINGS_ONBOARDED, 'tour-state': TOUR_DISMISSED });
		await page.goto('/tunes/e2e-community-tune-1');
		await expect(page.getByText('shared by Test Author')).toBeVisible();

		let failedFetches = 0;
		await page.route('**/rest/v1/tunes?*', async (route) => {
			// Hydration may re-fetch the viewed sheet before the click. Fail
			// only the payload request after the server records the adoption.
			if (cloud.rows('tune_adoptions').length === 0) return route.fallback();
			failedFetches++;
			await route.fulfill({
				status: 404,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Post-insert payload fetch unavailable' })
			});
		});
		await page.getByRole('button', { name: 'Add to my book' }).click();

		await expect(page.getByRole('button', { name: 'Practice licks' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Return to community' })).toBeVisible();
		await expect(page.getByText('shared by Test Author')).toBeVisible();
		expect(failedFetches).toBeGreaterThan(0);
		expect(cloud.rows('tune_adoptions')).toEqual([
			expect.objectContaining({ user_id: ADOPTER.id, tune_id: COMMUNITY_TUNE_ROW.id })
		]);
		await page.getByRole('button', { name: 'Practice licks' }).click();
		await expect(page).toHaveURL(/\/tunes\/[^/]+\/practice$/);
		await expect(page.getByRole('heading', { name: 'Practice licks' })).toBeVisible();
		await expect(page.getByRole('img', { name: 'Sheet Music for "Community Test Tune"' })).toBeVisible();
	});

	test('adding a shared tune puts it in the book and unlocks practice', async ({
		page,
		baseURL,
		consoleCollector: _consoleCollector
	}) => {
		const cloud = createStubCloud();
		cloud.seedRow('tunes', COMMUNITY_TUNE_ROW);
		cloud.seedRow('public_tune_authors', COMMUNITY_AUTHOR_ROW);
		await installStubCloud(page.context(), cloud, ADOPTER, baseURL as string);
		await seedStorage(page, { settings: SETTINGS_ONBOARDED, 'tour-state': TOUR_DISMISSED });

		await page.goto('/tunes/e2e-community-tune-1');
		await expect(page.getByRole('heading', { name: 'Community Test Tune' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Practice licks' })).toHaveCount(0);

		await page.getByRole('button', { name: 'Add to my book' }).click();

		await expect(page.getByRole('button', { name: 'Practice licks' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Return to community' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Add to my book' })).toHaveCount(0);
		expect(cloud.rows('tune_adoptions')).toEqual([
			expect.objectContaining({ user_id: ADOPTER.id, tune_id: 'e2e-community-tune-1' })
		]);
	});
});

test.describe('community studio desk', () => {
	const READER: E2ETestUser = { id: 'aaaaaaaa-0000-4000-8000-0000000ad098', email: 'reader@e2e.dev' };
	const rows = Array.from({ length: 8 }, (_, index) => ({
		...COMMUNITY_TUNE_ROW,
		id: `community-desk-${index}`,
		title: index === 0 ? 'Autumn Study' : `Community Tune ${index + 1}`,
		favorite_count: 20 - index,
		sections: [{ ...COMMUNITY_TUNE_ROW.sections[0], bars: 32,
			harmony: [
				{ chord: { root: 'D', quality: 'min7' }, startOffset: [0, 1], duration: [1, 1], scaleId: 'major.dorian' },
				{ chord: { root: 'G', quality: '7' }, symbol: 'G7(b9,#11)/B', startOffset: [1, 1], duration: [1, 1], scaleId: 'major.mixolydian' },
				{ chord: { root: 'C', quality: 'maj7' }, startOffset: [2, 1], duration: [30, 1], scaleId: 'major.ionian' }
			]
		}]
	}));

	/** Seed the stub cloud with the community rows and author, serve the paginated tunes listing, open /tunes/community and return the cloud. */
	async function desk(page: Page, baseURL: string) {
		const cloud = createStubCloud();
		for (const row of rows) cloud.seedRow('tunes', row);
		cloud.seedRow('public_tune_authors', COMMUNITY_AUTHOR_ROW);
		await installStubCloud(page.context(), cloud, READER, baseURL);
		await seedStorage(page, { settings: SETTINGS_ONBOARDED, 'tour-state': TOUR_DISMISSED });
		await page.route('**/rest/v1/tunes?*', async route => {
			if (route.request().method() !== 'GET') return route.fallback();
			const params = new URL(route.request().url()).searchParams;
			// The shared stub only supports eq/neq and no offset. This listing
			// fixture honors the actual page and global membership query.
			if (params.get('user_id') !== `neq.${READER.id}`) return route.fallback();
			let result = [...rows];
			const ids = params.get('id');
			if (ids?.startsWith('in.')) result = result.filter(row => ids.includes(row.id));
			if (ids?.startsWith('not.in.')) result = result.filter(row => !ids.includes(row.id));
			if (params.get('or')?.includes('zz-unmatched')) result = [];
			const offset = Number(params.get('offset') ?? 0);
			const limit = Number(params.get('limit') ?? 50);
			await jsonRoute(result.slice(offset, offset + limit))(route);
		});
		await page.goto('/tunes/community');
		await expect(page.getByRole('heading', { name: 'Autumn Study', exact: true })).toBeVisible();
		return cloud;
	}

	test('browses pages, retains eight bars, and transposes rich chords in written pitch', async ({ page, baseURL }) => {
		await desk(page, baseURL!);
		await expect(page.locator('.ct-tune-row')).toHaveCount(6);
		await expect(page.locator('.ct-bar')).toHaveCount(8);
		await expect(page.getByRole('combobox', { name: 'Preview written key' })).toHaveValue('D');
		await expect(page.locator('.ct-chord-cell').nth(1)).toContainText('A7(b9,#11)/C#');
		await page.getByRole('combobox', { name: 'Preview written key' }).selectOption('F');
		await expect(page.locator('.ct-chord-cell').nth(1)).toContainText('C7(b9,#11)/E');
		await page.getByRole('button', { name: 'Preview Community Tune 2', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Community Tune 2', exact: true })).toBeVisible();
		await expect(page.getByRole('combobox', { name: 'Preview written key' })).toHaveValue('D');
		await page.getByRole('button', { name: 'Next page' }).click();
		await expect(page.locator('.ct-tune-row')).toHaveCount(2);
		await expect(page.getByRole('button', { name: 'Preview Community Tune 7', exact: true })).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
		await page.getByRole('button', { name: 'Previous page' }).click();
		await expect(page.locator('.ct-tune-row')).toHaveCount(6);
	});

	test('favorites, adds and returns through real persistence actions', async ({ page, baseURL }) => {
		const cloud = await desk(page, baseURL!);
		await page.getByRole('button', { name: 'Favorite Autumn Study', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Unfavorite Autumn Study', exact: true })).toBeEnabled();
		expect(cloud.rows('tune_favorites')).toHaveLength(1);
		await page.getByRole('button', { name: 'Add Autumn Study to my book' }).click();
		await expect(page.getByRole('link', { name: 'In my book' })).toBeVisible();
		expect(cloud.rows('tune_adoptions')).toHaveLength(1);
		await page.getByRole('button', { name: 'Return to community' }).click();
		await expect(page.getByRole('button', { name: 'Add Autumn Study to my book' })).toBeEnabled();
		expect(cloud.rows('tune_adoptions')).toHaveLength(0);
		await page.getByRole('button', { name: /Filters/ }).click();
		await page.getByRole('combobox', { name: 'Filter collection' }).selectOption('favorites');
		await expect(page.locator('.ct-tune-row')).toHaveCount(1);
		await page.getByRole('button', { name: 'Unfavorite Autumn Study', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'No tunes match just yet.' })).toBeVisible();
		await page.locator('.ct-state').getByRole('button', { name: 'Clear filters' }).click();
		await expect(page.locator('.ct-tune-row')).toHaveCount(6);
	});

	test('rolls back failed actions and offers a retry for failed collection loads', async ({ page, baseURL }) => {
		await desk(page, baseURL!);
		await page.route('**/rest/v1/tune_favorites*', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Test rejection' }) }));
		await page.getByRole('button', { name: 'Favorite Autumn Study', exact: true }).click();
		await expect(page.getByRole('alert')).toHaveText('Could not save your favorite. Please try again.');
		await expect(page.getByRole('button', { name: 'Favorite Autumn Study', exact: true })).toContainText('20');
		await page.route('**/rest/v1/tunes?*', async route => {
			await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Test unavailable' }) });
		}, { times: 1 });
		await page.getByRole('combobox', { name: 'Sort community tunes' }).selectOption('newest');
		await expect(page.getByRole('heading', { name: 'The collection couldn’t load.' })).toBeVisible();
		await page.getByRole('button', { name: 'Try again' }).click();
		await expect(page.locator('.ct-tune-row')).toHaveCount(6);
		await page.getByRole('searchbox', { name: 'Search community tunes' }).fill('zz-unmatched');
		await expect(page.getByRole('heading', { name: 'No tunes match just yet.' })).toBeVisible();
	});

	test('reconciles a filtered page when an in-flight favorite is rejected', async ({ page, baseURL }) => {
		await desk(page, baseURL!);
		let release!: () => void;
		const responseGate = new Promise<void>(resolve => { release = resolve; });
		await page.route('**/rest/v1/tune_favorites*', async route => {
			await responseGate;
			await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Delayed rejection' }) });
		});
		await page.getByRole('button', { name: 'Favorite Autumn Study', exact: true }).click();
		await page.getByRole('button', { name: /Filters/ }).click();
		await page.getByRole('combobox', { name: 'Filter collection' }).selectOption('favorites');
		await expect(page.locator('.ct-tune-row')).toHaveCount(1);
		release();
		await expect(page.getByRole('heading', { name: 'No tunes match just yet.' })).toBeVisible();
	});

	test('fits a compact mobile screen and the light theme', async ({ page, baseURL }, testInfo) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await desk(page, baseURL!);
		await expect(page.locator('.ct-bar')).toHaveCount(8);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.getByRole('button', { name: 'Preview Community Tune 2', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Community Tune 2', exact: true })).toBeVisible();
		await page.evaluate(() => document.documentElement.classList.add('light'));
		await page.screenshot({ path: testInfo.outputPath('mobile-light.png'), fullPage: true });
		await page.setViewportSize({ width: 320, height: 844 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		// A page can fit while long alterations still overlap adjacent bars.
		expect(await page.locator('.ct-chord-cell .chord-symbol').evaluateAll(symbols => symbols.every(symbol => {
			const ink = symbol.getBoundingClientRect();
			const cell = symbol.closest('.ct-chord-cell')!.getBoundingClientRect();
			return ink.left >= cell.left - 1 && ink.right <= cell.right + 1;
		}))).toBe(true);
		await page.setViewportSize({ width: 1440, height: 1100 });
		await page.evaluate(() => document.documentElement.classList.remove('light'));
		await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
	});
});
