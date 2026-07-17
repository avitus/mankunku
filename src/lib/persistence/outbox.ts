/**
 * Durable, per-user cloud-sync outbox.
 *
 * Replaces the scattered fire-and-forget `.catch(console.warn)` cloud writes.
 * Every mutation writes local-first (unchanged) and then ENQUEUES an intent to
 * sync a given "kind" of state. Intents coalesce by kind (one pending entry per
 * kind, drained against the CURRENT local state), so rapid edits collapse into
 * a single push carrying the latest data.
 *
 * Durability + safety:
 *  - The queue lives in the ACTIVE user's namespace (storage.ts), so it survives
 *    reload / offline / sign-out and drains on the next launch or re-login, and
 *    one user's queue is physically separate from another's.
 *  - `drainOutbox` verifies the authenticated user matches the active namespace
 *    before pushing anything (defense-in-depth), so a queued write can never
 *    land in the wrong account.
 *  - Failed sends stay queued with exponential backoff instead of vanishing into
 *    a console warning; local and cloud can no longer silently diverge.
 *  - A single debounced drain replaces every per-module debounce timer, so there
 *    are no stray timers that could fire an empty blob after a sign-out.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { load, save } from './storage';
import { getActiveUidOrNull } from './namespace';

export type OutboxKind =
	| 'progress'
	| 'lickMeta'
	| 'settings'
	| 'dailySummaries'
	| 'userLicks';

interface OutboxEntry {
	kind: OutboxKind;
	/** uid that enqueued this (defense-in-depth; the namespace already isolates). */
	uid: string;
	attempts: number;
	nextAttemptAt: number;
}

type OutboxMap = Partial<Record<OutboxKind, OutboxEntry>>;

const OUTBOX_KEY = 'outbox';
const DRAIN_DEBOUNCE_MS = 600;
const MAX_BACKOFF_MS = 60_000;

let _supabase: SupabaseClient<Database> | null = null;
let _drainTimer: ReturnType<typeof setTimeout> | null = null;
let _draining = false;

/** Register the Supabase client the debounced drain uses. Set during hydration. */
export function setOutboxClient(supabase: SupabaseClient<Database>): void {
	_supabase = supabase;
}

function loadOutbox(): OutboxMap {
	return load<OutboxMap>(OUTBOX_KEY) ?? {};
}

function saveOutbox(map: OutboxMap): void {
	save(OUTBOX_KEY, map);
}

/**
 * Enqueue an intent to sync `kind`. Coalesces: re-enqueuing a kind that is
 * already pending just resets its backoff. Schedules a debounced drain.
 */
export function enqueue(kind: OutboxKind): void {
	try {
		const map = loadOutbox();
		map[kind] = {
			kind,
			uid: getActiveUidOrNull() ?? 'anon',
			attempts: 0,
			nextAttemptAt: 0
		};
		saveOutbox(map);
	} catch {
		/* best effort — a failed enqueue must never break the local write */
	}
	scheduleDrain();
}

function scheduleDrain(): void {
	if (typeof setTimeout === 'undefined') return;
	if (_drainTimer) clearTimeout(_drainTimer);
	_drainTimer = setTimeout(() => {
		_drainTimer = null;
		if (_supabase) drainOutbox(_supabase).catch(() => {});
	}, DRAIN_DEBOUNCE_MS);
}

function backoff(attempts: number): number {
	return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts);
}

/**
 * Run the sync operation for one kind against the current local state. Throws on
 * failure so the drainer can back off; returns normally on success.
 */
async function runKind(kind: OutboxKind, supabase: SupabaseClient<Database>): Promise<void> {
	switch (kind) {
		case 'progress': {
			const m = await import('$lib/state/progress.svelte');
			await m.flushProgressToCloud(supabase);
			return;
		}
		case 'settings': {
			const m = await import('$lib/state/settings.svelte');
			await m.flushSettingsToCloud(supabase);
			return;
		}
		case 'lickMeta': {
			const m = await import('./lick-practice-store');
			await m.flushLickMetadataToCloud(supabase);
			return;
		}
		case 'userLicks': {
			const m = await import('./user-licks');
			await m.flushUserLicksToCloud(supabase);
			return;
		}
		case 'dailySummaries': {
			const m = await import('$lib/state/history.svelte');
			await m.flushDailySummariesToCloud(supabase);
			return;
		}
	}
}

/**
 * Drain the queue. Verifies the authenticated user matches the active namespace
 * before pushing anything; on mismatch it aborts without touching the queue, so
 * the entries drain later under the correct identity. Failed entries stay queued
 * with exponential backoff.
 */
export async function drainOutbox(supabase: SupabaseClient<Database>): Promise<void> {
	if (_draining) return;
	_draining = true;
	try {
		// Identity gate: the queue is namespaced to a user, but confirm the
		// authenticated session matches before any push.
		let authedUid: string | null = null;
		try {
			const {
				data: { user }
			} = await supabase.auth.getUser();
			authedUid = user?.id ?? null;
		} catch {
			return; // auth unavailable — try again later
		}
		const activeUid = getActiveUidOrNull();
		if (!authedUid || authedUid !== activeUid) return;

		const map = loadOutbox();
		const kinds = Object.keys(map) as OutboxKind[];
		if (kinds.length === 0) return;

		const now = Date.now();
		let changed = false;
		let rescheduleDelay = Infinity;

		for (const kind of kinds) {
			const entry = map[kind];
			if (!entry) continue;
			if (entry.uid !== activeUid) {
				// Stale cross-identity entry (should not happen given namespacing).
				delete map[kind];
				changed = true;
				continue;
			}
			if (entry.nextAttemptAt > now) {
				rescheduleDelay = Math.min(rescheduleDelay, entry.nextAttemptAt - now);
				continue;
			}
			try {
				await runKind(kind, supabase);
				delete map[kind];
				changed = true;
			} catch {
				entry.attempts += 1;
				const delay = backoff(entry.attempts);
				entry.nextAttemptAt = Date.now() + delay;
				rescheduleDelay = Math.min(rescheduleDelay, delay);
				changed = true;
			}
		}

		if (changed) saveOutbox(map);

		// If anything is still queued (backing off), schedule a follow-up drain.
		if (Number.isFinite(rescheduleDelay) && typeof setTimeout !== 'undefined') {
			if (_drainTimer) clearTimeout(_drainTimer);
			_drainTimer = setTimeout(() => {
				_drainTimer = null;
				if (_supabase) drainOutbox(_supabase).catch(() => {});
			}, Math.max(500, rescheduleDelay));
		}
	} finally {
		_draining = false;
	}
}

/**
 * Flush on tab hide / pagehide. Entries are already durable in localStorage, so
 * this is a best-effort network send; anything that doesn't land replays on the
 * next launch.
 */
export async function flushOnHide(supabase: SupabaseClient<Database>): Promise<void> {
	if (_drainTimer) {
		clearTimeout(_drainTimer);
		_drainTimer = null;
	}
	try {
		await drainOutbox(supabase);
	} catch {
		/* best effort */
	}
}

/** Flush using the registered client — used by the sign-out handler. */
export async function flushAllPendingSync(): Promise<void> {
	if (_drainTimer) {
		clearTimeout(_drainTimer);
		_drainTimer = null;
	}
	if (!_supabase) return;
	try {
		await drainOutbox(_supabase);
	} catch {
		/* best effort */
	}
}
