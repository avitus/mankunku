/**
 * Active-user reconciliation and cross-tab coordination.
 *
 * Storage is per-user-namespaced (see namespace.ts), so switching accounts no
 * longer WIPES the previous user's data — it re-homes the browser to a
 * different namespace and reloads so the in-memory rune singletons re-read the
 * correct bucket. This module owns:
 *
 *  - `reconcileActiveUser()` — compares the server-verified user against the
 *    active namespace and switches + reloads on a real change. Called from
 *    `+layout.ts`, replacing the old `syncUserScope()`.
 *  - a monotonic `getScopeGeneration()` counter kept as defense-in-depth for
 *    the existing mid-flight writeback guards across the persistence layer.
 *  - cross-tab propagation (BroadcastChannel + storage-event) so a background
 *    tab re-homes instead of writing the previous user's state under whoever is
 *    now signed in.
 *  - explicit data-erasure helpers for account deletion / "clear my data".
 *
 * A null current user is NEVER treated as a destructive event: a transient auth
 * outage (`degraded`) leaves everything untouched (the class of failure behind
 * the 2026-07-13 incident), and a genuine sign-out merely re-homes to the anon
 * bucket while the user's own bucket survives for instant re-login.
 */
import {
	getActiveUid,
	getActiveUidOrNull,
	setActiveUid,
	adoptAnonInto,
	hasAnonSessionTrust,
	anonBucketNonEmpty,
	clearNamespace
} from './namespace';
import { clearAllRecordings } from './audio-store';

const SUPABASE_RUNTIME_CACHE = 'supabase-api';
const BROADCAST_CHANNEL = 'mankunku:auth';
const RELOAD_GUARD_KEY = 'mankunku:reload-target';

let _generation = 0;

/**
 * Scope generation counter. Bumped on every affirmative user change. Long-running
 * hydration/sync calls capture this at entry and compare before writing back, so
 * an in-flight writeback started under the previous user is abandoned.
 */
export function getScopeGeneration(): number {
	return _generation;
}

/**
 * The last-seen authenticated user ID, or null when anonymous. Used by
 * synchronous write paths (e.g. `saveUserLick` owner-stamping) to attribute
 * records without an async round-trip. Delegates to the namespace's active uid.
 */
export function getLastUserId(): string | null {
	return getActiveUidOrNull();
}

// ── Reload plumbing ─────────────────────────────────────────────────────────

function canReload(): boolean {
	return typeof location !== 'undefined' && typeof location.reload === 'function';
}

/**
 * Reload to re-home the realm onto `target`, guarding against reload loops: if
 * we've already attempted a reload for this exact target in this tab-session,
 * skip it (something is wrong; better to run stale than loop).
 */
function scheduleReload(target: string): void {
	if (!canReload()) return;
	try {
		if (typeof sessionStorage !== 'undefined') {
			if (sessionStorage.getItem(RELOAD_GUARD_KEY) === target) return;
			sessionStorage.setItem(RELOAD_GUARD_KEY, target);
		}
	} catch {
		/* best effort — proceed with reload */
	}
	location.reload();
}

/** Clear the reload guard once we've confirmed we're in the right realm. */
function clearReloadGuard(): void {
	try {
		if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(RELOAD_GUARD_KEY);
	} catch {
		/* best effort */
	}
}

// ── Cross-tab ───────────────────────────────────────────────────────────────

let _channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
	if (_channel) return _channel;
	if (typeof BroadcastChannel === 'undefined') return null;
	try {
		_channel = new BroadcastChannel(BROADCAST_CHANNEL);
	} catch {
		_channel = null;
	}
	return _channel;
}

function broadcastUserChanged(uid: string): void {
	try {
		getChannel()?.postMessage({ type: 'user-changed', uid });
	} catch {
		/* best effort */
	}
}

/**
 * Wire cross-tab account-switch propagation. When another tab switches users,
 * this tab re-homes by reloading (its cookies are already the new user's, so it
 * lands in the correct namespace). Returns a teardown function. Call once from
 * the root layout's onMount (browser only).
 */
