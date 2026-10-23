import { readFileSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';

/**
 * "Flag Scoring Error" on /progress — the admin's one-click export of a
 * mis-scored take. Until it existed, reporting a bad score meant finding the
 * session here, listening to it, tracking the same take down on /diagnostics
 * and downloading its two files by hand. The button downloads the same pair
 * (`<date>-<slug>.json` + `.wav`, the corpus's own names) from the session
 * row, with two additions the /diagnostics export cannot make: the phrase the
 * session played (a user-written lick lives in no data file) and the note the
 * admin typed about what they heard. Admin-only for now — a player-facing
 * flag is a later step, and it will send this same payload rather than
 * download it.
 */

const ADMIN = { id: '00000000-0000-0000-0000-00000000000a', email: 'owner@mankunku.dev', isAdmin: true };
const SESSION_ID = 'flag-me';
/** 2026-10-17T00:45:32Z, the date in the file names. */
const TIMESTAMP = Date.UTC(2026, 9, 17, 0, 45, 32);
const BLOB_SECONDS = 3.5;
const NOTE = 'the final D split into three notes';

// signedInPage sets its cookie from testUser during FIXTURE SETUP, so the
// admin variant overrides the fixture rather than mutating it mid-test.
const adminTest = test.extend({
	testUser: async ({}, use) => {
		await use(ADMIN);
	}
});

/** The session /progress lists: pfl-035 in concert D, scored "fair". */
function session() {
	return {
		id: SESSION_ID,
		timestamp: TIMESTAMP,
		phraseId: 'pfl-035',
		phraseName: 'Third Walks Back to Root',
		category: 'pentatonic',
		key: 'D',
		source: 'ear-training',
		tempo: 100,
		difficultyLevel: 3,
		pitchAccuracy: 0.667,
		rhythmAccuracy: 0.644,
		overall: 0.657,
		grade: 'fair',
		notesHit: 4,
		notesTotal: 4,
		noteResults: [],
		timing: null
	};
}

async function seedSession(page: Page) {
	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		progress: {
			adaptive: {},
			sessions: [session()],
			categoryProgress: {},
			keyProgress: {},
			scaleProficiency: {},
			keyProficiency: {},
			lickProgress: {},
			totalPracticeTime: 0,
			streakDays: 0,
			lastPracticeDate: ''
		}
	});
}

/**
 * Save the session's recording in the user's IndexedDB bucket: 1.5 s of
 * silence, a second of D3, a second of silence, with the metadata an
 * ear-training take carries. Runs on a loaded page (IndexedDB needs the
 * origin); the page is reloaded afterwards so /progress reads it on mount.
 */
async function seedRecording(page: Page, uid: string) {
	await page.evaluate(
		async ({ uid, sessionId, timestamp, blobSeconds }) => {
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
				wav.setInt16(44 + i * 2, Math.round(0.5 * 0x7fff * Math.sin((2 * Math.PI * 146.83 * i) / rate)), true);
			}
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open(`mankunku-audio:${uid}`, 1);
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
					sessionId,
					// The store's own shape: bytes + MIME type, never a Blob.
					bytes: wav.buffer,
					type: 'audio/wav',
					timestamp,
					metadata: {
						phraseId: 'pfl-035_D',
						phraseName: 'Third Walks Back to Root',
						source: 'ear-training',
						tempo: 100,
						key: 'D',
						swing: 0.6,
						score: null,
						detectedNotes: [],
						backingTrackLog: null,
						bleedFilterLog: null,
						metronomeEnabled: true,
						transportSeconds: 10
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
		{ uid, sessionId: SESSION_ID, timestamp: TIMESTAMP, blobSeconds: BLOB_SECONDS }
	);
	await page.reload();
}

async function expandSession(page: Page) {
	await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
	await page.getByRole('button', { name: /Third Walks Back to Root/ }).click();
	await expect(page.getByRole('button', { name: 'Play Recording' })).toBeVisible();
}

adminTest.describe('progress — Flag Scoring Error', () => {
	adminTest.beforeEach(async ({ signedInPage }) => {
		await seedSession(signedInPage);
		await signedInPage.goto('/progress');
		await seedRecording(signedInPage, ADMIN.id);
		await expandSession(signedInPage);
	});

	adminTest('downloads the corpus pair with the phrase and the admin\'s note', async ({ signedInPage: page }) => {
		await page.getByRole('button', { name: 'Flag Scoring Error' }).click();
		const note = page.getByLabel('What went wrong?');
		await expect(note).toBeVisible();
		await note.fill(NOTE);

		const downloads: Download[] = [];
		page.on('download', (d) => downloads.push(d));
		await page.getByRole('button', { name: 'Download export' }).click();
		await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(2);
		const names = downloads.map((d) => d.suggestedFilename()).sort();
		expect(names).toEqual([
			'2026-10-17-third-walks-back-to-root.json',
			'2026-10-17-third-walks-back-to-root.wav'
		]);
		// The form closes once the files are on their way.
		await expect(note).toHaveCount(0);

		const json = downloads.find((d) => d.suggestedFilename().endsWith('.json'))!;
		const exported = JSON.parse(readFileSync(await json.path(), 'utf8'));
		expect(exported.version).toBe(1);
		expect(exported.flag.note).toBe(NOTE);
		expect(Date.parse(exported.flag.flaggedAt)).toBeGreaterThan(TIMESTAMP);
		// The phrase the session played, in its key.
		expect(exported.phrase.key).toBe('D');
		expect(exported.phrase.notes.map((n: { pitch: number }) => n.pitch)).toEqual([50, 54, 52, 50]);
		// The same replay /diagnostics would export: an ear-training take is
		// trimmed, and the D3 was heard.
		expect(exported.context.phraseId).toBe('pfl-035_D');
		expect(exported.context.transportSeconds).toBeCloseTo(10 + exported.audio.captureTrimSeconds, 9);
		expect(exported.audio.captureTrimSeconds).toBeGreaterThan(1);
		expect(exported.detection.readings.length).toBeGreaterThan(20);
		expect(exported.detection.segmentedNotes.map((n: { midi: number }) => n.midi)).toEqual([50]);

		// The WAV is the untrimmed capture as 16-bit mono.
		const wav = downloads.find((d) => d.suggestedFilename().endsWith('.wav'))!;
		const bytes = readFileSync(await wav.path());
		expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
		expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
		expect(bytes.readUInt16LE(22)).toBe(1);
		expect(bytes.readUInt16LE(34)).toBe(16);
		const rate = bytes.readUInt32LE(24);
		expect(bytes.readUInt32LE(40) / 2 / rate).toBeCloseTo(BLOB_SECONDS, 1);
	});

	adminTest('cancel puts the form away without exporting', async ({ signedInPage: page }) => {
		await page.getByRole('button', { name: 'Flag Scoring Error' }).click();
		await expect(page.getByLabel('What went wrong?')).toBeVisible();
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByLabel('What went wrong?')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Flag Scoring Error' })).toBeVisible();
	});
});

test.describe('progress — Flag Scoring Error is admin-only', () => {
	test('a player sees the playback buttons and no flag', async ({ signedInPage: page, testUser }) => {
		await seedSession(page);
		await page.goto('/progress');
		await seedRecording(page, testUser.id);
		await expandSession(page);
		await expect(page.getByRole('button', { name: 'Play Lick' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Flag Scoring Error' })).toHaveCount(0);
	});
});
