/**
 * Per-user storage namespacing.
 *
 * localStorage/sessionStorage/IndexedDB are browser-scoped, not user-scoped.
 * Rather than WIPE the previous user's data on an account switch (the fragile
 * model that caused the 2026-07-13 data-loss incident and could never reset
 * already-evaluated in-memory rune state), every user's data lives under its
 * own key namespace:
 *
 *   mankunku:u:<uid>:<key>    per authenticated user
 *   mankunku:<key>            signed-out / anonymous (the legacy bare path)
 *
 * The anonymous bucket deliberately stays at the BARE legacy path: pre-login
 * data and offline-first anonymous use keep working unchanged (no migration),
 * and only authenticated users get a `u:<uid>:` prefix. Isolation still holds —
 * two authenticated users have distinct prefixes, and an authenticated user's
 * data never collides with the bare anon path.
 *
 * Two GLOBAL control keys sit outside any namespace:
 *
 *   mankunku:__active   JSON "<uid>" | "anon" — which bucket this device homed to
 *   mankunku:__schema   namespace-upgrade version marker
 *
 * The active namespace is resolved ONCE per JS realm, synchronously, so the
 * module-eval `$state(loadX())` singletons in the state modules read the right
 * bucket. Resolution order: (1) the fast, UNVERIFIED auth-cookie uid, (2) the
 * `__active` pointer from the last verified reconcile, (3) `anon`. Cloud writes
 * remain gated on `getUser()` elsewhere, so a mis-parsed cookie can never
 * authorise a wrong-account write — the worst case is one self-correcting
 * reload driven by `reconcileActiveUser`.
 *
 * This module must NOT import `storage.ts` (storage imports this), so it touches
 * localStorage directly for the control keys via the shared ROOT prefix.
 */

/** Must match the PREFIX in storage.ts. Duplicated to avoid a circular import. */
const ROOT = 'mankunku:';

const SCHEMA_KEY = '__schema';
const ACTIVE_KEY = '__active';
const LEGACY_LAST_USER_ID_KEY = '__lastUserId';
const CURRENT_SCHEMA = 2;

const ANON = 'anon';

/** Reserved global control keys — never namespaced, never migrated. */
const CONTROL_KEYS = new Set([SCHEMA_KEY, ACTIVE_KEY, LEGACY_LAST_USER_ID_KEY]);

let _cachedUid: string | null = null;

function hasLocalStorage(): boolean {
	try {
		return typeof localStorage !== 'undefined';
	} catch {
		return false;
	}
}

function rawGet(key: string): string | null {
	try {
		return localStorage.getItem(ROOT + key);
	} catch {
		return null;
	}
}

function rawSet(key: string, value: string): void {
	try {
		localStorage.setItem(ROOT + key, value);
	} catch {
		/* quota / private-mode — best effort */
	}
}

