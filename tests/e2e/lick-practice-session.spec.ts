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
			...SEEDED_PROGRESS
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

		// Tempo UI: the progress ring centers on the current tempo, resolved
		// from the seeded key-C progress (the slowest stored key tempo).
		const ring = page.locator('svg').filter({ hasText: 'BPM' });
		await expect(ring.locator('text', { hasText: /^180$/ })).toBeVisible();

		// Round phase 1 — the demo cycle: the active row chips "Listen" while
		// the app plays the lick. The instrument samples are served by the
		// CDN stub, so the old 45s WebKit cold-load (PR #205) is gone; the
		// generous timeout stays as headroom for shared-runner contention.
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

		// Two full cycles (demo + user window + turnaround) at the seeded
		// tempo — same budget shape as the daily test. Deep practice eases
		// in 2% under the lick's stored tempo, so it opens at 176 rather
		// than the seeded 180; the budget absorbs the difference.
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

		// Cycle 1 opens with the session's one guaranteed demo (Listen chip),
		// then the user window. Samples come from the CDN stub; the generous
		// first wait is headroom for shared-runner contention.
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
