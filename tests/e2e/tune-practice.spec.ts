import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, seedTunes, seedUserLicks } from './fixtures/storage';
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
 * The engraved layout as bars per system — one entry per abcjs staff
 * wrapper, counting its barline groups (a pickup bar contributes the `|:`
 * that closes it). Two renders of one chart are congruent iff these match.
 */
async function systemSignature(page: Page): Promise<number[]> {
	return page.evaluate(() => {
		const vp = document.querySelector('[data-testid="chart-scroll-viewport"].following');
		const wrappers = [...(vp?.querySelectorAll('svg g.abcjs-staff-wrapper') ?? [])];
		return wrappers.map((w) => w.querySelectorAll('g.abcjs-bar').length);
	});
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
		// Links carry the title slug; the curated `ls-` id still resolves too.
		await expect(page).toHaveURL(/\/tunes\/when-the-saints-go-marching-in\/practice$/);

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

	test('choruses range from 1 to 12 and update the planned insertion count', async ({ page }) => {
		await page.goto('/tunes/ls-when-the-saints/practice');
		const choruses = page.getByRole('slider', { name: /^choruses$/i });
		await expect(choruses).toHaveAttribute('aria-valuenow', '1');
		await expect(choruses).toHaveAttribute('aria-valuemin', '1');
		await expect(choruses).toHaveAttribute('aria-valuemax', '12');
		await expect(async () => {
			await choruses.press('End');
			await expect(choruses).toHaveAttribute('aria-valuenow', '12', { timeout: 1000 });
		}).toPass();
		await expect(page.getByText(/60 insertion points/i)).toBeVisible();
		await choruses.press('Home');
		await expect(page.getByText(/5 insertion points/i)).toBeVisible();
		await choruses.press('ArrowUp');
		await expect(page.getByText(/10 insertion points/i)).toBeVisible();
		await page.reload();
		await expect(choruses).toHaveAttribute('aria-valuenow', '2');
		await expect(page.getByText(/10 insertion points/i)).toBeVisible();
		await page.goto('/tunes/ls-mankunku-blues/practice');
		await expect(choruses).toHaveAttribute('aria-valuenow', '2');
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
		await page.getByRole('switch', { name: /play the head first/i }).click();
		await expect(summary).toContainText('5 insertion points');
		await page.getByRole('slider', { name: /^choruses$/i }).press('ArrowUp');
		await expect(summary).toContainText('10 insertion points');
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
		// Strictness pad present, and the three levels differ in what the
		// chart tells you, never in how it listens — each option's sublabel
		// (part of its accessible name) says what that level names.
		const strictness = page.getByRole('radiogroup', { name: 'Strictness', exact: true });
		await expect(strictness.getByRole('radio', { name: /^guided\b.*names the lick/i })).toBeVisible();
		await expect(
			strictness.getByRole('radio', { name: /^standard\b.*names the progression only/i })
		).toBeVisible();
		await expect(
			strictness.getByRole('radio', { name: /^solo\b.*no cues — any fitting lick/i })
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

	test('backing switch starts at the global setting and overrides it for one session', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		// Global backing OFF. Written unconditionally AFTER the beforeEach seed
		// (seedStorage only fills absent keys, so it cannot override it) and on
		// every navigation, which is what makes the return-visit leg meaningful.
		await page.addInitScript(() => {
			const key = 'mankunku:settings';
			const raw = window.localStorage.getItem(key);
			const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
			window.localStorage.setItem(key, JSON.stringify({ ...parsed, backingTrackEnabled: false }));
		});
		await page.goto('/tunes/ls-when-the-saints/practice');

		const backing = page.getByRole('switch', { name: /backing track this session/i });
		const style = page.getByRole('radiogroup', { name: 'Backing style', exact: true });
		await expect(backing).toBeVisible();
		await expect(backing).toHaveAttribute('aria-checked', 'false');
		// Style is a property OF the backing track — with no band there is nothing
		// to style, as on the settings page.
		await expect(style).toBeHidden();

		// Freestyle's copy describes what plays, so it has to follow the switch:
		// "backing only" is a promise of a band. (A pad option's accessible name
		// is its label plus its sublabel line.)
		const freestyle = page
			.getByRole('radiogroup', { name: 'Mode', exact: true })
			.getByRole('radio', { name: /^freestyle/i });
		await expect(freestyle).not.toHaveAccessibleName(/backing only/i);

		await backing.click();
		await expect(backing).toHaveAttribute('aria-checked', 'true');
		await expect(style).toBeVisible();
		await expect(freestyle).toHaveAccessibleName(/backing only/i);

		// Checked before navigating: the override must not write the global back.
		const stored = await page.evaluate(() => {
			const raw = window.localStorage.getItem('mankunku:settings');
			return raw ? (JSON.parse(raw) as { backingTrackEnabled?: boolean }) : null;
		});
		expect(stored?.backingTrackEnabled).toBe(false);

		// Leave setup and come back THROUGH THE APP: the state module outlives
		// the route, so only a client-side round trip exercises the re-seed —
		// a page.goto would reload the module and pass for the wrong reason.
		await page.getByRole('link', { name: /when the saints go marching in/i }).click();
		await expect(page).toHaveURL(/\/tunes\/when-the-saints-go-marching-in$/);
		await page.getByRole('button', { name: /practice licks/i }).click();
		await expect(page.getByRole('heading', { name: /practice licks/i })).toBeVisible();
		await expect(backing).toHaveAttribute('aria-checked', 'false');
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
	test('finishes three practice choruses with the head played once', async ({ page, browserName }) => {
		test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() hangs in headless Linux Firefox without an audio device');
		test.setTimeout(90_000);
		await seedOnboardedAnonymous(page);
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await seedTunes(page, [{
			id: 'e2e-three-choruses', title: 'Three Choruses', composer: 'E2E', key: 'C',
			timeSignature: [4, 4], style: 'Medium Swing', tags: ['e2e'], source: 'user',
			sections: [{ label: 'A', bars: 2,
				notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }],
				harmony: [{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian',
					startOffset: [0, 1], duration: [2, 1], symbol: 'Cmaj7' }]
			}]
		}]);
		await page.goto('/tunes/e2e-three-choruses/practice');
		await setTempoMax(page);
		const choruses = page.getByRole('slider', { name: /^choruses$/i });
		await choruses.press('ArrowUp');
		await choruses.press('ArrowUp');
		await expect(choruses).toHaveAttribute('aria-valuenow', '3');
		await expect(page.getByText(/3 insertion points/i)).toBeVisible();
		await startPracticeSession(page);
		// After count-in (1s), head (2s), and the first chorus (2s), the
		// chart must still follow the second practice chorus, not finish early.
		await expect(page.getByText('0:05', { exact: true })).toBeVisible({ timeout: 20_000 });
		await expectChartVisibleInFollowViewport(page);
		await expect(page.locator('svg .range-marker[class*="playhead-"]').first()).toBeVisible();
		await expect(page.getByRole('heading', { name: /take complete/i })).toBeVisible({ timeout: 20_000 });
		await expect(page.getByText(/of 3 insertion points landed/i)).toBeVisible();
	});

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

	test('a session runs with the backing switched off', async ({
		page,
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		// The override exists so a tune can be taken unaccompanied, and no other
		// test ever starts a session in that state: with no band there is no
		// backing schedule for the window's bleed evidence to read, and the
		// automatic console guard fails the test if that path throws.
		test.setTimeout(150_000);

		await seedOnboardedAnonymous(page);
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);

		await page.goto('/tunes/ls-mankunku-blues/practice');
		await expect(page.getByRole('button', { name: /^start$/i })).toBeVisible();

		const backing = page.getByRole('switch', { name: /backing track this session/i });
		await backing.click();
		await expect(backing).toHaveAttribute('aria-checked', 'false');

		await setTempoMax(page);
		await startPracticeSession(page);

		// Reaching a scored window is the point: it is where the missing
		// schedule would be read.
		await expect(
			page.getByText(/your turn — play the lick!|comping — insertion/i)
		).toBeVisible({ timeout: 75_000 });

		await page.getByRole('button', { name: /^end$/i }).click();
		await expect(page.getByRole('heading', { name: /take complete/i })).toBeVisible({
			timeout: 10_000
		});
	});

	test('freestyle with the backing off does not claim the band was listening', async ({
		page,
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		test.setTimeout(150_000);

		await seedOnboardedAnonymous(page);
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);

		await page.goto('/tunes/ls-when-the-saints/practice');
		await expect(page.getByRole('button', { name: /^start$/i })).toBeVisible();

		await page
			.getByRole('radiogroup', { name: 'Mode', exact: true })
			.getByRole('radio', { name: /^freestyle/i })
			.click();
		await page.getByRole('switch', { name: /backing track this session/i }).click();
		await setTempoMax(page);
		await startPracticeSession(page);

		// End with nothing played: the no-match branch of the freestyle summary,
		// which must not credit a band that never played.
		await page.getByRole('button', { name: /^end$/i }).click();
		await expect(page.getByRole('heading', { name: /take complete/i })).toBeVisible({
			timeout: 10_000
		});
		const summary = page.locator('p', { hasText: /no known licks recognized/i });
		await expect(summary).toBeVisible();
		await expect(summary).not.toContainText(/band/i);
	});

	test('no lick prompts through the head; a minor lick gets its own band on the i chord (Autumn Leaves)', async ({
		page,
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		test.setTimeout(150_000);

		// 2026-09-17: with no long ii-V-I lick ready, a single-chord minor lick
		// was named across every long ii-V-I from the first head bar. Andy's
		// rules: nothing prompts for a lick while the melody plays, and a
		// single-chord lick is offered as its own band on the chord it fits —
		// the i of the minor ii-V-i — labelled with its name and key.
		const autumnLeaves = {
			...autumnLeavesFixture,
			id: 'e2e-autumn-leaves',
			source: 'user' as const
		};
		const minorLick = {
			id: 'e2e-minor-lick',
			name: 'E2E Minor Lick',
			timeSignature: [4, 4],
			key: 'C',
			notes: [
				{ pitch: 63, duration: [1, 2], offset: [0, 1] },
				{ pitch: 62, duration: [1, 2], offset: [1, 2] },
				{ pitch: 60, duration: [1, 1], offset: [1, 1] }
			],
			harmony: [
				{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [2, 1], symbol: 'C-7' }
			],
			difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 2 },
			category: 'minor-chord',
			tags: ['practice'],
			source: 'user-entered'
		};

		await seedOnboardedAnonymous(page);
		await seedUserLicks(page, [minorLick]);
		// Known in concert E (the tune's minor chord): Points mode admits the
		// whole catalog, and a lick the player HAS in the key outranks a longer
		// cadence lick they have never touched.
		await seedStorage(page, {
			'lick-practice-progress': {
				'e2e-minor-lick': { E: { passCount: 1, currentTempo: 240, lastPracticedAt: 1 } }
			}
		});
		await seedTunes(page, [autumnLeaves]);
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);

		await page.goto('/tunes/e2e-autumn-leaves/practice');
		await expect(page.getByRole('button', { name: /^start$/i })).toBeVisible();
		// Points: no readiness filter, and the pick card is the one prompt a
		// head could show.
		await page
			.getByRole('radiogroup', { name: 'Mode', exact: true })
			.getByRole('radio', { name: /^points\b/i })
			.click();
		// Guided: the bands name the lick (Standard, the default, names the
		// progression alone).
		await page
			.getByRole('radiogroup', { name: 'Strictness', exact: true })
			.getByRole('radio', { name: /^guided\b/i })
			.click();
		await setTempoMax(page);
		await startPracticeSession(page);

		// The head: the melody sheet carries the playhead and nothing else.
		// A regex in getByText is not whitespace-normalised, and the template breaks
		// this line between "once" and "through".
		await expect(page.getByText(/melody once\s+through/i)).toBeVisible({ timeout: 20_000 });
		const annotationsDuringHead = await page.evaluate(() => {
			const vp = document.querySelector('[data-testid="chart-scroll-viewport"].following');
			const markers = [...(vp?.querySelectorAll('svg .range-marker') ?? [])];
			return {
				labels: markers.filter((m) => m.classList.contains('range-marker-label')).length,
				bands: markers.filter((m) => m.getAttribute('data-marker-id') !== '__playhead').length,
				pickCard: !!document.querySelector('[data-testid="suggestion-pick-card"]')
			};
		});
		expect(annotationsDuringHead).toEqual({ labels: 0, bands: 0, pickCard: false });

		// The solo chorus: the minor lick is named on its own Minor bands, in
		// the written key of the chord it sits on (concert E- is F#- on tenor).
		await expect(
			page.getByText(/your turn — play the lick!|comping — insertion/i)
		).toBeVisible({ timeout: 75_000 });
		const labels = page.locator('svg text.range-marker-label');
		await expect(labels.first()).toBeVisible();
		const texts = await labels.allTextContents();
		expect(texts.filter((t) => t === 'E2E Minor Lick · F#m').length).toBeGreaterThanOrEqual(3);
		// The pick card, held back through the head, is up for the next window.
		await expect(page.getByTestId('suggestion-pick-card')).toBeVisible();

		await page.getByRole('button', { name: /^end$/i }).click();
		await expect(page.getByRole('heading', { name: /take complete/i })).toBeVisible({
			timeout: 10_000
		});
		// The report names the window by its chord: bar, key F#, "Minor" (the
		// take ended before the window played, so no lick is recorded on it).
		const minorRows = page.locator('div', { hasText: /b8\s*F#\s*Minor\s*No take/ });
		await expect(minorRows.first()).toBeVisible();
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

		// The head chart is the lead sheet as the detail page engraves it:
		// pickup + 4 bars, then the [1] line, the [2] line, and B in fours.
		const headSignature = await systemSignature(page);
		expect(headSignature).toEqual([5, 4, 3, 4, 4, 4, 4]);

		await expect(
			page.getByText(/your turn — play the lick!|comping — insertion/i)
		).toBeVisible({ timeout: 75_000 });

		for (let i = 0; i < 5; i++) {
			await expectChartVisibleInFollowViewport(page);
			await page.waitForTimeout(200);
		}

		// 2026-09-16: the head→changes swap re-engraved a different layout —
		// the melody-free sheet lost its pickup (inferred from the notes just
		// removed) and widened to 6 bars a line, so the second A landed on a
		// lone pickup bar with the [2] bars compressed under a split [1]. The
		// changes sheet must break its systems exactly like the head sheet.
		expect(await systemSignature(page)).toEqual(headSignature);

		await page.getByRole('button', { name: /^end$/i }).click();
		await expect(page.getByRole('heading', { name: /take complete/i })).toBeVisible({
			timeout: 10_000
		});
	});
});
