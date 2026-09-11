import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

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

/**
 * Max the tempo knob (End key → max) and confirm the value moved.
 *
 * The keypress is retried until `aria-valuenow` reaches the max. Callers
 * reach here as soon as the Start button is VISIBLE, but visible is not
 * hydrated: the setup screen is server-rendered, so a key event can land
 * before Svelte has attached the Knob's keydown handler — nothing runs and
 * `config.tempo` stays at its default. The old range-input version of this
 * helper hit that race ~70% of the time locally on `chart stays visible
 * through first insertion`. The readout is not asserted by text: the Knob
 * draws "240" and "BPM" as two SVG text nodes inside an aria-hidden svg.
 */
async function setTempoMax(page: Page): Promise<void> {
	const knob = page.getByRole('slider', { name: /^tempo$/i });
	await expect(async () => {
		await knob.press('End');
		await expect(knob).toHaveAttribute('aria-valuenow', '240', { timeout: 1_000 });
	}).toPass({ timeout: 15_000 });
}

/** Start a session and wait until the running chrome is up (not the setup chart). */
async function startPracticeSession(page: Page): Promise<void> {
	await page.getByRole('button', { name: /^start$/i }).click();
	// "End" only exists once the session leaves setup — stronger than the bare
	// chart viewport testid, which the setup preview also mounts. Session start
	// runs Tone.start() + sample decode + transport spin-up in real time; on a
	// box saturated by the full parallel suite that reliably starved a 20s
	// budget (solo runs finish in ~5s), so the budget covers the loaded case.
	await expect(page.getByRole('button', { name: /^end$/i })).toBeVisible({ timeout: 45_000 });
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
		const head = page.getByRole('switch', { name: /play the head first/i });
		const modes = page.getByRole('radiogroup', { name: 'Mode', exact: true });
		// The play-the-head option applies to every mode.
		await expect(head).toBeVisible();
		await expect(head).toBeEnabled();
		await modes.getByRole('radio', { name: /^freestyle/i }).click();
		await expect(head).toBeVisible();
		// A pad option's accessible name is its label plus its sublabel line.
		await modes.getByRole('radio', { name: /^points\b.*streaks double/i }).click();
		await expect(head).toBeVisible();
		// Strictness pad present.
		await expect(
			page
				.getByRole('radiogroup', { name: 'Strictness', exact: true })
				.getByRole('radio', { name: /^solo\b/i })
		).toBeVisible();
	});

	test('head switch is disabled on a chords-only chart', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		// A user sheet with harmony but no pitched notes: the head cannot play,
		// so the switch reads OFF and unavailable (config.playHead still defaults
		// true — the plan resolves playHead && hasMelody) and the Start caption
		// says why.
		const chordsOnlyTune = {
			id: 'e2e-chords-only',
			title: 'Chords Only',
			composer: 'E2E',
			key: 'C',
			timeSignature: [4, 4],
			style: 'Medium Swing',
			tags: ['e2e'],
			sections: [
				{
					label: 'A',
					bars: 2,
					notes: [
						{ pitch: null, duration: [1, 1], offset: [0, 1] },
						{ pitch: null, duration: [1, 1], offset: [1, 1] }
					],
					harmony: [
						{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 2], symbol: 'Dm7' },
						{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 2], duration: [1, 2], symbol: 'G7' },
						{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [1, 1], duration: [1, 1], symbol: 'Cmaj7' }
					]
				}
			],
			source: 'user'
		};
		await seedTunes(page, [chordsOnlyTune]);
		await page.goto('/tunes/e2e-chords-only/practice');
		const head = page.getByRole('switch', { name: /play the head first/i });
		await expect(head).toBeVisible();
		await expect(head).toBeDisabled();
		await expect(head).toHaveAttribute('aria-checked', 'false');
		// Scoped to a <p>: the switch's tooltip carries similar copy off-screen.
		await expect(page.locator('p', { hasText: /no melody/i })).toBeVisible();
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

		// Outer clock > sum of inner budgets (45s start + 75s window + 10s end).
		test.setTimeout(150_000);

		await seedOnboardedAnonymous(page);
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);

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

		// Outer clock > sum of inner budgets (45s start + 75s window + 10s end).
		test.setTimeout(150_000);

		const autumnLeaves = {
			...autumnLeavesFixture,
			id: 'e2e-autumn-leaves',
			source: 'user' as const
		};

		await seedOnboardedAnonymous(page);
		await seedTunes(page, [autumnLeaves]);
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);

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