function rawGetJSON<T>(key: string): T | null {
	const raw = rawGet(key);
	if (raw === null) return null;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

/**
 * Extract the authenticated user id from the Supabase auth cookie, best-effort
 * and synchronously. Returns null on any doubt (SSR, missing/garbled cookie).
 *
 * The cookie is `sb-<ref>-auth-token`, optionally chunked (`.0`, `.1`, …), and
 * its value may be `base64-<b64>`. The access token inside is a JWT whose
 * payload carries `sub` = user id; we regex the JWT out of the (possibly
 * base64-decoded) blob and read `sub`. Because a JWT is pure ASCII it survives
 * a Latin-1 `atob` of the surrounding UTF-8 payload intact.
 */
function uidFromCookie(): string | null {
	if (typeof document === 'undefined') return null;
	try {
		const parts = (document.cookie || '').split('; ');
		const chunks: { idx: number; val: string }[] = [];
		for (const p of parts) {
			const eq = p.indexOf('=');
			if (eq < 0) continue;
			const name = p.slice(0, eq);
			const m = name.match(/^sb-.*-auth-token(?:\.(\d+))?$/);
			if (!m) continue;
			chunks.push({ idx: m[1] ? parseInt(m[1], 10) : -1, val: decodeURIComponent(p.slice(eq + 1)) });
		}
		if (chunks.length === 0) return null;
		chunks.sort((a, b) => a.idx - b.idx);
		let raw = chunks.map((c) => c.val).join('');
		if (raw.startsWith('base64-')) {
			try {
				raw = atob(raw.slice('base64-'.length));
			} catch {
				/* keep raw — the JWT may still be findable */
			}
		}
		const jwt = raw.match(/eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/);
		if (jwt) {
			const seg = jwt[1].replace(/-/g, '+').replace(/_/g, '/');
			const payload = JSON.parse(atob(seg + '==='.slice((seg.length + 3) % 4)));
			if (typeof payload?.sub === 'string' && payload.sub) return payload.sub;
		}
		// Fallback: a plain session object with user.id.
		try {
			const obj = JSON.parse(raw) as { user?: { id?: string }; currentSession?: { user?: { id?: string } } };
			const uid = obj?.user?.id ?? obj?.currentSession?.user?.id;
			if (typeof uid === 'string' && uid) return uid;
		} catch {
			/* not JSON — give up */
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * One-time migration of pre-namespace keys (`mankunku:<key>`) into the active
 * user's bucket (`mankunku:u:<uid>:<key>`). Guarded by `__schema`; idempotent
 * and half-run-safe (copy-then-delete per key; `__schema` stamped only after
 * all copies succeed, so a crash simply re-runs).
 */
export function runNamespaceUpgradeIfNeeded(): void {
	if (!hasLocalStorage()) return;
	try {
		if (rawGet(SCHEMA_KEY) === String(CURRENT_SCHEMA)) return;

		const lastUserId = rawGetJSON<string>(LEGACY_LAST_USER_ID_KEY);
		const target = typeof lastUserId === 'string' && lastUserId ? lastUserId : ANON;

		// Snapshot the legacy keys first, then mutate — never iterate a store
		// that is being modified.
		const legacyKeys: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const full = localStorage.key(i);
			if (!full || !full.startsWith(ROOT)) continue;
			const k = full.slice(ROOT.length);
			if (CONTROL_KEYS.has(k) || k.startsWith('u:')) continue;
			legacyKeys.push(k);
		}

		// When the last user was a real account, move the bare legacy keys into
		// their namespace. When there was no marker (anonymous-only device), the
		// bare keys ARE the anon bucket and stay put — no move.
		if (target !== ANON) {
			for (const k of legacyKeys) {
				const val = localStorage.getItem(ROOT + k);
				if (val === null) continue;
				const dest = ROOT + 'u:' + target + ':' + k;
				if (localStorage.getItem(dest) === null) {
					localStorage.setItem(dest, val);
				}
				localStorage.removeItem(ROOT + k);
			}
		}

		rawSet(ACTIVE_KEY, JSON.stringify(target));
		rawSet(SCHEMA_KEY, String(CURRENT_SCHEMA));
		try {
			localStorage.removeItem(ROOT + LEGACY_LAST_USER_ID_KEY);
		} catch {
			/* best effort */
		}
	} catch {
		// Leave __schema unset so the upgrade retries on the next load; the
		// per-key copy is idempotent, so a partial run causes no loss.
	}
}

/** The active namespace uid, resolved once per realm and cached. */
export function getActiveUid(): string {
	if (_cachedUid !== null) return _cachedUid;
	runNamespaceUpgradeIfNeeded();
	const cookieUid = uidFromCookie();
	const pointer = rawGetJSON<string>(ACTIVE_KEY);
	_cachedUid = cookieUid ?? (typeof pointer === 'string' && pointer ? pointer : ANON);
	return _cachedUid;
}

/** The active user id, or null when anonymous (for owner-stamp semantics). */
export function getActiveUidOrNull(): string | null {
	const uid = getActiveUid();
	return uid === ANON ? null : uid;
}

/** Key-prefix segment for the active namespace: `u:<uid>:`, or '' for anon. */
export function getActivePrefix(): string {
	const uid = getActiveUid();
	return uid === ANON ? '' : `u:${uid}:`;
}

/**
 * Does a logical key (already stripped of the `mankunku:` root) belong to the
 * ACTIVE namespace? For anon that's any non-control, non-`u:` bare key; for an
 * authenticated user it's the `u:<uid>:` prefix.
 */
export function activeLogicalKey(rootStripped: string): string | null {
	const uid = getActiveUid();
	if (uid === ANON) {
		if (rootStripped.startsWith('u:') || rootStripped.startsWith('__')) return null;
		return rootStripped;
	}
	const p = `u:${uid}:`;
	return rootStripped.startsWith(p) ? rootStripped.slice(p.length) : null;
}

/** Namespace a logical key: `u:<uid>:<key>` (storage.ts prepends the ROOT). */
export function nsKey(key: string): string {
	return getActivePrefix() + key;
}

/**
 * Set the active namespace (and persist the `__active` pointer). Called by
 * `reconcileActiveUser` after server verification, just before a reload.
 */
export function setActiveUid(uid: string | null): void {
	const norm = uid && uid.length ? uid : ANON;
	_cachedUid = norm;
	rawSet(ACTIVE_KEY, JSON.stringify(norm));
}

/** True when no authenticated user is active (anonymous bucket). */
export function isAnonActive(): boolean {
	return getActiveUid() === ANON;
}

/**
 * Erase one user's entire namespace bucket (all `mankunku:u:<uid>:*` keys).
 * Used by the explicit "clear my data on this device" control and by account
 * deletion. Does NOT touch other users' buckets or the control keys.
 */
export function clearNamespace(uid: string): void {
	if (!hasLocalStorage()) return;
	try {
		const toRemove: string[] = [];
		if (uid === ANON) {
			// Anon = bare keys, excluding control keys and other users' buckets.
			for (let i = 0; i < localStorage.length; i++) {
				const full = localStorage.key(i);
				if (!full || !full.startsWith(ROOT)) continue;
				const k = full.slice(ROOT.length);
				if (CONTROL_KEYS.has(k) || k.startsWith('u:')) continue;
				toRemove.push(full);
			}
		} else {
			const prefix = ROOT + 'u:' + uid + ':';
			for (let i = 0; i < localStorage.length; i++) {
				const full = localStorage.key(i);
				if (full && full.startsWith(prefix)) toRemove.push(full);
			}
		}
		for (const k of toRemove) localStorage.removeItem(k);
	} catch {
		/* best effort */
	}
}

// ── Anonymous-session trust + adoption ──────────────────────────────────────
//
// When an anonymous user signs in, their offline-entered data (in the `anon`
// bucket) should follow them into their account. But a DIFFERENT person's
// leftover anon data must never be adopted. Trust is proven by a per-tab
// sessionStorage token set the first time THIS tab writes anon data — it dies
// with the tab, so a fresh tab (a different person) never inherits it.

const ANON_TRUST_KEY = ROOT + '__anon-session';

function hasSessionStorage(): boolean {
	try {
		return typeof sessionStorage !== 'undefined';
	} catch {
		return false;
	}
}

/** Mark the current tab-session as the author of the anon bucket (idempotent). */
export function markAnonSessionActive(): void {
	if (!hasSessionStorage()) return;
	try {
		if (!sessionStorage.getItem(ANON_TRUST_KEY)) {
			sessionStorage.setItem(ANON_TRUST_KEY, '1');
		}
	} catch {
		/* private-mode — best effort */
	}
}

/** True when this tab-session authored the anon bucket and may adopt it. */
export function hasAnonSessionTrust(): boolean {
	if (!hasSessionStorage()) return false;
	try {
		return sessionStorage.getItem(ANON_TRUST_KEY) === '1';
	} catch {
		return false;
	}
}

function clearAnonSessionTrust(): void {
	if (!hasSessionStorage()) return;
	try {
		sessionStorage.removeItem(ANON_TRUST_KEY);
	} catch {
		/* best effort */
	}
}

/** True when the anonymous (bare-path) bucket holds any user keys. */
export function anonBucketNonEmpty(): boolean {
	if (!hasLocalStorage()) return false;
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const full = localStorage.key(i);
			if (!full || !full.startsWith(ROOT)) continue;
			const k = full.slice(ROOT.length);
			if (CONTROL_KEYS.has(k) || k.startsWith('u:')) continue;
			return true;
		}
	} catch {
		/* best effort */
	}
	return false;
}

/**
 * Adopt the anonymous bucket into user `uid`'s bucket: copy each `u:anon:<key>`
 * to `u:<uid>:<key>` ONLY where the destination is absent (never overwrite the
 * user's real data), then clear the anon bucket and the trust token. Returns the
 * number of keys copied. Idempotent-ish: a second call finds an empty anon
 * bucket and does nothing.
 */
export function adoptAnonInto(uid: string): number {
	if (!hasLocalStorage() || uid === ANON) return 0;
	const destPrefix = ROOT + 'u:' + uid + ':';
	let copied = 0;
	try {
		// Anon = bare keys (excluding control keys and other users' buckets).
		const anonKeys: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const full = localStorage.key(i);
			if (!full || !full.startsWith(ROOT)) continue;
			const k = full.slice(ROOT.length);
			if (CONTROL_KEYS.has(k) || k.startsWith('u:')) continue;
			anonKeys.push(full);
		}
		for (const full of anonKeys) {
			const logical = full.slice(ROOT.length);
			const val = localStorage.getItem(full);
			if (val === null) continue;
			const dest = destPrefix + logical;
			if (localStorage.getItem(dest) === null) {
				localStorage.setItem(dest, val);
				copied++;
			}
			localStorage.removeItem(full);
		}
	} catch {
		/* best effort */
	}
	clearAnonSessionTrust();
	return copied;
}

/** Test-only: reset the cached uid so a test can re-resolve after mutating storage. */
export function __resetNamespaceCacheForTests(): void {
	_cachedUid = null;
}
