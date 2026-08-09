/**
 * Client half of the parse route's heartbeat protocol: read a
 * newline-delimited JSON stream of `progress` lines terminated by exactly
 * one `result` or `error` line.
 *
 * The deadline here is deliberately an INACTIVITY budget rather than a
 * total elapsed time. A system-mode call legitimately runs for minutes —
 * measured 2026-08-09 at 15s to 345s on the SAME 4-bar crop, because Fable
 * decides how long to think — so any total timeout is a guess above a tail
 * the model does not bound, and guessing low is what made a working import
 * look like a broken one. Silence, on the other hand, means something
 * really is wrong: the server heartbeats every few seconds regardless of
 * how deep the model is.
 */

export interface NdjsonProgress {
	/** Time the SERVER has had this call in flight — the authoritative figure. */
	elapsedMs?: number;
	attempt?: number;
}

export interface ReadNdjsonOptions {
	/** Abort if no bytes arrive for this long. */
	inactivityMs: number;
	onProgress?: (progress: NdjsonProgress) => void;
	signal?: AbortSignal;
}

interface TerminalLine {
	type?: string;
	status?: number;
	message?: string;
	[key: string]: unknown;
}

export async function readNdjsonResult<T>(
	response: Response,
	{ inactivityMs, onProgress, signal }: ReadNdjsonOptions
): Promise<T> {
	const body = response.body;
	if (!body) throw new Error('The server sent an empty response.');
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	const handle = (raw: string): T | null => {
		const text = raw.trim();
		if (!text) return null;
		let line: TerminalLine;
		try {
			line = JSON.parse(text) as TerminalLine;
		} catch {
			// A malformed line is not worth failing the whole import over —
			// the terminal line is what matters.
			return null;
		}
		if (line.type === 'progress') {
			onProgress?.(line as NdjsonProgress);
			return null;
		}
		if (line.type === 'error') {
			throw new Error(line.message ?? `Transcription failed (${line.status ?? 500}).`);
		}
		if (line.type === 'result') {
			const { type: _type, ...rest } = line;
			void _type;
			return rest as T;
		}
		return null;
	};

	let timer: ReturnType<typeof setTimeout> | undefined;
	const onAbort = (): void => void reader.cancel().catch(() => undefined);
	signal?.addEventListener('abort', onAbort, { once: true });
	try {
		for (;;) {
			if (signal?.aborted) throw new Error('Import cancelled.');
			// Race the next chunk against the silence budget. The timer is
			// recreated per read, so it measures the GAP, not the total.
			const silence = new Promise<'silent'>((resolve) => {
				timer = setTimeout(() => resolve('silent'), inactivityMs);
			});
			let outcome: ReadableStreamReadResult<Uint8Array> | 'silent';
			try {
				outcome = await Promise.race([reader.read(), silence]);
			} finally {
				clearTimeout(timer);
			}
			if (outcome === 'silent') {
				await reader.cancel().catch(() => undefined);
				throw new Error('The server stopped responding.');
			}
			const { done, value } = outcome;
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let newline = buffer.indexOf('\n');
			while (newline >= 0) {
				const result = handle(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
				if (result !== null) return result;
				newline = buffer.indexOf('\n');
			}
		}
		// A terminal line with no trailing newline is still a terminal line.
		const tail = handle(buffer);
		if (tail !== null) return tail;
		throw new Error('The transcription stream ended before returning a result.');
	} finally {
		signal?.removeEventListener('abort', onAbort);
	}
}
