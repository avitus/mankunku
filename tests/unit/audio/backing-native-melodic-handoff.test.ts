import { expect, it } from 'vitest';
import { finishNativeBassAnswer } from '$lib/audio/backing-native-melodic-handoff';
import type { HarmonicSegment } from '$lib/types/music';

import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';

it('finishes a Ballad contour on the existing half notes while keeping its root entrance', () => {
 const keyboard = [60,64,62,65].map((midi,i) => ({midi,beat:i}));
 const prefix = [{midi:41,beat:4},{midi:45,beat:6}];
 const events = [43,38].map((midi,i)=>({midi,absBeat:8+i*2,time:(8+i*2)*192+'i',velocity:80,duration:.9}));
 const harmony: HarmonicSegment[] = [{startOffset:[0,1],duration:[4,1],chord:{root:'G',quality:'min7'},scaleId:'dorian'}];
 const matched=finishNativeBassAnswer('ballad',keyboard,prefix,events,harmony);
 expect(matched?.reply.map(n=>n.midi)).toEqual([41,45,43,46]);
 expect(matched?.events.map(e=>[e.absBeat,e.duration])).toEqual([[8,.9],[10,.9]]);
});

const examples = [
 { style: 'bossa-nova', tempo: 112, seed: 7, role: 'keys', bar: 21, reply: [67,65,62,62] },
 { style: 'bossa-nova', tempo: 128, seed: 2, role: 'bass', bar: 39, reply: [42,41,41,36,41] },
 { style: 'ballad', tempo: 92, seed: 3, role: 'bass', bar: 37, reply: [36,42,38,46,41] },
 { style: 'ballad', tempo: 88, seed: 22, role: 'keys', bar: 36, reply: [65,65,67,69] }
] as const;

for (const instrument of ['piano','organ'] as const) {
 it.each(examples)(instrument + ' passes the $style phrase to $role on the existing attacks', example => {
  const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
  const style = BACKING_STYLES[example.style];
  const params = { phraseId: phrase.id, tempo: example.tempo, ppq: 192, beatsPerBar: 4,
   swing: style.defaultSwing, performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
  const options = releasedBackingOptions(instrument, example.seed);
  const score = createRollingBacking(phrase.harmony, style, params, options);
  const previous = createRollingBacking(phrase.harmony, style, params, { ...options, nativeMelodicHandoff: undefined });
  const bass = new Map<number,number>();
  const keys = new Map<number,number>();
  let checkpoint: RollingBackingCheckpoint | undefined;
  let controlCheckpoint: RollingBackingCheckpoint | undefined;
  for (let bar=0; bar<score.totalBars; bar++) {
   const played = advanceRollingBacking(score, checkpoint);
   const control = advanceRollingBacking(previous, controlCheckpoint);
   expect(advanceRollingBacking(score, checkpoint && JSON.parse(JSON.stringify(checkpoint)))).toEqual(played);
   for (const e of played.bassEvents) bass.set(e.absBeat,e.midi);
   for (const e of played.compEvents) keys.set(e.absBeat,Math.max(keys.get(e.absBeat) ?? 0,...e.notes));
   if (bar+1 === example.bar) {
    const bassAnswer = played.bassEvents.find(e => e.melodicSource);
    const keyboardAnswer = played.compEvents.find(e => e.keyboardAnswer)?.keyboardAnswer;
    const source = example.role === 'bass' ? bassAnswer!.melodicSource! : keyboardAnswer!.source;
    const reply = example.role === 'bass' ? bassAnswer!.melodicReply! : keyboardAnswer!.reply;
    expect(reply.map(n=>n.midi)).toEqual(example.reply);
    expect(source.at(-1)!.beat).toBeLessThan(reply[0].beat);
    for (const note of source) expect((example.role==='bass'?keys:bass).get(note.beat)).toBe(note.midi);
    for (const [i,note] of reply.entries()) {
     expect((example.role==='bass'?bass:keys).get(note.beat)).toBe(note.midi);
     if (i) expect(Math.sign(note.midi-reply[i-1].midi)).toBe(Math.sign(source[i].midi-source[i-1].midi));
    }
    const attacks = (events: readonly {time:string; duration:number; velocity:number}[]) => events.map(e=>[e.time,e.duration,e.velocity]);
    expect(attacks(played.bassEvents)).toEqual(attacks(control.bassEvents));
    expect(attacks(played.compEvents)).toEqual(attacks(control.compEvents));
    expect(played.drumEvents).toEqual(control.drumEvents);
    if (example.role==='bass') expect(played.bassEvents.map(e=>e.midi)).not.toEqual(control.bassEvents.map(e=>e.midi));
    else expect(played.compEvents.map(e=>e.notes)).not.toEqual(control.compEvents.map(e=>e.notes));
    const busy = advanceRollingBacking(score,checkpoint,[{source:'scripted',barIndex:bar,observedAtBar:bar,confidence:1,noteDensity:1,restBeats:0}]);
    expect(busy.bassEvents.some(e=>e.melodicSource) || busy.compEvents.some(e=>e.keyboardAnswer)).toBe(false);
   }
   checkpoint=played.checkpoint;
   controlCheckpoint=control.checkpoint;
  }
 });
}
