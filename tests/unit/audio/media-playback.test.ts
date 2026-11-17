import { beforeEach, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => ({ init: vi.fn(), source: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }));
vi.mock('$lib/audio/audio-context', () => ({
 initAudio: audio.init,
 getAudioContext: async () => ({ resume: async () => {}, createMediaElementSource: audio.source }),
 getReplayGain: () => ({})
}));
import { mixAudio } from '$lib/audio/media-playback';

/** Media transport events are queued, like native play/pause events. */
class Media extends EventTarget {
 paused = true;
 muted = false;
 volume = 1;
 play = vi.fn(async () => {
  if (!this.paused) return;
  this.paused = false;
  queueMicrotask(() => this.dispatchEvent(new Event('play')));
 });
 pause() {
  if (this.paused) return;
  this.paused = true;
  queueMicrotask(() => this.dispatchEvent(new Event('pause')));
 }
}

beforeEach(() => {
 vi.clearAllMocks();
 audio.source.mockReturnValue({ connect: audio.connect, disconnect: audio.disconnect });
});

it.each([false, true])('respects the latest pause intent during initialization: %s', async cancel => {
 let ready!: () => void;
 audio.init.mockReturnValue(new Promise<void>(resolve => { ready = resolve; }));
 const element = new Media();
 const action = mixAudio(element as unknown as HTMLMediaElement);
 await element.play();
 await Promise.resolve(); // The action's own pause event must not cancel Play.
 if (cancel) {
  await element.play();
  element.pause();
  await Promise.resolve();
 }
 ready();
 await vi.waitFor(() => expect(audio.connect).toHaveBeenCalledOnce());
 expect(element.paused).toBe(cancel);
 expect(element.play).toHaveBeenCalledTimes(2);
 expect(element.muted).toBe(false);
 expect(element.volume).toBe(1);
 action.destroy();
 expect(element.paused).toBe(true);
});

it('does not restart playback after destruction during initialization', async () => {
 let ready!: () => void;
 audio.init.mockReturnValue(new Promise<void>(resolve => { ready = resolve; }));
 const element = new Media();
 const action = mixAudio(element as unknown as HTMLMediaElement);
 await element.play();
 action.destroy();
 ready();
 await vi.waitFor(() => expect(audio.disconnect).toHaveBeenCalled());
 expect(element.play).toHaveBeenCalledTimes(1);
 expect(element.paused).toBe(true);
});
