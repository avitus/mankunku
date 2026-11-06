import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { installAudioMock } from './fixtures/audio';

// Exercise the actual recorder → editor → saved lick boundary. The recorder's
// C-normalized storage copy must never replace the take shown for editing.
test('preserves the recorded tenor register and written key in the editor', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
		'Headless Linux Firefox has no audio device for Tone.start()');
	test.setTimeout(60_000);
	await seedOnboardedAnonymous(page); // tenor saxophone
	await installAudioMock(page);
	await page.goto('/licks/record');
	await expect(page.getByRole('button', { name: 'Start count-in' })).toBeEnabled();
	await page.evaluate(() => {
		MediaDevices.prototype.getUserMedia = async () => {
			const context = new AudioContext();
			await context.resume();
			const destination = context.createMediaStreamDestination();
			const oscillator = context.createOscillator();
			// Concert C3 (48) is written D4 (62) for tenor. Normalizing from
			// concert A lowers it to 39, written F3 (53), below the horn's Bb3.
			oscillator.frequency.value = 440 * 2 ** ((48 - 69) / 12);
			oscillator.connect(destination);
			oscillator.start();
			return destination.stream;
		};
	});
	await page.getByLabel('Written key').selectOption({ label: 'B' });
	await page.getByRole('button', { name: 'Start count-in' }).click();
	// Wait for a sustained sample window, without needing the UI to paint a
	// particular beat during a busy sandbox frame.
	await expect(page.getByRole('heading', { name: 'Play now.', exact: true })).toBeVisible({ timeout: 15_000 });
	await page.waitForTimeout(1200);
	await page.getByRole('button', { name: 'Stop recording' }).click();
	await expect(page.getByRole('heading', { name: 'Make it your own.' })).toBeVisible();
	await page.getByLabel('Lick name').fill('Tenor register handoff');
	await page.getByLabel('First note starts on').selectOption({ label: 'Beat 1' });
	await page.getByLabel('Last note length').selectOption({ label: 'Half' });
	await page.getByRole('button', { name: 'Review in editor' }).click();
	await expect(page).toHaveURL(/\/licks\/editor$/);
	await expect(page.locator('input.le-title')).toHaveValue('Tenor register handoff');
	await expect(page.getByRole('combobox', { name: 'Key', exact: true })).toHaveValue('B');
	await page.getByRole('button', { name: 'Save lick', exact: true }).click();
	await expect.poll(() => page.evaluate(() => {
		const [lick] = JSON.parse(localStorage.getItem('mankunku:user-licks') ?? '[]');
		return lick && { key: lick.key, notes: lick.notes.filter((note: { pitch: number | null }) => note.pitch !== null) };
	})).toEqual({ key: 'A', notes: [{ pitch: 48, offset: [0, 1], duration: [1, 2] }] });
});
