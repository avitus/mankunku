import { test, expect } from './fixtures/test';
import { TOUR_DISMISSED, seedUserLicks, seedStorage, SETTINGS_ONBOARDED } from './fixtures/storage';

const phrase = {
	id: 'user-progress-keys', name: 'Key labels', key: 'F', mode: 'major', timeSignature: [4, 4],
	notes: [{ pitch: 65, offset: [0, 1], duration: [1, 1] }], harmony: [],
	difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
	category: 'major-chord', tags: [], source: 'user-entered'
};
const history = [1, 2, 3, 4].map((keys, i) => ({ t: Date.UTC(2026, 8, 1 + i), bpm: 60 + i * 5, keys }));

// The markers name the second, third and fourth keys of the lick's unlock
// ramp in WRITTEN pitch: the ramp climbs the written key signatures, so a
// concert F major lick goes C, G, D; on tenor the same lick is written G
// major and goes written C, F, D; read as minor it is written G minor
// (two flats) and goes A-, E-, D-.
for (const example of [
	// `playIn` is the "Play in" option's text once E is chosen: it labels the
	// CHART (its progression's mode), while the markers label the LICK — a
	// stated-minor line shown over the major vamp reads A-, E-, D- under a
	// chart in E (CodeRabbit on PR #280).
	{ instrumentId: 'concert', mode: 'major', names: ['C', 'G', 'D'], playIn: 'E', width: 1440, theme: 'dark' },
	{ instrumentId: 'tenor-sax', mode: 'major', names: ['C', 'F', 'D'], playIn: 'E', width: 390, theme: 'dark' },
	{ instrumentId: 'tenor-sax', mode: 'minor', names: ['A-', 'E-', 'D-'], playIn: 'E', width: 390, theme: 'light' },
	// No stated mode: the label SUFFIX borrows the chart's progression — a
	// minor-chord line's home is the minor vamp — where the lick's chords
	// (none) say nothing. The key sequence is still the session's ramp, which
	// reads an unstated mode with no chords as major: written C, F, D.
	{ instrumentId: 'tenor-sax', mode: undefined, category: 'minor-chord', names: ['C-', 'F-', 'D-'], playIn: 'E-', width: 390, theme: 'dark' },
	// A stated-MAJOR lick whose home is the minor cadence: the markers keep
	// the player's major reading, the selector names the minor chart.
	{ instrumentId: 'concert', mode: 'major', category: 'ii-V-I-minor', names: ['C', 'G', 'D'], playIn: 'E-', width: 1440, theme: 'light' }
]) {
	test(`unlock labels use the saved entry key in ${example.instrumentId} ${example.mode ?? 'unstated mode'}${example.category ? ' · ' + example.category : ''}`, async ({ page }) => {
		await seedUserLicks(page, [{ ...phrase, mode: example.mode, category: example.category ?? phrase.category }]);
		await seedStorage(page, {
			'tour-state': TOUR_DISMISSED,
			settings: { ...SETTINGS_ONBOARDED, instrumentId: example.instrumentId, theme: example.theme },
			'lick-progress-history': { [phrase.id]: history }
		});
		await page.setViewportSize({ width: example.width, height: 1000 });
		await page.goto('/licks/' + phrase.id);
		await expect(page.getByRole('region', { name: 'Practice stages' }).locator('[aria-current=step]')).toContainText('new');
		await expect(page.getByText('Unlock all 12 keys, then build tempo.', { exact: true })).toBeVisible();
		const labels = page.locator('.unlock-key-label text');
		await expect(labels).toHaveText(example.names);
		await expect(page.getByRole('img', { name: /Tempo over time/ })).toHaveAttribute('aria-label', new RegExp('Written keys unlocked: ' + example.names.join(', ')));
		await page.getByLabel('Play in').selectOption('E');
		await expect(page.getByLabel('Play in').locator('option:checked')).toHaveText(example.playIn);
		await expect(labels).toHaveText(example.names);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		const rects = await page.locator('.unlock-key-label rect').evaluateAll((els) => els.map((el) => {
			const rect = el.getBoundingClientRect(); return { left: rect.left, right: rect.right };
		}));
		for (let i = 1; i < rects.length; i++) expect(rects[i].left).toBeGreaterThan(rects[i - 1].right);
		expect(await page.evaluate((id) => JSON.parse(localStorage.getItem('mankunku:lick-progress-history') ?? '{}')[id], phrase.id)).toEqual(history);
	});
}
