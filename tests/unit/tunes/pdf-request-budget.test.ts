import { expect, it, vi } from 'vitest';
import { withRecognitionDeadline } from '$lib/server/pdf-import/request-budget';
it('cancels in-flight recognition on caller abort and on a whole-stream deadline', async () => {
	vi.useFakeTimers();
	try {
		const parent = new AbortController();
		let seen: AbortSignal | undefined;
		const call = withRecognitionDeadline(
			parent.signal,
			100,
			(signal) =>
				new Promise<void>((resolve) => {
					seen = signal;
					signal.addEventListener('abort', () => resolve());
				})
		);
		parent.abort();
		await call;
		expect(seen?.aborted).toBe(true);
		const timed = withRecognitionDeadline(
			new AbortController().signal,
			100,
			(signal) =>
				new Promise<void>((resolve) => {
					seen = signal;
					signal.addEventListener('abort', () => resolve());
				})
		);
		await vi.advanceTimersByTimeAsync(100);
		await timed;
		expect(seen?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		vi.useRealTimers();
	}
});
