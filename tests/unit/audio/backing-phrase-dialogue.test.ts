import {describe,it,expect} from 'vitest';
import {recallBassOpening, fourthStack, snareKickDialogue} from '$lib/audio/backing-phrase-dialogue';
import type {BassEvent} from '$lib/audio/backing-generation';
const walk=(notes=[36,38,40,43]):BassEvent[]=>notes.map((midi,i)=>({midi,absBeat:8+i,time:`${(8+i)*192}i`,duration:.3,velocity:70}));
const source={barIndex:1,notes:[31,35] as [number,number]};
describe('phrase dialogue',()=>{
 it('transposes an actual opening interval while preserving the entrance and final approach',()=>{
  const before=walk([36,38,43,47]),after=recallBassOpening(before,2,0,[0,2,4,5,7,9,10],source);
  expect(after.map(e=>e.midi)).toEqual([36,40,43,47]);expect(after[0]).toEqual(before[0]);expect(after.slice(2)).toEqual(before.slice(2));
  expect(after[1].phraseDialogue).toMatchObject({kind:'opening-recall',sourceBar:1,sourceNotes:[31,35],fromMidi:38,toMidi:40});
  expect(after[1].time).toBe(before[1].time);
 });
 it('rejects stale sources, foreign scale tones, collisions with prior gestures and awkward leaps',()=>{
  const before=walk();
  for(const [root,scale,motif] of [[0,[0,7],source],[0,[0,2,4,7],{...source,barIndex:0}],[0,[0,2,4,7],{...source,notes:[31,43]}]] as const)
   expect(recallBassOpening(before,2,root,scale,motif)).toEqual(before);
  expect(recallBassOpening(walk([36,38,50,47]),2,0,[0,4,7],source)).toEqual(walk([36,38,50,47]));
  const repeated=walk([36,36,43,47]);repeated[1]={...repeated[1],conversation:{kind:'repeated-bass',sourceAbsBeat:8,sourceMidi:36,originalMidi:38}};
  expect(recallBassOpening(repeated,2,0,[0,4,7],source)).toEqual(repeated);
 });
 it('keeps defining third and seventh below a genuine three-note fourth stack',()=>{
  for(const [root,quality,third,seventh] of [[0,'7',4,10],[5,'min7',3,10],[7,'maj7',4,11]] as const){
   const cell=fourthStack([48+root,52+root,58+root,72+root],root,quality)!;expect(cell).toBeDefined();
   expect(cell.slice(-3).map((n,i,a)=>i?n-a[i-1]:0)).toEqual([0,5,5]);
   expect(cell.slice(0,2).map(n=>(n-root+120)%12).sort((a,b)=>a-b)).toEqual([third,seventh].sort((a,b)=>a-b));
   expect(cell.every((n,i)=>n>=48&&n<=84&&(!i||n>cell[i-1]))).toBe(true);
  }
  expect(fourthStack([55,59,62,67],0,'7b9')).toBeUndefined();
 });
 it('moves only the second snare of a pair to a free kick onset',()=>{
  const hits=[{drum:'snare' as const,beatOffset:.5,velocity:.5,role:'commentary' as const},{drum:'snare' as const,beatOffset:1.5,velocity:.6,role:'commentary' as const}];
  const after=snareKickDialogue(hits,[],2);expect(after[0]).toEqual(hits[0]);expect(after[1]).toMatchObject({drum:'kick',beatOffset:1.5,phraseDialogue:{kind:'kick-answer',sourceOffset:.5}});
  expect(snareKickDialogue([...hits,{drum:'kick',beatOffset:1.5,velocity:.1,role:'timekeeping'}],[],2)).toEqual([...hits,{drum:'kick',beatOffset:1.5,velocity:.1,role:'timekeeping'}]);
  expect(snareKickDialogue(hits,[{absBeat:9.5}],2)).toEqual(hits);
  expect(snareKickDialogue([...hits,{...hits[1],beatOffset:3}],[],2)).toEqual([...hits,{...hits[1],beatOffset:3}]);
 });
});

it('retains the quiet middle of a complete snare fill and does not overwrite a ghosted pair',()=>{
 const expression={kind:'ghost-answer' as const,originalVelocity:.3,part:'answer' as const};
 const hits=[{drum:'snare' as const,beatOffset:3,velocity:.3,role:'commentary' as const},{drum:'snare' as const,beatOffset:3+1/3,velocity:.15,role:'commentary' as const,expression},{drum:'snare' as const,beatOffset:3+2/3,velocity:.4,role:'commentary' as const}];
 const result=snareKickDialogue(hits,[],0);expect(result[1]).toEqual(hits[1]);expect(result[2].drum).toBe('kick');expect(result.map(h=>h.beatOffset)).toEqual(hits.map(h=>h.beatOffset));
 const pair=[hits[0],{...hits[1],beatOffset:3.5}];expect(snareKickDialogue(pair,[],0)).toEqual(pair);
});
