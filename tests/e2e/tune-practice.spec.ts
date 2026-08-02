import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import { installAudioMock } from './fixtures/audio';

const autumnLeavesFixture = JSON.parse(
	readFileSync(
		resolve(
			dirname(fileURLToPath(import.meta.url)),
			'../fixtures/leadsheets/pdf-vs-musescore/autumn-leaves.musescore-import.json'
		),
		'utf8'
	)
) as Record<string, unknown>;

/**
 * /tunes/[id]/practice — setup screen (no audio) + a session smoke that
 * pins the follow-scroll regression where the chart vanished at the first
 * insertion / head→changes sheet swap.
 */

/**
 * Assert the *following* teleprompter viewport still shows part of the chart
 * SVG. Setup charts also render a `chart-scroll-viewport` node — only the
 * session instance has the `.following` class (fixed 60vh clip + translateY).
 */
async function expectChartVisibleInFollowViewport(page: Page): Promise<void> {
	const result = await page.evaluate(() => {
		const vp = document.querySelector(
			'[data-testid="chart-scroll-viewport"].following'
		) as HTMLElement | null;
		const svg = vp?.querySelector('svg');
		if (!vp || !svg) return { ok: false as const, reason: 'missing-following-viewport' };
		const vr = vp.getBoundingClientRect();
		const sr = svg.getBoundingClientRect();
		if (vr.height < 8 || vr.width < 8) {
			return {
				ok: false as const,
				reason: 'viewport-collapsed',
				vr: { h: vr.height, w: vr.width }
			};
		}
		if (sr.height < 8 || sr.width < 8) {
			return {
				ok: false as const,
				reason: 'svg-empty',
				sr: { h: sr.height, w: sr.width }
			};
		}
		const overlaps =
			sr.bottom > vr.top + 4 &&
			sr.top < vr.bottom - 4 &&
			sr.right > vr.left + 4 &&
			sr.left < vr.right - 4;
		return {
			ok: overlaps,
			reason: overlaps ? 'ok' : 'no-overlap',
			offset: vp.getAttribute('data-follow-offset'),
			vr: { top: vr.top, bottom: vr.bottom, h: vr.height },
			sr: { top: sr.top, bottom: sr.bottom, h: sr.height }
		};
	});
	expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
}

/** Max the tempo slider and confirm the label updates (Svelte range bind). */
async function setTempoMax(page: Page): Promise<void> {
	const slider = page.locator('input[type="range"]');
	await slider.evaluate((el: HTMLInputElement) => {
		el.value = el.max;
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	});
	await expect(page.getByText(/240\s*BPM/i)).toBeVisible();
}

/** Start a session and wait until the running chrome is up (not the setup chart). */
async function startPracticeSession(page: Page): Promise<void> {
	await page.getByRole('button', { name: /^start$/i }).click();
	// "End" only exists once the session leaves setup — stronger than the bare
	// chart viewport testid, which the setup preview also mounts.
	await expect(page.getByRole('button', { name: /^end$/i })).toBeVisible({ timeout: 20_000 });
	await expect(page.locator('[data-testid="chart-scroll-viewport"].following')).toBeVisible();
	await expectChartVisibleInFollowViewport(page);
}

