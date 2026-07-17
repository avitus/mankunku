import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { createStubCloud, installStubCloud, type Row, type StubCloud } from './fixtures/stub-cloud';
import type { E2ETestUser } from './fixtures/auth';
import type { Page } from '@playwright/test';

/**
 * Cross-device cloud CONVERGENCE, end-to-end, against the shared in-memory
 * stub-cloud (tests/e2e/fixtures/stub-cloud.ts). Two browser CONTEXTS in one
 * test share ONE `cloud` object living in the Node test process — that shared
 * object is where "device A" and "device B" meet. The app's REAL sync code runs
 * unchanged: progress union merge, user-licks tombstones, and the outbox drain.
 */

const USER: E2ETestUser = { id: 'cccccccc-0000-4000-8000-000000000fff', email: 'converge@e2e.dev' };

// ── Row builders (shaped like the real DB rows — snake_case) ─────────────────

function sessionRow(id: string, timestamp: number): Row {
	return {
		id,
		user_id: USER.id,
		phrase_id: `phrase-${id}`,
		phrase_name: `Phrase ${id}`,
		category: 'ii-V-I-major',
		key: 'C',
		scale_type: 'dorian',
		tempo: 100,
		difficulty_level: 20,
		pitch_accuracy: 0.8,
		rhythm_accuracy: 0.75,
		overall: 0.78,
		grade: 'good',
		notes_hit: 4,
		notes_total: 5,
		note_results: [],
		timing: null,
		timestamp,
		source: 'ear-training'
	};
}

/** A local SessionResult (camelCase) as stored inside the `progress` blob. */
function localSession(id: string, timestamp: number): Row {
	return {
		id,
		timestamp,
		phraseId: `phrase-${id}`,
		phraseName: `Phrase ${id}`,
		category: 'ii-V-I-major',
		key: 'C',
		scaleType: 'dorian',
		source: 'ear-training',
		tempo: 100,
		difficultyLevel: 20,
		pitchAccuracy: 0.8,
		rhythmAccuracy: 0.75,
		overall: 0.78,
		grade: 'good',
		notesHit: 4,
		notesTotal: 5,
		noteResults: [],
		timing: null
	};
}

function progressRow(): Row {
	return {
		user_id: USER.id,
		adaptive_state: {},
		category_progress: {},
		key_progress: {},
		total_practice_time: 0,
		streak_days: 0,
		last_practice_date: '',
		updated_at: new Date().toISOString()
	};
}

/** Read the parsed `progress` blob from the user's namespaced localStorage. */
async function readLocalProgress(page: Page): Promise<{ sessions: Array<{ id: string }> }> {
	const raw = await page.evaluate(
		(uid) => localStorage.getItem(`mankunku:u:${uid}:progress`),
		USER.id
	);
	return raw ? JSON.parse(raw) : { sessions: [] };
}

// ── Scenario 1: Session union across devices ─────────────────────────────────

test('convergence: sessions union across devices (nothing lost, both pushed back)', async ({
	page,
	baseURL,
	consoleCollector: _consoleCollector
}) => {
	const cloud = createStubCloud();
	// Device A already synced: an aggregate progress row + one session.
	cloud.seedRow('user_progress', progressRow());
	cloud.seedRow('session_results', sessionRow('cloud-sess-A', 1_700_000_000_000));

	await installStubCloud(page.context(), cloud, USER, baseURL as string);
	// Device B has a DIFFERENT session locally that the cloud has never seen.
	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		progress: {
			adaptive: {},
			sessions: [localSession('local-sess-B', 1_700_000_500_000)],
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

	await page.goto('/progress');
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(1500); // hydration union + outbox drain

	// (a) Local progress now holds BOTH sessions — the union kept device A's
	//     cloud session AND device B's local session (nothing discarded).
	await expect
		.poll(async () => (await readLocalProgress(page)).sessions.map((s) => s.id).sort(), {
			timeout: 15_000
		})
		.toEqual(['cloud-sess-A', 'local-sess-B']);

	// (b) Device B pushed the union back — the cloud now has BOTH ids too.
	await expect
		.poll(
			() =>
				cloud
					.rows('session_results')
					.map((r) => r.id as string)
					.sort(),
			{ timeout: 15_000 }
		)
		.toEqual(['cloud-sess-A', 'local-sess-B']);
});

// ── Scenario 2: Delete tombstone convergence ─────────────────────────────────

function liveLickRow(): Row {
	return {
		id: 'lick-X',
		user_id: USER.id,
		name: 'Tombstone Target Lick',
		key: 'C',
		time_signature: [4, 4],
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 62, duration: [1, 8], offset: [1, 8] }
		],
		harmony: [
			{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }
		],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
		category: 'bebop-lines',
		tags: [],
		source: 'user-entered',
		favorite_count: 0,
		deleted_at: null,
		client_mtime: 100,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString()
	};
}

