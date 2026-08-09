/**
 * Per-system transcription orchestration for the PDF import — pure, no DOM,
 * no fetch (the caller supplies `transcribe`), so the flow is Node-testable
 * the way `tune-practice-plan.ts` is.
 *
 * The rule this module exists to enforce: **one system's failure must not
 * cost the systems that succeeded.** The page used to fan out with
 * `Promise.all`, which rejects on the first rejection — a single slow
 * system aborting at its client timeout discarded every completed
 * transcription and restarted on the whole-PDF path, doubling the wait
 * before failing. `assembleClaudeDoc` pads missing bars from geometry and
 * the chords come from the text layer, so a partial run is a usable draft:
 * the failed systems arrive in the editor as empty bars flagged for review,
 * which is where the user was going to check the transcription anyway.
 */

export type SystemStatus = 'pending' | 'running' | 'done' | 'failed';

export interface SystemProgress {
	/** Position in reading order. */
	index: number;
	status: SystemStatus;
	/** Attempts started so far (1-based while running). */
	attempts: number;
	/** Reason the last attempt failed; retained on a system that recovered. */
	error: string | null;
}

export interface RunSystemsOptions<T> {
	/** Number of systems, in reading order. */
	count: number;
	/** Max transcriptions in flight at once. */
	concurrency?: number;
	/** Total attempts per system (1 = no retry). */
	attempts?: number;
	/**
	 * Transcribe one system. Rejecting OR resolving null counts as a failed
	 * attempt. `signal` aborts when the run does.
	 */
	transcribe: (index: number, attempt: number, signal: AbortSignal) => Promise<T | null>;
	/** Fired on every state change, with a fresh snapshot. */
	onProgress?: (progress: SystemProgress[]) => void;
	signal?: AbortSignal;
}

export interface RunSystemsResult<T> {
	/** One slot per system; null where every attempt failed. */
	results: Array<T | null>;
	/** Indices of systems with no result. */
	failed: number[];
	progress: SystemProgress[];
	/** True when the caller aborted before the run finished. */
	aborted: boolean;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_ATTEMPTS = 2;

export async function runSystemTranscriptions<T>({
	count,
	concurrency = DEFAULT_CONCURRENCY,
	attempts = DEFAULT_ATTEMPTS,
	transcribe,
	onProgress,
	signal
}: RunSystemsOptions<T>): Promise<RunSystemsResult<T>> {
	const results: Array<T | null> = new Array(count).fill(null);
	const progress: SystemProgress[] = Array.from({ length: count }, (_, index) => ({
		index,
		status: 'pending' as SystemStatus,
		attempts: 0,
		error: null
	}));

	// One controller for the whole run: aborting it cancels every in-flight
	// transcription, rather than leaving orphaned calls billing away after
	// the caller has given up.
	const controller = new AbortController();
	const onAbort = (): void => controller.abort();
	if (signal) {
		if (signal.aborted) controller.abort();
		else signal.addEventListener('abort', onAbort, { once: true });
	}

	const emit = (): void => onProgress?.(progress.map((p) => ({ ...p })));

	const runOne = async (index: number): Promise<void> => {
		for (let attempt = 1; attempt <= attempts; attempt++) {
			if (controller.signal.aborted) return;
			progress[index].status = 'running';
			progress[index].attempts = attempt;
			emit();
			try {
				const value = await transcribe(index, attempt, controller.signal);
				if (value !== null && value !== undefined) {
					results[index] = value;
					progress[index].status = 'done';
					emit();
					return;
				}
				progress[index].error = 'no transcription returned';
			} catch (err) {
				progress[index].error = err instanceof Error ? err.message : String(err);
			}
			// A run the caller abandoned mid-attempt is not a transcription
			// failure — leave the status alone and stop.
			if (controller.signal.aborted) return;
		}
		progress[index].status = 'failed';
		emit();
	};

	try {
		let next = 0;
		const workers = Array.from({ length: Math.max(0, Math.min(concurrency, count)) }, async () => {
			while (next < count && !controller.signal.aborted) {
				await runOne(next++);
			}
		});
		await Promise.all(workers);
	} finally {
		signal?.removeEventListener('abort', onAbort);
	}

	return {
		results,
		failed: progress.filter((p) => results[p.index] === null).map((p) => p.index),
		progress,
		aborted: controller.signal.aborted
	};
}
