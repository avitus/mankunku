import type { Page } from '@playwright/test';
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

const ROUTE_RESPONSE = readFileSync(
	'tests/fixtures/leadsheets/fly-me-to-the-moon.parsed-sheet.json',
	'utf8'
);

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
		seenMeters,
		posts
	}: {
		failFirstSystem?: boolean;
		/** Meter the stub claims is PRINTED, for the declaration cross-check. */
		printedMeter?: [number, number];
		/** Collects the meter each per-line request was prompted with. */
		seenMeters?: Array<[number, number]>;
		/** Records the shape of EVERY non-GET request ('system' | 'pdf' | 'other'). */
		posts?: string[];
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
		posts?.push(body.system ? 'system' : (body as { pdf?: unknown }).pdf ? 'pdf' : 'other');
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

/**
 * Expand the editor's import-review notes ("N details").
 *
 * Waits for the chart to engrave first. The review box sits directly under
 * the chart, which abcjs draws after the editor mounts, so a click aimed at
 * the summary before then is dispatched to wherever the summary WAS: on CI
 * Firefox (2026-09-27, -30) the engrave landed between Playwright's
 * actionability check and the click, the review stayed closed below the
 * fold, and the video shows the pointer's hover highlight on bar 3's chord
 * slot — the summary's spot in the unengraved layout. `Sheet Music for …` is
 * abcjs's own label on the engraved SVG.
 */
async function openImportReview(page: Page): Promise<void> {
	await expect(page.getByRole('img', { name: /^Sheet Music for/ })).toBeVisible();
	await page
		.getByRole('group')
		.filter({ hasText: /detail/ })
		.getByText(/detail/)
		.first()
		.click();
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
	// Selecting a chart leaves time to check the printed pitch and meter.
	await expect(page.getByText('Ready when you are.')).toBeVisible();
	await expect(page).toHaveURL(/\/tunes\/import\/pdf$/);
	await expect(page.getByTestId('import-progress')).toHaveCount(0);
	await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();

	// The draft opens in the editor with the extracted content intact.
	await page.waitForURL('**/tunes/editor');
	await expect(page.getByRole('textbox', { name: 'Tune title' })).toHaveValue('Fly Me to the Moon');
	// The chart is printed at written pitch for tenor (D). The Bb default
	// shifts it to concert C on import, and the editor re-displays it at the
	// tenor's written pitch — so the opening chord reads B-7, exactly as
	// printed on the source chart.
	await expect(
		page.locator('.abcjs-container svg text').filter({ hasText: /^B-7$/ }).first()
	).toBeVisible();
	// The pre-assigned id keeps the flow in update mode so the stored PDF
	// stays linked to the sheet the user saves.
	await expect(page.getByRole('button', { name: 'Update tune' })).toBeVisible();

	await page.getByRole('button', { name: 'Update tune' }).click();
	// The per-system pipeline (importViaSystems) assigns its own generated
	// sheet id client-side — the route fixture's id only applies on the
	// single-shot fallback path — so match the id shape, not a fixed value.
	// The saved tune lands on its title slug (the pre-assigned `sheet-…` id stays the PDF key).
	await page.waitForURL(/\/tunes\/(?!editor$|sheet-)[a-z0-9-]+$/);
	await expect(page.getByRole('heading', { name: 'Fly Me to the Moon' })).toBeVisible();
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();

	// Saved into the book under its pre-assigned `sheet-…` id — the same id the
	// PDF blob was stored under, so the linkage holds. The detail URL is the
	// title slug (2026-09-16), so the linkage is checked against the PDF store
	// itself rather than read off the address bar.
	const stored = await page.evaluate(() => window.localStorage.getItem('mankunku:user-tunes'));
	const sheets = JSON.parse(stored ?? '[]') as Array<{ id: string; title: string }>;
	expect(sheets).toHaveLength(1);
	expect(sheets[0].title).toBe('Fly Me to the Moon');
	expect(sheets[0].id).toMatch(/^sheet-/);
	expect(page.url()).toMatch(/\/tunes\/fly-me-to-the-moon$/);
	// The anonymous bucket's store, opened by its exact name (WebKit's
	// `indexedDB.databases()` lists nothing here); an `upgradeneeded` means the
	// database did not exist, so abort rather than create an empty one.
	const pdfIds = await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase | null>((res, rej) => {
			const req = indexedDB.open('mankunku-tune-pdfs:anon');
			req.onupgradeneeded = () => {
				req.transaction?.abort();
				res(null);
			};
			req.onsuccess = () => res(req.result);
			req.onerror = () => (req.error?.name === 'AbortError' ? res(null) : rej(req.error));
		});
		if (!db) return [] as string[];
		return new Promise<string[]>((res, rej) => {
			const req = db.transaction('pdfs').objectStore('pdfs').getAllKeys();
			req.onsuccess = () => res(req.result.map(String));
			req.onerror = () => rej(req.error);
		});
	});
	expect(pdfIds).toContain(sheets[0].id);
});