/** Minimal console/pageerror guard for contexts not covered by the base fixture. */
function guardConsole(page: Page): { errors: string[] } {
	const errors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
	page.on('pageerror', (err) => errors.push(err.message));
	return { errors };
}

test('convergence: a delete tombstone propagates up and never resurrects', async ({
	page,
	baseURL,
	browser,
	consoleCollector: _consoleCollector
}) => {
	const cloud = createStubCloud();
	// A live cloud lick authored by the user (client_mtime 100, not deleted).
	cloud.seedRow('user_licks', liveLickRow());

	// ── Device B: has a NEWER local tombstone for lick-X, no live copy. ──
	await installStubCloud(page.context(), cloud, USER, baseURL as string);
	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		'user-licks': [],
		'user-licks-meta': { 'lick-X': { mtime: 500, deletedAt: 500 } }
	});

	await page.goto('/library');
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(1500); // hydration reconcile + tombstone push

	// The delete propagated UP: the cloud row now carries a deleted_at tombstone.
	await expect
		.poll(
			() => {
				const row = cloud.rows('user_licks').find((r) => r.id === 'lick-X');
				return row ? row.deleted_at : undefined;
			},
			{ timeout: 15_000 }
		)
		.toBeTruthy();

	// And it is NOT shown as a live lick on device B.
	await expect(page.getByText('Tombstone Target Lick')).toHaveCount(0);

	// ── Device C: fresh, empty local, same shared cloud. ──
	const contextC = await browser.newContext({ baseURL });
	const pageC = await contextC.newPage();
	const guard = guardConsole(pageC);
	try {
		await installStubCloud(contextC, cloud, USER, baseURL as string);
		// Device C holds a STALE LIVE copy of lick-X (older clock than the cloud
		// tombstone at 500), so reconcile must ACTIVELY REMOVE it — a stronger
		// assertion than an empty device merely not adding it back.
		await seedStorage(pageC, {
			settings: SETTINGS_ONBOARDED,
			'tour-state': TOUR_DISMISSED,
			'user-licks': [
				{
					id: 'lick-X',
					name: 'Tombstone Target Lick',
					timeSignature: [4, 4],
					key: 'C',
					notes: [{ pitch: 60, duration: [1, 8], offset: [0, 1] }],
					harmony: [
						{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }
					],
					difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
					category: 'bebop-lines',
					tags: [],
					source: 'user-entered'
				}
			],
			'user-licks-meta': { 'lick-X': { mtime: 50 } }
		});

		await pageC.goto('/library');
		await pageC.waitForLoadState('networkidle');
		await pageC.waitForTimeout(1500);

		// The tombstone propagated DOWN: lick-X never resurrects on a fresh device.
		await expect(pageC.getByText('Tombstone Target Lick')).toHaveCount(0);
		// Local storage did not resurrect it either.
		const localLicks = await pageC.evaluate(
			(uid) => localStorage.getItem(`mankunku:u:${uid}:user-licks`) ?? '[]',
			USER.id
		);
		expect(localLicks).not.toContain('lick-X');

		expect(guard.errors, guard.errors.join('\n')).toEqual([]);
	} finally {
		await contextC.close();
	}
});
