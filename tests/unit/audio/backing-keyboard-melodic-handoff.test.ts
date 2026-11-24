import { expect, it } from 'vitest';
import { keyboardAnswerPrefix } from '$lib/audio/backing-keyboard-melodic-handoff';

import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';

it('recognizes only an already heard opening after a complete bass call', () => {
 const source = [41,45,43,46].map((midi,beat) => ({ beat,midi }));
 const opening = [{beat:4, midi:65},{beat:6,midi:69}];
 expect(keyboardAnswerPrefix(source, opening, 2, 8)).toEqual(opening);
 expect(keyboardAnswerPrefix(source, [{beat:2,midi:65},opening[1]], 2, 8)).toBeUndefined();
 expect(keyboardAnswerPrefix(source, [opening[0],{beat:6,midi:62}], 2, 8)).toBeUndefined();
});

it.each([
 { instrument: 'piano' as const, seed: 57, bar: 20, bass: [40,41,39,38,40], top: [69,70,69,68,70] },
 { instrument: 'organ' as const, seed: 57, bar: 20, bass: [40,41,39,38,40], top: [69,70,69,68,70] },
 { style: 'straight' as const, instrument: 'organ' as const, seed: 5, bar: 32, bass: [41,43,40,38], top: [70,74,70,65] },
 { instrument: 'piano' as const, seed: 5, bar: 32, bass: [41,43,40,38], top: [70,74,70,65] }
])('completes the played call in the $instrument take with seed $seed', example => {
 const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
 const style = BACKING_STYLES[example.style ?? 'swing'];
 const params = { phraseId: phrase.id, tempo: 144, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing, performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
 const options = releasedBackingOptions(example.instrument, example.seed);
 const score = createRollingBacking(phrase.harmony, style, params, options);
 const oldScore = createRollingBacking(phrase.harmony, style, params, { ...options, keyboardMelodicHandoff: undefined });
 const bass = new Map<number, number>();
 const keyboard = new Map<number, number>();
 let checkpoint: RollingBackingCheckpoint | undefined;
 let oldCheckpoint: RollingBackingCheckpoint | undefined;
 for (let bar=0; bar<score.totalBars; bar++) {
  const played = advanceRollingBacking(score, checkpoint);
  const old = advanceRollingBacking(oldScore, oldCheckpoint);
  expect(advanceRollingBacking(score, checkpoint && JSON.parse(JSON.stringify(checkpoint)))).toEqual(played);
  for (const event of played.bassEvents) bass.set(event.absBeat,event.midi);
  for (const event of played.compEvents) keyboard.set(event.absBeat,Math.max(keyboard.get(event.absBeat) ?? 0,...event.notes));
  if (bar===example.bar) {
   const answer = played.compEvents[0].keyboardAnswer!;
   expect(answer.source.map(n=>n.midi)).toEqual(example.bass);
   expect(answer.reply.map(n=>n.midi)).toEqual(example.top);
   for(const note of answer.source) expect(bass.get(note.beat)).toBe(note.midi);
   for(const note of answer.reply) expect(keyboard.get(note.beat)).toBe(note.midi);
   expect(answer.source.at(-1)!.beat).toBeLessThan(answer.reply[0].beat);
   expect(played.compEvents.map(e=>[e.time,e.duration,e.velocity,e.notes.length])).toEqual(old.compEvents.map(e=>[e.time,e.duration,e.velocity,e.notes.length]));
   expect(played.compEvents.map(e=>e.notes)).not.toEqual(old.compEvents.map(e=>e.notes));
   expect(played.checkpoint.piano.voicing!.notes).toEqual(played.compEvents.at(-1)!.notes);
   expect(played.checkpoint.melodicMemory!.bassCalls).toEqual([]);
   const busy = advanceRollingBacking(score,checkpoint,[{source:'scripted',barIndex:bar,observedAtBar:bar,confidence:1,noteDensity:1,restBeats:0}]);
   expect(busy.compEvents.some(e=>e.keyboardAnswer)).toBe(false);
  }
  checkpoint = played.checkpoint;
  oldCheckpoint = old.checkpoint;
 }
});
