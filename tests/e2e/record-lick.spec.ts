import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { installAudioMock } from './fixtures/audio';

/**
 * The record-a-lick start signal: Count in → Play in 4…1 → on-air Play.
 *
 * Pins the cue sequence and the state machine around it, not pitch content —
 * the transcription pipeline is covered by the Vitest replay suites, and
 * pitch assertions on a synthetic media stream are flaky by construction.
 * The mock's stream is a bare oscillator on every engine (fixtures/audio.ts
 * never calls the native getUserMedia): whether the detector reads it
 * confidently (review) or not (idle) is not this spec's business, so the
 * ending accepts either exit from the take. The silence auto-stop is
 * untestable here for the same reason — the tone never stops.
 *
 * Skipped only on headless Linux Firefox in CI, where Tone.start() hangs
 * without an audio device (see ear-training.spec.ts); the cue is
 * browser-agnostic DOM and the mock is engine-agnostic, so Chromium and
 * WebKit both run it.
 */
test.describe('record a lick: start signal', () => {
	test('counts in with a countdown, flips on air, and stop exits the take', async ({
		page,
		browserName
	}: {
		page: Page;
		browserName: string;
	}): Promise<void> => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		test.setTimeout(60_000);

		await seedOnboardedAnonymous(page);
		await installAudioMock(page);

		await page.goto('/licks/record', { waitUntil: 'networkidle' });
		await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();

		await page.getByRole('button', { name: 'Start recording' }).click();

		// Count-in bar 1: the cue bar announces the phase, the stop button is
		// present but not yet armed.
		const cueLabel = page.locator('.cue [role="status"]');
		await expect(cueLabel).toHaveText('Count in', { timeout: 15_000 });
		const stopButton = page.getByRole('button', { name: 'Stop recording' });
		await expect(stopButton).toBeDisabled();

		// Count-in bar 2: the 4…1 countdown numeral renders beside the label.
		// At the default 100 BPM the lead bar starts 2.4 s in.
		await expect(page.locator('.cue .lead-count')).toBeVisible({ timeout: 10_000 });

		// The entrance: cue flips to Play on the audible downbeat, the stop
		// button goes live.
		await expect(cueLabel).toHaveText('Play', { timeout: 10_000 });
		await expect(stopButton).toBeEnabled();
		await expect(page.getByText('On tape…')).toBeVisible();

		// Stop the take. Depending on what the fake device fed the detector
		// this lands on the review screen (readings survived) or back on idle
		// (empty take) — both are valid exits; being stuck recording is not.
		await stopButton.click();
		const reviewHeading = page.getByRole('heading', { name: 'Review Your Lick' });
		const idleButton = page.getByRole('button', { name: 'Start recording' });
		await expect(reviewHeading.or(idleButton)).toBeVisible({ timeout: 15_000 });
	});
});
