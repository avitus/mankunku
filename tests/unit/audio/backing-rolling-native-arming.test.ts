import { describe, expect, it, vi } from 'vitest';
import { createRollingBackingRenderer, type RollingBackingRuntime } from '$lib/audio/backing-rolling-renderer';
import type { RollingBackingBar } from '$lib/audio/backing-rolling';
import type { BackingTrackSchedule } from '$lib/audio/backing-track-schedule';
import type { BackingHit } from '$lib/audio/turnaround-bar';

function bar(index: number, sessionId = 'take'): RollingBackingBar {
 const tick = index * 768, beat = index * 4;
 return {
  version: 1, sessionId, fromBar: index, toBarExclusive: index + 1, startTick: tick, earliestTick: tick, committedThroughTick: tick + 768,
  previousCheckpointId: index ? `checkpoint-${index}` : null,
  checkpoint: { version: 1, sessionId, fingerprint: 'score', checkpointId: `checkpoint-${index + 1}`, nextBar: index + 1 },
  bassEvents: [{ time: `${tick}i`, midi: 41, velocity: 80, duration: .4, absBeat: beat },
   { time: `${tick + 192}i`, midi: 45, velocity: 78, duration: .4, absBeat: beat + 1 }],
  compEvents: [{ time: `${tick}i`, notes: [57, 63, 67], velocity: 64, duration: 1, absBeat: beat },
   { time: `${tick + 576}i`, notes: [57, 62, 67], velocity: 60, duration: .25, absBeat: beat + 3 }],
  drumEvents: [{ time: `${tick}i`, drum: 'ride', velocity: .6, absBeat: beat },
   { time: `${tick + 384}i`, drum: 'kick', velocity: .5, absBeat: beat + 2 }],
  ensemblePlan: [], ensembleTiming: [], ensembleDevelopment: { pianoMotifs: [], bassTurnarounds: [], drumPhrases: [] }
 } as unknown as RollingBackingBar;
}
function harness(sessionId = 'take') {
 let now = 10, current = true, published: BackingTrackSchedule | null = null;
 const cancellations: ReturnType<typeof vi.fn>[] = [];
 const arm = vi.fn<NonNullable<RollingBackingRuntime['arm']>>((_hits: readonly BackingHit[], _time: number, _key: string) => {
  const cancel = vi.fn(); cancellations.push(cancel); return cancel;
 });
 const runtime: RollingBackingRuntime & { arm: typeof arm } = {
  audioNow: () => now, lookAhead: () => .1, updateInterval: () => .025, isCurrent: () => current,
  arm, scheduleOnce: vi.fn(() => 1), clear: vi.fn(), play: vi.fn(() => vi.fn()),
  publishSchedule: vi.fn(schedule => { published = schedule; })
 };
 const renderer = createRollingBackingRenderer({ sessionId, tempo: 120, ppq: 192, totalBars: 4, startAudioTime: 11 }, runtime);
 return { runtime, renderer, cancellations, now: (value: number) => { now = value; }, current: (value: boolean) => { current = value; },
  published: () => published };
}

