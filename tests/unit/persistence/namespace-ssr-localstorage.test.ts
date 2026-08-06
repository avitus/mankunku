/**
 * SSR must never *evaluate* the bare `localStorage` global.
 *
 * Recent Node versions install `localStorage` on globalThis as a lazy accessor
 * (present on 26.5.1, absent on 24.3.0). Reading it without `--localstorage-file`
 * resolves to `undefined` AND emits `ExperimentalWarning: localStorage is not
 * available…` — once per process, into the production PM2 log. The guard in
 * namespace.ts must therefore decide "no storage here" WITHOUT touching it.
 *
 * The accessor is synthesised here rather than relying on the host Node, so the
 * regression is caught on any version the suite happens to run under.
 *
 * This file deliberately does NOT install the usual data-property localStorage
 * mock: it reproduces the server shape (no `window`, lazy accessor present).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Reproduce Node 22+'s lazy accessor ───────────────────────────────
// A getter that records access and resolves to undefined, exactly like Node's
// built-in does when --localstorage-file was not provided.
const accessorReads = vi.fn(() => undefined);
Object.defineProperty(globalThis, 'localStorage', {
	get: accessorReads,
	configurable: true
});

import { anonBucketNonEmpty, adoptAnonInto, clearNamespace } from '$lib/persistence/namespace';

beforeEach(() => {
	accessorReads.mockClear();
});

describe('namespace guards under an SSR (Node 22+) runtime', () => {
	it('reports no storage without evaluating the lazy localStorage accessor', () => {
		expect(anonBucketNonEmpty()).toBe(false);
		expect(accessorReads).not.toHaveBeenCalled();
	});

	it('adoptAnonInto short-circuits without evaluating the accessor', () => {
		expect(adoptAnonInto('user-1')).toBe(0);
		expect(accessorReads).not.toHaveBeenCalled();
	});

	it('clearNamespace short-circuits without evaluating the accessor', () => {
		expect(() => clearNamespace('user-1')).not.toThrow();
		expect(accessorReads).not.toHaveBeenCalled();
	});

	it('sanity: `in` alone does not evaluate the accessor', () => {
		expect('localStorage' in globalThis).toBe(true);
		expect(accessorReads).not.toHaveBeenCalled();
	});
});
