/**
 * The lick-practice setup screen opens on whichever session type
 * `lickPractice.config` starts in. Daily Practice is the intended front
 * door — it rotates every progression the user has tagged, so it needs no
 * configuration before the first Start. Focused and Deep are opt-in.
 *
 * Own file so the assertion sees the module's pristine initial state: other
 * suites mutate `lickPractice.config` freely, and Vitest isolates module
 * registries per file.
 */

import { describe, it, expect, vi } from 'vitest';
import { lickPractice } from '$lib/state/lick-practice.svelte';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});

describe('lick practice default config', () => {
	it('defaults to the Daily Practice session type', () => {
		expect(lickPractice.config.sessionType).toBe('daily');
	});
});
