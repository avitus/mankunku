/**
 * Per-system transcription orchestration.
 *
 * The behaviour under test is the one the inline page code got wrong: a
 * single slow or failing system used to reject out of `Promise.all`, throw
 * away every system that HAD succeeded, and restart on the much slower
 * whole-PDF path. `assembleClaudeDoc` already pads missing bars, so a
 * partial transcription is a usable draft — the run must produce one.
 */
import { describe, it, expect, vi } from 'vitest';
import {
	runSystemTranscriptions,
	type SystemProgress
} from '$lib/tunes/import/pdf-import-run';

/** Resolve after `ms` of fake time. */
const later = <T,>(ms: number, value: T): Promise<T> =>
	new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe('runSystemTranscriptions', () => {
	it('returns every system result in reading order', async () => {
		const run = await runSystemTranscriptions<string>({
			count: 4,
			transcribe: async (i) => `sys${i}`
		});
		expect(run.results).toEqual(['sys0', 'sys1', 'sys2', 'sys3']);
		expect(run.failed).toEqual([]);
		expect(run.aborted).toBe(false);
	});

	it('keeps the systems that succeeded when one fails every attempt', async () => {
		const run = await runSystemTranscriptions<string>({
			count: 4,
			attempts: 2,
			transcribe: async (i) => {
				if (i === 2) throw new Error('boom');
				return `sys${i}`;
			}
		});
		expect(run.results).toEqual(['sys0', 'sys1', null, 'sys3']);
		expect(run.failed).toEqual([2]);
	});

	it('treats a null resolution as a failure, not as a result', async () => {
		const run = await runSystemTranscriptions<string>({
			count: 2,
			attempts: 1,
			transcribe: async (i) => (i === 0 ? null : 'sys1')
		});
		expect(run.results).toEqual([null, 'sys1']);
		expect(run.failed).toEqual([0]);
	});

	it('retries a failing system and keeps the later success', async () => {
		const seen: Array<[number, number]> = [];
		const run = await runSystemTranscriptions<string>({
			count: 2,
			attempts: 3,
			transcribe: async (i, attempt) => {
				seen.push([i, attempt]);
				if (i === 1 && attempt < 2) throw new Error('transient');
				return `sys${i}`;
			}
		});
		expect(run.results).toEqual(['sys0', 'sys1']);
		expect(run.failed).toEqual([]);
		expect(seen.filter(([i]) => i === 1)).toEqual([
			[1, 1],
			[1, 2]
		]);
	});

	it('never exceeds the concurrency cap', async () => {
		vi.useFakeTimers();
		let inFlight = 0;
		let peak = 0;
		const promise = runSystemTranscriptions<string>({
			count: 9,
			concurrency: 3,
			transcribe: async (i) => {
				inFlight++;
				peak = Math.max(peak, inFlight);
				await later(10, null);
				inFlight--;
				return `sys${i}`;
			}
		});
		await vi.runAllTimersAsync();
		const run = await promise;
		vi.useRealTimers();
		expect(run.results).toHaveLength(9);
		expect(peak).toBeLessThanOrEqual(3);
	});

	it('reports per-system progress as states change', async () => {
		const snapshots: SystemProgress[][] = [];
		await runSystemTranscriptions<string>({
			count: 2,
			attempts: 2,
			transcribe: async (i, attempt) => {
				if (i === 0 && attempt === 1) throw new Error('nope');
				return `sys${i}`;
			},
			onProgress: (p) => snapshots.push(p.map((s) => ({ ...s })))
		});
		const last = snapshots[snapshots.length - 1];
		expect(last.map((s) => s.status)).toEqual(['done', 'done']);
		expect(last[0].attempts).toBe(2);
		// The retry must be visible while it is happening, not only at the end.
		expect(snapshots.some((s) => s[0].status === 'running' && s[0].attempts === 2)).toBe(true);
	});

	it('stops scheduling new systems once the caller aborts', async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const started: number[] = [];
		const promise = runSystemTranscriptions<string>({
			count: 8,
			concurrency: 2,
			signal: controller.signal,
			transcribe: async (i) => {
				started.push(i);
				await later(10, null);
				return `sys${i}`;
			}
		});
		await vi.advanceTimersByTimeAsync(15);
		controller.abort();
		await vi.runAllTimersAsync();
		const run = await promise;
		vi.useRealTimers();
		expect(run.aborted).toBe(true);
		expect(started.length).toBeLessThan(8);
	});

	it('hands the transcriber a signal that aborts with the run', async () => {
		const controller = new AbortController();
		let observed: AbortSignal | null = null;
		const promise = runSystemTranscriptions<string>({
			count: 1,
			signal: controller.signal,
			transcribe: async (_i, _attempt, signal) => {
				observed = signal;
				controller.abort();
				return 'sys0';
			}
		});
		await promise;
		expect(observed).not.toBeNull();
		expect((observed as unknown as AbortSignal).aborted).toBe(true);
	});

	it('records the failure reason for a system that never succeeded', async () => {
		const run = await runSystemTranscriptions<string>({
			count: 1,
			attempts: 2,
			transcribe: async () => {
				throw new Error('The system image could not be transcribed (api: overloaded).');
			}
		});
		expect(run.progress[0].status).toBe('failed');
		expect(run.progress[0].error).toContain('overloaded');
	});
});
