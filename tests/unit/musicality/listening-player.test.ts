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
