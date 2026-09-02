import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

/**
 * Stored per-key progress pinning the session tempo at 180 BPM. These tests
 * ran at the new-lick default of 60 BPM for months and were the two slowest
 * specs in the entire suite (115s/108s on CI WebKit) — the flow is real-time
 * transport playback, so bar time IS test time and 180 cuts it 3×. The
 * 60-BPM default itself is unit-tested (resolveLickTempo); what these tests
 * pin is the round loop, which is tempo-independent. Only key C exists and
 * no unlock counts are seeded, so the plan still holds exactly one key.
 */
const FAST_TEMPO = 180;
const SEEDED_PROGRESS = {
	'lick-practice-progress': {
		'e2e-user-lick-bebop': {
			C: { currentTempo: FAST_TEMPO, lastPracticedAt: 1754000000000, passCount: 0 }
		}
	}
};

/**
 * The same seed with a sub-floor rolling score on C — a key the player has
 * been failing. C is the lick's only unlocked key, hence the one being
 * learned, so the session engraves its row as a lead sheet while the rolling
 * score is under the floor (`shouldRevealNotation` → `PlannedKey.reveal`) and
 * runs it for three passes. `lick-practice-next-steps.ts` never reads
 * `rollingScore`, so the report's Drill CTA below is unaffected.
 */
const SUB_FLOOR_PROGRESS = {
	'lick-practice-progress': {
		'e2e-user-lick-bebop': {
			C: {
				currentTempo: FAST_TEMPO,
				lastPracticedAt: 1754000000000,
				passCount: 0,
				rollingScore: 0.5
			}
		}
	}
};

/**
 * Full lick-practice session flow.
 *
 * Seeds one practice-tagged lick (`practice` + `prog:ii-V-I-major` in the
 * user-lick-tags blob), starts a Daily Practice session from the setup page,
 * and lets the engine run a complete round on its own: demo cycle, then one
 * recorded key window at the seeded 180 BPM. The lick plans a single
 * unlocked key, so when that window closes and scores, the plan is
 * exhausted and the Session Report renders without any further interaction —
 * reaching it proves the whole round loop (playback → recording → scoring →
 * advance → report) actually ran.
 *
 * The mic is the mocked stream from fixtures/audio.ts. What the pitch
 * detector hears is irrelevant to the flow: the scoring pipeline records a
 * result for every closed window (silence scores 0), so the report
 * deterministically shows one attempted key. Assertions therefore pin
 * structure (attempt counts, BPM readouts, percentage chips), never the
 * score's value.
 */
