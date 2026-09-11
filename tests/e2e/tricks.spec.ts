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

		// Variant pills: an unlocked rung is a selectable button; a locked one is
		// padlocked text. `exact` keeps the pill apart from the mastery-tree row
		// of the same label (whose accessible name carries its pass count).
		const pill = (label: string) => signedInPage.getByRole('button', { name: label, exact: true });
		await expect(pill('Single chromatic approach — major')).toBeVisible();
		await expect(pill('Single chromatic approach — minor')).toBeVisible();
		await expect(pill('Single chromatic approach — dominant')).toBeVisible();
		await expect(pill('Scale step down to the 3rd — major')).toBeVisible();
		await expect(pill('Scale step down to the 3rd — minor')).toHaveCount(0);
		await expect(pill('Scale step down to the 3rd — dominant')).toHaveCount(0);
		await expect(
			signedInPage.getByText('🔒 Scale step down to the 3rd — minor', { exact: true })
		).toBeVisible();
		await expect(
			signedInPage.getByText('🔒 Scale step down to the 3rd — dominant', { exact: true })
		).toBeVisible();

		// Mastery path: the practised rung reads its pass total; the locked
		// rungs on the other chains name the prerequisite they still need.
		const tree = signedInPage.getByRole('button', { name: 'Single chromatic approach — major 3 passes' });
		await expect(tree).toBeVisible();
		await expect(
			signedInPage.getByText('needs 3 passes of Single chromatic approach — minor')
		).toBeVisible();
		await expect(
			signedInPage.getByText('needs 3 passes of Single chromatic approach — dominant')
		).toBeVisible();

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

	test('Practice this variant hands off to the setup page and starts a trick drill', async ({
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
		await signedInPage.getByRole('button', { name: /practice this variant/i }).click();

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
});
