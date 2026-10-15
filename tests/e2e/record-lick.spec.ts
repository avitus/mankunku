import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { installAudioMock } from './fixtures/audio';

async function openRecorder(page: Page): Promise<void> {
	await seedOnboardedAnonymous(page);
	await installAudioMock(page, { countGetUserMediaCalls: true });
	await page.goto('/licks/record', { waitUntil: 'networkidle' });
	await expect(page.getByRole('button', { name: 'Start count-in' })).toBeEnabled();
}

test.describe('record a lick: Studio Desk', () => {
	test.beforeEach(({ browserName }) => {
		test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Headless Linux Firefox has no audio device for Tone.start()');
	});

	test('shows every beat in both bars, then records and reviews a real synthetic take', async ({ page }) => {
		test.setTimeout(60_000);
		await openRecorder(page);
		await page.evaluate(() => {
			const beats = document.querySelector('.rl-beats')!;
			const observed: string[] = [];
			(window as unknown as { observedBeats: string[] }).observedBeats = observed;
			new MutationObserver(() => {
				const label = beats.getAttribute('aria-label')!;
				if (observed.at(-1) !== label) observed.push(label);
			}).observe(beats, { attributes: true, attributeFilter: ['aria-label'] });
		});
		await page.getByRole('button', { name: 'Start count-in' }).click();
		await expect(page.getByRole('heading', { name: 'Find the pulse.' })).toBeVisible();
		await expect(page.getByRole('spinbutton', { name: 'Tempo' })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Cancel count-in' })).toBeEnabled();
		await expect(page.getByRole('heading', { name: 'Get ready to play.' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Play now.' })).toBeVisible();
		const observed = await page.evaluate(() => (window as unknown as { observedBeats: string[] }).observedBeats);
		expect(observed.slice(0, 9)).toEqual([
			...[1, 2].flatMap(bar => [1, 2, 3, 4].map(beat => `Count-in, bar ${bar}, beat ${beat}`)),
			'Playing, bar 1, beat 1'
		]);
		// Let the real pitch detector collect a phrase from the synthetic oscillator.
		await expect(page.getByRole('img', { name: 'Playing, bar 1, beat 3', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Stop recording' }).click();
		await expect(page.getByRole('heading', { name: 'Make it your own.' })).toBeVisible();
		await expect(page.locator('.rl-score svg')).toBeVisible();
		await page.getByLabel('Lick name').fill('Recorded desk test');
		await page.getByRole('button', { name: 'Play back', exact: true }).click();
		await page.getByRole('button', { name: 'Review in editor' }).click();
		await expect(page).toHaveURL(/\/licks\/editor$/);
		await expect(page.locator('input.le-title')).toHaveValue('Recorded desk test');
		expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-licks') ?? '[]'))).toEqual([]);
		await page.getByRole('button', { name: 'Save lick', exact: true }).click();
		await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-licks') ?? '[]'))).toMatchObject([
			{ name: 'Recorded desk test', source: 'user-recorded', tags: ['user-recorded'] }
		]);
	});

	test('cancels count-in and restarts from the first beat on a phone without overflow', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openRecorder(page);
		await page.getByRole('spinbutton', { name: 'Tempo' }).fill('120');
		await page.getByRole('spinbutton', { name: 'Tempo' }).blur();
		await page.getByRole('button', { name: 'Start count-in' }).click();
		await expect(page.getByRole('img', { name: 'Count-in, bar 1, beat 1', exact: true })).toBeVisible();
		const cancel = page.getByRole('button', { name: 'Cancel count-in' });
		await expect(cancel).toBeInViewport();
		await expect(page.getByRole('complementary', { name: 'Recording setup' })).toBeHidden();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await cancel.click();
		await expect(page.getByRole('button', { name: 'Start count-in' })).toBeEnabled();
		await page.getByRole('button', { name: 'Start count-in' }).click();
		await expect(page.getByRole('img', { name: 'Count-in, bar 1, beat 1', exact: true })).toBeVisible();
		await cancel.click();
	});

	test('canceling a pending microphone request releases late audio and never starts counting', async ({ page }) => {
		await openRecorder(page);
		await page.evaluate(() => {
			const original = MediaDevices.prototype.getUserMedia;
			MediaDevices.prototype.getUserMedia = async function (constraints) {
				await new Promise<void>(resolve => { (window as unknown as { releaseMic: () => void }).releaseMic = resolve; });
				const stream = await original.call(this, constraints);
				(window as unknown as { lateStream: MediaStream }).lateStream = stream;
				return stream;
			};
		});
		await page.getByRole('button', { name: 'Start count-in' }).click();
		await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseMic?: () => void }).releaseMic)).toBe('function');
		await page.getByRole('button', { name: 'Cancel count-in' }).click();
		await page.evaluate(() => (window as unknown as { releaseMic: () => void }).releaseMic());
		await expect(page.getByRole('button', { name: 'Start count-in' })).toBeEnabled();
		await expect.poll(() => page.evaluate(() => (window as unknown as { lateStream: MediaStream }).lateStream.getTracks().every(t => t.readyState === 'ended'))).toBe(true);
		await expect(page.getByRole('heading', { name: 'Count in first. Then play.' })).toBeVisible();
	});

	test('saves the reviewed take directly and allows a fresh recording', async ({ page }) => {
		await openRecorder(page);
		await page.getByRole('button', { name: 'Start count-in' }).click();
		await expect(page.getByRole('img', { name: 'Playing, bar 1, beat 3', exact: true })).toBeVisible({ timeout: 15_000 });
		await page.getByRole('button', { name: 'Stop recording' }).click();
		await expect(page.getByRole('heading', { name: 'Make it your own.' })).toBeVisible();
		await page.getByLabel('Lick name').fill('Direct recorded take');
		await page.getByRole('button', { name: 'Save to Book' }).click();
		await expect(page.getByRole('button', { name: 'Saved!', exact: true })).toBeDisabled();
		await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-licks') ?? '[]'))).toMatchObject([
			{ name: 'Direct recorded take', source: 'user-recorded' }
		]);
		await page.getByRole('button', { name: 'Record again' }).click();
		await page.getByRole('button', { name: 'Start count-in' }).click();
		await expect(page.getByRole('heading', { name: 'Get ready to play.' })).toBeVisible();
		await page.getByRole('button', { name: 'Cancel count-in' }).click();
	});

	test('microphone failure is visible and leaves setup usable', async ({ page }) => {
		await openRecorder(page);
		await page.evaluate(() => {
			MediaDevices.prototype.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
		});
		await page.getByRole('button', { name: 'Start count-in' }).click();
		await expect(page.getByRole('alert')).toContainText('Microphone access is unavailable');
		await expect(page.getByRole('button', { name: 'Start count-in' })).toBeEnabled();
		await expect(page.getByRole('spinbutton', { name: 'Tempo' })).toBeEnabled();
	});
});
