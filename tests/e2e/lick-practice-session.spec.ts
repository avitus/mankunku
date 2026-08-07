import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage } from './fixtures/storage';
import { installAudioMock } from './fixtures/audio';

/**
 * Full lick-practice session flow.
 *
 * Seeds one practice-tagged lick (`practice` + `prog:ii-V-I-major` in the
 * user-lick-tags blob), starts a Daily Practice session from the setup page,
 * and lets the engine run a complete round on its own: demo cycle, then one
 * recorded key window at the new-lick default 60 BPM. A fresh lick plans a
 * single unlocked key, so when that window closes and scores, the plan is
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

		// Instrument-sample loading + a 2-bar demo and response window at
		// 60 BPM put the report ~40s out on a cold run. The outer clock must
		// exceed the sum of the phase waits below (90s listen + 30s record +
		// 90s report), or it kills a run the inner budgets still allow.
		test.setTimeout(240_000);

		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, {
			'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] }
		});
		await installAudioMock(page);

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

		// Tempo UI: the progress ring centers on the current tempo, which for a
		// never-practiced lick must be the new-lick default of 60 BPM.
		const ring = page.locator('svg').filter({ hasText: 'BPM' });
		await expect(ring.locator('text', { hasText: /^60$/ })).toBeVisible();

		// Round phase 1 — the demo cycle: the active row chips "Listen" while
		// the app plays the lick. Generous timeout: this is where the CDN
		// piano/bass samples and the 12-buffer drum kit load and the transport
		// spins up — WebKit on shared CI runners has crossed 45s (PR #205),
		// so this window matches the report wait below.
		await expect(page.locator('.listen-tag')).toBeVisible({ timeout: 90_000 });

		// Round phase 2 — the user window: the active chart flags recording
		// while the mocked mic captures the response.
		await expect(page.locator('.chart-wrap.recording')).toBeVisible({ timeout: 30_000 });

		// Round completes: the window closes, the attempt is scored, and the
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
		await expect(page.getByText(/[01]\/1 · \d+%/)).toBeVisible();

		// Tempo UI on the report: the per-lick row shows the lick's BPM (with
		// the session's auto-adjustment delta when one applied).
		await expect(page.getByText(/\d+ BPM/).first()).toBeVisible();

		// The report offers the restart path.
		await expect(page.getByRole('button', { name: /new session/i })).toBeVisible();
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

		// Two full cycles at 60 BPM (demo + user window + turnaround, ~20s each
		// warm) after cold sample loading — same budget shape as the daily test.
		test.setTimeout(240_000);

		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await installAudioMock(page);

		// Deep Practice launches from the lick's detail page.
		await page.goto('/licks/e2e-user-lick-bebop');
		await page.getByRole('button', { name: /^practice$/i }).click();
		await expect(page).toHaveURL(/\/lick-practice\/session$/);
		await expect(page.getByRole('button', { name: /end session/i })).toBeVisible({
			timeout: 20_000
		});

		// Cycle 1 opens with the session's one guaranteed demo (Listen chip),
		// then the user window. Generous first wait — CDN samples load here.
		await expect(page.locator('.listen-tag')).toBeVisible({ timeout: 90_000 });
		await expect(page.locator('.chart-wrap.recording')).toBeVisible({ timeout: 30_000 });

		// The window closes and scores silently: the tier-colored flash is the
		// only feedback — no breather card, no pause. (The mocked mic scores
		// whatever it scores; the flash's presence is the contract, not its value.)
		await expect(page.locator('.chart-wrap.recording')).toBeHidden({ timeout: 60_000 });
		await expect(page.locator('.score-flash')).toBeVisible({ timeout: 10_000 });

		// The boundary must have scheduled cycle 2 on its own: a new recording
		// window opens with zero interaction. This is the no-stoppage proof —
		// under the old flow 2 rest bars + a breather card sat here; under a
		// boundary regression nothing would ever open again.
		await expect(page.locator('.chart-wrap.recording')).toBeVisible({ timeout: 60_000 });

		// Endless by design: still running, no report, no round card.
		await expect(page.getByRole('heading', { name: /session report/i })).not.toBeVisible();
		await expect(page.getByText(/keep going/i)).not.toBeVisible();
		await expect(page.getByRole('button', { name: /end session/i })).toBeVisible();
	});
});
