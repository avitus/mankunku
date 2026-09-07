/**
 * The audio mock must outlive the browser's `navigator.mediaDevices` wrapper.
 *
 * WebKit's JS wrapper for MediaDevices is collectable: an override set on the
 * instance from an init script was present right after the script ran and
 * gone by the time the app called getUserMedia (2026-09-07 — a GC in between
 * re-created the wrapper without its expandos), so the app reached the native
 * getUserMedia, which Playwright's WebKit rejects with NotAllowedError, and
 * every WebKit spec that opened a mic failed in CI while Chromium and Firefox
 * stayed green. `installAudioMock` therefore patches `MediaDevices.prototype`.
 * This spec churns the heap after the page loads and checks that the mock —
 * not the native function — still answers, on every engine.
 */
import { test, expect } from './fixtures/test';
import { installAudioMock } from './fixtures/audio';

test('getUserMedia mock survives the browser re-creating navigator.mediaDevices', async ({
	page
}) => {
	await installAudioMock(page);
	await page.goto('/');

	// Twelve rounds of garbage, each released before the next, with a yield
	// between them so the collector can run — the shape that made the
	// instance-level override vanish in WebKit.
	await page.evaluate(async () => {
		for (let round = 0; round < 12; round++) {
			let junk: unknown[] | null = [];
			for (let i = 0; i < 300_000; i++) junk.push({ i, s: 'x'.repeat(16), a: [i] });
			junk = null;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	});

	const result = await page.evaluate(async () => {
		const native = navigator.mediaDevices.getUserMedia.toString().includes('[native code]');
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		return { native, tracks: stream.getAudioTracks().length };
	});
	expect(result.native).toBe(false);
	expect(result.tracks).toBe(1);
});
