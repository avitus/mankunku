import { expect, it } from 'vitest';
import { repeatBassPulse, colorDominantNinth, catchBassRepeat, dominantColorFitsBass } from '$lib/audio/backing-trio-conversation';
import type { BassEvent } from '$lib/audio/backing-generation';
const bass: BassEvent[] = [41,43,45,46].map((midi,i)=>({midi,absBeat:i,time:`${i*192}i`,velocity:80,duration:.4}));
it('repeats one walking pulse but preserves its approach, timing, gates and actual final history',()=>{
 const result=repeatBassPulse(bass,0,'swing');
 expect(result.map(e=>e.midi)).toEqual([41,41,45,46]);
 expect(result.map(({midi,conversation,...e})=>e)).toEqual(bass.map(({midi,...e})=>e));
 expect(result.slice(-2)).toEqual(bass.slice(-2)); expect(bass[1].midi).toBe(43);
 expect(result[1].conversation).toMatchObject({kind:'repeated-bass',sourceAbsBeat:0,sourceMidi:41,originalMidi:43});
});
it('refuses broken pulse, a large exit leap, repeated source pitches and native bass grooves',()=>{
 for(const events of [bass.slice(1), bass.map((e,i)=>({...e,midi:i===2?53:e.midi})),bass.map((e,i)=>({...e,midi:i===1?41:e.midi}))])expect(repeatBassPulse(events,0,'swing')).toEqual(events);
 for(const style of ['bossa-nova','ballad'] as const) expect(repeatBassPulse(bass,0,style)).toEqual(bass);
});
it('turns an inner ninth into a flat ninth while preserving defining tones and the upper voice',()=>{
 expect(colorDominantNinth([52,58,62,67],0)).toEqual({notes:[52,58,61,67],fromMidi:62,toMidi:61});
 expect(colorDominantNinth([52,58,62],0)).toBeUndefined(); // never moves the melody
 expect(colorDominantNinth([52,60,62,67],0)).toBeUndefined(); // no seventh
 expect(colorDominantNinth([52,58,60,62,67],0)).toBeUndefined(); // unsupported size
});
it('lets the kick catch an actual repeated bass figure without adding or moving any drum hit',()=>{
 const actual=repeatBassPulse(bass,0,'swing');
 const hits=[{drum:'kick' as const,beatOffset:2,velocity:.12,role:'timekeeping' as const},{drum:'ride' as const,beatOffset:2,velocity:.3,role:'timekeeping' as const}];
 const result=catchBassRepeat(hits,actual,0,[.5]);
 expect(result[0].velocity).toBeCloseTo(.204); expect(result[1]).toEqual(hits[1]);
 expect(result[0].conversation).toMatchObject({kind:'bass-catch',repeatAbsBeat:1,sourceMidi:41,originalVelocity:.12});
 expect(catchBassRepeat(hits,bass,0,[])).toEqual(hits);
 expect(catchBassRepeat(hits,actual,0,[2])).toEqual(hits); // leave keyboard attack clear
 expect(catchBassRepeat(hits,actual.map((e,i)=>({...e,midi:i===1?43:e.midi})),0,[])).toEqual(hits);
 expect(catchBassRepeat(hits.map(h=>({...h,role:'accent' as const})),actual,0,[])).toEqual(hits.map(h=>({...h,role:'accent' as const})));
});

it('permits the intentional root/flat-ninth tension but rejects overlapping natural-ninth bass',()=>{
 const chord={time:'192i',duration:.4};
 const played=(midi:number,time='192i')=>[{...bass[0],midi,time}];
 expect(dominantColorFitsBass(chord,played(36),0,120,192)).toBe(true);
 expect(dominantColorFitsBass(chord,played(38),0,120,192)).toBe(false);
 expect(dominantColorFitsBass(chord,played(37),0,120,192)).toBe(false);
 expect(dominantColorFitsBass(chord,played(38,'384i'),0,120,192)).toBe(true);
 expect(dominantColorFitsBass(chord,undefined,0,120,192)).toBe(false);
});
