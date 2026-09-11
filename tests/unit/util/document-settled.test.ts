/**
 * `documentSettled` (src/lib/util/document-settled.ts): what a boot-time
 * re-home reload waits for, so it aborts none of the replaced document's
 * loads — the window `load` event, then pending web fonts, capped so a stalled
 * request can't hold the re-home hostage. It must never reject: the reload
 * behind it has to happen either way.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	documentSettled,
	DOCUMENT_SETTLE_CAP_MS,
	type LoadEventSource,
	type SettlingDocument
} from '$lib/util/document-settled';

/** A window stand-in whose `load` the test fires. */
function fakeWindow(): LoadEventSource & { fireLoad: () => void; listeners: number } {
	const listeners: Array<() => void> = [];
	return {
		addEventListener: (_type, listener) => void listeners.push(listener),
		fireLoad: () => listeners.splice(0).forEach((listener) => listener()),
		get listeners() {
			return listeners.length;
		}
	};
}

/** A promise the test resolves or rejects by hand. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
	let resolve: () => void = () => {};
	let reject: (e: unknown) => void = () => {};
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Resolve-state probe: has `p` resolved after the queued work ran? */
async function isDone(p: Promise<void>): Promise<boolean> {
	let done = false;
	void p.then(() => (done = true));
	await vi.advanceTimersByTimeAsync(0);
	return done;
}

afterEach(() => {
	vi.useRealTimers();
});

describe('documentSettled', () => {
	it('waits for the load event, THEN for pending fonts', async () => {
		vi.useFakeTimers();
		const win = fakeWindow();
		const fonts = deferred();
		const doc: SettlingDocument = { readyState: 'interactive', fonts: { ready: fonts.promise } };

		const settled = documentSettled(doc, win);

		expect(await isDone(settled)).toBe(false);
		win.fireLoad();
		expect(await isDone(settled)).toBe(false); // a font is still downloading
		fonts.resolve();
		expect(await isDone(settled)).toBe(true);
	});

	it('does not wait for a load event that already fired', async () => {
		vi.useFakeTimers();
		const win = fakeWindow();

		const settled = documentSettled({ readyState: 'complete', fonts: { ready: Promise.resolve() } }, win);

		expect(await isDone(settled)).toBe(true);
		expect(win.listeners).toBe(0);
	});

	it('settles without a FontFaceSet (older engines)', async () => {
		vi.useFakeTimers();

		expect(await isDone(documentSettled({ readyState: 'complete' }, fakeWindow()))).toBe(true);
	});

	it('settles — never rejects — when the font wait fails', async () => {
		vi.useFakeTimers();
		const fonts = deferred();
		const settled = documentSettled({ readyState: 'complete', fonts: { ready: fonts.promise } }, fakeWindow());

		fonts.reject(new Error('font set broke'));

		expect(await isDone(settled)).toBe(true);
	});

	it('gives up at the cap: a stalled load never holds the re-home hostage', async () => {
		vi.useFakeTimers();
		const settled = documentSettled({ readyState: 'loading' }, fakeWindow(), 1000);

		await vi.advanceTimersByTimeAsync(999);
		expect(await isDone(settled)).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(await isDone(settled)).toBe(true);
	});

	it('clears its cap timer once settled', async () => {
		vi.useFakeTimers();
		await documentSettled({ readyState: 'complete' }, fakeWindow());

		expect(vi.getTimerCount()).toBe(0);
	});

	it('caps at a few seconds by default', () => {
		expect(DOCUMENT_SETTLE_CAP_MS).toBeGreaterThanOrEqual(1000);
		expect(DOCUMENT_SETTLE_CAP_MS).toBeLessThanOrEqual(10_000);
	});
});
