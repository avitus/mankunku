import { describe, expect, it, vi } from 'vitest';
import { createListeningPlayer, type ListeningPlayerRuntime, type PreparedListeningTake } from '$lib/musicality/listening-player';
import type { BounceParams } from '$lib/audio/backing-bounce';

const params = { tempo: 120, phrase: { timeSignature: [4, 4], harmony: [{ startOffset: [0, 1], duration: [2, 1] }] } } as unknown as BounceParams;
const generated = { bassEvents: [], compEvents: [], drumEvents: [] };
function harness() {
	let now = 10; let tick: (() => void) | undefined;
	const take: PreparedListeningTake = { generated, ppq: 192, startAudioTime: 11, audioNow: () => now, start: vi.fn(), stop: vi.fn() };
	const runtime: ListeningPlayerRuntime = { prepare: vi.fn(async () => take), poll: vi.fn((callback) => { tick = callback; return vi.fn(); }) };
	const onChange = vi.fn(); const player = createListeningPlayer({ onChange }, runtime);
	return { player, runtime, take, onChange, advance(time: number) { now = time; tick?.(); }, tick: () => tick };
}
describe('full-tune listening player', () => {
	it('captures an immutable musicality release with a started take and retains it on stop', async () => {
		const h = harness();
		expect(h.player.snapshot().musicalityRelease).toBeUndefined();
		await h.player.start(params);
		const release = h.player.snapshot().musicalityRelease;
		expect(release).toEqual({ version: '0.2.0', engineRevision: '079b335ec69eb90e9777ea6a8b62e2b188c0d683', status: 'listening-preview' });
		expect(Object.isFrozen(release)).toBe(true);
		h.player.stop();
		expect(h.player.snapshot().musicalityRelease).toBe(release);
		expect(h.player.snapshot().generated).toBe(generated);
	});
	it('clears the previous release when a new take cannot be prepared', async () => {
		const h = harness(); await h.player.start(params);
		expect(h.player.snapshot().musicalityRelease).toBeDefined();
		vi.mocked(h.runtime.prepare).mockRejectedValueOnce(new Error('samples unavailable'));
		await h.player.start(params);
		expect(h.player.snapshot().musicalityRelease).toBeUndefined();
	});
	it('follows the sounding audio clock, waits for the origin, and preserves the exact generated score', async () => {
		const h = harness(); await h.player.start(params);
		expect(h.player.snapshot()).toMatchObject({ status: 'playing', barIndex: null, generated });
		expect(h.player.snapshot().generated).toBe(generated);
		h.advance(12.99); expect(h.player.snapshot().barIndex).toBe(0);
		h.advance(13); expect(h.player.snapshot()).toMatchObject({ barIndex: 1, elapsedBeats: 4 });
		// Wall-clock timer invocations never advance a suspended audio clock.
		h.advance(13); expect(h.player.snapshot().elapsedBeats).toBe(4);
		h.advance(15); expect(h.player.snapshot()).toMatchObject({ status: 'playing', ending: true, elapsedBeats: 8, barIndex: 1 });
		h.advance(17.5); expect(h.player.snapshot().status).toBe('completed');
		expect(h.take.stop).toHaveBeenCalledOnce();
	});
	it('cancels stale loading and never starts its returned take', async () => {
		const h = harness(); let resolve!: (take: PreparedListeningTake) => void;
		vi.mocked(h.runtime.prepare).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
		const pending = h.player.start(params); h.player.stop(); resolve(h.take); await pending;
		expect(h.player.snapshot().status).toBe('stopped'); expect(h.take.start).not.toHaveBeenCalled();
		expect(h.take.stop).toHaveBeenCalledOnce();
	});
	it('ignores stale timer callbacks after replay and disposal', async () => {
		const h = harness(); await h.player.start(params); const oldTick = h.tick();
		h.player.stop(); await h.player.start(params); const count = h.onChange.mock.calls.length;
		oldTick?.(); expect(h.onChange).toHaveBeenCalledTimes(count);
		h.player.dispose(); const disposedCount = h.onChange.mock.calls.length;
		h.advance(30); expect(h.onChange).toHaveBeenCalledTimes(disposedCount);
		await h.player.start(params); expect(h.onChange).toHaveBeenCalledTimes(disposedCount);
	});
	it('captures settings and disposes a superseded prepared take without touching the newer one', async () => {
		const h = harness(); let resolveA!: (take: PreparedListeningTake) => void;
		const takeA = { ...h.take, start: vi.fn(), stop: vi.fn() };
		const takeB = { ...h.take, start: vi.fn(), stop: vi.fn() };
		vi.mocked(h.runtime.prepare).mockImplementationOnce(() => new Promise((r) => { resolveA = r; }));
		vi.mocked(h.runtime.prepare).mockResolvedValueOnce(takeB);
		const input = structuredClone(params);
		const pendingA = h.player.start(input);
		await h.player.start(input);
		input.tempo = 240;
		input.phrase.harmony[0].duration = [8, 1];
		resolveA(takeA); await pendingA;
		expect(takeA.start).not.toHaveBeenCalled(); expect(takeA.stop).toHaveBeenCalledOnce();
		expect(takeB.start).toHaveBeenCalledOnce(); expect(takeB.stop).not.toHaveBeenCalled();
		expect(h.player.snapshot().params?.tempo).toBe(120);
		h.advance(13); expect(h.player.snapshot()).toMatchObject({ barIndex: 1, durationBeats: 8 });
		h.player.dispose(); h.player.dispose(); expect(takeB.stop).toHaveBeenCalledOnce();
	});
	it('reports current failures but suppresses failures from cancelled work', async () => {
		const h = harness(); vi.mocked(h.runtime.prepare).mockRejectedValueOnce(new Error('samples unavailable'));
		await h.player.start(params); expect(h.player.snapshot()).toMatchObject({ status: 'error', error: 'samples unavailable' });
		let reject!: (e: Error) => void;
		vi.mocked(h.runtime.prepare).mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
		const pending = h.player.start(params); h.player.stop(); reject(new Error('obsolete')); await pending;
		expect(h.player.snapshot()).toMatchObject({ status: 'stopped', error: null });
	});
});

