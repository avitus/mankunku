/**
 * Device-upgrade contract for the lead-sheet → tune rename: a browser that
 * last ran the PRE-RENAME build (schema 2, `user-leadsheets` keys, a queued
 * `leadSheets` outbox intent) boots the renamed build and loses NOTHING —
 * the book reads back, the community caches read back, and the queued sync
 * intent drains against the renamed `tunes` table.
 *
 * The persistence layer is imported FRESH (vi.resetModules) after seeding,
 * so the module-eval upgrade in storage.ts runs exactly as it does on a
 * real device's first post-deploy load.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock localStorage (seeded before the fresh module import) ────────────
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => {
		store[key] = value;
	}),
	removeItem: vi.fn((key: string) => {
		delete store[key];
	}),
	clear: vi.fn(() => {
		for (const key of Object.keys(store)) delete store[key];
	}),
	get length() {
		return Object.keys(store).length;
	},
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

import { createCloudState, mockSupabaseFromCloud, peek } from '../helpers/cloud-sync-mocks';
import type { Database } from '$lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

const UID = 'user-x';
const NS = `mankunku:u:${UID}:`;

const SHEET = {
	id: 'sheet-100-abcd',
	title: 'Blue in Green',
	key: 'Bb' as const,
	timeSignature: [4, 4] as [number, number],
	tags: ['ballad'],
	sections: [{ label: 'A', bars: 8, notes: [], harmony: [] }],
	source: 'user'
};

function seedPreRenameDevice(): void {
	store['mankunku:__schema'] = '2';
	store['mankunku:__active'] = JSON.stringify(UID);
	store[`${NS}user-leadsheets`] = JSON.stringify([SHEET]);
	store[`${NS}user-leadsheets-owners`] = JSON.stringify({ [SHEET.id]: UID });
	store[`${NS}user-leadsheets-meta`] = JSON.stringify({ [SHEET.id]: { mtime: 500 } });
	store[`${NS}leadsheet-favorites`] = JSON.stringify(['sheet-9-zzzz']);
	store[`${NS}leadsheet-adoptions`] = JSON.stringify(['sheet-9-zzzz']);
	store[`${NS}leadsheet-adopted-payloads`] = JSON.stringify([
		{ ...SHEET, id: 'sheet-9-zzzz', title: 'Adopted Tune' }
	]);
	store[`${NS}leadsheet-adopted-authors`] = JSON.stringify({
		'sheet-9-zzzz': { authorName: 'Dizzy' }
	});
	// A pending lead-sheet sync intent, queued by the OLD build mid-upgrade.
	store[`${NS}outbox`] = JSON.stringify({
		leadSheets: { kind: 'leadSheets', uid: UID, rev: 2, attempts: 1, nextAttemptAt: 0 }
	});
}

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
	vi.resetModules();
});

describe('pre-rename device boots the renamed build', () => {
	it('the book, community caches, and queued outbox intent all survive', async () => {
		seedPreRenameDevice();

		// Fresh import = first post-deploy load; storage.ts runs the upgrade
		// at module eval, before any consumer reads.
		const userTunes = await import('$lib/persistence/user-tunes');
		const tuneCommunity = await import('$lib/persistence/tune-community');
		const storage = await import('$lib/persistence/storage');

		const sheets = userTunes.getUserTunesLocal();
		expect(sheets).toHaveLength(1);
		expect(sheets[0].id).toBe(SHEET.id);
		expect(sheets[0].title).toBe('Blue in Green');

		expect(Array.from(tuneCommunity.getTuneFavoritesLocal())).toEqual(['sheet-9-zzzz']);
		expect(Array.from(tuneCommunity.getTuneAdoptionsLocal())).toEqual(['sheet-9-zzzz']);
		expect(tuneCommunity.getAdoptedTunesLocal().map((s) => s.title)).toEqual(['Adopted Tune']);
		expect(tuneCommunity.getAdoptedTuneAuthorsLocal()['sheet-9-zzzz']?.authorName).toBe('Dizzy');

		// The queued intent was rewritten, not dropped.
		const outbox = storage.load<Record<string, { kind: string; rev: number }>>('outbox');
		expect(outbox?.leadSheets).toBeUndefined();
		expect(outbox?.tunes).toMatchObject({ kind: 'tunes', rev: 2 });
	});

	it('the rewritten intent drains against the renamed tunes table', async () => {
		seedPreRenameDevice();

		const outboxModule = await import('$lib/persistence/outbox');
		const cloud = createCloudState();
		const supabase = mockSupabaseFromCloud(cloud, {
			auth: { userId: UID }
		}) as SupabaseClient<Database>;

		await outboxModule.drainOutbox(supabase);

		// The queued lead-sheet intent pushed the local book into `tunes`.
		const rows = peek(cloud, 'tunes');
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(SHEET.id);
		expect(rows[0].title).toBe('Blue in Green');

		// Drained — the intent is gone.
		const storage = await import('$lib/persistence/storage');
		const outbox = storage.load<Record<string, unknown>>('outbox');
		expect(outbox?.tunes).toBeUndefined();
	});
});
