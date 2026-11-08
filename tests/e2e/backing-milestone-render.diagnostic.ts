import { test } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * LOCAL milestone WAV producer, not a CI test: feeds every events JSON in
 * RENDER_DIR through the lab's "Render WAV from events JSON" control and
 * saves the resulting downloads into the sandbox's recovered artifacts. Produces the listening-pass
 * files without any manual clicking.
 */

test('render milestone JSONs to WAV files', async ({ page }, testInfo) => {
	const renderDir = process.env.RENDER_DIR;
	const outDir = testInfo.outputPath('renders');
	if (!renderDir) throw new Error('Set RENDER_DIR to a repository-relative directory of events JSON files.');
	test.setTimeout(1_800_000);

	mkdirSync(outDir!, { recursive: true });
	await seedOnboardedAnonymous(page);
	await page.goto('/diagnostics/backing-mixer');

	const input = page.locator('input[aria-label="Render WAV from events JSON"]');
	for (const file of readdirSync(renderDir!).sort()) {
		if (!file.endsWith('.json')) continue;
		const downloadPromise = page.waitForEvent('download', { timeout: 600_000 });
		await input.setInputFiles({
			name: file,
			mimeType: 'application/json',
			buffer: readFileSync(join(renderDir!, file))
		});
		const download = await downloadPromise;
		const target = join(outDir!, file.replace(/\.json$/, '.wav'));
		await download.saveAs(target);
		console.log(`RENDERED ${file} -> ${target}`);
	}
});
