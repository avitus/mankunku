import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

/**
 * The UI never shows concert pitch: every key label is transposed for the
 * configured instrument (`concertKeyToWritten`). A tenor reads a major ninth
 * up (concert C → D), an alto a major sixth up (concert C → A), and the
 * concert-pitch instrument reads the key as it is.
 *
 * The daily tonality is pinned to concert C major pentatonic through the
 * settings override — both halves are unlocked from day one, so the override
 * is honoured — which makes the expected written keys exact rather than
 * derived from today's date.
 */

const KEY_OVERRIDE = { key: 'C', scaleType: 'major-pentatonic' };

test.describe('written pitch follows the instrument setting', () => {
	test.beforeEach(async ({ page }) => {
		await seedStorage(page, {
			settings: { ...SETTINGS_ONBOARDED, instrumentId: 'tenor-sax', tonalityOverride: KEY_OVERRIDE },
			'tour-state': TOUR_DISMISSED
		});
		// /ear-training loads the instrument on mount; keep the samples local.
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
	});

	test("today's key on /ear-training and /settings re-spells when the instrument changes", async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		// The key block: caption, the written key, then the scale name.
		const todaysKey = () => page.getByText("Today's key", { exact: true }).locator('..');

		// Tenor: concert C reads D.
		await page.goto('/ear-training');
		await expect(todaysKey()).toContainText(/Today's key\s*D\s*Major Pentatonic/);

		// Switch to alto on the settings page; its own tonality line agrees.
		await page.goto('/settings');
		const instrumentGroup = page.getByRole('radiogroup', { name: 'Instrument', exact: true });
		await instrumentGroup.getByRole('radio', { name: /alto/i }).first().click();
		await expect(page.getByText('A Major Pentatonic', { exact: true })).toBeVisible();
		await expect(page.getByText('Custom override')).toBeVisible();

		// Alto: concert C reads A.
		await page.goto('/ear-training');
		await expect(todaysKey()).toContainText(/Today's key\s*A\s*Major Pentatonic/);

		// Concert pitch: the key is shown as stored.
		await page.goto('/settings');
		await page
			.getByRole('radiogroup', { name: 'Instrument', exact: true })
			.getByRole('radio', { name: /concert pitch/i })
			.first()
			.click();
		await expect(page.getByText('C Major Pentatonic', { exact: true })).toBeVisible();
		await page.goto('/ear-training');
		await expect(todaysKey()).toContainText(/Today's key\s*C\s*Major Pentatonic/);
	});

	test('key-unlock hints on /progress and /settings name written keys', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		// No progress is seeded, so only concert C is unlocked. /progress names
		// the next key — concert G, gated on concert C ≥ 10 — and on the
		// Settings key pad the locked concert D (gated on concert G ≥ 10)
		// carries its gate as a tooltip. Concert D because, on each horn, a
		// pad label OR a tooltip left at concert yields a different string
		// (the neighbouring concert key needs another key, or level 15).
		const unlockCard = () => page.locator('[data-tour="unlocks"]');
		const keyPad = () => page.getByRole('radiogroup', { name: 'Key center', exact: true });
		const instrumentGroup = () => page.getByRole('radiogroup', { name: 'Instrument', exact: true });

		// Tenor: concert G reads A, C reads D; concert D reads E, gated on A.
		await page.goto('/progress');
		await expect(unlockCard()).toContainText(/Next: A — D ≥ 10 \(now \d+\)/);
		await page.goto('/settings');
		await expect(keyPad().getByRole('radio', { name: 'E', exact: true })).toHaveAttribute(
			'title',
			'Requires A proficiency level 10'
		);

		// Alto: concert G reads E, C reads A; concert D reads B, gated on E.
		await instrumentGroup().getByRole('radio', { name: /alto/i }).first().click();
		await expect(keyPad().getByRole('radio', { name: 'B', exact: true })).toHaveAttribute(
			'title',
			'Requires E proficiency level 10'
		);
		await page.goto('/progress');
		await expect(unlockCard()).toContainText(/Next: E — A ≥ 10 \(now \d+\)/);

		// Concert pitch: keys read as stored.
		await page.goto('/settings');
		await instrumentGroup().getByRole('radio', { name: /concert pitch/i }).first().click();
		await expect(keyPad().getByRole('radio', { name: 'D', exact: true })).toHaveAttribute(
			'title',
			'Requires G proficiency level 10'
		);
		await page.goto('/progress');
		await expect(unlockCard()).toContainText(/Next: G — C ≥ 10 \(now \d+\)/);
	});
});
