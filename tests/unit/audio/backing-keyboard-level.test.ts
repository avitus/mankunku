import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';
import { fakeAudioContext } from '../../helpers/fake-audio-context';

const state = vi.hoisted(() => ({
 instruments: [] as Array<{ name: string; destination: { gain: { value: number } }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>,
 organLoad: null as Promise<unknown> | null
}));
vi.mock('smplr', async () => {
 class Instrument {
  load: Promise<this>;
  start = vi.fn(); stop = vi.fn(); disconnect = vi.fn();
  constructor(_context: unknown, options: { destination: { gain: { value: number } } }) {
   state.instruments.push({ name: new.target.name, destination: options.destination, start: this.start, stop: this.stop, disconnect: this.disconnect });
   this.load = new.target.name === 'Soundfont' && state.organLoad ? state.organLoad.then(() => this) : Promise.resolve(this);
  }
 }
 return {
  Smolken: class Smolken extends Instrument {}, SplendidGrandPiano: class SplendidGrandPiano extends Instrument {},
  Soundfont: class Soundfont extends Instrument {}, Sampler: class Sampler extends Instrument {}, CacheStorage: class {}, Scheduler: class {},
  renderOffline: async (render: (ctx: unknown) => Promise<void>) => {
   const context = { ...fakeAudioContext(), sampleRate: 48000, destination: {} };
   await render(context);
   return { audioBuffer: { numberOfChannels: 1, getChannelData: () => new Float32Array([0]) } };
  },
  audioBufferToWav16: () => new Blob()
 };
});
vi.mock('$lib/audio/audio-context', () => ({
 initAudio: async () => fakeAudioContext(), getAudioContext: () => fakeAudioContext(),
 getMasterGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })
}));
vi.mock('tone', () => ({ getTransport: () => ({ PPQ: 192 }), getContext: () => ({ rawContext: { currentTime: 0 } }) }));
const bank = (name: string) => state.instruments.filter(item => item.name === name).at(-1)!;

beforeEach(() => { vi.resetModules(); state.instruments.length = 0; state.organLoad = null; });

describe('calibrated keyboard output ownership', () => {
 it('changes bank level while preserving the user fader, mute and unchanged piano reference', async () => {
  const track = await import('$lib/audio/backing-track');
  track.setBackingMix({ ...DEFAULT_BACKING_MIX, comp: .75 }, { persist: false });
  await track.loadBackingInstruments('piano');
  const piano = bank('SplendidGrandPiano');
  expect(piano.destination.gain.value).toBeCloseTo(.075);
  await track.loadBackingInstruments('organ');
  expect(bank('Soundfont').destination.gain.value).toBeCloseTo(.1635);
  expect(piano.stop).toHaveBeenCalledOnce();
  track.setBackingMix({ ...DEFAULT_BACKING_MIX, comp: 0 }, { persist: false });
  expect(bank('Soundfont').destination.gain.value).toBe(0);
  await track.loadBackingInstruments('piano');
  expect(bank('SplendidGrandPiano').destination.gain.value).toBe(0);
  track.setBackingMix({ ...DEFAULT_BACKING_MIX, comp: 1 }, { persist: false });
  expect(bank('SplendidGrandPiano').destination.gain.value).toBeCloseTo(.1);
 });
 it('keeps the previous piano calibration after a failed organ load', async () => {
  const track = await import('$lib/audio/backing-track');
  await track.loadBackingInstruments('piano');
  const piano = bank('SplendidGrandPiano');
  state.organLoad = Promise.reject(new Error('sample unavailable'));
  await expect(track.loadBackingInstruments('organ')).rejects.toThrow('sample unavailable');
  expect(bank('Soundfont').disconnect).toHaveBeenCalledOnce();
  expect(piano.destination.gain.value).toBeCloseTo(.1);
  expect(piano.stop).not.toHaveBeenCalled();
 });
 it('cannot publish the trim of an organ load superseded by piano', async () => {
  const track = await import('$lib/audio/backing-track');
  await track.loadBackingInstruments('piano');
  let finish!: () => void;
  state.organLoad = new Promise<void>(resolve => { finish = resolve; });
  const pending = track.loadBackingInstruments('organ');
  await vi.waitFor(() => expect(state.instruments.some(item => item.name === 'Soundfont')).toBe(true));
  await track.loadBackingInstruments('piano');
  finish(); await pending;
  expect(bank('Soundfont').disconnect).toHaveBeenCalledOnce();
  expect(bank('SplendidGrandPiano').destination.gain.value).toBeCloseTo(.1);
 });
 it.each(['piano', 'organ'] as const)('WAV bounce uses the same %s calibration and unchanged event dynamics', async instrument => {
  const { renderEventsToWav } = await import('$lib/audio/backing-bounce');
  await renderEventsToWav({ bassEvents: [], drumEvents: [], compEvents: [{ absBeat: 0, time: '0i', notes: [57,60,63], duration: .4, velocity: 72 }] }, {},
   { tempo: 140, volume: .7, mix: { ...DEFAULT_BACKING_MIX, comp: .75 }, durationSeconds: 1, instrument });
  const player = bank(instrument === 'piano' ? 'SplendidGrandPiano' : 'Soundfont');
  expect(player.destination.gain.value).toBeCloseTo(instrument === 'piano' ? .075 : .1635);
  expect(player.start.mock.calls.map(([event]) => event)).toEqual([57,60,63].map(note => ({ note, time: 0, velocity: 72, duration: .4 })));
 });
});
