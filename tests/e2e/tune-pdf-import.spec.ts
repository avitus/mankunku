import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * The PDF import flow end-to-end on the client: upload → extraction →
 * MANDATORY review in the editor → save → detail page.
 *
 * The API route is stubbed so this runs without a key and deterministically:
 * per-system requests get the NDJSON heartbeat stream the real route speaks,
 * and the whole-PDF fallback gets the committed route-response fixture (the
 * recorded extraction of the real Fly Me to the Moon chart).
 *
 * Two regressions are pinned here:
 *  - the post-extraction handoff used to be WIPED by the editor's stale-state
 *    guard (editingId set without ?edit= looked like leftover state), landing
 *    the user in an empty editor after a 40-second wait;
 *  - one unreadable line used to reject out of `Promise.all` and discard
 *    every line that HAD been transcribed, then restart on the slower
 *    whole-PDF path — minutes of extra wait to arrive at an error.
 */

const ROUTE_RESPONSE = readFileSync('tests/fixtures/leadsheets/fly-me-to-the-moon.parsed-sheet.json', 'utf8');

interface SystemRequest {
	system?: { barCount?: number; first?: boolean; timeSignature?: [number, number] };
	pdf?: string;
}

/** The route's NDJSON shape: heartbeats, then exactly one terminal line. */
function ndjson(...lines: unknown[]): string {
	return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function transcribedSystem(barCount: number, printedMeter: [number, number] = [4, 4]): string {
	return ndjson(
		{ type: 'progress', elapsedMs: 3_000, attempt: 1 },
		{
			type: 'result',
			keySignature: { fifths: 2 },
			timeSignature: printedMeter,
			warnings: [],
			bars: Array.from({ length: barCount }, () => ({
				startRepeat: false,
				endRepeat: false,
				ending: null,
				pickup: false,
				melody: [[0, 4, 'B4']]
			}))
		}
	);
}

/**
 * @param failFirstSystem fail every attempt at the chart's opening line, to
 *   exercise the partial-result path (it is identifiable in the request body
 *   by `system.first`, and it is also the line that carries the meter).
 */
async function stubParseRoute(
	page: import('@playwright/test').Page,
	{
		failFirstSystem = false,
		printedMeter = [4, 4] as [number, number],
		seenMeters
	}: {
		failFirstSystem?: boolean;
		/** Meter the stub claims is PRINTED, for the declaration cross-check. */
		printedMeter?: [number, number];
		/** Collects the meter each per-line request was prompted with. */
		seenMeters?: Array<[number, number]>;
	} = {}
): Promise<void> {
	await page.route('**/api/tune-parse', async (route) => {
		const request = route.request();
		if (request.method() === 'GET') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ configured: true, model: 'stub' })
			});
			return;
		}
		const body = (request.postDataJSON() ?? {}) as SystemRequest;
		if (body.system) {
			if (seenMeters && body.system.timeSignature) seenMeters.push(body.system.timeSignature);
			const failing = failFirstSystem && body.system.first === true;
			await route.fulfill({
				status: 200,
				contentType: 'application/x-ndjson',
				body: failing
					? ndjson({
							type: 'error',
							status: 502,
							message: 'The system image could not be transcribed (api: overloaded).'
						})
					: transcribedSystem(body.system.barCount ?? 4, printedMeter)
			});
			return;
		}
		// The page asks for NDJSON on the whole-PDF fallback too, and the route
		// answers with a heartbeat stream there — it is the longest single call
		// in the system. NOTE: nothing in this file currently reaches this
		// branch (partial results mean a failed line no longer triggers the
		// fallback), so it is stubbed for fidelity, not coverage — a plain-JSON
		// body here would throw in `readNdjsonResult`, which only accepts a
		// typed `result` line, and no test would have told us.
		await route.fulfill({
			status: 200,
			contentType: 'application/x-ndjson',
			body: ndjson(
				{ type: 'progress', elapsedMs: 3_000, attempt: 1 },
				{ type: 'result', ...(JSON.parse(ROUTE_RESPONSE) as Record<string, unknown>) }
			)
		});
	});
}

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await stubParseRoute(page);
});

test('a PDF chart lands in the editor for review and saves from there', async ({ page }) => {
	await page.goto('/tunes/import/pdf');

	// The source-pitch selector defaults to the seeded tenor's family.
	await expect(page.getByLabel('Chart written for')).toHaveValue('Bb');

	const fileInput = page.getByLabel('Tune PDF');
	await expect(fileInput).toBeEnabled(); // config probe resolved + hydrated
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');

	// The draft opens in the editor with the extracted content intact.
	await page.waitForURL('**/tunes/editor');
	await expect(page.getByRole('textbox', { name: 'Tune title' })).toHaveValue('Fly Me to the Moon');
	// The chart is printed at written pitch for tenor (D). The Bb default
	// shifts it to concert C on import, and the editor re-displays it at the
	// tenor's written pitch — so the opening chord reads B-7, exactly as
	// printed on the source chart.
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^B-7$/ }).first()).toBeVisible();
	// The pre-assigned id keeps the flow in update mode so the stored PDF
	// stays linked to the sheet the user saves.
	await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();

	await page.getByRole('button', { name: 'Update' }).click();
	// The per-system pipeline (importViaSystems) assigns its own generated
	// sheet id client-side — the route fixture's id only applies on the
	// single-shot fallback path — so match the id shape, not a fixed value.
	await page.waitForURL(/\/tunes\/sheet-[^/]+$/);
	await expect(page.getByRole('heading', { name: 'Fly Me to the Moon' })).toBeVisible();
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();

	// Saved into the book, and the detail URL is the saved sheet's id — the
	// same id the PDF blob was stored under, so the linkage holds.
	const stored = await page.evaluate(() => window.localStorage.getItem('mankunku:user-tunes'));
	const sheets = JSON.parse(stored ?? '[]') as Array<{ id: string; title: string }>;
	expect(sheets).toHaveLength(1);
	expect(sheets[0].title).toBe('Fly Me to the Moon');
	expect(page.url()).toContain(`/tunes/${sheets[0].id}`);
});