export function initCrossTabSync(): () => void {
	const teardown: Array<() => void> = [];

	const ch = getChannel();
	if (ch) {
		const onMessage = (ev: MessageEvent) => {
			const data = ev.data as { type?: string; uid?: string } | null;
			if (data?.type === 'user-changed' && typeof data.uid === 'string') {
				if (getActiveUid() !== data.uid) scheduleReload(data.uid);
			}
		};
		ch.addEventListener('message', onMessage);
		teardown.push(() => ch.removeEventListener('message', onMessage));
	}

	if (typeof window !== 'undefined') {
		const onStorage = (ev: StorageEvent) => {
			// The `__active` pointer changing in another tab signals a switch.
			if (ev.key === 'mankunku:__active' && ev.newValue) {
				let uid: string | null = null;
				try {
					uid = JSON.parse(ev.newValue);
				} catch {
					uid = null;
				}
				if (uid && getActiveUid() !== uid) scheduleReload(uid);
			}
		};
		window.addEventListener('storage', onStorage);
		teardown.push(() => window.removeEventListener('storage', onStorage));
	}

	return () => {
		for (const fn of teardown) fn();
	};
}

// ── Reconciliation ──────────────────────────────────────────────────────────

export interface ReconcileResult {
	/** 'reload' means a switch/adoption happened and a reload was scheduled. */
	action: 'none' | 'reload';
}

/**
 * Reconcile the server-verified user against the active namespace.
 *
 * Rules:
 *  - Verified user present:
 *      · adopt trusted anonymous data into this user's bucket (first login on
 *        any path), then reload so the singletons re-read it;
 *      · if the active namespace differs, switch to it and reload.
 *  - Verified user null + `degraded` (auth server unreachable): DO NOTHING.
 *    A transient outage must never move anyone (the 2026-07-13 failure mode).
 *  - Verified user null + not degraded (genuine sign-out): re-home to the anon
 *    bucket and reload. NO wipe — the user's own bucket survives for re-login.
 *
 * @returns whether a reload was scheduled (caller should skip further hydration).
 */
export function reconcileActiveUser(serverUid: string | null, degraded: boolean): ReconcileResult {
	const active = getActiveUid();

	if (serverUid) {
		let mustReload = false;

		// First login on any path: capture the anon bucket this tab authored.
		if (hasAnonSessionTrust() && anonBucketNonEmpty()) {
			adoptAnonInto(serverUid);
			mustReload = true;
		}

		if (serverUid !== active) {
			setActiveUid(serverUid);
			mustReload = true;
		}

		if (mustReload) {
			_generation++;
			broadcastUserChanged(serverUid);
			scheduleReload(serverUid);
			return { action: 'reload' };
		}

		clearReloadGuard();
		return { action: 'none' };
	}

	// serverUid is null.
	if (degraded) return { action: 'none' };

	if (active !== 'anon') {
		_generation++;
		setActiveUid(null); // → anon
		broadcastUserChanged('anon');
		scheduleReload('anon');
		return { action: 'reload' };
	}

	clearReloadGuard();
	return { action: 'none' };
}

// ── Explicit data erasure ───────────────────────────────────────────────────

/**
 * Permanently erase one user's data from THIS device: their namespace bucket,
 * their IndexedDB recordings, and the Supabase runtime cache. Used by account
 * deletion and the explicit "clear my data on this device" control. Does not
 * touch other users' buckets. Re-homes to the anon bucket.
 */
export async function wipeUserData(uid: string): Promise<void> {
	clearNamespace(uid);
	try {
		await clearAllRecordings(uid);
	} catch {
		/* IndexedDB errors must not block deletion */
	}
	if (typeof caches !== 'undefined') {
		caches.delete(SUPABASE_RUNTIME_CACHE).catch(() => {});
	}
	setActiveUid(null);
}
