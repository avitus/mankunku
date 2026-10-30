import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

/**
 * The report's focus drill at its target tempo (Andy, 2026-10-25).
 *
 * Focus takes join on the downbeat with no bar, because the takes still to
 * come are drawn under the current one. The take AT the target used to have
 * nothing under it — the projection listed only the takes needed if every
 * one cleared — so when it missed, the stack emptied and the next take's
 * chart appeared on the downbeat it had to be played on. Twice, after
 * three-pass sheet takes.
 *
 * The lick is saved at 50 BPM, the tempo floor: the drill's 10% ease-in
 * clamps back up to it, so the drill opens AT its target. The mocked mic
 * scores silence, a sub-floor miss whose step down clamps at the floor too,
 * so the next take is the target again. Every sheet triple now commits to
 * a chord-only memory turn, even after silence, with one preparation bar.
 * 50 BPM is slow for real-time playback, but the lick's progression is two
 * bars: about ten seconds a take.
 *
 * One of the lick-practice session specs, cut by subject for CircleCI's
 * file-level test splitting. It seeds its own 50 BPM progress rather than
 * the shared 180 BPM seeds in fixtures/lick-practice-seeds.ts.
 */
const TARGET_TEMPO = 50;

test.describe('lick-practice focus drill at the target', () => {
	test('a sheet triple at the target previews and plays a chord-only memory turn even after a miss', async ({
		page,
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		// Same Tone.start() hang as ear-training on headless Linux Firefox CI.
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		// A Daily round (count-in, demo, three sheet passes) and the drill's
		// opening demo plus three passes, all at 50 BPM, with load headroom.
		test.setTimeout(300_000);

		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		// C is the lick's only unlocked key, under the floor: its rows are lead
		// sheets with three passes, in Daily and in the drill.
		await seedStorage(page, {
			'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] },
			'lick-practice-progress': {
				'e2e-user-lick-bebop': {
					C: { currentTempo: TARGET_TEMPO, lastPracticedAt: 1754000000000, passCount: 0, rollingScore: 0.5 }
				}
			}
		});
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);

		await page.goto('/lick-practice');
		const startBtn = page.getByRole('button', { name: /start daily practice/i });
		await expect(startBtn).toBeEnabled();
		await startBtn.click();

		// The silent Daily take earns the report's focus drill on C.
		await expect(page.getByRole('heading', { name: /session report/i })).toBeVisible({ timeout: 150_000 });
		await page.getByRole('button', { name: /start deep practice/i }).click();
		await expect(page.getByTestId('focus-ramp')).toContainText(
			`${TARGET_TEMPO} → ${TARGET_TEMPO} BPM`,
			{ timeout: 30_000 }
		);
		await expect(page.locator('.chart-wrap.recording')).toBeVisible({ timeout: 60_000 });

		// From the first take's window to just after the next take's downbeat,
		// every frame: the row under the current take is the focus key again,
		// tagged with its tempo and already chord-only. The original incident
		// was that row missing, with the next take drawn only at its downbeat.
		const flow = await page.evaluate(async () => {
			const kinds = new Set<string>();
			let frames = 0;
			let bareFrames = 0;
			let sheetPreviewFrames = 0;
			/** Sample the stack each frame while `keepGoing` holds. */
			async function sample(keepGoing: () => boolean): Promise<void> {
				while (keepGoing()) {
					const current = document.querySelector('.row.current');
					const below = current?.nextElementSibling;
					frames++;
					if (!below || below.getAttribute('data-key') !== current?.getAttribute('data-key') ||
						!below.querySelector('[data-testid="row-tempo"]')) bareFrames++;
					if (below?.querySelector('[data-testid="lead-sheet-row"]')) sheetPreviewFrames++;
					kinds.add(document.querySelector('.row.current .phase-tab')?.getAttribute('data-kind') ?? 'missing');
					await new Promise(requestAnimationFrame);
				}
			}
			const first = document.querySelector('.row.current');
			const deadline = performance.now() + 60_000;
			await sample(() => performance.now() < deadline && document.querySelector('.row.current') === first);
			const next = document.querySelector('.row.current');
			const settle = performance.now() + 500;
			await sample(() => performance.now() < settle);
			return {
				advanced: next !== first,
				sameKey: next?.getAttribute('data-key') === first?.getAttribute('data-key'),
				sheet: !!next?.querySelector('[data-testid="lead-sheet-row"]'),
				tempo: next?.querySelector('[data-testid="row-tempo"]')?.textContent?.trim(),
				frames,
				bareFrames,
				sheetPreviewFrames,
				kinds: [...kinds]
			};
		});
		expect(flow).toMatchObject({
			advanced: true, sameKey: true, sheet: false, tempo: `${TARGET_TEMPO} BPM`, bareFrames: 0, sheetPreviewFrames: 0
		});
		expect(flow.frames).toBeGreaterThan(0);
		// The committed memory turn retains its unscored preparation bar.
		expect(flow.kinds).toContain('play-in');
		expect(flow.kinds).not.toContain('read');
		expect(flow.kinds).toContain('play');
		await expect(page.getByTestId('focus-ramp')).toContainText(`${TARGET_TEMPO} → ${TARGET_TEMPO} BPM`);

		await expect(page.locator('.row.current .chart-wrap.recording')).toBeVisible({ timeout: 15_000 });
		await expect(page.locator('.row.current [data-testid="lead-sheet-row"]')).toHaveCount(0);

		await page.getByRole('button', { name: /end session/i }).click();
		await expect(page.getByText('Session Report', { exact: true })).toBeVisible();
	});
});
