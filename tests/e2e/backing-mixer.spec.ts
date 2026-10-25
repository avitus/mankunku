import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { readFile } from 'node:fs/promises';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

/**
 * /diagnostics/backing-mixer — the backing listening lab.
 *
 * The mixer contract: slider moves reach the engine's persisted mix
 * (localStorage `backing-mix-levels-v2`) and survive a reload, because that
 * is what makes a tuned mix apply to every later practice session. The lab
 * contract: preset/seed/checklist controls render and the checklist report
 * reflects verdicts. Audio output itself is not asserted here (bouncing
 * needs CDN instrument fetches).
 */

test('mixer sliders persist to the engine mix and survive reload', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/diagnostics/backing-mixer');
	await expect(page.getByRole('heading', { name: 'Backing lab' })).toBeVisible();

	// The gain sliders (incl. the room return) and core voice sliders render.
	for (const key of ['bass', 'comp', 'drums', 'room', 'kick', 'ride', 'hihat']) {
		await expect(page.getByTestId(`mix-${key}`)).toBeVisible();
	}

	// Move bass down. Polling the fill→storage round-trip also absorbs the
	// hydration race: a fill dispatched before Svelte attaches oninput does
	// nothing, and the next retry lands once the page is interactive.
	await expect
		.poll(async () => {
			await page.getByTestId('mix-bass').fill('0.6');
			return page.evaluate(
				() => JSON.parse(localStorage.getItem('backing-mix-levels-v2') ?? '{}').bass
			);
		})
		.toBeCloseTo(0.6);

	// Hydration is proven now; a plain fill suffices for the kick.
	await page.getByTestId('mix-kick').fill('2');
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('backing-mix-levels-v2') ?? '{}')
	);
	expect(stored.kick).toBeCloseTo(2);

	// Reload: the tuned values come back on the sliders.
	await page.reload();
	await expect(page.getByTestId('mix-bass')).toHaveValue('0.6');
	await expect(page.getByTestId('mix-kick')).toHaveValue('2');

	// Reset returns the sliders and the stored mix to defaults.
	await page.getByRole('button', { name: 'Reset to defaults' }).click();
	await expect(page.getByTestId('mix-bass')).toHaveValue('1');
	const reset = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('backing-mix-levels-v2') ?? '{}')
	);
	expect(reset.kick).toBe(1);
});

test('listening-lab controls render and the checklist records verdicts', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/diagnostics/backing-mixer');

	// Preset picker exposes the protocol progressions.
	const presetSelect = page.getByTestId('lab-preset');
	await expect(presetSelect).toBeVisible();
	await presetSelect.selectOption('lab-aaba-c');
	await expect(presetSelect).toHaveValue('lab-aaba-c');

	// Seed input and tempo preset chips.
	await expect(page.getByTestId('lab-seed')).toBeVisible();
	await page.getByRole('button', { name: '160', exact: true }).click();
	await expect(page.getByText('Tempo: 160 BPM')).toBeVisible();

	// Bounce button present (rendering itself needs CDN samples — not run here).
	await expect(page.getByTestId('lab-bounce')).toBeVisible();

	// Blind A/B requires a bounce + reference before it can start.
	await expect(page.getByRole('button', { name: 'Start blind comparison' })).toBeDisabled();

	// Checklist: cycle one item to pass; the copied report contains it.
	const checklist = page.getByTestId('listening-checklist');
	await expect(checklist).toBeVisible();
	const firstItem = checklist.getByRole('button', { name: /At 90 BPM the swing lopes/ });
	await firstItem.click(); // ⬜ → ✅
	await expect(firstItem).toContainText('✅');

	// A second click cycles pass → fail.
	await firstItem.click();
	await expect(firstItem).toContainText('❌');

	// Report copy button renders (clipboard write itself is not asserted —
	// permission behavior differs per engine).
	await expect(page.getByRole('button', { name: 'Copy listening report' })).toBeVisible();
});

