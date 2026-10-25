import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createListeningPlayer } from '$lib/musicality/listening-player';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';
import type { BounceParams } from '$lib/audio/backing-bounce';
import type { RollingBackingPlayback, RollingBackingPlaybackOptions } from '$lib/audio/backing-track';
import { buildListeningTuneSession, LISTENING_TUNES } from '$lib/musicality/listening-tunes';

const host = vi.hoisted(() => ({
	context: { state: 'running', currentTime: 0, resume: vi.fn(async () => {}) },
	transport: { PPQ: 192, position: 0, bpm: { value: 120 }, start: vi.fn(), stop: vi.fn() },
	active: null as unknown, schedule: null as unknown, nextId: 0,
	callbacks: new Map<number, { tick: number; callback: (time: number) => void; origin: number; tempo: number }>(),
	playbacks: [] as { stop: ReturnType<typeof vi.fn> }[],
	pauseAfterClaim: null as Promise<void> | null,
	getUserMedia: vi.fn()
}));
vi.mock('$lib/audio/audio-context', () => ({ initAudio: vi.fn(async () => host.context) }));
vi.mock('tone', () => ({ getTransport: () => host.transport, now: () => host.context.currentTime }));
vi.mock('$lib/audio/backing-track', async () => {
	const { createRollingBackingRenderer } = await import('$lib/audio/backing-rolling-renderer');
	return {
		loadBackingInstruments: vi.fn(async () => {}), setBackingMix: vi.fn(), setBackingTrackVolume: vi.fn(),
		getActiveSchedule: () => host.schedule, disposeBackingParts: vi.fn(() => { host.schedule = null; host.active = null; }),
		scheduleBackingTrack: vi.fn(async () => { host.active = null; host.schedule = {}; return { bassEvents: [], compEvents: [], drumEvents: [] }; }),
		createRollingBackingPlayback: vi.fn(async (options: RollingBackingPlaybackOptions): Promise<RollingBackingPlayback> => {
			const pause = host.pauseAfterClaim;
			const startAudioTime = host.context.currentTime + .3;
			const renderer = createRollingBackingRenderer({ ...options, startAudioTime }, {
				audioNow: () => { if (host.context.state !== 'running') throw new Error('suspended'); return host.context.currentTime; },
				lookAhead: () => .1, updateInterval: () => .025,
				isCurrent: () => host.active === renderer && options.isCurrent(),
				scheduleOnce: (callback, time) => { const id = ++host.nextId; host.callbacks.set(id, { callback, tick: parseInt(time), origin: startAudioTime, tempo: options.tempo }); return id; },
				clear: id => { host.callbacks.delete(id); }, play: () => () => {}, publishSchedule: schedule => { host.schedule = schedule; }
			});
			const stop = vi.fn(renderer.stop);
			const playback = Object.assign(renderer, { stop, ownsOutput: () => host.active === renderer });
			host.active = renderer; host.playbacks.push(playback);
			if (pause) await pause;
			return playback;
		})
	};
});

