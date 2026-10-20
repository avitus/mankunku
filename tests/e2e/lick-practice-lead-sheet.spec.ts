import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage, SAMPLE_USER_LICKS } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';
import { SUB_FLOOR_PROGRESS, LEAD_AHEAD_PROGRESS } from './fixtures/lick-practice-seeds';

/**
 * The lead-sheet row of the key being learned: visible ahead in a taller row,
 * its playhead without canvas measurement, ledger notes and cue at the range
 * extremes, and the three-pass rule (only the final pass persists).
 *
 * One of the lick-practice session specs, cut by subject so CircleCI's
 * file-level test splitting can spread them across nodes; the flow they
 * share and the seeds are described in fixtures/lick-practice-seeds.ts.
 */
test.describe('lick-practice session flow', () => {
	/** Daily and standalone Deep share the same read-ahead, sizing, and continuous sheet entrance. */
	for (const practice of ['daily', 'deep'] as const) {
	test(`${practice} sheet is visible ahead in a taller row and enters without a pause`, async ({ page, browserName }) => {
		test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device');
		test.setTimeout(150_000);
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, {
			'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] },
			...LEAD_AHEAD_PROGRESS
		});
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.goto(practice === 'daily' ? '/lick-practice' : '/licks/e2e-user-lick-bebop');
		await page.getByRole('button', { name: practice === 'daily' ? /start daily practice/i : /^practice$/i }).click();
		const sheet = page.getByTestId('lead-sheet-row');
		await expect(sheet).toBeVisible({ timeout: 20_000 });
		await expect(sheet.locator('.abcjs-notehead').first()).toBeVisible();
		await expect(page.getByTestId('lead-sheet-placeholder')).toHaveCount(0);
		await expect(page.getByText('Changes', { exact: true })).toHaveCount(0);
		const listen = page.locator('.phase-tab[data-kind="listen"]');
		await expect(listen).toBeVisible({ timeout: 60_000 });
		await expect(listen).toHaveText('Listen');
		await expect(listen.locator('.tab-count')).toHaveCount(0);
		await expect.poll(async () => page.locator('.chord-cell.active .scale-125').evaluateAll(dots =>
			dots.some(dot => !['transparent', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(dot).backgroundColor))
		)).toBe(true);

		await expect(page.locator('.phase-tab[data-kind="play-in"]')).toHaveText(/Play\s*[1-4]/);
		const play = page.locator('.phase-tab[data-kind="play"]');
		await expect(play).toHaveText('Play');

		// Observe every rendered frame across C -> Bb, so a brief READ/countdown cannot escape a poll.
		await page.evaluate(() => {
			const samples: string[] = [];
			(window as unknown as { dailyCues: string[] }).dailyCues = samples;
			/** Record the cue tab on every frame until the Bb row's first pass is live. */
			const sample = () => {
				const tab = document.querySelector('.phase-tab');
				samples.push(`${tab?.getAttribute('data-kind')}:${tab?.textContent?.trim()}`);
				if (!document.querySelector('.row[data-key="Bb"].current .phase-tab[data-pass="1"]')) requestAnimationFrame(sample);
			};
			sample();
		});
		const geometry = await sheet.evaluate((lead) => {
			const stack = lead.closest('.stack')!;
			const rows = [...stack.querySelectorAll(':scope > .row')];
			const box = lead.getBoundingClientRect();
			const svg = lead.querySelector('svg')!;
			const ink = [...svg.querySelectorAll('path, text.abcjs-chord')]
				.map((el) => el.getBoundingClientRect());
			const chord = svg.querySelector<SVGTextElement>('text.abcjs-chord')!;
			return {
				heights: rows.map((r) => r.getBoundingClientRect().height),
				inkInside: ink.every((r) => r.top >= box.top && r.bottom <= box.bottom + 1 && r.left >= box.left && r.right <= box.right + 1),
				chordFontPx: Number(chord.getAttribute('font-size')) * chord.getScreenCTM()!.a,
				noteheadWidth: svg.querySelector('.abcjs-notehead')!.getBoundingClientRect().width,
				current: rows.findIndex((r) => r.classList.contains('current'))
			};
		});
		expect(geometry).toMatchObject({ inkInside: true, current: 0 });
		expect(geometry.heights[0]).toBe(128);
		expect(geometry.heights[1]).toBeCloseTo(204.8, 1);
		expect(geometry.chordFontPx).toBeGreaterThan(23);
		// Measure painted notes too: the previous 1,100-unit staff made these
		// only 8px wide even though its oversized chord font passed the check.
		expect(geometry.noteheadWidth).toBeGreaterThan(11);
		// Chord-only cells represent time, independently of the sheet's
		// engraving: two 2-beat chords followed by one 4-beat chord.
		const widths = await page.locator('.chord-cells').first().locator('.chord-cell')
			.evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
		expect(widths).toHaveLength(3);
		expect(Math.abs(widths[0] - widths[1])).toBeLessThan(0.1);
		expect(Math.abs(widths[2] - 2 * widths[0])).toBeLessThan(0.1);

		await page.screenshot({ path: test.info().outputPath('daily-sheet-preview.png') });
		await expect(play).toHaveAttribute('data-pass', '1', { timeout: 15_000 });
		await expect(play).toHaveText('Play · 1/3');
		await expect(sheet.locator('.playhead-under-bar').first()).toBeVisible();
		const markerInside = await sheet.evaluate((lead) => {
			const row = lead.getBoundingClientRect();
			const marker = lead.querySelector('.playhead-under-bar')!.getBoundingClientRect();
			return marker.top >= row.top && marker.bottom <= row.bottom;
		});
		expect(markerInside).toBe(true);
		await expect(page.locator('.row[data-key="Bb"] .chart-wrap.recording')).toBeVisible();
		const cues = await page.evaluate(() => (window as unknown as { dailyCues: string[] }).dailyCues);
		expect(cues.length).toBeGreaterThan(1);
		expect(cues.every((cue) => /^play:Play(?: · 1\/3)?$/.test(cue))).toBe(true);
		await page.screenshot({ path: test.info().outputPath('daily-sheet-playing.png') });
	});
	}

	test('daily sheet keeps its playhead when canvas measurement is unavailable', async ({ page, browserName }) => {
		test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device');
		test.setTimeout(90_000);
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, {
			'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] },
			...SUB_FLOOR_PROGRESS
		});
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.addInitScript(() => {
			const measure = SVGSVGElement.prototype.getBBox;
			SVGSVGElement.prototype.getBBox = function () {
				if (this.closest('[data-testid="lead-sheet-row"]')) {
					throw new DOMException('Canvas measurement unavailable', 'InvalidStateError');
				}
				return measure.call(this);
			};
		});
		await page.goto('/lick-practice');
		await page.getByRole('button', { name: /start daily practice/i }).click();
		const sheet = page.getByTestId('lead-sheet-row');
		await expect(sheet.locator('.abcjs-notehead').first()).toBeVisible();
		// Charts render before sample decoding completes; await audio readiness.
		await expect(page.locator('.phase-tab[data-kind="listen"]')).toBeVisible({ timeout: 60_000 });
		await expect(sheet.locator('.playhead-under-bar').first()).toBeVisible();
	});

	for (const pitch of [45, 78]) {
		test(`daily sheet keeps ledger notes and its cue clear at pitch ${pitch}`, async ({ page, browserName }) => {
			test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
				'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device');
			test.setTimeout(90_000);
			await seedOnboardedAnonymous(page);
			const lick = structuredClone(SAMPLE_USER_LICKS[0]) as { notes: { pitch: number }[] };
			lick.notes.forEach((note, i) => { note.pitch = pitch + i; });
			await seedUserLicks(page, [lick]);
			await seedStorage(page, {
				'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] },
				...SUB_FLOOR_PROGRESS
			});
			await installAudioMock(page);
			await stubCdnInstrumentSamples(page);
			await page.goto('/lick-practice');
			await page.getByRole('button', { name: /start daily practice/i }).click();
			const sheet = page.getByTestId('lead-sheet-row');
			await expect(sheet.locator('.abcjs-notehead').first()).toBeVisible();
			// The prebuilt sheet is visible while the audio is still loading.
			await expect(page.locator('.phase-tab[data-kind="listen"]')).toBeVisible({ timeout: 60_000 });
			for (const width of [1440, 768, 390]) {
				await page.setViewportSize({ width, height: 900 });
				const bounds = await sheet.evaluate((lead) => {
					const box = lead.getBoundingClientRect();
					const cue = lead.closest('.row')!.querySelector('.phase-tab')!.getBoundingClientRect();
					const ink = [...lead.querySelectorAll('svg path, svg text.abcjs-chord')]
						.map((el) => el.getBoundingClientRect());
					return {
						rowHeight: lead.closest('.row')!.getBoundingClientRect().height,
						inside: ink.every((r) => r.top >= box.top && r.bottom <= box.bottom + 1 && r.left >= box.left && r.right <= box.right + 1),
						cueClear: ink.every((r) => r.left >= cue.right || r.right <= cue.left || r.top >= cue.bottom || r.bottom <= cue.top)
					};
				});
				expect(bounds, `viewport ${width}px`).toMatchObject({ inside: true, cueClear: true });
			expect(bounds.rowHeight).toBeCloseTo(204.8, 1);
			}
		});
	}

	/**
	 * A revealed key plays three windows, and only the LAST is the attempt of
	 * record: the two rehearsal passes are scored and flashed, but nothing
	 * about them persists — no per-key progress write (`recordKeyAttempt`), no
	 * session-log attempt, no saved take. A regression here is silent and
	 * compounding: every revealed key would fold three EWMA steps into its
	 * rolling score per session (dragging a struggling key down three times as
	 * fast, so it stays revealed), the session log would count three attempts
	 * where the player made one, and /diagnostics would list orphan takes that
	 * no result references.
	 *
	 * The Daily seed has one key, C, under the floor: count-in, demo, three
	 * passes, report — about a dozen bars at 180 BPM. Every write to the
	 * progress blob is logged in order, so the count of rolling-score updates
	 * does not depend on when it is sampled. The mock recorder hands back a
	 * real WAV, because the default empty blob is never saved and "one saved
	 * take" would be unobservable. The persistence checks are soft: they are
	 * independent facets of the same rule, and a regression that breaks all
	 * of them should say so in one run.
	 */
	test('a revealed key persists only its final pass: one progress update, one logged attempt, one take', async ({
		page,
		browserName
	}) => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		test.setTimeout(150_000);

		const seededRolling = SUB_FLOOR_PROGRESS['lick-practice-progress']['e2e-user-lick-bebop'].C.rollingScore;
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, {
			'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] },
			...SUB_FLOOR_PROGRESS
		});
		await installAudioMock(page, { fixturePath: '2026-07-08-four-to-five.wav' });
		await stubCdnInstrumentSamples(page);
		await page.addInitScript(() => {
			const w = window as unknown as {
				__writes: Array<[string, string]>;
				__recorderStarts: number;
				MediaRecorder: typeof MediaRecorder;
			};
			// The per-key progress blob, and the three blobs an attempt of record
			// writes after it: the session log, the daily summary, the streak.
			const LOGGED = new Set([
				'mankunku:lick-practice-progress',
				'mankunku:lick-practice-sessions',
				'mankunku:daily-summaries',
				'mankunku:progress'
			]);
			const writes: Array<[string, string]> = [];
			w.__writes = writes;
			const setItem = Storage.prototype.setItem;
			Storage.prototype.setItem = function (key: string, value: string): void {
				if (LOGGED.has(key)) writes.push([key, value]);
				setItem.call(this, key, value);
			};
			// Count recorder starts. The mock recorder is installed by another
			// init script, and Playwright leaves the order of init scripts
			// undefined — so wrap whichever constructor is current AND any
			// assigned after this runs.
			w.__recorderStarts = 0;
			/**
			 * Subclass a MediaRecorder constructor so every `start` bumps the
			 * count — applied to the current constructor and, via the setter
			 * below, to any the mock installs after this script.
			 */
			const counting = (Base: typeof MediaRecorder): typeof MediaRecorder =>
				class extends Base {
					/** Count the start, then defer to the wrapped recorder. */
					start(timeslice?: number): void {
						w.__recorderStarts++;
						super.start(timeslice);
					}
				};
			let current = counting(w.MediaRecorder);
			Object.defineProperty(window, 'MediaRecorder', {
				configurable: true,
				get: () => current,
				set: (next: typeof MediaRecorder) => {
					current = counting(next);
				}
			});
		});

		await page.goto('/lick-practice');
		const startBtn = page.getByRole('button', { name: /start daily practice/i });
		await expect(startBtn).toBeEnabled();
		await startBtn.click();
		await expect(page).toHaveURL(/\/lick-practice\/session$/);
		await expect(page.getByTestId('lead-sheet-row')).toHaveCount(1, { timeout: 20_000 });

		// All three windows run: the PLAY tab numbers them. The windows abut, so
		// the tab is the observable, not the recording ring.
		const playTab = page.locator('.phase-tab[data-kind="play"]');
		await expect(playTab).toHaveAttribute('data-pass', '1', { timeout: 90_000 });
		await expect(playTab).toHaveAttribute('data-pass', '2', { timeout: 30_000 });
		await expect(playTab).toHaveAttribute('data-pass', '3', { timeout: 30_000 });
		await expect(page.getByRole('heading', { name: /session report/i })).toBeVisible({
			timeout: 60_000
		});

		// The session log holds ONE attempt for the three windows.
		const sessions = await page.evaluate(
			() => JSON.parse(localStorage.getItem('mankunku:lick-practice-sessions') ?? '[]') as Array<{
				report: { totalAttempts: number; licks: Array<{ keys: Array<{ key: string; sessionId?: string }> }> };
			}>
		);
		expect(sessions).toHaveLength(1);
		const report = sessions[0].report;
		expect.soft(report.totalAttempts, 'attempts in the session log').toBe(1);
		expect.soft(report.licks.flatMap((l) => l.keys.map((k) => k.key))).toEqual(['C']);
		const attemptSessionId = report.licks[0]?.keys[0]?.sessionId;

		// The key's rolling score moved exactly once from its seed. The end-of-
		// lick tempo write re-saves the same value, so updates are counted as
		// changes, not writes; the seed may or may not be in the log (init-
		// script order is Playwright's), which counting from the seed absorbs.
		const writes = await page.evaluate(
			() => (window as unknown as { __writes: Array<[string, string]> }).__writes
		);
		const updateAt: number[] = [];
		let rolling: number | undefined = seededRolling;
		writes.forEach(([key, value], i) => {
			if (key !== 'mankunku:lick-practice-progress') return;
			const next = (JSON.parse(value) as Record<string, Record<string, { rollingScore?: number }>>)[
				'e2e-user-lick-bebop'
			]?.C?.rollingScore;
			if (next !== rolling) updateAt.push(i);
			rolling = next;
		});
		expect.soft(updateAt, 'rolling-score updates to key C').toHaveLength(1);
		// Nothing else about the attempt lands before it either: the session
		// log, the daily summary and the streak are first written by the final
		// pass, after its progress write — a rehearsal pass that bumped the
		// streak would count a practice day with no attempt of record.
		const firstRecordWrite = writes.findIndex(([key]) => key !== 'mankunku:lick-practice-progress');
		expect
			.soft(firstRecordWrite, 'first session-log / summary / streak write, after the progress update')
			.toBeGreaterThan(updateAt[0] ?? Infinity);

		// One take recorded for the three windows: a rehearsal pass starts no
		// recorder at all.
		expect
			.soft(
				await page.evaluate(() => (window as unknown as { __recorderStarts: number }).__recorderStarts),
				'recorders started'
			)
			.toBe(1);

		// ...and the saved take is the attempt the log references. WebKit cannot
		// store a Blob in IndexedDB in Playwright's ephemeral context (the put's
		// transaction aborts; the app warns and keeps going), so no take is
		// ever saved there and the recorder count above is its pin.
		if (browserName === 'webkit') return;
		/**
		 * Session ids of the saved lick-practice takes in the anon audio store.
		 * The probe creates the store if the app has not (same shape as
		 * audio-store.ts), so opening it early can never leave the app a
		 * store-less database.
		 */
		const readTakes = () =>
			page.evaluate(async () => {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const req = indexedDB.open('mankunku-audio:anon', 1);
					req.onupgradeneeded = () => {
						if (!req.result.objectStoreNames.contains('recordings')) {
							req.result.createObjectStore('recordings', { keyPath: 'sessionId' });
						}
					};
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				});
				try {
					const rows = await new Promise<
						Array<{ sessionId: string; blob: Blob; metadata: { source?: string } | null }>
					>((resolve, reject) => {
						const req = db.transaction('recordings', 'readonly').objectStore('recordings').getAll();
						req.onsuccess = () => resolve(req.result);
						req.onerror = () => reject(req.error);
					});
					return rows
						.filter((r) => r.metadata?.source === 'lick-practice' && r.blob.size > 0)
						.map((r) => r.sessionId);
				} finally {
					db.close();
				}
			});
		// Saved asynchronously after the window closes; the rehearsal takes, if
		// any were kept, closed whole passes earlier and are in by then.
		await expect.poll(readTakes, { timeout: 10_000 }).toContain(attemptSessionId);
		expect.soft(await readTakes(), 'saved lick-practice takes').toEqual([attemptSessionId]);

		// The take carries the clock evidence the click-grid investigation reads
		// (capture-timing.ts): the window's open instant with the transport read
		// both ways, the recorder's start call and start event, and the live
		// readings. The mocked recorder fires its start event, so it is present.
		const timing = await page.evaluate(async (id) => {
			if (!id) return null;
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open('mankunku-audio:anon', 1);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
			try {
				const row = await new Promise<{ metadata?: { captureTiming?: unknown } } | undefined>(
					(resolve, reject) => {
						const req = db.transaction('recordings', 'readonly').objectStore('recordings').get(id);
						req.onsuccess = () => resolve(req.result);
						req.onerror = () => reject(req.error);
					}
				);
				return row?.metadata?.captureTiming ?? null;
			} finally {
				db.close();
			}
		}, attemptSessionId);
		const t = timing as {
			version: number;
			arm: { transportSeconds: number; transportSecondsAtContextTime: number | null; lookAhead: number | null; liveWindowSeconds: number };
			recorder: { startCall: { contextTime: number }; startEvent: { contextTime: number } | null } | null;
			liveReadings: unknown[];
			liveOnsets: unknown[];
		} | null;
		expect.soft(t?.version, 'capture timing saved with the take').toBe(1);
		expect.soft(typeof t?.arm.transportSeconds, 'stamped transport position').toBe('number');
		expect.soft(typeof t?.arm.transportSecondsAtContextTime, 'transport position at the audio clock').toBe('number');
		expect.soft(t?.arm.lookAhead, "Tone's lookahead").toBeGreaterThan(0);
		expect.soft(t?.arm.liveWindowSeconds, 'live analyser window').toBeGreaterThan(0.05);
		expect.soft(t?.recorder?.startEvent, 'recorder start event').not.toBeNull();
		expect.soft(Array.isArray(t?.liveReadings), 'live readings').toBe(true);
		expect.soft(Array.isArray(t?.liveOnsets), 'live onsets').toBe(true);
	});
});