test.describe('tune practice setup', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('detail page links into practice setup with detected insertion points', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/tunes/ls-when-the-saints');
		await page.getByRole('button', { name: /practice licks/i }).click();
		await expect(page).toHaveURL(/\/tunes\/ls-when-the-saints\/practice$/);

		await expect(page.getByRole('heading', { name: /practice licks/i })).toBeVisible();
		// When the Saints: 3 major-vamps + 1 dominant-vamp + 1 blues bar.
		await expect(page.getByText(/5 insertion points/i)).toBeVisible();
		await expect(page.getByRole('button', { name: /^start$/i })).toBeVisible();

		// The detector's bar ranges render as marker bands inside the chart SVG,
		// each labeled with its progression name.
		await expect(page.locator('svg rect.range-marker').first()).toBeVisible();
		expect(await page.locator('svg rect.range-marker').count()).toBeGreaterThanOrEqual(5);
		await expect(page.locator('svg text.range-marker-label').first()).toBeVisible();
		const labels = await page.locator('svg text.range-marker-label').allTextContents();
		expect(labels.join(' ')).toMatch(/Major|Dominant|Blues/);
	});

	test('mankunku blues previews its ii-V, turnarounds, and blues bars', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/tunes/ls-mankunku-blues/practice');
		// With the default head-first setting, only the SOLO pass of the
		// whole-form repeat is practiceable (the jazz form rule): 3 blues bars +
		// 1 short ii-V-I + 1 turnaround. Scope to the summary paragraph — the same
		// progression names also render as on-chart marker labels (short ones like
		// "Turnaround" un-truncated), so a bare getByText would match twice.
		const summary = page.locator('p', { hasText: /insertion point/i });
		await expect(summary).toContainText('5 insertion points');
		await expect(summary).toContainText('Short ii-V-I (Maj)');
		await expect(summary).toContainText('Turnaround');
		await expect(summary).toContainText('Blues');
	});

	test('mode selector and the head toggle', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/tunes/ls-when-the-saints/practice');
		// The play-the-head option applies to every mode.
		await expect(page.getByText(/play the head first/i)).toBeVisible();
		await page.getByRole('button', { name: /freestyle/i }).click();
		await expect(page.getByText(/play the head first/i)).toBeVisible();
		// The mode button's accessible name includes its description line.
		await page.getByRole('button', { name: /pick your lick and earn points/i }).click();
		await expect(page.getByText(/play the head first/i)).toBeVisible();
		// Strictness pills present.
		await expect(page.getByRole('button', { name: /^solo$/i })).toBeVisible();
	});
});

/**
 * Live session: the chart must remain visible through the head→changes swap
 * and the first insertion window. Regression for the Firefox report where
 * Autumn Leaves' score vanished as soon as the first lick point arrived
 * (stale translateY after re-render + unstable follow viewport height).
 *
 * Serial: both tests own Tone/AudioContext; parallel starts flake.
 */
test.describe.serial('tune practice session follow-scroll', () => {
	test('chart stays visible through first insertion (Mankunku Blues, head on)', async ({
		page,
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		// Same Tone.start() hang as ear-training on headless Linux Firefox CI.
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);

		test.setTimeout(90_000);

		await seedOnboardedAnonymous(page);
		await installAudioMock(page);

		await page.goto('/tunes/ls-mankunku-blues/practice');
		await expect(page.getByRole('button', { name: /^start$/i })).toBeVisible();

		// Keep head-first ON (default) — the chart swap is the regression trigger.
		await setTempoMax(page);
		await startPracticeSession(page);

		// Wait until practice chorus / first window: either "Your turn" (window
		// open) or "Comping — insertion" (running, window not yet open). Both
		// sit after the head→changes re-render that used to blank the chart.
		await expect(
			page.getByText(/your turn — play the lick!|comping — insertion/i)
		).toBeVisible({ timeout: 75_000 });

		// Poll a few frames: a one-frame flash is acceptable; sustained hide is not.
		for (let i = 0; i < 5; i++) {
			await expectChartVisibleInFollowViewport(page);
			await page.waitForTimeout(200);
		}

		await page.getByRole('button', { name: /^end$/i }).click();
		await expect(page.getByRole('heading', { name: /take complete/i })).toBeVisible({
			timeout: 10_000
		});
	});

	test('chart stays visible through first insertion (Autumn Leaves)', async ({
		page,
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);

		test.setTimeout(90_000);

		const autumnLeaves = {
			...autumnLeavesFixture,
			id: 'e2e-autumn-leaves',
			source: 'user' as const
		};

		await seedOnboardedAnonymous(page);
		await seedTunes(page, [autumnLeaves]);
		await installAudioMock(page);

		await page.goto('/tunes/e2e-autumn-leaves/practice');
		await expect(page.getByRole('button', { name: /^start$/i })).toBeVisible();

		await setTempoMax(page);
		await startPracticeSession(page);

		await expect(
			page.getByText(/your turn — play the lick!|comping — insertion/i)
		).toBeVisible({ timeout: 75_000 });

		for (let i = 0; i < 5; i++) {
			await expectChartVisibleInFollowViewport(page);
			await page.waitForTimeout(200);
		}

		await page.getByRole('button', { name: /^end$/i }).click();
		await expect(page.getByRole('heading', { name: /take complete/i })).toBeVisible({
			timeout: 10_000
		});
	});
});
