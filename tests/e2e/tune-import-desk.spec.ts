import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await seedOnboardedAnonymous(page); });

for (const width of [1280, 820, 390]) {
	test(`all four tune entry workspaces fit at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		for (const route of ['add', 'import/ireal', 'import/biab', 'import/musescore']) {
			await page.goto('/tunes/' + route);
			await expect(page.locator('.studio-page-heading h1')).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
			if (route === 'add') {
				const primary = page.getByRole('region', { name: 'Create in Editor or import from MuseScore' });
				await expect(primary.getByRole('link', { name: 'Open the editor' })).toBeVisible();
				await expect(primary.getByRole('link', { name: 'Import from MuseScore' })).toBeVisible();
				await expect(primary.getByText('Most reliable import')).toBeVisible();
			} else {
				await expect(page.getByLabel('Chart written for')).toBeEnabled();
				await expect(page.getByRole('button', { name: /^Read (link|file|score)$/ })).toBeDisabled();
			}
		}
	});
}

test('MuseScore waits for Read score, preserves a manual source choice and engraves the real score', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/tunes/import/musescore');
	const fileInput = page.getByLabel('MuseScore file');
	await expect(fileInput).toBeEnabled();
	await page.getByLabel('Chart written for').selectOption('Eb');
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.mscz');
	await expect(page.getByText('Your music is ready to read.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add to book' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Read score', exact: true }).click();
	await expect(page.getByLabel('Chart written for')).toHaveValue('Eb');
	await expect(page.getByRole('region', { name: 'Imported score preview' }).locator('.abcjs-note').first()).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await expect(fileInput).toHaveValue('');
});

test('playlist filtering keeps added state attached to the original tune and reset starts a fresh import', async ({ page }) => {
	const song = (title: string): string => `${title}=Trad=Swing=C=n={*AT44C7 |F7 |C7 |G7 Z`;
	const link = 'irealbook://' + encodeURIComponent(song('First Blues') + '===' + song('Second Blues'));
	await page.goto('/tunes/import/ireal');
	await page.getByRole('textbox', { name: 'iReal Pro share link' }).fill(link);
	await page.getByRole('button', { name: 'Read link' }).click();
	const search = page.getByRole('searchbox', { name: 'Find a tune in this import' });
	await search.fill('Second');
	await page.getByRole('button', { name: 'Add to book' }).click();
	await search.fill('');
	await expect(page.getByRole('article', { name: 'Second Blues' }).getByRole('link', { name: 'Added — view' })).toBeVisible();
	await expect(page.getByRole('article', { name: 'First Blues' }).getByRole('button', { name: 'Add to book' })).toBeVisible();
	await search.fill('no such song');
	await expect(page.getByText(/No tunes match/)).toBeVisible();
	await page.getByRole('button', { name: 'Clear search' }).click();
	await page.getByRole('button', { name: 'Start over' }).click();
	await page.getByRole('textbox', { name: 'iReal Pro share link' }).fill(link);
	await page.getByRole('button', { name: 'Read link' }).click();
	await expect(page.getByRole('button', { name: 'Add to book' })).toHaveCount(2);
});

test('cancelled file reads cannot replace a newer import', async ({ page }) => {
	await page.addInitScript(() => {
		const original = File.prototype.arrayBuffer;
		const state = window as unknown as { slowReadStarted?: boolean; releaseSlowRead?: () => void; slowReadFinished?: boolean };
		File.prototype.arrayBuffer = async function (): Promise<ArrayBuffer> {
			const data = await original.call(this);
			if (this.name === 'slow.sgu') {
				state.slowReadStarted = true;
				await new Promise<void>(resolve => { state.releaseSlowRead = resolve; });
				state.slowReadFinished = true;
			}
			return data;
		};
	});
	await page.goto('/tunes/import/biab');
	const fileInput = page.getByLabel('Band-in-a-Box file');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles({ name: 'slow.sgu', mimeType: 'application/octet-stream', buffer: await readFile('tests/fixtures/leadsheets/fly-me-to-the-moon.sgu') });
	await page.getByRole('button', { name: 'Read file', exact: true }).click();
	await expect.poll(() => page.evaluate(() => (window as unknown as { slowReadStarted?: boolean }).slowReadStarted)).toBe(true);
	await expect(page.getByLabel('Chart written for')).toBeDisabled();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByText('slow.sgu', { exact: true })).toBeVisible();
	await fileInput.setInputFiles({ name: 'corrupt.sgu', mimeType: 'application/octet-stream', buffer: Buffer.from('not a song') });
	await page.getByRole('button', { name: 'Read file', exact: true }).click();
	await expect(page.getByText('Nothing importable found in that file.')).toBeVisible();
	await page.evaluate(() => (window as unknown as { releaseSlowRead: () => void }).releaseSlowRead());
	await expect.poll(() => page.evaluate(() => (window as unknown as { slowReadFinished?: boolean }).slowReadFinished)).toBe(true);
	await expect(page.getByText('Nothing importable found in that file.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add to book' })).toHaveCount(0);
});

test('an unsupported file leaves the picker usable', async ({ page }) => {
	await page.goto('/tunes/import/musescore');
	const input = page.getByLabel('MuseScore file');
	await expect(input).toBeEnabled();
	await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') });
	await expect(page.getByRole('alert')).toHaveText('Choose a .mscz or .mscx score.');
	await expect(page.getByRole('button', { name: 'Read score', exact: true })).toBeDisabled();
	await expect(input).toHaveValue('');
});
