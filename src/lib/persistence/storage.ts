/**
 * localStorage persistence with type-safe load/save.
 *
 * All keys are prefixed with 'mankunku:' to avoid collisions.
 */

const PREFIX = 'mankunku:';

/**
 * Save a value to localStorage as JSON.
 */
export function save<T>(key: string, value: T, syncCallback?: () => void): void {
	try {
		localStorage.setItem(PREFIX + key, JSON.stringify(value));
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
 * Load a value from localStorage. Returns null if not found or invalid.
 */
export function load<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(PREFIX + key);
		if (raw === null) return null;
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

/**
 * Remove a value from localStorage.
 */
export function remove(key: string): void {
	localStorage.removeItem(PREFIX + key);
}

/**
 * List all mankunku keys in localStorage.
 */
export function listKeys(): string[] {
	const keys: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key?.startsWith(PREFIX)) {
			keys.push(key.slice(PREFIX.length));
		}
	}
	return keys;
}

/**
 * Clear all mankunku data from localStorage.
 */
export function clearAll(): void {
	const keys = listKeys();
	for (const key of keys) {
		remove(key);
	}
}