test('the declared time signature goes out with every line, with none waiting on another', async ({
	page
}) => {
	// The meter used to be learned by transcribing line 1, which serialised
	// the whole import behind that one call — 263s of it on a measured run.
	const seenMeters: Array<[number, number]> = [];
	await stubParseRoute(page, { printedMeter: [3, 4], seenMeters });
	await page.goto('/tunes/import/pdf');

	const fileInput = page.getByLabel('Tune PDF');
	// Enabled == config probe resolved AND hydrated; selecting before that
	// changes the DOM value without reaching the rune behind it.
	await expect(fileInput).toBeEnabled();
	await page.getByLabel('Time signature').selectOption('3/4');
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');

	await page.waitForURL('**/tunes/editor', { timeout: 60_000 });
	expect(seenMeters.length).toBeGreaterThan(1);
	// Every line — including the first — was prompted with the user's meter.
	expect(seenMeters.every(([n, d]) => n === 3 && d === 4)).toBe(true);
});

test('a declared meter that contradicts the print is flagged, not silently applied', async ({
	page
}) => {
	await stubParseRoute(page, { printedMeter: [3, 4] });
	await page.goto('/tunes/import/pdf');
	// Leave the 4/4 default while the chart reports 3/4.
	const fileInput = page.getByLabel('Tune PDF');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');

	await page.waitForURL('**/tunes/editor', { timeout: 60_000 });
	await page.getByRole('group').filter({ hasText: /detail/ }).getByText(/detail/).first().click();
	await expect(page.getByText(/looks like it is in 3\/4/).first()).toBeVisible();
});

test('a line the AI cannot read is left blank instead of sinking the import', async ({ page }) => {
	await stubParseRoute(page, { failFirstSystem: true });
	await page.goto('/tunes/import/pdf');

	const fileInput = page.getByLabel('Tune PDF');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');

	// The draft still arrives — the lines that DID transcribe are kept, and
	// the whole-PDF fallback is not used (it would have replaced the title
	// with the fixture's and taken minutes).
	await page.waitForURL('**/tunes/editor', { timeout: 60_000 });
	await expect(page.getByRole('textbox', { name: 'Tune title' })).toBeVisible();

	// The failed line is not silently blank: the review banner names its bars
	// up front, and the detail says why they are empty.
	await expect(page.getByText(/Review bars .* — the import wasn't certain there/)).toBeVisible();
	await page.getByRole('group').filter({ hasText: /detail/ }).getByText(/detail/).first().click();
	await expect(page.getByText(/could not be transcribed/i).first()).toBeVisible();
});

test('the import reports which line it is on, and can be cancelled', async ({ page }) => {
	// Hold every system request open so the progress panel stays on screen.
	await page.route('**/api/tune-parse', async (route) => {
		const request = route.request();
		if (request.method() === 'GET') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ configured: true, model: 'stub' })
			});
			return;
		}
		// Never fulfilled: the request hangs exactly like a long model call.
		await new Promise(() => {});
	});
	await page.goto('/tunes/import/pdf');
	const fileInput = page.getByLabel('Tune PDF');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');

	// Per-line state, not a bare spinner: the old UI showed one counter that
	// only moved when a whole batch of three finished.
	const panel = page.getByTestId('import-progress');
	await expect(panel).toBeVisible();
	await expect(panel.getByText(/Transcribing \d+ of \d+ lines/)).toBeVisible({ timeout: 60_000 });
	await expect(panel.getByText('Line 1')).toBeVisible();
	await expect(panel.getByText(/reading/).first()).toBeVisible();

	await panel.getByRole('button', { name: 'Cancel import' }).click();
	await expect(page.getByText('Import cancelled.')).toBeVisible();
	// The file input is released, so a second attempt is possible.
	await expect(fileInput).toBeEnabled();
});

test('cancelling an unsaved PDF draft returns to the book, not a dead detail page', async ({ page }) => {
	await page.goto('/tunes/import/pdf');
	const fileInput = page.getByLabel('Tune PDF');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');

	await page.waitForURL('**/tunes/editor');
	await expect(page.getByRole('textbox', { name: 'Tune title' })).toHaveValue('Fly Me to the Moon');

	await page.getByRole('button', { name: 'Cancel' }).click();
	await page.waitForURL('**/tunes');
	await expect(page.getByRole('heading', { name: 'Tunes', exact: true })).toBeVisible();
});
