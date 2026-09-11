import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { seedOnboardedAnonymous } from './fixtures/storage';

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
		await expect(signedInPage.getByRole('button', { name: /^popular$/i })).toBeVisible();
		await expect(signedInPage.getByRole('button', { name: /^newest$/i })).toBeVisible();
		await expect(signedInPage.getByText('Sign in to browse community tunes.')).toHaveCount(0);

		// One card, counted in the header, opening the sheet.
		await expect(signedInPage.getByText('1 sheet', { exact: true })).toBeVisible();
		const card = signedInPage.getByRole('button', { name: 'Open Community Test Tune' });
		await expect(card).toBeVisible();
		await expect(card).toContainText('E2E Composer');
		await expect(card).toContainText('by Test Author');
		// Concert C on the seeded tenor reads D — keys are never shown concert.
		await expect(card).toContainText('Key of D');
		await expect(card).toContainText('4 bars');
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

	test('an empty corpus shows the first-to-share prompt', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await stubCommunityRows(signedInPage, []);
		await signedInPage.goto('/tunes/community');

		await expect(signedInPage.getByText('No shared tunes yet.')).toBeVisible();
		await expect(signedInPage.getByText('0 sheets', { exact: true })).toBeVisible();
		await expect(signedInPage.locator('main').getByRole('link', { name: /add a tune/i })).toHaveAttribute(
			'href',
			'/tunes/add'
		);
	});
});
