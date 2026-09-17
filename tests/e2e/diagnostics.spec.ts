import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * /diagnostics — the saved-recordings inspector. A fresh browser has no
 * recordings in IndexedDB, so the page must come up on its empty state with
 * its controls live: the summary stats, sort/source filters, Refresh, and
 * the link to the backing mixer.
 */

test.describe('diagnostics', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('loads on the empty state with its controls', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/diagnostics');
		await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible();
		await expect(page).toHaveTitle('Diagnostics — Mankunku');

		// Summary: nothing recorded yet, so the score stats are dashes.
		await expect(page.getByText('Recordings', { exact: true })).toBeVisible();
		await expect(page.getByText('showing 0 recordings')).toBeVisible();
		await expect(page.getByText('No saved recordings match the current filters.')).toBeVisible();
		await expect(page.getByText('—', { exact: true })).toHaveCount(2);

		// Filters are real selects with their options.
		const sort = page.getByLabel('Sort');
		await expect(sort).toHaveValue('newest');
		await sort.selectOption('best');
		await expect(sort).toHaveValue('best');
		const source = page.getByLabel('Source');
		await expect(source).toHaveValue('all');
		await source.selectOption('lick-practice');
		await expect(page.getByText('showing 0 recordings')).toBeVisible();

		// Refresh re-reads the store without error; the mixer is a link away.
		await page.getByRole('button', { name: 'Refresh' }).click();
		await expect(page.getByText('showing 0 recordings')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Backing mixer' })).toHaveAttribute(
			'href',
			'/diagnostics/backing-mixer'
		);
	});

	test('replays each recording in its own scoring frame — only ear training is trimmed', async ({
		page,
		browserName
	}) => {
		// Same limit lick-practice-session.spec.ts records: WebKit cannot store a
		// Blob in IndexedDB in Playwright's ephemeral context (the put's
		// transaction aborts), so there is no recording to seed.
		test.skip(browserName === 'webkit', 'WebKit cannot store a Blob in ephemeral IndexedDB');
		await page.goto('/diagnostics');
		await expect(page.getByText('showing 0 recordings')).toBeVisible();

		// The same take saved under both sources: 1.5 s of silence, then a
		// second of C4 — a first note well past the 0.35 s pre-roll, so
		// `trimToPerformance` moves it and a lick-practice window does not.
		await page.evaluate(async () => {
			const rate = 44100;
			const samples = Math.round(2.5 * rate);
			const wav = new DataView(new ArrayBuffer(44 + samples * 2));
			const ascii = (at: number, s: string) => {
				for (let i = 0; i < s.length; i++) wav.setUint8(at + i, s.charCodeAt(i));
			};
			ascii(0, 'RIFF');
			wav.setUint32(4, 36 + samples * 2, true);
			ascii(8, 'WAVE');
			ascii(12, 'fmt ');
			wav.setUint32(16, 16, true);
			wav.setUint16(20, 1, true);
			wav.setUint16(22, 1, true);
			wav.setUint32(24, rate, true);
			wav.setUint32(28, rate * 2, true);
			wav.setUint16(32, 2, true);
			wav.setUint16(34, 16, true);
			ascii(36, 'data');
			wav.setUint32(40, samples * 2, true);
			for (let i = Math.round(1.5 * rate); i < samples; i++) {
				wav.setInt16(44 + i * 2, Math.round(0.5 * 0x7fff * Math.sin((2 * Math.PI * 261.63 * i) / rate)), true);
			}
			const blob = new Blob([wav.buffer], { type: 'audio/wav' });

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
			const record = (sessionId: string, source: string, timestamp: number) => ({
				sessionId,
				blob,
				timestamp,
				metadata: {
					phraseId: 'late-entry',
					phraseName: `Late entry ${source}`,
					source,
					tempo: 120,
					key: 'C',
					swing: 0.5,
					score: null,
					detectedNotes: [],
					backingTrackLog: null,
					bleedFilterLog: null,
					metronomeEnabled: false
				}
			});
			try {
				const tx = db.transaction('recordings', 'readwrite');
				const store = tx.objectStore('recordings');
				store.put(record('late-entry-ear', 'ear-training', Date.now() - 1000));
				store.put(record('late-entry-lick', 'lick-practice', Date.now()));
				await new Promise<void>((resolve, reject) => {
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
				});
			} finally {
				db.close();
			}
		});
		await page.getByRole('button', { name: 'Refresh' }).click();
		await expect(page.getByText('showing 2 recordings')).toBeVisible();

		/** Expand one row and read the replayed duration off its summary line. */
		const replayedSeconds = async (source: string): Promise<number> => {
			await page.getByRole('button', { name: new RegExp(`Late entry ${source}`) }).click();
			const summary = page.getByText(/\d+ readings · \d+ weak · [\d.]+s · \d+ Hz/);
			await expect(summary).toBeVisible();
			const match = (await summary.textContent())?.match(/· ([\d.]+)s ·/);
			return Number(match?.[1]);
		};

		// Lick practice segments its window untrimmed: the whole blob.
		expect(await replayedSeconds('lick-practice')).toBeCloseTo(2.5, 2);
		// Ear training trims the lead-in down to the pre-roll.
		const earSeconds = await replayedSeconds('ear-training');
		expect(earSeconds).toBeGreaterThan(0.5);
		expect(earSeconds).toBeLessThan(2);
	});
});
