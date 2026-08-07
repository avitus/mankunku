/**
 * SSR must never *evaluate* the bare `localStorage` global.
 *
 * Some server runtimes expose `localStorage` on globalThis as a lazy
 * accessor whose evaluation has host-dependent side effects (warnings, or
 * throwing when no backing store is configured). The guard in namespace.ts
 * must therefore decide "no storage here" WITHOUT touching it.
 *
 * The accessor is synthesised here rather than relying on the host, so the
 * regression is caught on any version the suite happens to run under.
 *
 * This file deliberately does NOT install the usual data-property localStorage
 * mock: it reproduces the server shape (no `window`, lazy accessor present).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Synthetic lazy-accessor fixture ──────────────────────────────────
// A getter that records access and resolves to undefined — a stand-in for a
// host-provided lazy accessor, not an exact replica of any Node version's
// implementation. What matters is only that evaluation is observable.
const accessorReads = vi.fn(() => undefined);
Object.defineProperty(globalThis, 'localStorage', {
	get: accessorReads,
	configurable: true
});

import { anonBucketNonEmpty, adoptAnonInto, clearNamespace } from '$lib/persistence/namespace';

beforeEach(() => {
	accessorReads.mockClear();
});

describe('namespace guards under an SSR runtime with a lazy localStorage accessor', () => {
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
