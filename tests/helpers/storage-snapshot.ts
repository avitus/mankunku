/**
 * Negative-property assertions for the `mankunku:`-prefixed localStorage
 * surface. Used by user-scope tests to lock in the deliberate scoping of the
 * wipe coordinator: a new `mankunku:foo` cache key added in production must be
 * wiped on user switch / logout, or these helpers fail.
 */

import { expect } from 'vitest';

const PREFIX = 'mankunku:';

/** Read every key in localStorage. Works with both Map-backed and indexed stubs. */
function listAllKeys(storage: Storage): string[] {
	const keys: string[] = [];
	for (let i = 0; i < storage.length; i++) {
		const k = storage.key(i);
		if (k !== null) keys.push(k);
	}
	return keys;
}

/** Filter to keys that carry the mankunku prefix. */
function listMankunkuKeys(storage: Storage): string[] {
	return listAllKeys(storage).filter((k) => k.startsWith(PREFIX));
}

/**
 * Assert that no `mankunku:`-prefixed key remains in localStorage other than
 * the explicitly allowed exceptions. Pass exception keys *without* the prefix
 * — the helper adds it.
 *
 * Use after a logout / user-switch wipe to prove the wipe was complete.
 */
export function expectNoMankunkuKeysExcept(
	storage: Storage,
	exceptions: string[] = []
): void {
	const allowed = new Set(exceptions.map((e) => PREFIX + e));
	const remaining = listMankunkuKeys(storage).filter((k) => !allowed.has(k));
	expect(remaining).toEqual([]);
}

/**
 * Assert that the `mankunku:` surface contains exactly the expected keys.
 * Stricter than `expectNoMankunkuKeysExcept` — fails if any expected key is
 * missing too.
 */
export function expectMankunkuKeys(storage: Storage, expected: string[]): void {
	const actual = listMankunkuKeys(storage)
		.map((k) => k.slice(PREFIX.length))
		.sort();
	expect(actual).toEqual([...expected].sort());
}
