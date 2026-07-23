/**
 * localStorage persistence with type-safe load/save.
 *
 * All keys are prefixed with 'mankunku:' to avoid collisions, and — except for
 * a handful of GLOBAL control keys — namespaced under the active user via
 * `namespace.ts` (`mankunku:u:<uid>:<key>`). This gives each user (and the
 * anonymous bucket) isolated storage on a shared browser, so account switching
 * needs no destructive wipe. See namespace.ts.
 */

import {
	nsKey,
	activeLogicalKey,
	runNamespaceUpgradeIfNeeded,
	isAnonActive,
	markAnonSessionActive
} from './namespace';

const PREFIX = 'mankunku:';

// Ensure the one-time key-namespacing upgrade runs before the first read/write
// in this realm (idempotent, guarded by __schema).
runNamespaceUpgradeIfNeeded();

/**
 * Save a value to the ACTIVE user's namespace as JSON.
 */
export function save<T>(key: string, value: T, syncCallback?: () => void): void {
	try {
		localStorage.setItem(PREFIX + nsKey(key), JSON.stringify(value));
		// First anon write in this tab-session proves authorship of the anon
		// bucket, so a later sign-in may adopt it (namespace.ts trust rule).
		if (isAnonActive()) markAnonSessionActive();
		// Trigger cloud sync callback after successful local save
		if (syncCallback) {
			try {
				syncCallback();
			} catch (err) {
				console.warn(`Sync callback failed for ${key}:`, err);
			}
		}
	} catch (err) {
		console.warn(`Failed to save ${key}:`, err);
	}
}

/**
 * Load a value from the ACTIVE user's namespace. Returns null if not found or invalid.
 */
export function load<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(PREFIX + nsKey(key));
		if (raw === null) return null;
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

/**
 * Remove a value from the ACTIVE user's namespace.
 */
export function remove(key: string): void {
	try {
		localStorage.removeItem(PREFIX + nsKey(key));
	} catch {
		/* best effort */
	}
}

/**
 * List all logical keys in the ACTIVE user's namespace (namespace prefix
 * stripped). Global control keys are NOT included.
 */
export function listKeys(): string[] {
	const keys: string[] = [];
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key?.startsWith(PREFIX)) continue;
			const logical = activeLogicalKey(key.slice(PREFIX.length));
			if (logical !== null) keys.push(logical);
		}
	} catch {
		/* best effort */
	}
	return keys;
}

/**
 * Clear all data in the ACTIVE user's namespace. Does NOT touch other users'
 * buckets or the global control keys (`__active`, `__schema`, `__lastUserId`), so a
 * clear can never strand the pointer or wipe another account.
 */
export function clearAll(): void {
	const keys = listKeys();
	for (const key of keys) {
		remove(key);
	}
}