test('the declared time signature goes out with every line, including the context pass', async ({
	page
}) => {
	// Header observations carry the declaration too; music recognition does
	// not have to wait for an expensive first melody transcription.
	const seenMeters: Array<[number, number]> = [];
	await stubParseRoute(page, { printedMeter: [3, 4], seenMeters });
	await page.goto('/tunes/import/pdf');

	const fileInput = page.getByLabel('Tune PDF');
	// Enabled == config probe resolved AND hydrated; selecting before that
	// changes the DOM value without reaching the rune behind it.
	await expect(fileInput).toBeEnabled();
	await page.getByLabel('Time signature').selectOption('3/4');
	await fileInput.setInputFiles('tests/fixtures/leadsheets/pdf-accuracy/black-orpheus-scan.pdf');
	await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();

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
	await fileInput.setInputFiles('tests/fixtures/leadsheets/pdf-accuracy/black-orpheus-scan.pdf');
	await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();

	await page.waitForURL('**/tunes/editor', { timeout: 60_000 });
	await openImportReview(page);
	await expect(page.getByText(/looks like it is in 3\/4/).first()).toBeVisible();
});

test('a line the AI cannot read is left blank instead of sinking the import', async ({ page }) => {
	await stubParseRoute(page, { failFirstSystem: true });
	await page.goto('/tunes/import/pdf');

	const fileInput = page.getByLabel('Tune PDF');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles('tests/fixtures/leadsheets/pdf-accuracy/black-orpheus-scan.pdf');
	await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();

	// The draft still arrives — the lines that DID transcribe are kept, and
	// the whole-PDF fallback is not used (it would have replaced the title
	// with the fixture's and taken minutes).
	await page.waitForURL('**/tunes/editor', { timeout: 60_000 });
	await expect(page.getByRole('textbox', { name: 'Tune title' })).toBeVisible();

	// The failed line is not silently blank: the review banner names its bars
	// up front, and the detail says why they are empty.
	await expect(page.getByText(/Review bars .* — the import wasn't certain there/)).toBeVisible();
	await openImportReview(page);
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
	await fileInput.setInputFiles('tests/fixtures/leadsheets/pdf-accuracy/black-orpheus-scan.pdf');
	await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();

	// Per-line state, not a bare spinner: the old UI showed one counter that
	// only moved when a whole batch of three finished.
	const panel = page.getByTestId('import-progress');
	await expect(panel).toBeVisible();
	await expect(
		panel.getByText(/(?:Transcribing|Reading key and clef for) \d+ of \d+ lines/)
	).toBeVisible({ timeout: 60_000 });
	await expect(panel.getByText('Line 1')).toBeVisible();
	await expect(panel.getByText(/reading/).first()).toBeVisible();
	await expect(page.getByLabel('Chart written for')).toBeDisabled();
	await expect(page.getByLabel('Time signature')).toBeDisabled();

	await panel.getByRole('button', { name: 'Cancel import' }).click();
	await expect(page.getByText('Import cancelled.')).toBeVisible();
	// The file input is released, so a second attempt is possible.
	await expect(fileInput).toBeEnabled();
	await expect(page.getByText('black-orpheus-scan.pdf', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Prepare draft', exact: true })).toBeEnabled();
	await expect(page.getByLabel('Chart written for')).toBeEnabled();
});

test('staged PDFs can be removed and reselected; invalid files do not start recognition', async ({ page }) => {
	await page.goto('/tunes/import/pdf');
	const input = page.getByLabel('Tune PDF');
	const prepare = page.getByRole('button', { name: 'Prepare draft', exact: true });
	await expect(input).toBeEnabled();
	await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a PDF') });
	await expect(page.getByRole('alert')).toHaveText('Choose a PDF file.');
	await expect(prepare).toBeDisabled();
	await input.setInputFiles({ name: 'large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
	await expect(page.getByRole('alert')).toContainText('PDF too large');
	await expect(prepare).toBeDisabled();
	await input.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(prepare).toBeEnabled();
	await page.getByRole('button', { name: 'Remove PDF' }).click();
	await expect(prepare).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Choose a PDF' })).toBeVisible();
	await input.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');
	await expect(prepare).toBeEnabled();
	await expect(page.getByText('Ready when you are.')).toBeVisible();
});

test('dropping a chart stages it without bypassing preparation', async ({ page }) => {
	await page.goto('/tunes/import/pdf');
	await expect(page.getByLabel('Tune PDF')).toBeEnabled();
	const transfer = await page.evaluateHandle(() => {
		const data = new DataTransfer();
		data.items.add(new File(['%PDF-1.4'], 'dropped-chart.pdf', { type: 'application/pdf' }));
		return data;
	});
	await page.getByRole('region', { name: 'Drop a PDF chart' }).dispatchEvent('drop', { dataTransfer: transfer });
	await expect(page.getByText('dropped-chart.pdf', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Prepare draft', exact: true })).toBeEnabled();
	await expect(page.getByTestId('import-progress')).toHaveCount(0);
	await transfer.dispose();
});

test('cancelling an unsaved PDF draft returns to the book, not a dead detail page', async ({
	page
}) => {
	await page.goto('/tunes/import/pdf');
	const fileInput = page.getByLabel('Tune PDF');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');
	await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();

	await page.waitForURL('**/tunes/editor');
	await expect(page.getByRole('textbox', { name: 'Tune title' })).toHaveValue('Fly Me to the Moon');

	await page.getByRole('button', { name: 'Cancel' }).click();
	await page.waitForURL('**/tunes');
	await expect(page.getByRole('heading', { name: 'Tunes', exact: true })).toBeVisible();
});

test('embedded notation takes priority over an attached OMR transcription with zero AI calls', async ({
	page
}) => {
	// The .omr.json is a REAL recorded LEGATO v1 transcription of this chart
	// (deterministic; see docs/omr/). Lines it covers never touch the network.
	const seenMeters: Array<[number, number]> = [];
	const posts: string[] = [];
	await stubParseRoute(page, { seenMeters, posts });
	await page.goto('/tunes/import/pdf');

	await page.locator('summary').filter({ hasText: 'Have a transcription?' }).click();
	const omrInput = page.getByLabel('OMR transcription (optional)');
	await expect(omrInput).toBeEnabled();
	await omrInput.setInputFiles('tests/fixtures/leadsheets/omr/lady-bird.omr.json');
	await expect(page.getByText(/Attached OMR transcription: lady-bird\.omr\.json/)).toBeVisible();

	const fileInput = page.getByLabel('Tune PDF');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles('Leadsheets/PDF/Lady Bird.pdf');
	await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();

	await page.waitForURL('**/tunes/editor', { timeout: 60_000 });
	await expect(page.getByRole('textbox', { name: 'Tune title' })).toHaveValue(/Lady Bird/);
	// Every line was covered by the OMR transcription: no request of ANY
	// shape reached the parse route — system-mode or whole-PDF fallback.
	expect(seenMeters).toHaveLength(0);
	expect(posts).toHaveLength(0);
	// The chart content arrived: notation is rendered for review.
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
});

test('a non-OMR JSON file is rejected inline and the import is not blocked', async ({ page }) => {
	await page.goto('/tunes/import/pdf');

	await page.locator('summary').filter({ hasText: 'Have a transcription?' }).click();
	const omrInput = page.getByLabel('OMR transcription (optional)');
	await expect(omrInput).toBeEnabled();
	await omrInput.setInputFiles({
		name: 'not-omr.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify({ hello: 'world' }))
	});
	await expect(page.getByText(/Not a usable OMR transcription/)).toBeVisible();

	// The PDF path still works without the attachment.
	const fileInput = page.getByLabel('Tune PDF');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');
	await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();
	await page.waitForURL('**/tunes/editor');
	await expect(page.getByRole('textbox', { name: 'Tune title' })).toHaveValue('Fly Me to the Moon');
});

test('Black Orpheus scan has 39 measures and requests independent harmony with inherited context', async ({
	page
}) => {
	const music: Array<{ barCount: number; readHarmony: boolean; context: { fifths: number } }> = [];
	await page.route('**/api/tune-parse', async (route) => {
		if (route.request().method() === 'GET')
			return route.fulfill({ json: { configured: true, model: 'test' } });
		const { system } = route.request().postDataJSON();
		expect(system).toBeTruthy();
		if (system.contextOnly)
			return route.fulfill({
				contentType: 'application/x-ndjson',
				body: ndjson({
					type: 'result',
					keySignature: system.first ? { fifths: 2 } : null,
					clef: 'treble',
					timeSignature: null,
					bars: [],
					warnings: []
				})
			});
		music.push(system);
		expect(system.harmonyImages).toHaveLength(system.barCount);
		expect(system.readAccidentals).toBe(true);
		expect(
			system.harmonyImages.every((image: string) => image.startsWith('data:image/png;base64,'))
		).toBe(true);
		return route.fulfill({
			contentType: 'application/x-ndjson',
			body: transcribedSystem(system.barCount)
		});
	});
	await page.goto('/tunes/import/pdf');
	await expect(page.getByLabel('Tune PDF')).toBeEnabled();
	await page
		.getByLabel('Tune PDF')
		.setInputFiles('tests/fixtures/leadsheets/pdf-accuracy/black-orpheus-scan.pdf');
	await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();
	await page.waitForURL('**/tunes/editor', { timeout: 60_000 });
	expect(music.map((s) => s.barCount)).toEqual([5, 4, 4, 4, 4, 4, 4, 4, 6]);
	expect(music.every((s) => s.readHarmony && s.context.fifths === 2)).toBe(true);
});

test('an exported PDF imports offline and keeps the original measures available for correction', async ({
	page
}) => {
	const posts: string[] = [];
	await page.route('**/api/tune-parse', async (route) => {
		if (route.request().method() === 'GET') return route.fulfill({ json: { configured: false } });
		posts.push(route.request().postData() ?? '');
		return route.fulfill({ status: 503, json: { message: 'No optical reader' } });
	});
	await page.goto('/tunes/import/pdf');
	await expect(page.getByText('The scan reader is unavailable.', { exact: false })).toBeVisible();
	await page.getByLabel('Tune PDF').setInputFiles('Leadsheets/PDF/Lady Bird.pdf');
	await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();
	await page.waitForURL('**/tunes/editor');
	expect(posts).toEqual([]);
	await expect(page.getByRole('textbox', { name: 'Tune title' })).toHaveValue(/Lady Bird/);
	await page.getByText('Compare with original PDF', { exact: true }).click();
	await expect(page.getByAltText('Original PDF measure 1')).toBeVisible();
	await page.getByLabel('Source measure', { exact: true }).selectOption({ label: '3' });
	await expect(page.getByAltText('Original PDF measure 3')).toBeVisible();
	await page.getByRole('button', { name: 'Update tune', exact: true }).click();
	await page.waitForURL(/\/tunes\/lady-bird$/);
	const saved = await page.evaluate(
		() => JSON.parse(localStorage.getItem('mankunku:user-tunes') ?? '[]')[0]
	);
	expect(
		saved.sections.reduce(
			(n: number, s: { notes: { pitch: number | null }[] }) =>
				n + s.notes.filter((note) => note.pitch !== null).length,
			0
		)
	).toBe(53);
	expect(JSON.stringify(saved)).not.toContain('data:image');
});

for (const [name, measures] of [
	['Donna Lee', 32],
	['Do Nothing Till You Hear From Me', 33]
] as const) {
	test(`legacy-font ${name} imports without an optical reader`, async ({ page }) => {
		const posts: string[] = [];
		await page.route('**/api/tune-parse', async (route) => {
			if (route.request().method() === 'GET') return route.fulfill({ json: { configured: false } });
			posts.push(route.request().postData() ?? '');
			return route.fulfill({ status: 503, json: { message: 'No optical reader' } });
		});
		await page.goto('/tunes/import/pdf');
		await page.getByLabel('Tune PDF').setInputFiles(`Leadsheets/PDF/${name} - Bb.pdf`);
		await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();
		await page.waitForURL('**/tunes/editor');
		expect(posts).toEqual([]);
		await expect(page.getByRole('textbox', { name: 'Tune title' })).toHaveValue(
			new RegExp(name.replace('Till', 'Till?'))
		);
		await page.getByText('Compare with original PDF', { exact: true }).click();
		await page
			.getByLabel('Source measure', { exact: true })
			.selectOption({ label: String(measures) });
		await expect(page.getByAltText(`Original PDF measure ${measures}`)).toBeVisible();
	});
}
