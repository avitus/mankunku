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
 *    hooks.client.ts `init` on every page load (`reconcileBeforeHydration`,
 *    before SvelteKit imports any route node) and from `+layout.ts` whenever
 *    the root layout load re-runs client-side (login, auth invalidation).
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
import { clearAllTunePdfs } from './tune-pdf-store';
import type { AuthVerdict } from './auth-verdict';

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

function reloadNow(): void {
	location.reload();
}

/**
 * Reload to re-home the realm onto `target`, guarding against reload loops: if
 * we've already attempted a reload for this exact target in this tab-session,
 * skip it (something is wrong; better to run stale than loop).
 *
 * @param reload - the effect that reloads; `location.reload()` at once unless
 *   a caller defers it (the boot path waits for its document to settle)
 * @returns true when the reload was issued — callers that park the realm until
 *   it lands must not park on a skipped one.
 */
function scheduleReload(target: string, reload: () => void = reloadNow): boolean {
	if (!canReload()) return false;
	try {
		if (typeof sessionStorage !== 'undefined') {
			if (sessionStorage.getItem(RELOAD_GUARD_KEY) === target) return false;
			sessionStorage.setItem(RELOAD_GUARD_KEY, target);
		}
	} catch {
		/* best effort — proceed with reload */
	}
	reload();
	return true;
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
	/** 'reload' means a switch/adoption happened (`reloading` says whether a reload was issued). */
	action: 'none' | 'reload';
	/**
	 * True only when the reload was actually issued. False for 'none', and for a
	 * 'reload' the loop guard declined (the realm was re-homed but will not be
	 * torn down) — the case in which parking the caller would hang it.
	 */
	reloading: boolean;
}

export interface ReconcileOptions {
	/**
	 * The reload effect, called at most once, after the switch is persisted.
	 * Defaults to `location.reload()` at once; the boot path passes one that
	 * waits for its document to settle first.
	 */
	reload?: () => void;
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
export function reconcileActiveUser(
	serverUid: string | null,
	degraded: boolean,
	{ reload }: ReconcileOptions = {}
): ReconcileResult {
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
			return { action: 'reload', reloading: scheduleReload(serverUid, reload) };
		}

		clearReloadGuard();
		return { action: 'none', reloading: false };
	}

	// serverUid is null.
	if (degraded) return { action: 'none', reloading: false };

	if (active !== 'anon') {
		_generation++;
		setActiveUid(null); // → anon
		broadcastUserChanged('anon');
		return { action: 'reload', reloading: scheduleReload('anon', reload) };
	}

	clearReloadGuard();
	return { action: 'none', reloading: false };
}

/**
 * Page-load reconcile, run from hooks.client.ts `init` with the verdict the
 * server wrote into the page head (auth-verdict.ts).
 *
 * Why here and not only in `+layout.ts`: SvelteKit's client `start()` awaits
 * `hooks.init` BEFORE it imports a single route node — the eager root layout /
 * root error imports and `_hydrate`'s branch imports all come after it. A reload
 * decided in the root layout's `load` (itself a route node) fired while those
 * imports were in flight; the reload aborted them, and SvelteKit's error path
 * ran during teardown — Firefox/WebKit page errors, the stale-chunk recovery's
 * probes in hooks.client.ts `handleError`, a root error-page load and a Sentry
 * event per re-home. Deciding here, nothing of the app's is in flight yet.
 *
 * The switch itself (pointer, adoption, cross-tab broadcast) is persisted at
 * once; only the `location.reload()` waits for `whenSettled` — the document
 * finishing what IT started loading (see util/document-settled.ts), so the
 * reload aborts nothing at all. Meanwhile `start()` stays parked on the
 * returned promise: hydration never begins in a realm that is about to be
 * replaced, and nothing in it reads or writes storage.
 *
 * Returns undefined — boot proceeds — when:
 *  - there is no verdict: `+layout.ts` reconciles during hydration instead;
 *  - the reconcile is a no-op (the common case);
 *  - the loop guard declined the reload: the namespace was still re-homed, and
 *    since no state module has read storage yet in this realm (none is in
 *    hooks.client.ts's static import graph), hydrating here reads the right
 *    bucket;
 *  - the reconcile threw: boot must never hang on it, and `+layout.ts` runs
 *    the same reconcile again during hydration.
 * The parked promise resolves (boot proceeds, on the re-homed namespace, for
 * the same reason) only if the deferred `location.reload()` itself throws.
 *
 * @param verdict - the server-verified user and degraded flag, or null when the
 *   page carries none
 * @param whenSettled - called only if a reload is due; the reload waits for the
 *   promise it returns (default: none — reload on the next microtask)
 * @returns a promise that stays pending while the reload lands, else undefined
 */
export function reconcileBeforeHydration(
	verdict: AuthVerdict | null,
	whenSettled?: () => PromiseLike<unknown>
): Promise<void> | undefined {
	if (!verdict) return undefined;
	let resume: () => void = () => {};
	const parked = new Promise<void>((resolve) => {
		resume = resolve;
	});
	const reloadOnceSettled = (): void => {
		Promise.resolve(whenSettled?.())
			.catch(() => undefined)
			.then(reloadNow)
			.catch(() => resume());
	};
	try {
		const { reloading } = reconcileActiveUser(verdict.uid, verdict.degraded, {
			reload: reloadOnceSettled
		});
		return reloading ? parked : undefined;
	} catch {
		return undefined;
	}
}

// ── Explicit data erasure ───────────────────────────────────────────────────

/**
 * Permanently erase one user's data from THIS device: their namespace bucket,
 * their IndexedDB recordings, and the Supabase runtime cache. Used by account
 * deletion and the explicit "clear my data on this device" control. Does not
 * touch other users' buckets. Re-homes to the anon bucket.
 */
export async function wipeUserData(uid: string): Promise<void> {
	const wipingActiveUser = getActiveUid() === uid;
	// Invalidate any in-flight writeback for the wiped user BEFORE re-homing, so
	// a straggling sync/save that resolves after this can't re-persist the
	// deleted data (its generation check now fails). This must happen before
	// setActiveUid(null), or the straggler could copy deleted state into the
	// anon namespace. The caller (account deletion) then navigates away, which
	// tears down the in-memory rune singletons.
	if (wipingActiveUser) {
		_generation++;
		broadcastUserChanged('anon');
	}
	clearNamespace(uid);
	try {
		await clearAllRecordings(uid);
	} catch {
		/* IndexedDB errors must not block deletion */
	}
	try {
		await clearAllTunePdfs(uid);
	} catch {
		/* IndexedDB errors must not block deletion */
	}
	if (typeof caches !== 'undefined') {
		caches.delete(SUPABASE_RUNTIME_CACHE).catch(() => {});
	}
	if (wipingActiveUser) setActiveUid(null);
}
