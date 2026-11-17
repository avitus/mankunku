import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { beforeEach, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => ({ init: vi.fn(), source: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }));
vi.mock('$lib/audio/audio-context', () => ({
 initAudio: audio.init,
 getAudioContext: async () => ({ resume: async () => {}, createMediaElementSource: audio.source }),
 getReplayGain: () => ({})
}));
import { mixAudio, connectMediaPlayback, pauseMediaPlayback } from '$lib/audio/media-playback';

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
 await new Promise(resolve => setTimeout(resolve, 0));
 expect(audio.source).not.toHaveBeenCalled();
 expect(audio.connect).not.toHaveBeenCalled();
 expect(element.volume).toBe(1);
 expect(element.play).toHaveBeenCalledTimes(1);
 expect(element.paused).toBe(true);
});

it.each(['preconnected', 'remounted'])('restores volume with a cached source: %s', async mode => {
 audio.init.mockResolvedValue(undefined);
 const element = new Media();
 element.volume = .65;
 const native = element as unknown as HTMLMediaElement;
 if (mode === 'preconnected') await connectMediaPlayback(native);
 else {
  const first = mixAudio(native);
  await element.play();
  await vi.waitFor(() => expect(element.paused).toBe(false));
  element.volume = .4; // Preserve native volume edits when detaching.
  first.destroy();
 }
 const expectedVolume = mode === 'remounted' ? .4 : .65;
 const action = mixAudio(native);
 await element.play();
 await vi.waitFor(() => { expect(element.volume).toBe(expectedVolume); expect(element.paused).toBe(false); });
 expect(audio.source).toHaveBeenCalledOnce();
 action.destroy();
});

it('switching record review to synthesized playback cancels an already-paused pending replay', async () => {
 let ready!: () => void;
 audio.init.mockReturnValue(new Promise<void>(resolve => { ready = resolve; }));
 const element = new Media();
 const action = mixAudio(element as unknown as HTMLMediaElement);
 await element.play();
 await Promise.resolve();
 expect(element.paused).toBe(true);
 // Execute the route's actual handler: native pause alone emits no event here.
 const script = readFileSync('src/routes/licks/record/+page.svelte', 'utf8').split('<script lang="ts">')[1].split('</script>')[0];
 const ast = ts.createSourceFile('record.ts', script, ts.ScriptTarget.Latest, true);
 const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handlePlayBack')!;
 const code = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 const playPhrase = vi.fn(async () => {});
 const context = { originalPlayer: element, pauseMediaPlayback, playbackModule: { playPhrase },
  performedPhrase: { notes: [] }, tempo: 120, settings: { swing: .6 } };
 const playBack = runInNewContext(`${code}\nhandlePlayBack`, context) as () => Promise<void>;
 await playBack();
 expect(playPhrase).toHaveBeenCalledOnce();
 ready();
 await vi.waitFor(() => expect(audio.connect).toHaveBeenCalledOnce());
 expect(element.paused).toBe(true);
 expect(element.play).toHaveBeenCalledTimes(1);
 action.destroy();
});


it('ignores a queued Play canceled before its event is delivered', async () => {
 const element = new Media();
 const native = element as unknown as HTMLMediaElement;
 const action = mixAudio(native);
 const playing = element.play();
 pauseMediaPlayback(native);
 await playing;
 await Promise.resolve();
 expect(audio.init).not.toHaveBeenCalled();
 expect(element.paused).toBe(true);
 expect(element.play).toHaveBeenCalledOnce();
 action.destroy();
});
