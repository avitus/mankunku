/**
 * FIXTURE RECORDER — not a test; skipped unless RECORD_OMR_FIXTURES=1.
 *
 * Drives the real import page with the committed OMR transcriptions and
 * records the saved concert-pitch Tune as
 * `tests/fixtures/leadsheets/pdf-vs-musescore/<slug>.omr-import.json` for
 * the comparison suite. Fully deterministic and network-free: any POST to
 * /api/tune-parse aborts the recording (the fused path must cover every
 * line). Re-run after an intentional fusion change:
 *
 *     RECORD_OMR_FIXTURES=1 npx playwright test record-omr-fixtures --project=chromium
 *
 * (Committed, unlike the original pdf-import recorder, precisely because
 * that one living in a scratchpad made re-recording a rediscovery project.)
 */
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { seedOnboardedAnonymous } from './fixtures/storage';

test.skip(
	!process.env.RECORD_OMR_FIXTURES,
	'fixture recorder — set RECORD_OMR_FIXTURES=1 to re-record'
);

const CHARTS = [
	{ slug: 'lady-bird', pdf: 'Leadsheets/PDF/Lady Bird.pdf' },
	{ slug: 'take-the-a-train', pdf: 'Leadsheets/PDF/Take the A Train.pdf' },
	{ slug: 'all-of-me', pdf: 'Leadsheets/PDF/All of Me.pdf' }
];

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.route('**/api/tune-parse', async (route) => {
		if (route.request().method() === 'GET') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ configured: true, model: 'stub' })
			});
			return;
		}
		throw new Error('recording must not touch the parse route — OMR coverage was incomplete');
	});
});

for (const { slug, pdf } of CHARTS) {
	test(`record ${slug}`, async ({ page }) => {
		await page.goto('/tunes/import/pdf');

		const omrInput = page.getByLabel('OMR transcription (optional)');
		await expect(omrInput).toBeEnabled();
		await omrInput.setInputFiles(`tests/fixtures/leadsheets/omr/${slug}.omr.json`);
		await expect(page.getByText(/Using OMR melody from/)).toBeVisible();

		const fileInput = page.getByLabel('Tune PDF');
		await expect(fileInput).toBeEnabled();
		await fileInput.setInputFiles(pdf);

		await page.waitForURL('**/tunes/editor', { timeout: 60_000 });
		await page.getByRole('button', { name: 'Update' }).click();
		await page.waitForURL(/\/tunes\/sheet-[^/]+$/);

		const stored = await page.evaluate(() => window.localStorage.getItem('mankunku:user-tunes'));
		const sheets = JSON.parse(stored ?? '[]') as Array<Record<string, unknown>>;
		expect(sheets).toHaveLength(1);
		writeFileSync(
			`tests/fixtures/leadsheets/pdf-vs-musescore/${slug}.omr-import.json`,
			JSON.stringify({ sheet: sheets[0] }, null, '\t') + '\n'
		);
	});
}
