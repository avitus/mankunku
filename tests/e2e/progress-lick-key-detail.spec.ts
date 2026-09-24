import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import type { Score } from '../../src/lib/types/scoring';
import type { LickPracticeSessionLogEntry } from '../../src/lib/persistence/lick-practice-sessions';

function scoreFor(expected: number, played: number, overall: number): Score {
	return {
		overall,
		grade: overall >= 0.95 ? 'perfect' : 'fair',
		pitchAccuracy: overall,
		rhythmAccuracy: overall,
		notesHit: overall >= 0.95 ? 1 : 0,
		notesTotal: 1,
		noteResults: [{
			expected: { pitch: expected, duration: [1, 1], offset: [0, 1] },
			detected: { midi: played, cents: 0, onsetTime: 0, duration: 0.5, clarity: 1 },
			pitchScore: overall,
			rhythmScore: overall,
			missed: false,
			extra: false
		}],
		timing: {
			meanOffsetMs: 0, medianOffsetMs: 0, stdDevMs: 0,
			latencyCorrectionMs: 0, perNoteOffsetMs: [0]
		}
	};
}

test('lick-practice key chips refresh the score and both note columns', async ({ page }) => {
	const scores = [scoreFor(60, 60, 0.96), scoreFor(65, 64, 0.60), null];
	const keys: LickPracticeSessionLogEntry['report']['licks'][number]['keys'] = [
		{ key: 'C', score: 0.96, pitchAccuracy: 0.96, rhythmAccuracy: 0.96, passed: true, sessionId: 'key-c' },
		{ key: 'F', score: 0.60, pitchAccuracy: 0.60, rhythmAccuracy: 0.60, passed: false, sessionId: 'key-f' },
		{ key: 'Bb', score: 0.50, pitchAccuracy: 0.50, rhythmAccuracy: 0.50, passed: false, sessionId: 'key-bb' }
	];
	const entry: LickPracticeSessionLogEntry = {
		id: 'key-switch-session', timestamp: Date.now(),
		progressionType: 'major-vamp', practiceMode: 'call-response',
		report: {
			licks: [{
				lickId: 'key-switch-lick', lickName: 'Key switch regression',
				tempo: 120, newTempo: null, keys, averageScore: 0.69, passedCount: 1
			}],
			overallAverage: 0.69, totalAttempts: 3, totalPassed: 1, elapsedMinutes: 2
		}
	};
	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		'lick-practice-sessions': [entry]
	});
	await page.goto('/progress');
	await page.evaluate(async ({ keys, scores }) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open('mankunku-audio:anon', 1);
			req.onupgradeneeded = () => {
				if (!req.result.objectStoreNames.contains('recordings')) {
					req.result.createObjectStore('recordings', { keyPath: 'sessionId' });
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(new Error(`Open recordings: ${req.error?.message}`));
		});
		try {
			const tx = db.transaction('recordings', 'readwrite');
			// This view reads metadata only. Omit audio bytes so the fixture also
			// works in WebKit runners that cannot persist Blob/File data.
			keys.forEach((key, i) => tx.objectStore('recordings').put({
				sessionId: key.sessionId,
				timestamp: Date.now(),
				metadata: {
					phraseId: 'key-switch-lick', phraseName: 'Key switch regression',
					source: 'lick-practice', tempo: 120, key: key.key, swing: 0.5,
					score: scores[i], detectedNotes: [], backingTrackLog: null, bleedFilterLog: null
				}
			}));
			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = (event) => reject(new Error(`Seed recordings: ${(event.target as IDBRequest).error?.message ?? tx.error?.message}`));
			});
		} finally {
			db.close();
		}
	}, { keys, scores });
	await page.reload();
	await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
	await page.getByRole('tab', { name: 'Lick Practice', exact: true }).click();
	await page.getByRole('button', { name: /Call & Response/ }).click();
	const card = page.locator('div').filter({ has: page.getByText('Key switch regression', { exact: true }) })
		.filter({ has: page.getByRole('button', { name: 'D 96%', exact: true }) }).last();
	// The detail is the last child of the lick card; percentages in the chips
	// must not accidentally satisfy assertions about the loaded attempt.
	const detail = card.locator(':scope > div').last();
	for (const key of ['D 96%', 'G 60%', 'D 96%', 'G 60%']) {
		await card.getByRole('button', { name: key, exact: true }).click();
		const first = key === 'D 96%';
		await expect(detail.getByText(first ? 'Perfect' : 'Fair', { exact: true })).toBeVisible();
		await expect(detail.getByText(first ? '96%' : '60%', { exact: true })).toHaveCount(5);
		await expect(detail.getByText(first ? '1/1 notes hit' : '0/1 notes hit')).toBeVisible();
		await expect(detail.locator('span.font-mono').filter({ hasText: /^[A-G][#b]?\d$/ }))
			.toHaveText(first ? ['D5', 'D5'] : ['G5', 'F#5']);
	}
	// A record without score metadata must clear the previous attempt, and
	// switching back must recover without collapsing/reopening the card.
	await card.getByRole('button', { name: 'C 50%', exact: true }).click();
	await expect(detail).toContainText('Detail no longer available');
	await expect(detail).not.toContainText('Note Comparison');
	await card.getByRole('button', { name: 'D 96%', exact: true }).click();
	await expect(detail.getByText('Perfect', { exact: true })).toBeVisible();
	await expect(detail.getByText('D5', { exact: true })).toHaveCount(2);
});