describe('rolling renderer native audio arming', () => {
 it('submits every committed bar group immediately at its exact future audio time without a later transport callback', () => {
  const h = harness(), input = bar(0);
  expect(h.renderer.commit(input)).toEqual({ accepted: true, nextBar: 1, committedThroughTick: 768 });
  expect(h.runtime.arm.mock.calls.map(([, time]) => time)).toEqual([11, 11.5, 12, 12.5]);
  expect(h.runtime.arm.mock.calls.map(([, , key]) => key)).toEqual(['0:0', '0:192', '0:384', '0:576']);
  expect(h.runtime.arm.mock.calls[0][0].map(hit => hit.kind)).toEqual(['bass', 'comp', 'drum']);
  expect(h.runtime.arm.mock.calls.flatMap(([hits]) => hits)).toHaveLength(6);
  expect(h.runtime.scheduleOnce).not.toHaveBeenCalled(); expect(h.runtime.play).not.toHaveBeenCalled();
  const committed = h.renderer.snapshot();
  expect(committed.dispatches.map(entry => entry.status)).toEqual(['played', 'played', 'played', 'played']);
  expect(committed.dispatches.map(entry => entry.audioTime)).toEqual([11, 11.5, 12, 12.5]);
  // No callback execution is needed after a main-thread pause: these timestamps
  // have already reached the native audio owner. Real-sample output is an E2E contract.
  h.now(12.8);
  expect(h.renderer.snapshot()).toBe(committed);
  expect(h.runtime.arm).toHaveBeenCalledTimes(4);
  input.compEvents[0].notes[0] = 99;
  expect((h.runtime.arm.mock.calls[0][0][1] as Extract<BackingHit, { kind: 'comp' }>).notes[0]).toBe(57);
 });
 it('cancels every owned future or sounding group once, even if one native cancellation throws', () => {
  const h = harness(); h.renderer.commit(bar(0)); h.renderer.commit(bar(1));
  expect(h.cancellations).toHaveLength(8);
  h.cancellations[1].mockImplementation(() => { throw new Error('already released'); });
  h.now(11.6); h.renderer.stop(); h.renderer.stop();
  expect(h.cancellations.every(cancel => cancel.mock.calls.length === 1)).toBe(true);
  expect(h.published()).toBeNull(); expect(h.runtime.clear).not.toHaveBeenCalled();
  expect(h.renderer.snapshot().status).toBe('stopped');
  expect(h.renderer.commit(bar(2))).toEqual({ accepted: false, reason: 'stopped' });
 });
 it('arms only after the ledger and immutable bar have been published and committed', () => {
  const h = harness(), arm = h.runtime.arm;
  h.runtime.arm = vi.fn((hits, time, key) => {
   const snapshot = h.renderer.snapshot();
   expect(snapshot.nextBar).toBe(1); expect(snapshot.checkpointId).toBe('checkpoint-1');
   expect(snapshot.windows).toHaveLength(1); expect(Object.isFrozen(snapshot.windows[0])).toBe(true);
   expect(snapshot.schedule).toBe(h.published()); expect(snapshot.schedule).not.toBeNull();
   return arm(hits, time, key);
  });
  expect(h.renderer.commit(bar(0)).accepted).toBe(true);
  expect(h.runtime.arm).toHaveBeenCalledTimes(4);
 });
 it('keeps a native arm failure as committed playback evidence, cancels owned sources and refuses a retry', () => {
  const h = harness(), arm = h.runtime.arm;
  h.runtime.arm = vi.fn((hits, time, key) => {
   if (key === '0:384') throw new Error('sample cannot arm');
   return arm(hits, time, key);
  });
  expect(h.renderer.commit(bar(0))).toEqual({ accepted: true, nextBar: 1, committedThroughTick: 768 });
  expect(h.cancellations).toHaveLength(2);
  expect(h.cancellations.every(cancel => cancel.mock.calls.length === 1)).toBe(true);
  const failed = h.renderer.snapshot();
  expect(failed.status).toBe('underrun'); expect(failed.nextBar).toBe(1);
  expect(failed.windows).toHaveLength(1); expect(failed.checkpointId).toBe('checkpoint-1');
  expect(failed.dispatches.find(entry => entry.tick === 384)?.status).toBe('failed');
  expect(failed.dispatches.find(entry => entry.tick === 576)?.status).toBe('cancelled');
  expect(h.published()).toBeNull();
  expect(h.renderer.commit(bar(0))).toEqual({ accepted: false, reason: 'stopped' });
  expect(h.runtime.scheduleOnce).not.toHaveBeenCalled();
 });
 it('records the native failure clock without inventing a transport callback timestamp', () => {
  const h = harness();
  h.runtime.arm.mockImplementationOnce(() => { h.now(11.2); throw new Error('native start missed'); });
  h.renderer.commit(bar(0));
  const failed = h.renderer.snapshot().dispatches[0];
  expect(failed.status).toBe('failed');
  expect(failed.diagnostic).toMatchObject({ reason: 'play_failure', targetAudioTime: 11, observedAudioTime: 11.2 });
  expect(failed.diagnostic?.latenessSeconds).toBeCloseTo(.2);
  expect(failed.diagnostic).not.toHaveProperty('callbackAudioTime');
 });
 it('publication failure arms no new sources and restores the previously committed ledger', () => {
  const h = harness(); h.renderer.commit(bar(0));
  const previous = h.renderer.snapshot(), publish = h.runtime.publishSchedule;
  h.runtime.publishSchedule = vi.fn(schedule => { publish(schedule); if (schedule !== previous.schedule) throw new Error('publish failed'); });
  expect(h.renderer.commit(bar(1))).toEqual({ accepted: false, reason: 'schedule_failure' });
  expect(h.cancellations).toHaveLength(4); expect(h.runtime.arm).toHaveBeenCalledTimes(4);
  expect(h.cancellations.every(cancel => !cancel.mock.calls.length)).toBe(true);
  expect(h.renderer.snapshot()).toBe(previous); expect(h.published()).toBe(previous.schedule);
 });
 it('a deadline crossed during publication rejects the entire attempt before native source allocation', () => {
  const h = harness(), before = h.renderer.snapshot(), publish = h.runtime.publishSchedule;
  h.runtime.publishSchedule = vi.fn(schedule => { publish(schedule); h.now(10.9); });
  expect(h.renderer.commit(bar(0))).toEqual({ accepted: false, reason: 'deadline' });
  expect(h.runtime.arm).not.toHaveBeenCalled(); expect(h.cancellations).toHaveLength(0);
  expect(h.renderer.snapshot()).toBe(before); expect(h.published()).toBeNull();
 });
 it('preserves compute, ordering and stale-session admission guards before native source allocation', () => {
  const h = harness();
  // Since 2026-11-12 a slow bar is refused for the lead it used up, not for a fixed 25 ms:
  // here the audio clock stood still at 10.8 while generation took 70 ms of the 65 ms left.
  h.now(10.8);
  expect(h.renderer.commit(bar(0), { renderStartedAt: 10.8, renderElapsedSeconds: .07 })).toEqual({ accepted: false, reason: 'deadline' });
  expect(h.renderer.commit(bar(0), { renderStartedAt: 10.8, renderElapsedSeconds: -1 })).toEqual({ accepted: false, reason: 'compute_budget' });
  h.now(10);
  expect(h.renderer.commit(bar(1))).toEqual({ accepted: false, reason: 'out_of_order' });
  h.current(false);
  expect(h.renderer.commit(bar(0))).toEqual({ accepted: false, reason: 'stale_session' });
  expect(h.runtime.arm).not.toHaveBeenCalled(); expect(h.cancellations).toHaveLength(0);
 });
 it.each(['stop', 'supersede'] as const)('cancels the source returned by a reentrant %s without erasing committed evidence or arming remaining groups', change => {
  const h = harness(), cancel = vi.fn();
  h.runtime.arm = vi.fn(() => { if (change === 'stop') h.renderer.stop(); else h.current(false); return cancel; });
  expect(h.renderer.commit(bar(0))).toEqual({ accepted: true, nextBar: 1, committedThroughTick: 768 });
  expect(cancel).toHaveBeenCalledTimes(1); expect(h.runtime.arm).toHaveBeenCalledTimes(1);
  expect(h.renderer.snapshot().nextBar).toBe(1); expect(h.renderer.snapshot().windows).toHaveLength(1);
 });
 it('stopping a stale renderer cannot cancel successor sources or erase the successor ledger', () => {
  const old = harness(), next = harness('next');
  let sharedSchedule: BackingTrackSchedule | null = null;
  const publish = vi.fn((schedule: BackingTrackSchedule | null) => { sharedSchedule = schedule; });
  old.runtime.publishSchedule = publish; next.runtime.publishSchedule = publish;
  old.renderer.commit(bar(0)); old.current(false);
  expect(next.renderer.commit(bar(0, 'next')).accepted).toBe(true);
  const successor = next.renderer.snapshot();
  old.renderer.stop();
  expect(old.cancellations).toHaveLength(4);
  expect(old.cancellations.every(cancel => cancel.mock.calls.length === 1)).toBe(true);
  expect(next.cancellations).toHaveLength(4);
  expect(next.cancellations.every(cancel => !cancel.mock.calls.length)).toBe(true);
  expect(sharedSchedule).toBe(successor.schedule); expect(next.renderer.snapshot()).toBe(successor);
 });
});
