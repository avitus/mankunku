import { expect, it } from 'vitest';
import { ninthPulse, chromaticInnerPair, liftFootHat } from '$lib/audio/backing-inner-motion';
import type { BassEvent, CompEvent } from '$lib/audio/backing-generation';
const walk=(notes=[36,40,43,47]):BassEvent[]=>notes.map((midi,i)=>({midi,absBeat:8+i,time:`${(8+i)*192}i`,duration:.3,velocity:70}));
const pair=():CompEvent[]=>[0,2].map(b=>({absBeat:8+b,time:`${(8+b)*192}i`,notes:[52,55,58,62],duration:.3,velocity:60}));

it('uses a nearby ninth on the third walking pulse and keeps the approach and pulse intact',()=>{
 const before=walk([36,40,43,40]),after=ninthPulse(before,2,0);
 expect(after.map(e=>e.midi)).toEqual([36,40,38,40]);
 expect(after.filter((_,i)=>i!==2)).toEqual(before.filter((_,i)=>i!==2));
 expect(after[2]).toMatchObject({time:before[2].time,duration:.3,velocity:70,innerMotion:{kind:'ninth-pulse',rootMidi:36,originalMidi:43}});
 expect(ninthPulse(walk([36,28,43,55]),2,0)).toEqual(walk([36,28,43,55]));
});
it('moves only an inner fifth chromatically into its existing target attack',()=>{
 const before=pair(),after=chromaticInnerPair(before,0,walk(),140,192);
 expect(after.map(e=>e.notes)).toEqual([[52,54,58,62],[52,55,58,62]]);
 expect(after.map(e=>[e.time,e.duration,e.velocity])).toEqual(before.map(e=>[e.time,e.duration,e.velocity]));
 expect(after[0].innerMotion).toMatchObject({kind:'chromatic-inner',phase:'approach',fromMidi:54,toMidi:55});
 expect(after[1].innerMotion).toMatchObject({kind:'chromatic-inner',phase:'resolution'});
});
it('declines missing bass evidence, close bass clashes, overlapping gates and absent defining tones',()=>{
 const before=pair();
 expect(chromaticInnerPair(before,0,undefined,140,192)).toEqual(before);
 expect(chromaticInnerPair(before,0,walk([55,40,43,47]),140,192)).toEqual(before);
 const held=pair();held[0].duration=1;expect(chromaticInnerPair(held,0,[],140,192)).toEqual(held);
 const noShell=pair().map(e=>({...e,notes:[48,55,60,64]}));expect(chromaticInnerPair(noShell,0,[],140,192)).toEqual(noShell);
});
it('lifts the existing foot-hat on four only when the late space is clear',()=>{
 const hits=[1,3].map(beatOffset=>({drum:'hihat-pedal' as const,beatOffset,velocity:.42,role:'timekeeping' as const}));
 const after=liftFootHat(hits,[],2,192);
 expect(after[0]).toEqual(hits[0]);expect(after[1]).toMatchObject({drum:'hihat-pedal',beatOffset:3,velocity:.42*1.5,innerMotion:{kind:'hat-lift'}});
 expect(liftFootHat(hits,[{...pair()[0],absBeat:11,time:'2112i'}],2,192)).toEqual(hits);
 expect(liftFootHat(hits,[{...pair()[0],absBeat:10,time:'2130i'}],2,192,2130)).toEqual(hits);
 const busy=[...hits,{drum:'snare' as const,beatOffset:3.5,velocity:.4,role:'commentary' as const}];expect(liftFootHat(busy,[],2,192)).toEqual(busy);
});

it('resolves an inner flat ninth to the existing ninth without moving the shell or top',()=>{
 const before=pair().map(e=>({...e,notes:[58,62,64,69]}));
 const after=chromaticInnerPair(before,0,[],140,192);
 expect(after.map(e=>e.notes)).toEqual([[58,61,64,69],[58,62,64,69]]);
 expect(chromaticInnerPair(before,0,walk([50,40,43,47]),140,192)).toEqual(before);
});
it('keeps an accepted opening recall when coloring the later third pulse',()=>{
 const before=walk([36,40,43,40]);
 before[1]={...before[1],phraseDialogue:{kind:'opening-recall'} as NonNullable<BassEvent['phraseDialogue']>};
 const after=ninthPulse(before,2,0);expect(after[1]).toEqual(before[1]);expect(after[2].midi).toBe(38);
});
