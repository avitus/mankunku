import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { installAudioMock } from './fixtures/audio';

/** Seed an onboarded anonymous visitor, install the mic mock and open the recorder once "Start count-in" is enabled. */
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

	for (const figure of [
		{ name: 'song suggestion', played: [0, 0.5, 1, 1.5, 2, 2.5], written: [0, 3, 6, 9, 12, 15] },
		{ name: 'swung eighths', played: [0, 0.65, 1, 1.65, 2], written: [0, 3, 6, 9, 12] },
		{ name: 'even triplets', played: [0, 1/3, 2/3, 1, 2], written: [0, 2, 4, 6, 12] }
	]) {
		test(`records and saves ${figure.name} against the live count-in`, async ({ page }, info) => {
			test.setTimeout(60_000);
			await openRecorder(page);
			await page.route('**/api/lick-match', route => route.fulfill({ json: { matches: figure.name === 'song suggestion' ? [{
				kind: 'wjazzd', sourceId: 'test', label: 'Art Pepper — Stardust, bar -1', suggestedName: 'Art Pepper - Stardust',
				attribution: 'Weimar Jazz Database: Art Pepper — Stardust', license: 'CC-BY-NC-SA', confidence: 'quote', score: 1
			}] : [] } }));
			await page.getByRole('spinbutton', { name: 'Tempo' }).fill('80');
			await page.getByRole('spinbutton', { name: 'Tempo' }).blur();
			// Schedule pitched attacks on an actual Web Audio clock when the
			// recorder opens its window. Only the microphone is synthetic.
			await page.evaluate(played => {
				MediaDevices.prototype.getUserMedia = async () => {
					const ctx = new AudioContext();
					await ctx.resume();
					const mic = ctx.createMediaStreamDestination();
					const observer = new MutationObserver(() => {
						if (!document.querySelector('.rl-console h2')?.textContent?.includes('Play now.')) return;
						observer.disconnect();
						const start = ctx.currentTime + 0.10;
						const pitches = [60, 64, 67, 65, 62, 63];
						for (const [i, beat] of played.entries()) {
							const on = start + beat * 0.75;
							const off = start + (played[i + 1] ?? 4) * 0.75 - 0.025;
							const osc = ctx.createOscillator();
							osc.frequency.value = 440 * 2 ** ((pitches[i] - 69) / 12);
							const gain = ctx.createGain();
							gain.gain.setValueAtTime(0, on);
							gain.gain.linearRampToValueAtTime(0.35, on + 0.01);
							gain.gain.setValueAtTime(0.35, off - 0.01);
							gain.gain.linearRampToValueAtTime(0, off);
							osc.connect(gain).connect(mic);
							osc.start(on);
							osc.stop(off);
						}
					});
					observer.observe(document.body, { subtree: true, characterData: true, childList: true });
					return mic.stream;
				};
			}, figure.played);
			await page.getByRole('button', { name: 'Start count-in' }).click();
			await expect(page.getByRole('heading', { name: 'Make it your own.' })).toBeVisible({ timeout: 25_000 });
			// Keep the exact browser input available if a headless audio driver
			// jumps or drops a block during the synthetic performance.
			const recorded = await page.locator('audio').evaluateHandle(async player =>
				(await fetch((player as HTMLAudioElement).currentSrc)).blob());
			await expect(page.getByLabel('Lick name')).toHaveValue('');
			await expect(page.locator('#lick-name-help')).toContainText('Artist - Song Name');
			await page.getByRole('button', { name: 'Save to Book' }).click();
			await expect(page.getByLabel('Lick name')).toBeFocused();
			if (figure.name === 'song suggestion') {
				await page.getByRole('button', { name: /Art Pepper - Stardust/ }).click();
				await expect(page.getByLabel('Lick name')).toHaveValue('Art Pepper - Stardust');
				await page.setViewportSize({ width: 390, height: 1000 });
				await info.attach('Recorder naming on mobile', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
			} else {
				await expect(page.getByText('No song match found. Enter your own name.', { exact: true })).toBeVisible();
				await page.getByLabel('Lick name').fill(figure.name);
			}
			await page.getByRole('button', { name: 'Save to Book' }).click();
			await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-licks') ?? '[]')[0]?.name))
				.toBe(figure.name === 'song suggestion' ? 'Art Pepper - Stardust' : figure.name);
			const savedTicks = () => page.evaluate(() => {
				const [lick] = JSON.parse(localStorage.getItem('mankunku:user-licks') ?? '[]');
				return lick?.notes.filter((n: { pitch: number | null }) => n.pitch !== null)
					.map((n: { offset: number[]; duration: number[] }) =>
						[24 * n.offset[0] / n.offset[1], 24 * n.duration[0] / n.duration[1]]);
			});
			try {
				if (figure.name === 'song suggestion') {
					// This case covers naming and saving a matchable recording. The
					// rhythm cases below retain their exact transcription assertions.
					await expect.poll(async () => (await savedTicks())?.length ?? 0).toBeGreaterThanOrEqual(6);
				} else {
					await expect.poll(savedTicks).toEqual(figure.written.map((t, i) => [t, (figure.written[i + 1] ?? 24) - t]));
				}
			} catch (error) {
				const bytes = await recorded.evaluate(async blob => Array.from(new Uint8Array(await blob.arrayBuffer())));
				await info.attach('recorded microphone input', { body: Buffer.from(bytes), contentType: 'audio/wav' });
				throw error;
			} finally {
				await recorded.dispose();
			}
		});
	}

	test('shows every beat in both bars, then records and reviews a real synthetic take', async ({ page }) => {
		test.setTimeout(60_000);
		await openRecorder(page);
		// A full second per beat gives the real audio clock and rendered cues
		// room under the sandbox's two-CPU ceiling; do not fake either clock.
		await page.getByRole('spinbutton', { name: 'Tempo' }).fill('60');
		await page.getByRole('spinbutton', { name: 'Tempo' }).blur();
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
		// Hold the oscillator's unchanged pitch beyond the two-second silence
		// timeout. A reactive MIDI-value effect used to stop this valid take.
		await expect(page.getByRole('img', { name: 'Playing, bar 2, beat 1', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Stop recording' }).click();
		await expect(page.getByRole('heading', { name: 'Make it your own.' })).toBeVisible();
		await expect(page.locator('.rl-score svg')).toBeVisible();
		await expect(page.locator('audio[aria-labelledby="original-recording-label"]')).toHaveAttribute('src', /^blob:/);
		await page.getByLabel('Written key').selectOption('F');
		await page.getByLabel('Last note length').selectOption({ label: 'Half' });
		await page.getByLabel('First note starts on').selectOption({ label: 'And of 1' });
		await expect(page.getByLabel('Last note length')).toHaveValue('Half');
		await page.getByLabel('Lick name').fill('Recorded desk test');
		await page.getByRole('button', { name: 'Play back', exact: true }).click();
		await page.getByRole('button', { name: 'Review in editor' }).click();
		await expect(page).toHaveURL(/\/licks\/editor$/);
		await expect(page.locator('input.le-title')).toHaveValue('Recorded desk test');
		expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-licks') ?? '[]'))).toEqual([]);
		await page.getByRole('button', { name: 'Save lick', exact: true }).click();
		await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-licks') ?? '[]'))).toMatchObject([
			{ name: 'Recorded desk test', source: 'user-recorded', tags: ['user-recorded'], notes: expect.arrayContaining([expect.objectContaining({ pitch: null, offset: [0, 1], duration: [1, 8] }), expect.objectContaining({ pitch: expect.any(Number), duration: [1, 2] })]) }
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