describe('progressive causal listening takes', () => {
	function rollingHarness() {
		const h = harness();
		let progress = {
			generated: { bassEvents: [], compEvents: [{ time: '0i', absBeat: 0, notes: [60, 64, 67], duration: .5, velocity: 60 }], drumEvents: [] },
			provenance: { engine: 'causal-rolling', sessionId: 'take-1', fingerprint: 'policy-1', totalBars: 2, committedBars: 1,
				committedThroughTick: 768, sessionStatus: 'running', dispatches: [{ tick: 0, audioTime: 11, status: 'scheduled' }] }, error: null as string | null
		};
		Object.assign(h.take, { progress: () => progress });
		return { ...h, get progress() { return progress; }, update(next: typeof progress) { progress = next; } };
	}
	it('publishes new committed prefixes without rewriting a prior snapshot or showing the lookahead bar', async () => {
		const h = rollingHarness(); await h.player.start(params);
		const first = h.player.snapshot();
		expect(first.generated).toBe(h.progress.generated);
		expect(first.barIndex).toBeNull();
		const next = structuredClone(h.progress);
		next.generated.compEvents.push({ time: '768i', absBeat: 4, notes: [62, 65, 69], duration: .5, velocity: 60 });
		Object.assign(next.provenance, { committedBars: 2, committedThroughTick: 1536 });
		next.provenance.dispatches.push({ tick: 768, audioTime: 13, status: 'scheduled' });
		h.update(next); h.advance(12);
		expect(h.player.snapshot().generated).toBe(next.generated);
		expect(h.player.snapshot().barIndex).toBe(0);
		expect(first.generated!.compEvents).toHaveLength(1);
		expect(first.provenance?.committedBars).toBe(1);
	});
	it('requires committed extent and successful dispatches as well as the tail before completion', async () => {
		const h = rollingHarness(); await h.player.start(params);
		h.advance(17.5);
		expect(h.player.snapshot().status).toBe('playing');
		h.progress.provenance.sessionStatus = 'complete';
		h.advance(18);
		expect(h.player.snapshot().status).toBe('error');
		expect(h.player.snapshot().error).toMatch(/incomplete/i);
	});
	it('completes only a fully played committed take after the release tail', async () => {
		const h = rollingHarness();
		Object.assign(h.progress.provenance, { committedBars: 2, committedThroughTick: 1536, sessionStatus: 'complete' });
		h.progress.provenance.dispatches[0].status = 'played';
		await h.player.start(params);
		h.advance(15); expect(h.player.snapshot()).toMatchObject({ status: 'playing', ending: true });
		h.advance(17.49); expect(h.player.snapshot().status).toBe('playing');
		h.advance(17.5); expect(h.player.snapshot().status).toBe('completed');
		expect(h.take.stop).toHaveBeenCalledOnce();
	});
	it.each(['failed', 'stopped'] as const)('surfaces %s scheduling without presenting a partial take as complete', async sessionStatus => {
		const h = rollingHarness(); await h.player.start(params);
		Object.assign(h.progress.provenance, { sessionStatus }); h.progress.error = 'Audio scheduling fell behind';
		h.advance(18);
		expect(h.player.snapshot()).toMatchObject({ status: 'error', error: 'Audio scheduling fell behind' });
		expect(h.player.snapshot().generated).toBe(h.progress.generated);
		expect(h.take.stop).toHaveBeenCalledOnce();
	});
	it('catches an unavailable clock after startup and retains the committed score', async () => {
		const h = rollingHarness(); await h.player.start(params);
		h.take.audioNow = () => { throw new Error('Audio context is suspended'); };
		expect(() => h.advance(18)).not.toThrow();
		expect(h.player.snapshot()).toMatchObject({ status: 'error', error: 'Audio context is suspended' });
		expect(h.player.snapshot().generated).toBe(h.progress.generated);
	});
	it('captures final cancelled dispatch evidence on stop without resuming generation', async () => {
		const h = rollingHarness(); await h.player.start(params);
		vi.mocked(h.take.stop).mockImplementation(() => {
			h.update({ ...h.progress, provenance: { ...h.progress.provenance, sessionStatus: 'stopped',
				dispatches: [{ tick: 0, audioTime: 11, status: 'cancelled' }] } });
		});
		h.player.stop();
		expect(h.player.snapshot()).toMatchObject({ status: 'stopped', provenance: { sessionStatus: 'stopped', dispatches: [{ status: 'cancelled' }] } });
	});
});
