import { test, expect } from './fixtures/auth';
import { seedOnboardedAnonymous, seedStorage } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

/**
 * /tricks catalog and /tricks/[id] detail — the variant mastery ladders,
 * signed in.
 *
 * The ladder rules under test (src/lib/tricks/mastery.ts):
 *  - Enclosures are THREE parallel self-contained chains (major / minor /
 *    dominant), each the same eight steps, with NO cross-type gating: every
 *    chain's first rung is unlocked from day one, and passes on one chain
 *    unlock only that chain's next rung.
 *  - Triad pairs are ONE strict linear chain over the eight families.
 *
 * Variant keys are `${trickId}:${sorted params}` (trickVariantKey); the
 * progress and selection blobs below are keyed on them. Selection lives in
 * the trick-practice store's own localStorage key (`trick-selected-variants`),
 * never in a lick blob.
 */

const E2E_UID = '00000000-0000-0000-0000-000000000001';

/** trickVariantKey('enclosures', e1 params + type) — the chain's first rung. */
const ENCLOSURE_E1 = (type: 'major' | 'minor' | 'dominant') =>
	`enclosures:beatPlacement=downbeat,noteCount=1,shape=chromatic-below,targetTone=root,type=${type}`;

test.describe('tricks', () => {
	test.beforeEach(async ({ signedInPage }) => {
		await seedOnboardedAnonymous(signedInPage);
		// The signed-in layout hydrates trick state from the cloud; answer every
		// REST call with an empty set so nothing reaches a real backend (same
		// pattern as licks-authed.spec.ts).
		await signedInPage.route('**/rest/v1/**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'content-range': '0-0/0' },
				body: '[]'
			});
		});
	});

	test('catalog lists both devices with their day-one unlock counts and opens a detail page', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await signedInPage.goto('/tricks');
		await expect(signedInPage.getByRole('heading', { name: 'Tricks', exact: true })).toBeVisible();

		// Three enclosure chains × one open first rung; one triad-pair chain.
		const enclosures = signedInPage.getByRole('button', { name: /Enclosures/ });
		await expect(enclosures).toContainText('3 of 24 variants unlocked');
		const triadPairs = signedInPage.getByRole('button', { name: /Triad Pairs/ });
		await expect(triadPairs).toContainText('1 of 8 variants unlocked');

		await enclosures.click();
		await expect(signedInPage).toHaveURL(/\/tricks\/enclosures$/);
		await expect(signedInPage.getByRole('heading', { name: 'Enclosures', exact: true })).toBeVisible();
	});

	test('enclosures: each chain opens on its first rung; passes unlock only that chain', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		// Three total passes on the MAJOR chain's first rung — the unlock
		// threshold for its second rung. The minor and dominant chains must not
		// move.
		await seedStorage(signedInPage, {
			'trick-practice-progress': {
				[ENCLOSURE_E1('major')]: {
					C: { currentTempo: 60, lastPracticedAt: 1754000000000, passCount: 2 },
					G: { currentTempo: 60, lastPracticedAt: 1754000001000, passCount: 1 }
				}
			}
		});
		await signedInPage.goto('/tricks/enclosures');

		const map = signedInPage.getByTestId('enclosure-mastery-map');
		await expect(map.locator('[data-variant-key]')).toHaveCount(8);
		await expect(map.locator('[data-step-index="1"]')).toContainText('3 passes');
		await expect(map.locator('[data-step-index="2"]')).toHaveAttribute('data-state', 'ready');
		await expect(map.locator('.connectors path')).toHaveCount(8);
		for (const family of ['minor-vamp', 'dominant-vamp']) {
			await signedInPage.getByRole('combobox', { name: 'Chord family', exact: true }).selectOption(family);
			await expect(map.locator('[data-step-index="1"]')).toHaveAttribute('data-state', 'ready');
			await expect(map.locator('[data-step-index="2"]')).toHaveAttribute('data-state', 'locked');
			expect(await map.locator('.contour circle').evaluateAll(circles => circles.every(circle => {
				const y = Number(circle.getAttribute('cy')), r = Number(circle.getAttribute('r'));
				return y - r >= 0 && y + r <= 32;
			}))).toBe(true);
			// Locked steps remain useful previews, but cannot start a drill.
			await map.locator('[data-step-index="2"]').click();
			await expect(signedInPage.getByRole('button', { name: /practice this enclosure/i })).toBeDisabled();
			await expect(signedInPage.locator('[data-enclosure-target]')).toBeVisible();
		}
		for (const width of [360, 768, 1100]) {
			await signedInPage.setViewportSize({ width, height: 1400 });
			await expect(map.locator('[data-variant-key]')).toHaveCount(8);
			await expect.poll(async () => signedInPage.evaluate(() =>
				document.documentElement.scrollWidth <= window.innerWidth
			)).toBe(true);
		}

		// The catalog card counts the unlock too.
		await signedInPage.goto('/tricks');
		await expect(signedInPage.getByRole('button', { name: /Enclosures/ })).toContainText(
			'4 of 24 variants unlocked'
		);
	});

	test('triad pairs: a strict linear chain with exactly one rung up next', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await signedInPage.goto('/tricks/triad-pairs');
		await expect(signedInPage.getByRole('heading', { name: 'Triad Pairs', exact: true })).toBeVisible();

		/**
		 * A variant pill by its exact label — `exact` keeps it apart from the
		 * mastery-tree row of the same label; a locked rung has no button.
		 */
		const pill = (label: string) => signedInPage.getByRole('button', { name: label, exact: true });
		await expect(pill('Major pair a whole step apart (C·D)')).toBeVisible();
		await expect(pill('Major + minor a whole step apart (C·Dm)')).toHaveCount(0);
		await expect(
			signedInPage.getByText('🔒 Major + minor a whole step apart (C·Dm)', { exact: true })
		).toBeVisible();

		// The second family waits on the first; nothing further down is "next".
		await expect(
			signedInPage.getByText('needs 3 passes of Major pair a whole step apart (C·D)')
		).toBeVisible();
		await expect(signedInPage.getByText('next up')).toHaveCount(1);

		// The preview engraves the selected variant's example in written pitch.
		await expect(
			signedInPage.locator('.abcjs-container svg .abcjs-notehead').first()
		).toBeVisible();
	});

	test('starring a variant for tune practice persists across a reload', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await signedInPage.goto('/tricks/enclosures');

		const star = signedInPage.getByRole('button', { name: /suggest in tunes/i });
		await expect(star).toHaveText('☆ Suggest in tunes');
		await star.click();
		await expect(star).toHaveText('★ Suggest in tunes');

		await signedInPage.reload();
		await expect(signedInPage.getByRole('button', { name: /suggest in tunes/i })).toHaveText(
			'★ Suggest in tunes'
		);

		// Saved under the trick store's own namespaced key as the composite
		// variant key of the default (first unlocked) variant.
		const stored = await signedInPage.evaluate(
			(key) => window.localStorage.getItem(key),
			`mankunku:u:${E2E_UID}:trick-selected-variants`
		);
		expect(JSON.parse(stored ?? '[]')).toEqual([ENCLOSURE_E1('major')]);
	});

	test('Practice this enclosure hands off to setup and starts a trick drill', async ({
		signedInPage,
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		test.setTimeout(90_000);

		await installAudioMock(signedInPage);
		await stubCdnInstrumentSamples(signedInPage);

		await signedInPage.goto('/tricks/enclosures');
		await signedInPage.getByRole('button', { name: /practice this enclosure/i }).click();

		// The detail page presets the config and the setup page owns the start.
		await expect(signedInPage).toHaveURL(/\/lick-practice$/);
		const start = signedInPage.getByRole('button', { name: /start trick drill/i });
		await expect(start).toBeEnabled();
		await start.click();

		await expect(signedInPage).toHaveURL(/\/lick-practice\/session$/);
		await expect(signedInPage.getByRole('button', { name: /end session/i })).toBeVisible({
			timeout: 20_000
		});
		// The session names the device and the variant it is drilling.
		await expect(signedInPage.getByText(/Single chromatic approach — major/).first()).toBeVisible({
			timeout: 20_000
		});
	});

	for (const [bed, label] of [
		['ii-V-I-major-long', 'Long ii-V-I (Maj)'],
		['ii-V-I-minor-long', 'Long ii-V-I (Min)']
	] as const) {
		test(`${bed} starts a drill with the configured enclosure`, async ({ signedInPage, browserName }) => {
			test.skip(
				browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
				'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
			);
			test.setTimeout(90_000);
			await installAudioMock(signedInPage);
			await stubCdnInstrumentSamples(signedInPage);
			await signedInPage.goto('/tricks/enclosures');
			await signedInPage.getByRole('button', { name: /practice this enclosure/i }).click();
			await signedInPage.getByRole('combobox', { name: 'Practice over', exact: true }).selectOption(bed);
			// This combination is outside the mastery catalog: progressions must
			// retain the gesture and use a readable session name without gating it.
			await signedInPage.locator('[data-enclosure-target]').click();
			await signedInPage.getByLabel('Place in the chord', { exact: true }).selectOption('third');
			await signedInPage.getByRole('button', { name: 'Land on the and of beat 1', exact: true }).click();
			await signedInPage.getByRole('button', { name: /start trick drill/i }).click();
			await expect(signedInPage).toHaveURL(/\/lick-practice\/session$/);
			await expect(signedInPage.getByRole('button', { name: /end session/i })).toBeVisible();
			await expect(signedInPage.getByRole('heading', { name: /Enclosures · .*Target 3rd · Off the beat/ })).toBeVisible();
			await expect(signedInPage.getByText(label, { exact: true })).toBeVisible();
			// A single offbeat approach begins on beat one: ii / V / I / I,
			// with no empty pickup bar added to the chart.
			await expect(signedInPage.locator('.chart-wrap').first().locator('.chord-symbol')).toHaveCount(4);
		});
	}

	test('phrase canvas preserves the gesture across major and minor ii-V-I arrivals', async ({ signedInPage }) => {
		await signedInPage.goto('/tricks/enclosures');
		await signedInPage.getByRole('button', { name: /practice this enclosure/i }).click();
		const progression = signedInPage.getByRole('combobox', { name: 'Practice over', exact: true });
		await expect(progression.locator('option')).toHaveCount(5);
		await progression.selectOption('ii-V-I-major-long');
		await signedInPage.getByRole('button', { name: '2 approach notes', exact: true }).click();
		await signedInPage.locator('[data-enclosure-note="0"]').click();
		await signedInPage.getByLabel('Complete approach pattern', { exact: true }).selectOption('above-below');
		const target = signedInPage.locator('[data-enclosure-target]');
		await target.click();
		await signedInPage.getByLabel('Place in the chord', { exact: true }).selectOption('third');
		await expect(target).toBeFocused();
		const arrivals = signedInPage.locator('[aria-label="Preview an arrival chord"] button');
		for (const [bed, pitches] of [
			['ii-V-I-major-long', ['F', 'B', 'E']],
			['ii-V-I-minor-long', ['F', 'B', 'Eb']]
		] as const) {
			await progression.selectOption(bed);
			for (let i = 0; i < pitches.length; i++) {
				await arrivals.nth(i).click();
				await expect(target).toHaveAttribute('aria-label', new RegExp(`^Target ${pitches[i]}\\d,`));
				await expect(signedInPage.getByRole('button', { name: '2 approach notes', exact: true })).toHaveAttribute('aria-pressed', 'true');
			}
		}
		await arrivals.nth(0).click();
		await target.click();
		await signedInPage.getByLabel('Place in the chord', { exact: true }).selectOption('fifth');
		await expect(target).toHaveAttribute('aria-label', /^Target Ab\d, diminished 5th/);
		await expect(target).toContainText('♭5');
		await arrivals.nth(1).click();
		await expect(target).toHaveAttribute('aria-label', /^Target D\d, 5th/);
		await expect(signedInPage.getByRole('button', { name: /start trick drill/i })).toBeEnabled();

		for (const width of [360, 768, 1100]) {
			await signedInPage.setViewportSize({ width, height: 1400 });
			for (const beat of ['Land on beat 1', 'Land on the and of beat 1']) {
				await signedInPage.getByRole('button', { name: beat, exact: true }).click();
				await expect.poll(async () => signedInPage.evaluate(() => {
					const line = document.querySelector('[data-beat-one-marker]')!.getBoundingClientRect();
					const beat = document.querySelector('[aria-label="Land on beat 1"]')!.getBoundingClientRect();
					return Math.abs(line.left - (beat.left + beat.width / 2));
				})).toBeLessThan(1);
			}
			const widths = await arrivals.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
			expect(widths[2] / widths[0]).toBeCloseTo(2, 1);
			expect(await signedInPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		}
	});
});
