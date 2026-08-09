/**
 * Reading the parse route's heartbeat stream.
 *
 * The point of the stream is that a transcription which is merely SLOW must
 * not look like one that has died. So the client's deadline is an
 * INACTIVITY timeout — silence on the socket — never a total elapsed time:
 * a Fable system call legitimately runs minutes (measured up to 345s on a
 * 4-bar crop), and any fixed total would have to be guessed above a tail
 * the model does not bound.
 */
import { describe, it, expect, vi } from 'vitest';
import { readNdjsonResult } from '$lib/tunes/import/ndjson-result';

/** A Response whose body emits `chunks` with `gapMs` between them. */
function streamed(chunks: string[], gapMs = 0): Response {
	const encoder = new TextEncoder();
	let i = 0;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (i >= chunks.length) {
				controller.close();
				return;
			}
			if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
			controller.enqueue(encoder.encode(chunks[i++]));
		}
	});
	return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
}

describe('readNdjsonResult', () => {
	it('resolves with the terminal result line', async () => {
		const res = streamed([
			'{"type":"progress","elapsedMs":3000}\n',
			'{"type":"result","bars":[1,2],"warnings":[]}\n'
		]);
		await expect(readNdjsonResult(res, { inactivityMs: 1_000 })).resolves.toEqual({
			bars: [1, 2],
			warnings: []
		});
	});

	it('reports every progress line as it arrives', async () => {
		const seen: number[] = [];
		const res = streamed([
			'{"type":"progress","elapsedMs":3000}\n',
			'{"type":"progress","elapsedMs":6000}\n',
			'{"type":"result","bars":[]}\n'
		]);
		await readNdjsonResult(res, {
			inactivityMs: 1_000,
			onProgress: (p) => seen.push(p.elapsedMs ?? 0)
		});
		expect(seen).toEqual([3000, 6000]);
	});

	it('handles a line split across chunk boundaries', async () => {
		const res = streamed(['{"type":"res', 'ult","bars":[7]}', '\n']);
		await expect(readNdjsonResult(res, { inactivityMs: 1_000 })).resolves.toEqual({ bars: [7] });
	});

	it('accepts a final line with no trailing newline', async () => {
		const res = streamed(['{"type":"result","bars":[7]}']);
		await expect(readNdjsonResult(res, { inactivityMs: 1_000 })).resolves.toEqual({ bars: [7] });
	});

	it('throws the server message from an error line', async () => {
		const res = streamed([
			'{"type":"error","status":502,"message":"The system image could not be transcribed (api: overloaded)."}\n'
		]);
		await expect(readNdjsonResult(res, { inactivityMs: 1_000 })).rejects.toThrow(/overloaded/);
	});

	it('throws when the stream ends with no terminal line', async () => {
		const res = streamed(['{"type":"progress","elapsedMs":3000}\n']);
		await expect(readNdjsonResult(res, { inactivityMs: 1_000 })).rejects.toThrow(/ended/i);
	});

	it('tolerates a slow stream so long as it keeps talking', async () => {
		vi.useFakeTimers();
		try {
			const res = streamed(
				[
					'{"type":"progress","elapsedMs":3000}\n',
					'{"type":"progress","elapsedMs":6000}\n',
					'{"type":"progress","elapsedMs":9000}\n',
					'{"type":"result","bars":[1]}\n'
				],
				// Each gap is under the inactivity budget; the TOTAL is well over
				// it. A total-elapsed timeout would kill this healthy stream.
				800
			);
			const promise = readNdjsonResult(res, { inactivityMs: 1_000 });
			await vi.advanceTimersByTimeAsync(5_000);
			await expect(promise).resolves.toEqual({ bars: [1] });
		} finally {
			vi.useRealTimers();
		}
	});

	it('gives up when the socket goes quiet for longer than the budget', async () => {
		vi.useFakeTimers();
		try {
			const res = streamed(['{"type":"progress","elapsedMs":3000}\n', '{"type":"result"}\n'], 5_000);
			const promise = readNdjsonResult(res, { inactivityMs: 1_000 });
			const assertion = expect(promise).rejects.toThrow(/stopped responding/i);
			await vi.advanceTimersByTimeAsync(20_000);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});

	it('stops reading when the caller aborts', async () => {
		const controller = new AbortController();
		const res = streamed(['{"type":"progress","elapsedMs":3000}\n', '{"type":"result"}\n'], 50);
		const promise = readNdjsonResult(res, {
			inactivityMs: 10_000,
			signal: controller.signal
		});
		controller.abort();
		await expect(promise).rejects.toThrow();
	});
});
