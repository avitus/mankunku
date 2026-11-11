import {expect,it} from 'vitest';
import {rootSeventhPulse,upperStructureTriad,upperStructureFitsBass} from '$lib/audio/backing-phrase-colors';
import type {BassEvent} from '$lib/audio/backing-generation';
const bass: BassEvent[]=[41,43,41,40].map((midi,i)=>({midi,absBeat:i,time:`${i*192}i`,duration:.4,velocity:80}));
it('dips from root to seventh, preserving the two approach notes and pulse envelopes',()=>{
 const out=rootSeventhPulse(bass,0,5,10);
 expect(out.map(e=>e.midi)).toEqual([41,39,41,40]);
 expect(out.slice(-2)).toEqual(bass.slice(-2));
 expect(out.map(({midi,phraseColor,...e})=>e)).toEqual(bass.map(({midi,...e})=>e));
 expect(bass[1].midi).toBe(43);
});
it('rejects broken walking, register underflow and an awkward exit from the seventh',()=>{
 expect(rootSeventhPulse(bass.slice(1),0,5,10)).toEqual(bass.slice(1));
 const low=bass.map(e=>({...e,midi:e.midi-12}));expect(rootSeventhPulse(low,0,5,10)).toEqual(low);
 const leap=bass.map((e,i)=>({...e,midi:i===2?48:e.midi}));expect(rootSeventhPulse(leap,0,5,10)).toEqual(leap);
});
it('places a bright upper triad above an intact dominant shell with a bounded register lift',()=>{
 expect(upperStructureTriad([58,62,64,69],0)).toEqual({notes:[52,58,62,66,69],addedMidi:66});
 expect(upperStructureTriad([64,69,70,74],0)).toEqual({notes:[58,64,66,69,74],addedMidi:66});
 expect(upperStructureTriad([52,57,62,67],0)).toBeUndefined(); // no seventh
 expect(upperStructureTriad([52,57,58,62],0)).toEqual({notes:[52,58,62,66,69],addedMidi:66}); // bounded seven-semitone lift
});
it('declines upper structure over overlapping fifth or fourth bass but ignores later notes',()=>{
 const event={time:'192i',duration:.4};
 expect(upperStructureFitsBass(event,[{...bass[0],midi:36}],0,120,192,54)).toBe(true);
 expect(upperStructureFitsBass(event,[{...bass[0],time:'192i',midi:43}],0,120,192,54)).toBe(false);
 expect(upperStructureFitsBass(event,[{...bass[0],time:'384i',midi:43}],0,120,192,54)).toBe(true);
 expect(upperStructureFitsBass(event,[{...bass[0],time:'192i',midi:43}],0,120,192,66)).toBe(true); // widely spaced dominant color
 expect(upperStructureFitsBass(event,undefined,0,120,192,54)).toBe(false);
});
