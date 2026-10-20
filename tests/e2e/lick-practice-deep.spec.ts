import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';
import { FAST_TEMPO, SEEDED_PROGRESS, LEAD_AHEAD_PROGRESS } from './fixtures/lick-practice-seeds';

/**
 * Single-lick Deep Practice: rows scrolling out through keys and cycle
 * rebuilds, continuous cycles with inline score feedback, starting from a
 * transposed view, and a sheet's chord box and beat dots staying visible.
 *
 * One of the lick-practice session specs, cut by subject so CircleCI's
 * file-level test splitting can spread them across nodes; the flow they
 * share and the seeds are described in fixtures/lick-practice-seeds.ts.
 */
test.describe('lick-practice session flow', () => {
	test('Deep scrolls completed rows out through keys and cycle rebuilds without moving scores to future rows', async ({ page, browserName }) => {
		test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device');
		test.setTimeout(60_000);
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, LEAD_AHEAD_PROGRESS);
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.goto('/licks/e2e-user-lick-bebop');
		await page.getByRole('button', { name: 'Practice', exact: true }).click();
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await expect(page.locator('.row.current[data-key="Bb"] .phase-tab[data-pass="3"]')).toBeVisible({ timeout: 30_000 });
		// Inspect the real CSS animation at deterministic checkpoints. Under
		// CI load, WebKit can miss its early frames in a requestAnimationFrame
		// sampler even though the animation starts in the correct position.
		const { movement, duration } = await page.evaluate(() => new Promise<{ movement: number[]; duration: number }>((resolve, reject) => {
			const observer = new MutationObserver(sample);
			const timeout = setTimeout(() => {
				observer.disconnect();
				reject(new Error('Next Deep cycle did not animate into C'));
			}, 15_000);
			/** Once the cycle-scroll animation exists, pauses it and measures the current row at its start, middle and end. */
			function sample(): void {
				const row = document.querySelector('.row.current[data-key="C"]');
				const animation = row?.closest('.stack')?.getAnimations().find(
					(candidate: Animation): boolean => candidate instanceof CSSAnimation && candidate.animationName.endsWith('cycle-scroll')
				);
				if (!row || !animation) return;
				observer.disconnect();
				clearTimeout(timeout);
				const duration = animation.effect?.getTiming().duration;
				if (typeof duration !== 'number') return reject(new Error('Deep scroll has no finite duration'));
				/** The row's distance below the top of its viewport. */
				const offset = (): number => row.getBoundingClientRect().top - row.closest('.viewport')!.getBoundingClientRect().top;
				animation.pause();
				animation.currentTime = 0;
				const start = offset();
				animation.currentTime = duration / 2;
				const middle = offset();
				animation.finish();
				resolve({ movement: [start, middle, offset()], duration });
			}
			observer.observe(document, { childList: true, subtree: true, attributes: true });
			sample();
		}));
		expect(duration).toBe(420);
		expect(Math.max(...movement)).toBeGreaterThan(64);
		expect(movement.some(y => y > 2 && y < 100)).toBe(true);
		expect(movement.at(-1)).toBeCloseTo(0, 0);
		await expect(page.locator('.row.current[data-key="C"]')).toBeVisible();
		const rows = await page.locator('.stack .row').evaluateAll((rows) => rows.map(row => ({
			key: row.getAttribute('data-key'), current: row.classList.contains('current'),
			score: row.querySelector('.score-flash')?.textContent?.trim() ?? null,
			y: row.getBoundingClientRect().top
		})));
		expect(rows.map(row => row.key)).toEqual(['Bb', 'C', 'Bb']);
		expect(rows[1].current).toBe(true);
		expect(rows[1].y - rows[0].y).toBeCloseTo(204.8, 1);
		const viewport = page.locator('.viewport').filter({ has: page.locator('.stack') });
		// The old row may exist as an outgoing animation frame, but must
		// leave the viewport. Assert painted geometry, not just row order.
		/** The current row's distance below the top of its viewport, as painted. */
		const currentTop = () => page.locator('.row.current').evaluate(row =>
			row.getBoundingClientRect().top - row.closest('.viewport')!.getBoundingClientRect().top);
		await expect.poll(currentTop).toBeCloseTo(0, 0);
		const finished = page.locator('.stack .row').first();
		expect((await finished.boundingBox())!.y + (await finished.boundingBox())!.height)
			.toBeLessThanOrEqual((await viewport.boundingBox())!.y + 1);
		expect(rows[0].score).not.toBeNull();
		expect(rows[2].score).toBeNull();
		// The next key also moves to the top, rather than replacing the
		// contents of a permanently active second slot.
		await expect(page.locator('.row.current[data-key="Bb"]')).toBeVisible({ timeout: 15_000 });
		await expect.poll(currentTop).toBeCloseTo(0, 0);
		await page.getByRole('button', { name: /end session/i }).click();
	});

	/**
	 * Single-lick Deep Practice continuous flow. The critical regression this
	 * pins is the synchronous cycle boundary: the last key's close event must
	 * itself schedule the next cycle (advance → sort → startLick → turnaround)
	 * with NO rest bars, NO breather card, and NO user interaction — a bug
	 * there strands the session silent after one cycle. So the strongest
	 * assertion available is a SECOND recording window opening on its own
	 * after the first one closed. The inline score flash replaces the old
	 * per-round card as the only feedback surface.
	 */
	test('deep practice joins cycles continuously with inline score feedback', async ({
		page,
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);

		// Two full cycles (demo + user window(s) + turnaround) at the seeded
		// tempo — same budget shape as the daily test; cycle 2 runs the
		// revealed key's three passes. Deep practice eases in 2% under the
		// lick's stored tempo, so it opens at 176 rather than the seeded 180;
		// the budget absorbs the difference.
		test.setTimeout(240_000);

		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, SEEDED_PROGRESS);
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);

		// Deep Practice launches from the lick's detail page.
		await page.goto('/licks/e2e-user-lick-bebop');
		await page.getByRole('button', { name: /^practice$/i }).click();
		await expect(page).toHaveURL(/\/lick-practice\/session$/);
		await expect(page.getByRole('button', { name: /end session/i })).toBeVisible({
			timeout: 20_000
		});

		// Cycle 1 opens with the session's one guaranteed demo (LISTEN phase
		// tab), then the user window — where the tab flips to PLAY. Samples
		// come from the CDN stub; the generous first wait is headroom for
		// shared-runner contention.
		await expect(page.locator('.phase-tab[data-kind^="listen"]')).toBeVisible({
			timeout: 90_000
		});
		// No rolling score is seeded, so the key has never been attempted and
		// cycle 1 is by ear: chord blocks only, no lead-sheet row.
		const reveal = page.getByTestId('lead-sheet-row');
		await expect(reveal).toHaveCount(0);
		await expect(page.locator('.chart-wrap.recording')).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('.phase-tab[data-kind="play"]')).toBeVisible({ timeout: 10_000 });

		// The window closes and scores silently: the tier-colored flash is the
		// only feedback — no breather card, no pause. (The mocked mic scores
		// whatever it scores; the flash's presence is the contract, not its value.)
		await expect(page.locator('.chart-wrap.recording')).toBeHidden({ timeout: 60_000 });
		await expect(page.locator('.score-flash')).toBeVisible({ timeout: 10_000 });

		// The silent attempt scored 0, so the key's rolling score is now under
		// the floor and the boundary rebuilt the stack with it: the row is a
		// lead-sheet system for the turnaround and the cycle-2 demo — an
		// engraved staff (abcjs noteheads) with the changes above it.
		await expect(reveal).toBeVisible({ timeout: 10_000 });
		await expect(reveal.locator('.abcjs-container svg .abcjs-notehead').first()).toBeVisible({
			timeout: 10_000
		});
		await expect(reveal.locator('.abcjs-container svg text.abcjs-chord').first()).toBeVisible();

		// The boundary must have scheduled cycle 2 on its own: a new recording
		// window opens with zero interaction. This is the no-stoppage proof —
		// under the old flow 2 rest bars + a breather card sat here; under a
		// boundary regression nothing would ever open again.
		await expect(page.locator('.chart-wrap.recording')).toBeVisible({ timeout: 60_000 });
		// ...and the sheet stays up through the user's windows in that key: the
		// revealed key plays THREE passes back to back, one held row, the PLAY
		// tab counting them (the windows abut, so the recording ring never
		// blinks between passes — the tab is the observable), with the current
		// bar marked ON the staff by the engraver's own geometry.
		await expect(reveal).toBeVisible();
		const playTab = page.locator('.phase-tab[data-kind="play"]');
		await expect(playTab).toHaveAttribute('data-pass', '1', { timeout: 10_000 });
		await expect(playTab).toContainText('1/3');
		await expect(reveal.locator('.abcjs-container svg .playhead-under-bar').first()).toBeVisible();
		await expect(playTab).toHaveAttribute('data-pass', '2', { timeout: 30_000 });
		// The bar marker is the only playback indication on the staff — no
		// lit-note cursor (Andy: "the bar below is sufficient"). Sampled every
		// frame through the opening of pass 2, where the line's first notes
		// sound: a retrying count-of-zero would pass on the first rest.
		const litDuringPass = await page.evaluate(async () => {
			const row = document.querySelector('[data-testid="lead-sheet-row"]');
			const end = performance.now() + 1500;
			while (performance.now() < end) {
				if (row?.querySelector('.cursor-note')) return true;
				await new Promise((r) => requestAnimationFrame(r));
			}
			return false;
		});
		expect(litDuringPass).toBe(false);
		await expect(playTab).toHaveAttribute('data-pass', '3', { timeout: 30_000 });
		await expect(reveal).toBeVisible();

		// Endless by design: still running, no report, no round card.
		await expect(page.getByRole('heading', { name: /session report/i })).not.toBeVisible();
		await expect(page.getByText(/keep going/i)).not.toBeVisible();
		await expect(page.getByRole('button', { name: /end session/i })).toBeVisible();
	});

	/**
	 * The detail page shows the lick transposed to the selector's key and fitted
	 * to the horn, and a transposed phrase carries a suffixed id. Practice must
	 * start from the STORED lick, or the session keys its unlock count and
	 * rolling scores off an id with no progress: one key, no sheet (2026-10-15,
	 * surfaced when the stave rule moved the fixture lick an octave).
	 */
	test('Practice from a transposed view keeps the lick\'s unlocked keys and sheet', async ({ page }) => {
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, LEAD_AHEAD_PROGRESS);
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.goto('/licks/e2e-user-lick-bebop');
		await page.getByLabel('Play in').selectOption('F');
		await expect(page.getByLabel('Play in')).toHaveValue('F');
		await page.getByRole('button', { name: /^practice$/i }).click();
		await expect(page.getByText('Key 1/2', { exact: true })).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('lead-sheet-row')).toBeVisible();
		await expect(page.locator('.row[data-key="Bb"]')).toHaveCount(1);
	});

	test('deep practice keeps the chord box and beat dots below a sheet fully visible', async ({ page }) => {
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, {
			...LEAD_AHEAD_PROGRESS,
			'lick-practice-progress': {
				'e2e-user-lick-bebop': {
					C: { currentTempo: FAST_TEMPO, rollingScore: 0.9, passCount: 3 },
					Bb: { currentTempo: FAST_TEMPO, rollingScore: 0.5, passCount: 0 }
				}
			}
		});
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.goto('/licks/e2e-user-lick-bebop');
		await page.getByRole('button', { name: /^practice$/i }).click();
		await expect(page.locator('.row').first().locator('.lead-sheet.revealed')).toBeVisible();
		const geometry = await page.locator('.stack > .row').nth(1).evaluate((row) => {
			const viewport = row.closest('.viewport')!.getBoundingClientRect();
			const chart = row.querySelector('.chord-chart')!;
			const dots = [...chart.querySelectorAll('.rounded-full')];
			return {
				chartBottom: chart.getBoundingClientRect().bottom,
				rowBottom: row.getBoundingClientRect().bottom,
				viewportBottom: viewport.bottom,
				dotBottom: Math.max(...dots.map((dot) => dot.getBoundingClientRect().bottom)),
				dotCount: dots.length
			};
		});
		expect(geometry.dotCount).toBeGreaterThan(0);
		expect(geometry.chartBottom).toBeLessThanOrEqual(geometry.rowBottom);
		expect(geometry.chartBottom).toBeLessThanOrEqual(geometry.viewportBottom);
		expect(geometry.dotBottom).toBeLessThanOrEqual(geometry.viewportBottom);
	});
});