const input = (orchestration: 'original' | 'coordinated' = 'coordinated'): BounceParams => ({
	phrase: structuredClone(BACKING_LAB_PRESETS[0].phrase), style: 'swing', tempo: 140, swing: .67,
	instrument: 'piano', volume: .37, mix: { ...DEFAULT_BACKING_MIX }, orchestration
});
const players: ReturnType<typeof createListeningPlayer>[] = [];
const player = () => { const value = createListeningPlayer({ onChange: () => {} }); players.push(value); return value; };
function advance(milliseconds: number) {
	for (let elapsed = 0; elapsed < milliseconds; elapsed += 10) {
		host.context.currentTime += .01;
		for (const [id, event] of host.callbacks) {
			const time = event.origin + event.tick * 60 / event.tempo / 192;
			if (time <= host.context.currentTime + .1) { host.callbacks.delete(id); event.callback(time); }
		}
		vi.advanceTimersByTime(10);
	}
}
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); vi.clearAllMocks();
	host.context.currentTime = 0; host.context.state = 'running'; host.active = null; host.schedule = null;
	host.callbacks.clear(); host.playbacks.length = 0; host.pauseAfterClaim = null;
	vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: host.getUserMedia } });
});
afterEach(() => { for (const value of players.splice(0)) value.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('browser listening runtime routing and ownership', () => {
 it.each(['unknown', 'late-attack'] as const)('rejects a requested hold with %s melody before loading instruments or scheduling', async kind => {
  const backing = await import('$lib/audio/backing-track');
  const params = { ...input(), phrase: buildListeningTuneSession({ tuneId: LISTENING_TUNES.find(tune => tune.title === 'Mankunku Blues')!.id, key: 'C', soloChoruses: 2 }).phrase, ending: 'hold-release' } as BounceParams;
  if (kind === 'unknown') params.phrase.notes = undefined as unknown as typeof params.phrase.notes;
  else params.phrase.notes[params.phrase.notes.length - 1] = { pitch: 60, offset: [207, 4], duration: [1, 4] };
  const take = player(); await take.start(params);
  expect(take.snapshot().status).toBe('error');
  expect(take.snapshot().error).toMatch(/melody/i);
  expect(backing.loadBackingInstruments).not.toHaveBeenCalled();
  expect(backing.createRollingBackingPlayback).not.toHaveBeenCalled();
  expect(backing.scheduleBackingTrack).not.toHaveBeenCalled();
 });
 it('allows an explicitly instrumental hold with an empty known melody', async () => {
  const params = { ...input(), phrase: buildListeningTuneSession({ tuneId: LISTENING_TUNES.find(tune => tune.title === 'Mankunku Blues')!.id, key: 'C', soloChoruses: 2 }).phrase, ending: 'hold-release' } as BounceParams;
  params.phrase.notes = []; const take = player(); await take.start(params);
  expect(take.snapshot().status).toBe('playing');
 });
 it('forwards a captured terminal choice and its score melody to the causal definition', async () => {
  const rolling = await import('$lib/audio/backing-rolling');
  const create = vi.spyOn(rolling, 'createRollingBacking');
  const params = { ...input(), phrase: buildListeningTuneSession({ tuneId: LISTENING_TUNES.find(tune => tune.title === 'Mankunku Blues')!.id, key: 'C', soloChoruses: 2 }).phrase, ending: 'hold-release' } as BounceParams;
  const melody = structuredClone(params.phrase.notes);
  const take = player(); await take.start(params);
  expect(take.snapshot().status).toBe('playing');
  expect(create.mock.calls.at(-1)?.[2]).toMatchObject({ terminalArrangement: { ending: 'hold-release', melody } });
  params.phrase.notes.length = 0;
  expect(take.snapshot().params).toMatchObject({ ending: 'hold-release', phrase: { notes: melody } });
  create.mockRestore();
 });
 it.each(['bossa-nova', 'ballad'] as const)('does not forward a stale terminal choice into native %s playback', async style => {
  const rolling = await import('$lib/audio/backing-rolling');
  const create = vi.spyOn(rolling, 'createRollingBacking');
  const take = player(); await take.start({ ...input(), style, ending: 'hold-release' } as BounceParams);
  expect(take.snapshot().status).toBe('playing');
  expect(create.mock.calls.at(-1)?.[2]).not.toHaveProperty('terminalArrangement');
 });
 it('does not forward a stale terminal choice to Original scheduling', async () => {
  const backing = await import('$lib/audio/backing-track');
  const take = player(); await take.start({ ...input('original'), ending: 'hold-release' } as BounceParams);
  expect(take.snapshot().status).toBe('playing');
  expect(backing.scheduleBackingTrack).toHaveBeenCalledOnce();
  expect(vi.mocked(backing.scheduleBackingTrack).mock.calls[0][1]).not.toHaveProperty('terminalArrangement');
  expect(vi.mocked(backing.scheduleBackingTrack).mock.calls[0][1]).not.toHaveProperty('ending');
 });
	it('uses causal committed prefixes without microphone access and completes only after every dispatch and the tail', async () => {
		const backing = await import('$lib/audio/backing-track'); const take = player(); await take.start(input());
		expect(take.snapshot()).toMatchObject({ status: 'playing', barIndex: null, provenance: { engine: 'causal-rolling', committedBars: 2 } });
		expect(backing.scheduleBackingTrack).not.toHaveBeenCalled();
		expect(backing.setBackingTrackVolume).toHaveBeenCalledWith(.37);
		expect(backing.setBackingMix).toHaveBeenCalledWith(DEFAULT_BACKING_MIX);
		expect(host.getUserMedia).not.toHaveBeenCalled();
		const prefix = take.snapshot().generated!;
		const count = prefix.ensemblePlan!.bars.length;
		advance(2000);
		expect(take.snapshot().barIndex).toBe(0);
		expect(prefix.ensemblePlan!.bars).toHaveLength(count);
		expect(Object.isFrozen(prefix.ensembleDevelopment)).toBe(true);
		const end = .3 + take.snapshot().durationBeats * 60 / 140;
		advance(Math.ceil((end + 2.4 - host.context.currentTime) * 1000));
		expect(take.snapshot().status).toBe('playing');
		advance(150);
		expect(take.snapshot()).toMatchObject({ status: 'completed', provenance: { engine: 'causal-rolling', sessionStatus: 'complete' } });
		expect(take.snapshot().provenance?.committedBars).toBe(take.snapshot().provenance?.totalBars);
	});
	it('keeps Original on its existing fixed scheduling path', async () => {
		const backing = await import('$lib/audio/backing-track'); const take = player(); await take.start(input('original'));
		expect(backing.scheduleBackingTrack).toHaveBeenCalledOnce();
		expect(backing.createRollingBackingPlayback).not.toHaveBeenCalled();
		expect(take.snapshot().provenance?.engine).toBe('fixed');
		expect(host.getUserMedia).not.toHaveBeenCalled();
	});
	it('stops its owned transport after cancellation invalidates the request', async () => {
		const take = player(); await take.start(input()); host.transport.stop.mockClear();
		take.stop();
		expect(host.transport.stop).toHaveBeenCalledOnce();
		expect(take.snapshot()).toMatchObject({ status: 'stopped', provenance: { sessionStatus: 'stopped' } });
	});
	it('releases a cancelled prepare after output claim without stopping a newer take', async () => {
		let release!: () => void; host.pauseAfterClaim = new Promise<void>(resolve => { release = resolve; });
		const stale = player(); const pending = stale.start(input());
		await vi.waitFor(() => expect(host.playbacks).toHaveLength(1));
		stale.stop(); host.pauseAfterClaim = null;
		const newer = player(); await newer.start(input()); const latest = host.active;
		host.transport.stop.mockClear(); release(); await pending;
		expect(host.playbacks[0].stop).toHaveBeenCalledOnce();
		expect(host.active).toBe(latest); expect(host.transport.stop).not.toHaveBeenCalled();
		expect(newer.snapshot().status).toBe('playing');
	});
	it('surfaces suspended audio and never marks a superseded rolling take complete', async () => {
		const stale = player(); await stale.start(input()); const newer = player(); await newer.start(input());
		advance(50); expect(stale.snapshot().status).toBe('error'); expect(newer.snapshot().status).toBe('playing');
		host.context.state = 'suspended'; vi.advanceTimersByTime(50);
		expect(newer.snapshot().status).toBe('error');
		expect(newer.snapshot().error).toMatch(/audio|suspend/i);
	});
});
