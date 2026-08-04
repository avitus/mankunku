/**
 * Unit tests for the hydration handle (src/lib/state/hydration.ts).
 *
 * This module is the contract the cold-load speedup rests on: the root layout
 * registers its background cloud-hydration promise here and snapshotting routes
 * (e.g. /ear-training) opt back in via `awaitHydration()`. The behaviours
 * locked here are: rejections are swallowed (awaiters never throw), and the
 * wait is bounded (slow/offline degrades to local state instead of hanging).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setHydrationPromise, whenHydrated, awaitHydration } from '$lib/state/hydration';

beforeEach(() => {
	// Reset the module-level promise between cases (it persists across tests).
	setHydrationPromise(Promise.resolve());
});

describe('hydration handle', () => {
	it('whenHydrated() tracks a registered promise', async () => {
		let resolve!: () => void;
		const pending = new Promise<void>((r) => {
			resolve = r;
		});
		setHydrationPromise(pending);

		let settled = false;
		const waiter = whenHydrated().then(() => {
			settled = true;
		});
		// Still pending until the registered promise resolves.
		await Promise.resolve();
		expect(settled).toBe(false);

		resolve();
		await waiter;
		expect(settled).toBe(true);
	});

	it('never rejects awaiters even when the registered promise rejects', async () => {
		setHydrationPromise(Promise.reject(new Error('cloud sync blew up')));
		// Both accessors must resolve, not throw.
		await expect(whenHydrated()).resolves.toBeUndefined();
		await expect(awaitHydration()).resolves.toBeUndefined();
	});

	it('awaitHydration() is bounded by the timeout when hydration never settles', async () => {
		vi.useFakeTimers();
		try {
			setHydrationPromise(new Promise<void>(() => {})); // never resolves
			const waiter = awaitHydration(2000);

			let settled = false;
			waiter.then(() => {
				settled = true;
			});

			// Not yet — just shy of the ceiling.
			await vi.advanceTimersByTimeAsync(1999);
			expect(settled).toBe(false);

			// Crossing the ceiling resolves it.
			await vi.advanceTimersByTimeAsync(1);
			await waiter;
			expect(settled).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});
