import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type ReleaseListener = () => void;

function makeFakeSentinel() {
	const listeners: ReleaseListener[] = [];
	return {
		release: vi.fn(() => Promise.resolve()),
		addEventListener: vi.fn((type: string, listener: ReleaseListener) => {
			if (type === 'release') listeners.push(listener);
		}),
		fireRelease() {
			for (const l of listeners) l();
		}
	};
}

function makeFakeDocument(visibilityState: 'visible' | 'hidden' = 'visible') {
	const listeners = new Map<string, Set<() => void>>();
	return {
		visibilityState,
		addEventListener: vi.fn((type: string, listener: () => void) => {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(listener);
		}),
		removeEventListener: vi.fn((type: string, listener: () => void) => {
			listeners.get(type)?.delete(listener);
		}),
		fireVisibilityChange(state: 'visible' | 'hidden') {
			this.visibilityState = state;
			for (const l of listeners.get('visibilitychange') ?? []) l();
		},
		listenerCount(type: string) {
			return listeners.get(type)?.size ?? 0;
		}
	};
}

async function loadModule() {
	vi.resetModules();
	return await import('$lib/util/wake-lock');
}

describe('screen wake lock', () => {
	let fakeDoc: ReturnType<typeof makeFakeDocument>;

	beforeEach(() => {
		fakeDoc = makeFakeDocument();
		vi.stubGlobal('document', fakeDoc);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('acquire requests a screen wake lock', async () => {
		const sentinel = makeFakeSentinel();
		const request = vi.fn(() => Promise.resolve(sentinel));
		vi.stubGlobal('navigator', { wakeLock: { request } });
		const { acquireScreenWakeLock } = await loadModule();

		await acquireScreenWakeLock();

		expect(request).toHaveBeenCalledWith('screen');
	});

	it('release releases the held sentinel and removes the visibility listener', async () => {
		const sentinel = makeFakeSentinel();
		vi.stubGlobal('navigator', { wakeLock: { request: vi.fn(() => Promise.resolve(sentinel)) } });
		const { acquireScreenWakeLock, releaseScreenWakeLock } = await loadModule();

		await acquireScreenWakeLock();
		releaseScreenWakeLock();

		expect(sentinel.release).toHaveBeenCalled();
		expect(fakeDoc.listenerCount('visibilitychange')).toBe(0);
	});

	it('re-acquires when the tab becomes visible after the browser dropped the lock', async () => {
		const first = makeFakeSentinel();
		const second = makeFakeSentinel();
		const request = vi
			.fn()
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(second);
		vi.stubGlobal('navigator', { wakeLock: { request } });
		const { acquireScreenWakeLock } = await loadModule();

		await acquireScreenWakeLock();
		// Browser auto-releases the lock when the tab is hidden.
		fakeDoc.fireVisibilityChange('hidden');
		first.fireRelease();
		fakeDoc.fireVisibilityChange('visible');
		await Promise.resolve();

		expect(request).toHaveBeenCalledTimes(2);
	});

	it('does not re-request while the current lock is still held', async () => {
		const sentinel = makeFakeSentinel();
		const request = vi.fn(() => Promise.resolve(sentinel));
		vi.stubGlobal('navigator', { wakeLock: { request } });
		const { acquireScreenWakeLock } = await loadModule();

		await acquireScreenWakeLock();
		await acquireScreenWakeLock();
		fakeDoc.fireVisibilityChange('visible');
		await Promise.resolve();

		expect(request).toHaveBeenCalledTimes(1);
	});

	it('does not re-acquire on visibility changes after release', async () => {
		const sentinel = makeFakeSentinel();
		const request = vi.fn(() => Promise.resolve(sentinel));
		vi.stubGlobal('navigator', { wakeLock: { request } });
		const { acquireScreenWakeLock, releaseScreenWakeLock } = await loadModule();

		await acquireScreenWakeLock();
		releaseScreenWakeLock();
		fakeDoc.fireVisibilityChange('hidden');
		fakeDoc.fireVisibilityChange('visible');
		await Promise.resolve();

		expect(request).toHaveBeenCalledTimes(1);
	});

	it('is a silent no-op when the browser has no wake lock support', async () => {
		vi.stubGlobal('navigator', {});
		const { acquireScreenWakeLock, releaseScreenWakeLock } = await loadModule();

		await expect(acquireScreenWakeLock()).resolves.toBeUndefined();
		expect(() => releaseScreenWakeLock()).not.toThrow();
	});

	it('swallows a refused request (battery saver, permissions policy)', async () => {
		const request = vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
		vi.stubGlobal('navigator', { wakeLock: { request } });
		const { acquireScreenWakeLock } = await loadModule();

		await expect(acquireScreenWakeLock()).resolves.toBeUndefined();
	});

	it('releases immediately if released while the request was still in flight', async () => {
		const sentinel = makeFakeSentinel();
		let resolveRequest: (s: unknown) => void = () => {};
		const request = vi.fn(() => new Promise((resolve) => (resolveRequest = resolve)));
		vi.stubGlobal('navigator', { wakeLock: { request } });
		const { acquireScreenWakeLock, releaseScreenWakeLock } = await loadModule();

		const pending = acquireScreenWakeLock();
		releaseScreenWakeLock();
		resolveRequest(sentinel);
		await pending;

		expect(sentinel.release).toHaveBeenCalled();
	});

	it('release without a prior acquire is a no-op', async () => {
		vi.stubGlobal('navigator', {});
		const { releaseScreenWakeLock } = await loadModule();

		expect(() => releaseScreenWakeLock()).not.toThrow();
	});
});
