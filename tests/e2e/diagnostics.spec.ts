import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/** Length of the synthesized take the replay test seeds. */
const BLOB_SECONDS = 3.5;

/** The parts of the /diagnostics JSON export the replay tests read. */
interface DiagnosticsExport {
	audio: { duration: number; captureTrimSeconds: number };
	detection: { readings: Array<{ time: number }> };
	captureTiming: { version: number } | null;
	captureAlignment: {
		blobStart: { blobStartOffset: number; matchedFrames: number } | null;
		stampLead: number | null;
		recorderStartEventDelay: number | null;
		gridError: { seconds: number; modBeat: number } | null;
	} | null;
}

/**
 * A mono 16-bit WAV of consecutive sine notes (`[frequency | 0, seconds]`,
 * 0 = silence), as base64 so it crosses into the page intact. Built here
 * rather than in the page because two tests share it.
 */
function wavBase64(segments: Array<[number, number]>, rate = 44100): string {
	const total = segments.reduce((n, [, sec]) => n + Math.round(sec * rate), 0);
	const buf = Buffer.alloc(44 + total * 2);
	buf.write('RIFF', 0, 'ascii');
	buf.writeUInt32LE(36 + total * 2, 4);
	buf.write('WAVE', 8, 'ascii');
	buf.write('fmt ', 12, 'ascii');
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(1, 22);
	buf.writeUInt32LE(rate, 24);
	buf.writeUInt32LE(rate * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36, 'ascii');
	buf.writeUInt32LE(total * 2, 40);
	let i = 0;
	for (const [freq, sec] of segments) {
		const n = Math.round(sec * rate);
		for (let k = 0; k < n; k++, i++) {
			const v = freq > 0 ? Math.round(0.5 * 0x7fff * Math.sin((2 * Math.PI * freq * i) / rate)) : 0;
			buf.writeInt16LE(v, 44 + i * 2);
		}
	}
	return buf.toString('base64');
}

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

	test('replays each recording in its own scoring frame — trim and duration per source', async ({
		page,
		browserName
	}) => {
		// Same limit lick-practice-session.spec.ts records: WebKit cannot store a
		// Blob in IndexedDB in Playwright's ephemeral context (the put's
		// transaction aborts), so there is no recording to seed.
		test.skip(browserName === 'webkit', 'WebKit cannot store a Blob in ephemeral IndexedDB');
		await page.goto('/diagnostics');
		await expect(page.getByText('showing 0 recordings')).toBeVisible();

		// The same take saved under both sources: 1.5 s of silence, a second of
		// C4, then a second of silence. The note starts well past the 0.35 s
		// pre-roll, so `trimToPerformance` moves it and a lick-practice window
		// does not; the trailing silence separates the blob's duration from
		// the one lick practice's close path segments over.
		await page.evaluate(async (blobSeconds) => {
			const rate = 44100;
			const samples = Math.round(blobSeconds * rate);
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
			for (let i = Math.round(1.5 * rate); i < Math.round(2.5 * rate); i++) {
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
		}, BLOB_SECONDS);
		await page.getByRole('button', { name: 'Refresh' }).click();
		await expect(page.getByText('showing 2 recordings')).toBeVisible();

		/** Expand one row and read its diagnostics JSON export. */
		const exportFor = async (source: string): Promise<DiagnosticsExport> => {
			await page.getByRole('button', { name: new RegExp(`Late entry ${source}`) }).click();
			const [download] = await Promise.all([
				page.waitForEvent('download'),
				page.getByRole('button', { name: 'Download diagnostics' }).click()
			]);
			return JSON.parse(readFileSync(await download.path(), 'utf8')) as DiagnosticsExport;
		};

		// Lick practice: untrimmed, over its close path's duration — a tail
		// past the last reading, not the blob's length.
		const lick = await exportFor('lick-practice');
		const lickReadings = lick.detection.readings;
		expect(lick.audio.captureTrimSeconds).toBe(0);
		expect(lickReadings[0].time).toBeGreaterThan(1.2);
		expect(lick.audio.duration).toBeCloseTo(lickReadings[lickReadings.length - 1].time + 0.1, 9);
		expect(lick.audio.duration).toBeLessThan(BLOB_SECONDS - 0.5);

		// Ear training: trimmed to the 0.35 s pre-roll, over the blob's
		// duration less the trim, as its authoritative rescore segments.
		const ear = await exportFor('ear-training');
		expect(ear.audio.captureTrimSeconds).toBeGreaterThan(1);
		expect(ear.detection.readings[0].time).toBeCloseTo(0.35, 9);
		expect(ear.audio.duration).toBeCloseTo(BLOB_SECONDS - ear.audio.captureTrimSeconds, 2);
		// Takes recorded before the capture-timing instrumentation carry none.
		expect(ear.captureTiming).toBeNull();
		expect(ear.captureAlignment).toBeNull();
	});

	/**
	 * The click-grid drift investigation (capture-timing.ts): a take carries the
	 * live detectors' readings on the audio clock from its arm instant, and the
	 * page lines them up against the blob's replay to measure where the blob
	 * starts. Seeded: C4 then E4, with live readings placed as a recording that
	 * began 366 ms after its arm instant would produce, and a stamp 100 ms ahead
	 * of the transport (Tone's lookahead).
	 */
	test('measures where a recording starts from its saved capture timing', async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'WebKit cannot store a Blob in ephemeral IndexedDB');
		await page.goto('/diagnostics');
		await expect(page.getByText('showing 0 recordings')).toBeVisible();

		const OFFSET = 0.366;
		const wav = wavBase64([
			[0, 0.5],
			[261.63, 0.7],
			[329.63, 0.7],
			[0, 0.5]
		]);
		await page.evaluate(
			async ({ wav, offset }) => {
				const bytes = Uint8Array.from(atob(wav), (c) => c.charCodeAt(0));
				const blob = new Blob([bytes], { type: 'audio/wav' });
				// The live detector's frames over the two notes: window centres every
				// 1/60 s, stamped at window END in seconds from the arm instant.
				const liveWindow = 4096 / 48000;
				const liveReadings: Array<[number, number, number]> = [];
				for (let c = 0.55; c < 1.85; c += 1 / 60) {
					liveReadings.push([offset + c + liveWindow / 2, c < 1.2 ? 60 : 64, 0.3]);
				}
				const captureTiming = {
					version: 1,
					arm: {
						contextTime: 20,
						performanceNowMs: 1000,
						transportSeconds: 64.1,
						transportSecondsAtContextTime: 64,
						lookAhead: 0.1,
						sampleRate: 48000,
						liveWindowSeconds: liveWindow,
						baseLatency: null,
						outputLatency: null,
						outputTimestamp: null
					},
					recorder: {
						mimeType: 'audio/webm;codecs=opus',
						startCall: { contextTime: 20, performanceNowMs: 1000.2 },
						startEvent: { contextTime: 20.35, performanceNowMs: 1350 }
					},
					liveOnsets: [],
					liveReadings
				};
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
					const tx = db.transaction('recordings', 'readwrite');
					tx.objectStore('recordings').put({
						sessionId: 'timed-take',
						blob,
						timestamp: Date.now(),
						metadata: {
							phraseId: 'timed',
							phraseName: 'Timed take',
							source: 'ear-training',
							tempo: 100,
							key: 'C',
							swing: 0.5,
							score: null,
							detectedNotes: [],
							backingTrackLog: null,
							bleedFilterLog: null,
							metronomeEnabled: true,
							transportSeconds: 64.1,
							captureTiming
						}
					});
					await new Promise<void>((resolve, reject) => {
						tx.oncomplete = () => resolve();
						tx.onerror = () => reject(tx.error);
					});
				} finally {
					db.close();
				}
			},
			{ wav, offset: OFFSET }
		);
		await page.getByRole('button', { name: 'Refresh' }).click();
		await page.getByRole('button', { name: /Timed take/ }).click();

		const panel = page.getByTestId('capture-alignment');
		await expect(panel).toContainText('Recording starts:');
		await expect(panel).toContainText('after arm');
		await expect(panel).toContainText('Stamp lead: +100 ms');
		await expect(panel).toContainText('start event: +350 ms');

		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('button', { name: 'Download diagnostics' }).click()
		]);
		const exported = JSON.parse(readFileSync(await download.path(), 'utf8')) as DiagnosticsExport;
		expect(exported.captureTiming?.version).toBe(1);
		const a = exported.captureAlignment!;
		expect(a.blobStart!.blobStartOffset).toBeCloseTo(OFFSET, 1);
		expect(Math.abs(a.blobStart!.blobStartOffset - OFFSET)).toBeLessThan(0.02);
		expect(a.stampLead).toBeCloseTo(0.1, 9);
		expect(a.recorderStartEventDelay).toBeCloseTo(0.35, 9);
		// 0.1 − 0.366: the grid would sit 266 ms late, +334 ms modulo the 600 ms beat.
		expect(a.gridError!.seconds).toBeCloseTo(0.1 - a.blobStart!.blobStartOffset, 9);
		expect(a.gridError!.modBeat).toBeCloseTo(0.334, 1);
	});
});
