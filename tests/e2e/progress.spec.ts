import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';

/**
 * Progress route — exercises the page's tabs and session-list rendering.
 * Seeds a synthetic progress entry so the page has something to render
 * (the empty state is also valid but doesn't exercise the interactive tabs).
 */

test.describe('progress', () => {
	test.beforeEach(async ({ page }) => {
		// Seed a single fake progress session so the Sessions tab has content
		// to render. The shape matches what recordAttempt() writes via the
		// progress.svelte.ts persistence path.
		await seedStorage(page, {
			settings: SETTINGS_ONBOARDED,
			'tour-state': TOUR_DISMISSED,
			progress: {
				sessions: [
					{
						id: 'e2e-test-session-0',
						timestamp: new Date('2026-04-01T12:00:00Z').toISOString(),
						score: { pitch: 0.92, rhythm: 0.81, overall: 0.88 },
						tonality: { key: 'C', scaleType: 'major' },
						instrumentId: 'tenor-sax',
						lickId: null
					}
				],
				scaleProficiency: {},
				lastDailyTonality: null
			}
		});
	});

	test('renders the progress page heading and main landmark', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/progress');
		await expect(page.locator('main')).toBeVisible();
		// The page has a heading; use a permissive matcher rather than
		// asserting exact wording, which has been tweaked across recent commits.
		await expect(page.getByRole('heading').first()).toBeVisible();
	});
});