test.describe('lick-practice session flow', () => {
	test('daily session runs a full round and lands on the scored report', async ({
		page,
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		// Same Tone.start() hang as ear-training on headless Linux Firefox CI.
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);

		// The outer clock must exceed the sum of the phase waits below (90s
		// listen + 30s record + 90s report), or it kills a run the inner
		// budgets still allow.
		test.setTimeout(240_000);

		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, {
			'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] },
			...SUB_FLOOR_PROGRESS
		});
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);

		await page.goto('/lick-practice');

		// The tagged lick makes Daily Practice (the default session type) startable.
		await expect(page.getByText(/1 lick across your tagged progressions/i)).toBeVisible();
		const startBtn = page.getByRole('button', { name: /start daily practice/i });
		await expect(startBtn).toBeEnabled();
		await startBtn.click();

		// Session route with the running chrome up.
		await expect(page).toHaveURL(/\/lick-practice\/session$/);
		await expect(page.getByRole('button', { name: /end session/i })).toBeVisible({
			timeout: 20_000
		});

		// The seeded key is under the floor, so its row in the stack is a
		// lead-sheet system — chords engraved above the staff — from the first
		// paint, through the demo and the user window alike.
		const reveal = page.getByTestId('lead-sheet-row');
		await expect(reveal).toBeVisible({ timeout: 20_000 });
		await expect(reveal.locator('.abcjs-container svg .abcjs-notehead').first()).toBeVisible({
			timeout: 10_000
		});
		await expect(reveal.locator('.abcjs-container svg text.abcjs-chord').first()).toBeVisible();

		// Tempo UI: the progress ring centers on the current tempo, resolved
		// from the seeded key-C progress (the slowest stored key tempo).
		const ring = page.locator('svg').filter({ hasText: 'BPM' });
		await expect(ring.locator('text', { hasText: /^180$/ })).toBeVisible();

		// Round phase 1 — the demo cycle: the phase tab on the active row reads
		// LISTEN (or LISTEN IN through the count-in — the prefix match covers
		// both, because with a short seeded lick the plain-listen window is a
		// single bar and polling could miss it). The instrument samples are
		// served by the CDN stub, so the old 45s WebKit cold-load (PR #205) is
		// gone; the generous timeout stays as headroom for shared-runner
		// contention.
		await expect(page.locator('.phase-tab[data-kind^="listen"]')).toBeVisible({
			timeout: 90_000
		});

		// Round phase 2 — the user window: the active chart flags recording
		// while the mocked mic captures the response. The revealed key plays
		// three passes; the PLAY tab numbers them.
		await expect(page.locator('.chart-wrap.recording')).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('.phase-tab[data-kind="play"]')).toHaveAttribute(
			'data-pass',
			/^[123]$/
		);

		// Round completes: the last pass closes, the attempt is scored, and the
		// single-key plan exhausts into the report — no clicks in between.
		await expect(page.getByRole('heading', { name: /session report/i })).toBeVisible({
			timeout: 90_000
		});

		// Score UI: summary stats plus the per-lick breakdown. Exactly one key
		// was attempted, so the "Keys Passed" stat and the per-lick line both
		// read N/1, and the attempted key renders a percentage chip.
		await expect(page.getByText(/^Overall$/)).toBeVisible();
		await expect(page.getByText(/^\d+%$/).first()).toBeVisible();
		await expect(page.getByText(/^Keys Passed$/)).toBeVisible();
		await expect(page.getByText(/^[01]\/1$/)).toBeVisible();
		// The lick name renders in the per-lick breakdown and again inside the
		// "Upcoming Licks" collapsible — assert the breakdown copy (first).
		await expect(page.getByText('Test Bebop Line').first()).toBeVisible();
		// The breakdown name links through to the lick's detail page. Assert the
		// href rather than clicking — navigating away would tear down the report
		// this test's remaining assertions (ramp CTA) still need.
		await expect(page.getByRole('link', { name: 'Test Bebop Line' })).toHaveAttribute(
			'href',
			'/licks/e2e-user-lick-bebop'
		);
		await expect(page.getByText(/[01]\/1 · \d+%/)).toBeVisible();

		// Tempo UI on the report: the per-lick row shows the lick's BPM (with
		// the session's auto-adjustment delta when one applied).
		await expect(page.getByText(/\d+ BPM/).first()).toBeVisible();

		// The report offers the restart path.
		await expect(page.getByRole('button', { name: /new session/i })).toBeVisible();

		// The one attempt scored silence (0%), so the report's Next card names
		// the key and offers Deep Practice on it. That CTA is the ONLY entry
		// to the focus ramp: the drill must open on that key ALONE, which the
		// lick header announces in place of its "Key n/N" slot. This pins the
		// handleStartNextStep → focusKey → startSingleLickSession wiring that
		// no unit test can reach.
		await expect(page.getByText(/^Drill /)).toBeVisible();
		await page.getByRole('button', { name: /start deep practice/i }).click();
		await expect(page.getByTestId('focus-ramp')).toContainText(/^Focus · /, { timeout: 30_000 });
		await expect(page.getByTestId('focus-ramp')).toContainText(/→ \d+ BPM$/);
		await expect(page.getByRole('button', { name: /end session/i })).toBeVisible();
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
});
