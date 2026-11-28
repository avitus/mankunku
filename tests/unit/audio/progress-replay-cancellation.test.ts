import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

/** Read the named route handler so tests exercise the code the UI invokes. */
function routeFunction(name: string) {
 const script = readFileSync('src/routes/progress/+page.svelte', 'utf8').split('<script lang="ts">')[1].split('</script>')[0];
 const ast = ts.createSourceFile('progress.ts', script, ts.ScriptTarget.Latest, true);
 const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
 return ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}

/** Execute the route's actual handler with controlled asynchronous dependencies. */
function handler() {
 const code = routeFunction('toggleAudio');
 let release!: () => void;
 const stopping = new Promise<void>(resolve => { release = resolve; });
 const getRecording = vi.fn(async () => new Blob(['audio']));
 const play = vi.fn(async () => {});
 const context = {
  playingLickSessionId: 'lick', playingSessionId: null as string | null, replayGeneration: 0,
  audioUrl: null, audioElement: null, supabase: undefined, page: { data: {} },
  console: { error: vi.fn() },
  stopRecordingPlayback() { context.replayGeneration++; context.playingSessionId = null; },
  stopLickPlayback: () => stopping,
  require: () => ({ getRecording }),
  URL: { createObjectURL: vi.fn(() => 'blob:take'), revokeObjectURL: vi.fn() },
  Audio: class { play = play; },
  connectMediaPlayback: async () => {}, disconnectMediaPlayback: vi.fn()
 };
 const toggle = runInNewContext(`${code}\ntoggleAudio`, context) as (id: string) => Promise<void>;
 return { context, toggle, release, getRecording, play };
}

it('cancels a recording request when teardown occurs during lick shutdown', async () => {
 const h = handler();
 const pending = h.toggle('recording');
 h.context.replayGeneration++; // onDestroy invalidates the pending request.
 h.release();
 await pending;
 expect(h.getRecording).not.toHaveBeenCalled();
 expect(h.play).not.toHaveBeenCalled();
 expect(h.context.console.error).not.toHaveBeenCalled();
});

it('only starts the newest request after overlapping lick shutdowns', async () => {
 const h = handler();
 const first = h.toggle('first');
 const second = h.toggle('second');
 h.release();
 await Promise.all([first, second]);
 expect(h.getRecording).toHaveBeenCalledTimes(1);
 expect(h.getRecording).toHaveBeenCalledWith('second', undefined, undefined);
 expect(h.play).toHaveBeenCalledOnce();
 expect(h.context.playingSessionId).toBe('second');
 expect(h.context.console.error).not.toHaveBeenCalled();
});

it('restores the saved register for export and only uses playable shifts for replay', () => {
 const phrase = { notes: [{ pitch: 60 }, { pitch: 64 }, { pitch: null }] };
 const context = {
  findPhraseForSession: () => phrase,
  extractSoundingNotes: () => phrase.notes.slice(0, 2),
  instrument: { concertRangeLow: 53 }, getEffectiveHighestNote: () => 76
 };
 const resolve = runInNewContext(routeFunction('sessionReferencePhrase') + '\nsessionReferencePhrase', context);
 const take = (pitches: number[]) => ({ noteResults: pitches.map(pitch => ({ expected: { pitch } })) });
 expect(resolve(take([72, 76]), true).notes).toEqual([{ pitch: 72 }, { pitch: 76 }, { pitch: null }]);
 expect(resolve(take([48, 52]), true)).toBe(phrase);
 expect(resolve(take([84, 88]), true)).toBe(phrase);
 expect(resolve(take([48, 52])).notes).toEqual([{ pitch: 48 }, { pitch: 52 }, { pitch: null }]);
});