test('scripted scenarios export the actual coordinated plan and retain an original comparison', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/diagnostics/backing-mixer');
	await page.getByTestId('lab-preset').selectOption('lab-aaba-c');
	await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('swing');
	await page.getByTestId('lab-orchestration').selectOption('coordinated');
	await page.getByTestId('lab-solo-scenario').selectOption('dense');
	await expect(page.getByTestId('lab-ensemble-scope')).toContainText('No solo audio or microphone listening');
	const exportEvents = async () => {
		const pending = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export events JSON' }).click();
		const download = await pending;
		return JSON.parse(await readFile((await download.path())!, 'utf8')) as GeneratedBacking & {
			orchestration: string; soloScenario: string; buildVersion: string;
		};
	};
	const dense = await exportEvents();
	expect(dense.orchestration).toBe('coordinated');
	expect(dense.soloScenario).toBe('dense');
	expect(dense.buildVersion).toBeTruthy();
	expect(dense.ensemblePlan?.bars).toHaveLength(96);
	expect(dense.ensembleMemory?.nextBar).toBe(96);
	expect(dense.ensembleMemory?.version).toBe(1);
	expect(dense.ensembleTiming?.[0].phraseStartBar).toBe(0);
	expect(dense.ensembleTiming?.at(-1)?.endBarExclusive).toBe(96);
	expect(dense.ensembleDevelopment?.pianoMotifs).toHaveLength(96);
	expect(dense.ensembleDevelopment?.bassTurnarounds.length).toBeGreaterThan(0);
	expect(dense.ensembleDevelopment?.drumPhrases).toHaveLength(96);
	for (const bar of dense.ensembleDevelopment!.drumPhrases) {
		expect(bar.commentary.hits).toHaveLength(0);
		expect(bar.hits.map((hit) => [hit.drum, bar.barIndex * 4 + hit.beatOffset, hit.velocity, hit.role])
		.sort()).toEqual(dense.drumEvents.filter((event) => Math.floor(event.absBeat / 4) === bar.barIndex)
		.map((event) => [event.drum, event.absBeat, event.velocity, event.role]).sort());
	}
	expect(dense.ensemblePlan?.trace.every((bar) => bar.soloEvidence === 'active')).toBe(true);
	expect(dense.drumEvents.filter((event) => event.role === 'commentary')).toHaveLength(0);
	await page.getByTestId('lab-orchestration').selectOption('original');
	await expect(page.getByTestId('lab-solo-scenario')).toBeDisabled();
	const original = await exportEvents();
	expect(original.ensemblePlan).toBeUndefined();
	expect(original.ensembleMemory).toBeUndefined();
	expect(original.ensembleTiming).toBeUndefined();
	expect(original.ensembleDevelopment).toBeUndefined();
	expect(original.compEvents.length).toBeGreaterThan(dense.compEvents.length);
	await expect(page.getByRole('link', { name: 'Musicality specification & progress' })).toHaveAttribute('href', '/musicality');
});

for (const style of ['bossa-nova', 'ballad', 'straight']) {
	test(`${style} exports coordinated native decisions and enables adaptation`, async ({ page }) => {
		await seedOnboardedAnonymous(page);
		await page.goto('/diagnostics/backing-mixer');
		await page.getByTestId('lab-preset').selectOption('lab-aaba-c');
		await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption(style);
		await page.getByTestId('lab-orchestration').selectOption('coordinated');
		await page.getByTestId('lab-solo-scenario').selectOption('dense');
		await expect(page.getByRole('button', { name: 'Adapt across loops', exact: true })).toBeEnabled();
		const pending = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export events JSON' }).click();
		const result = JSON.parse(await readFile((await (await pending).path())!, 'utf8')) as GeneratedBacking;
		expect(result.ensemblePlan?.bars).toHaveLength(96);
		expect(result.ensembleDevelopment?.pianoMotifs).toHaveLength(96);
		expect(result.ensembleDevelopment?.drumPhrases).toHaveLength(96);
		expect(result.ensemblePlan!.trace.every((bar) => bar.soloEvidence === 'active')).toBe(true);
		expect(result.drumEvents.filter((event) => event.role === 'commentary')).toHaveLength(0);
		if (style === 'ballad') expect(Math.max(...result.ensemblePlan!.bars.map((bar) => bar.energy))).toBeLessThanOrEqual(0.6);
		if (style === 'bossa-nova') expect(result.drumEvents.filter((event) => event.drum === 'hihat')).toHaveLength(96 * 8);
	});
}
