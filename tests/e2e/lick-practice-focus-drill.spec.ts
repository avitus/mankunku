import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';
import { FAST_TEMPO, SUB_FLOOR_PROGRESS } from './fixtures/lick-practice-seeds';

/**
 * The Daily report's focus drill for a learning key, and the isolated lapse
 * that earns none.
 *
 * One of the lick-practice session specs, cut by subject so CircleCI's
 * file-level test splitting can spread them across nodes; the flow they
 * share and the seeds are described in fixtures/lick-practice-seeds.ts.
 */
test.describe('lick-practice session flow', () => {
	for (const isolatedLapse of [false, true]) {
	test(`daily session reports ${isolatedLapse ? 'no extra drill for an isolated lapse' : 'a learning-key focus drill'}`, async ({
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
		if (isolatedLapse) {
			// Three healthy sittings, followed by today's silent-mic miss. The
			// live wrapper must read this history and count today's upsert once.
			await seedStorage(page, {
				'lick-practice-sessions': [0.96, 0.98, 0.95].map((score, i) => ({
					id: `prior-${i}-ii-V-I-major`, timestamp: 1754000000000 + i,
					progressionType: 'ii-V-I-major', practiceMode: 'continuous',
					report: {
						licks: [{
							lickId: 'e2e-user-lick-bebop', lickName: 'Test Bebop Line',
							tempo: FAST_TEMPO, newTempo: null, averageScore: score, passedCount: 1,
							keys: [{ key: 'C', score, pitchAccuracy: score, rhythmAccuracy: score, passed: true }]
						}],
						overallAverage: score, totalAttempts: 1, totalPassed: 1, elapsedMinutes: 1
					}
				}))
			});
		}
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

		if (isolatedLapse) {
			await expect(page.getByText('No clear learning gap or persistent weakness to prioritize today.', { exact: false })).toBeVisible();
			await expect(page.getByRole('button', { name: /start deep practice/i })).toHaveCount(0);
			return;
		}

		// The one attempt scored silence (0%), so the report's Next card names
		// the key and offers Deep Practice on it. That CTA is the ONLY entry
		// to the focus ramp: the drill must open on that key ALONE, which the
		// lick header announces in place of its "Key n/N" slot. This pins the
		// handleStartNextStep → focusKey → startSingleLickSession wiring that
		// no unit test can reach.
		await expect(page.getByText(/^Drill /)).toBeVisible();
		// Make C a previously learned key before opening the focused drill.
		// Its low score still earns the drill. The first deep attempt starts
		// from memory, then a poor attempt must reveal this older key too.
		await page.evaluate(() => {
			localStorage.setItem('mankunku:lick-unlock-count', JSON.stringify({ 'e2e-user-lick-bebop': 2 }));
		});
		await page.getByRole('button', { name: /start deep practice/i }).click();
		await expect(page.getByTestId('focus-ramp')).toContainText(/^Focus · /, { timeout: 30_000 });
		await expect(page.getByTestId('focus-ramp')).toContainText(/→ \d+ BPM$/);
		await expect(page.getByRole('button', { name: /end session/i })).toBeVisible();
		await expect(page.locator('.phase-tab[data-kind="play"]')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('lead-sheet-row')).toHaveCount(0);

		// The stack lists the takes still to come under the current one, each
		// tagged with its tempo, climbing to the saved tempo (Andy, 2026-10-24).
		const [, opening, target] = (await page.getByTestId('focus-ramp').textContent())!
			.match(/(\d+) → (\d+) BPM/)!.map(Number);
		/** The tempo-tagged rows of the stack, top to bottom. */
		const taggedRows = () => page.locator('.stack .row').evaluateAll((rows) => rows
			.filter((row) => row.querySelector('[data-testid="row-tempo"]'))
			.map((row) => ({
				key: row.getAttribute('data-key'),
				current: row.classList.contains('current'),
				tempo: Number(row.querySelector('[data-testid="row-tempo"]')!.textContent!.match(/\d+/)![0])
			})));
		const opened = await taggedRows();
		expect(opened[0]).toMatchObject({ current: true, tempo: opening });
		expect(opened.length).toBeGreaterThan(3);
		expect(opened.at(-1)!.tempo).toBe(target);
		expect(new Set(opened.map((row) => row.key)).size).toBe(1);
		expect(opened.slice(1).every((row, i) => !row.current && row.tempo > opened[i].tempo)).toBe(true);

		// The mock microphone scores poorly. Show music on the next cycle,
		// allowing the preparation cue but never restarting a Listen phase.
		await page.setViewportSize({ width: 390, height: 900 });
		const flow = await page.evaluate(async () => {
			const cues = new Set<string>();
			let showedSheet = false;
			let preparationAt: number | null = null;
			let preparedForMs: number | null = null;
			let entranceText = '';
			let recordedDuringPreparation = false;
			let cueOverlapsSheet = false;
			let cueOutsideRow = false;
			const counts = new Set<string>();
			const until = performance.now() + 12_000;
			while (performance.now() < until) {
				const tab = document.querySelector('.phase-tab');
				const kind = tab?.getAttribute('data-kind') ?? 'missing';
				cues.add(kind);
				if (kind === 'read' || kind === 'play-in') {
					preparationAt ??= performance.now();
					entranceText = tab?.textContent ?? '';
					const count = tab?.querySelector('.tab-count')?.textContent?.trim();
					if (count) counts.add(count);
					recordedDuringPreparation ||= !!document.querySelector('.chart-wrap.recording');
					const sheet = document.querySelector('.row.current .lead-sheet');
					if (sheet && tab) {
						const cueBox = tab.getBoundingClientRect();
						const rowBox = sheet.closest('.row')!.getBoundingClientRect();
						cueOutsideRow ||= cueBox.right > rowBox.right || cueBox.bottom > rowBox.bottom;
						cueOverlapsSheet ||= [...sheet.querySelectorAll('svg path, svg text.abcjs-chord')].some((ink) => {
							const r = ink.getBoundingClientRect();
							return r.left < cueBox.right && r.right > cueBox.left && r.top < cueBox.bottom && r.bottom > cueBox.top;
						});
					}
				} else if (kind === 'play' && preparationAt !== null && preparedForMs === null) {
					preparedForMs = performance.now() - preparationAt;
				}
				showedSheet ||= !!document.querySelector('[data-testid="lead-sheet-row"]');
				await new Promise(requestAnimationFrame);
			}
			return { cues: [...cues], showedSheet, preparedForMs, entranceText, recordedDuringPreparation, cueOverlapsSheet, cueOutsideRow, counts: [...counts] };
		});
		expect(flow.showedSheet).toBe(true);
		expect(flow.cues).not.toContain('listen');
		expect(flow.entranceText.trim()).toMatch(/^Play\s*[1-4]$/);
		expect(flow.entranceText).not.toMatch(/\bRead\b|\bnext\b/i);
		expect(flow.counts).toEqual(expect.arrayContaining(['4', '3', '2', '1']));
		expect(flow.preparedForMs).toBeGreaterThan(4 * 60_000 / FAST_TEMPO);
		expect(flow.preparedForMs).toBeLessThan(2 * 4 * 60_000 / FAST_TEMPO);
		expect(flow.recordedDuringPreparation).toBe(false);
		expect(flow.cueOverlapsSheet).toBe(false);
		expect(flow.cueOutsideRow).toBe(false);
		await page.setViewportSize({ width: 1440, height: 1000 });
		// The chord-only memory turn is already below the current sheet.
		// Measure the sheet being played, not the future memory rows.
		const currentSheet = page.locator('.row.current [data-testid="lead-sheet-row"]');
		await expect(currentSheet).toBeVisible();
		await expect(page.locator('.row.current + .row [data-testid="lead-sheet-row"]')).toHaveCount(0);
		const deepSheet = await currentSheet.evaluate((sheet) => ({
			height: sheet.closest('.row')!.getBoundingClientRect().height,
			noteWidth: sheet.querySelector('.abcjs-notehead')!.getBoundingClientRect().width
		}));
		expect(deepSheet.height).toBeCloseTo(204.8, 1);
		expect(deepSheet.noteWidth).toBeGreaterThan(11);
		// The cue stays a single line at the top-left of the sheet on desktop,
		// preserving the enlarged engraving and the existing row height. The
		// sheet stays up throughout all three passes, so no further count-in
		// comes: measure the Play cue of the take on it.
		const entrance = page.locator('.row.current .phase-tab[data-kind="play"]');
		await expect(entrance).toBeVisible({ timeout: 15_000 });
		const cueGeometry = await entrance.evaluate(tab => {
			const cue = tab.getBoundingClientRect();
			const chart = tab.closest('.chart-wrap')!.getBoundingClientRect();
			return { height: cue.height, top: cue.top - chart.top, left: cue.left - chart.left,
				overlap: [...tab.closest('.chart-wrap')!.querySelectorAll('.lead-sheet svg path, .lead-sheet svg text.abcjs-chord')].some(ink => {
					const r = ink.getBoundingClientRect();
					return r.left < cue.right && r.right > cue.left && r.top < cue.bottom && r.bottom > cue.top;
				}) };
		});
		expect(cueGeometry).toMatchObject({ top: 0, left: 0, overlap: false });
		expect(cueGeometry.height).toBeLessThan(28);
		await expect(page.locator('.chart-wrap.recording')).toBeVisible({ timeout: 15_000 });

		// The next take honors the chord-only memory preview even after a miss.
		// It scrolls into the current slot with its preparation countdown.
		const joined = await page.evaluate(async () => {
			const kinds = new Set<string>();
			/** Record the current row's cue kind each frame while `keepGoing` holds. */
			async function sample(keepGoing: () => boolean): Promise<void> {
				while (keepGoing()) {
					kinds.add(document.querySelector('.row.current .phase-tab')?.getAttribute('data-kind') ?? 'missing');
					await new Promise(requestAnimationFrame);
				}
			}
			const first = document.querySelector('.row.current');
			const deadline = performance.now() + 45_000;
			await sample(() => performance.now() < deadline && document.querySelector('.row.current') === first);
			const next = document.querySelector('.row.current');
			const settle = performance.now() + 500;
			await sample(() => performance.now() < settle);
			return {
				advanced: next !== first,
				sameKey: next?.getAttribute('data-key') === first?.getAttribute('data-key'),
				tagged: !!next?.querySelector('[data-testid="row-tempo"]'),
				sheet: !!next?.querySelector('[data-testid="lead-sheet-row"]'),
				kinds: [...kinds]
			};
		});
		expect(joined).toMatchObject({ advanced: true, sameKey: true, tagged: true, sheet: false });
		expect(joined.kinds).toContain('play-in');
		expect(joined.kinds).not.toContain('read');
		expect(joined.kinds).toContain('play');
		await page.getByRole('button', { name: /end session/i }).click();
		await expect(page.getByText('Session Report', { exact: true })).toBeVisible();
	});

	}
});
