import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, seedUserLicks } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

/**
 * /licks/[id] — a seeded user lick's detail page: the engraved chart, the
 * "Practice over" progression pills gated by `progressionFitsLick`, the
 * per-lick progress reset, and the Practice hand-off into a Deep Practice
 * session.
 *
 * The lick is a one-bar MAJOR-CHORD line over Cmaj7. For a chord-quality
 * category the fit rule is the chord family in the template's slot: the
 * major vamp and the I bar of the short ii-V-I fit; the minor and dominant
 * vamps are "Wrong chord for this lick's role" and their pills are greyed
 * with that reason (a greyed pill can never be tagged).
 */

const LICK_ID = 'e2e-user-lick-major-chord';

const MAJOR_CHORD_LICK = {
	id: LICK_ID,
	name: 'Test Major Chord Line',
	timeSignature: [4, 4],
	key: 'C',
	notes: [
		{ pitch: 60, duration: [1, 8], offset: [0, 1] },
		{ pitch: 64, duration: [1, 8], offset: [1, 8] },
		{ pitch: 67, duration: [1, 8], offset: [1, 4] },
		{ pitch: 71, duration: [1, 8], offset: [3, 8] }
	],
	harmony: [
		{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }
	],
	difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
	category: 'major-chord',
	tags: [],
	source: 'user-entered'
};

const WRONG_CHORD = "Wrong chord for this lick's role";

test.describe('lick detail page', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page, [MAJOR_CHORD_LICK]);
	});

	test('renders the lick with an engraved chart and fit-gated progression pills', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto(`/licks/${LICK_ID}`);
		await expect(page.getByRole('heading', { name: 'Test Major Chord Line' })).toBeVisible();
		await expect(page.getByText('Major Chord', { exact: true })).toBeVisible();
		await expect(page.getByText('1 bar', { exact: true })).toBeVisible();

		// abcjs engraves the phrase (noteheads in the SVG), in written pitch.
		await expect(page.locator('.abcjs-container svg .abcjs-notehead').first()).toBeVisible();
		await expect
			.poll(() => page.locator('.abcjs-container svg .abcjs-notehead').count())
			.toBeGreaterThanOrEqual(4);

		// Progressions the lick fits are live pills; the ones it can't play
		// over are disabled and explain why.
		const pill = (name: string) => page.getByRole('button', { name, exact: true });
		await expect(pill('Major')).toBeEnabled();
		await expect(pill('Short ii-V-I (Maj)')).toBeEnabled();
		await expect(pill('Minor')).toBeDisabled();
		await expect(pill('Minor')).toHaveAttribute('title', WRONG_CHORD);
		await expect(pill('Dominant')).toBeDisabled();
		await expect(pill('Dominant')).toHaveAttribute('title', WRONG_CHORD);
	});

	test('tagging a fitting progression is written to the tag store', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto(`/licks/${LICK_ID}`);
		await page.getByRole('button', { name: 'Major', exact: true }).click();

		const readTags = () =>
			page.evaluate((id) => {
				const raw = window.localStorage.getItem('mankunku:user-lick-tags');
				return raw ? ((JSON.parse(raw) as Record<string, string[]>)[id] ?? []) : [];
			}, LICK_ID);
		await expect.poll(readTags).toContain('prog:major-vamp');

		// Toggling again removes it.
		await page.getByRole('button', { name: 'Major', exact: true }).click();
		await expect.poll(readTags).not.toContain('prog:major-vamp');
	});

	test('Reset Progress clears the seeded per-key progress after a confirm', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await seedStorage(page, {
			'lick-practice-progress': {
				[LICK_ID]: {
					C: { currentTempo: 120, lastPracticedAt: 1754000000000, passCount: 3, rollingScore: 0.9 },
					G: { currentTempo: 110, lastPracticedAt: 1754000001000, passCount: 1, rollingScore: 0.6 }
				}
			},
			'lick-unlock-count': { [LICK_ID]: 2 }
		});
		await page.goto(`/licks/${LICK_ID}`);

		// Two-stage confirm, then the button vanishes — there is nothing left
		// to reset.
		const reset = page.getByRole('button', { name: /reset progress/i });
		await expect(reset).toBeVisible();
		await reset.click();
		const confirm = page.getByRole('button', { name: 'Confirm Reset' });
		await expect(confirm).toBeVisible();
		await confirm.click();
		await expect(page.getByRole('button', { name: /reset/i })).toHaveCount(0);

		// Gone from storage too: the per-key scores and the unlock count.
		const stored = await page.evaluate((id) => {
			const progress = JSON.parse(window.localStorage.getItem('mankunku:lick-practice-progress') ?? '{}');
			const unlocks = JSON.parse(window.localStorage.getItem('mankunku:lick-unlock-count') ?? '{}');
			return { progress: progress[id] ?? null, unlock: unlocks[id] ?? null };
		}, LICK_ID);
		expect(stored).toEqual({ progress: null, unlock: null });

		// Survives a reload: the button stays gone.
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Test Major Chord Line' })).toBeVisible();
		await expect(page.getByRole('button', { name: /reset/i })).toHaveCount(0);
	});

	test('Practice launches a Deep Practice session on this lick', async ({
		page,
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		test.setTimeout(60_000);

		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);

		await page.goto(`/licks/${LICK_ID}`);
		await page.getByRole('button', { name: 'Practice', exact: true }).click();

		await expect(page).toHaveURL(/\/lick-practice\/session$/);
		await expect(page.getByRole('button', { name: /end session/i })).toBeVisible({
			timeout: 20_000
		});
		await expect(page.getByText('Test Major Chord Line').first()).toBeVisible();
	});
});
