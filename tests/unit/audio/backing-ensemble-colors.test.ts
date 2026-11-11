import {expect,it} from 'vitest';
import {arpeggiateWalk,dropThirdVoice,crossStickUnderChord,spreadFitsBass} from '$lib/audio/backing-ensemble-colors';
import type {BassEvent,CompEvent} from '$lib/audio/backing-generation';
const bass: BassEvent[]=[41,43,45,43].map((midi,i)=>({midi,absBeat:i,time:`${i*192}i`,duration:.4,velocity:80}));
it('outlines root-third-fifth while retaining the final approach and every pulse envelope',()=>{
 const out=arpeggiateWalk(bass,0,5,4);
 expect(out.map(e=>e.midi)).toEqual([41,45,48,43]);expect(out[3]).toEqual(bass[3]);
 expect(out.map(({midi,ensembleColor,...e})=>e)).toEqual(bass.map(({midi,...e})=>e));
 expect(arpeggiateWalk(bass.slice(1),0,5,4)).toEqual(bass.slice(1));
 expect(arpeggiateWalk(bass.map((e,i)=>({...e,midi:i===3?28:e.midi})),0,5,4).some(e=>e.ensembleColor)).toBe(false);
});
it('drops the third voice from the top without changing pitch classes or upper melody',()=>{
 expect(dropThirdVoice([55,60,64,70])).toEqual({notes:[48,55,64,70],fromMidi:60,toMidi:48});
 expect(dropThirdVoice([52,57,60,64])?.notes).toEqual([45,52,60,64]);
 expect(dropThirdVoice([51,56,60,64])).toBeUndefined(); // below the new lower register
 expect(dropThirdVoice([52,57,60,74])).toBeUndefined(); // wider than the admitted span
 expect(dropThirdVoice([48,52,55,58])).toBeUndefined();
 expect(dropThirdVoice([48,60,64,70])).toBeUndefined(); // duplicate/crossing
 expect(dropThirdVoice([55,60,64])).toBeUndefined();
});
it('uses an existing later snare under a sustained wide chord, not an anticipated or released chord',()=>{
 const comp:CompEvent={time:'192i',absBeat:1,duration:1.2,notes:[48,55,64,70],velocity:70};
 const hits=[{drum:'ride' as const,beatOffset:2,velocity:.5,role:'timekeeping' as const},{drum:'snare' as const,beatOffset:2,velocity:.3,role:'commentary' as const}];
 const out=crossStickUnderChord(hits,[comp],0,120,192);
 expect(out[0]).toEqual(hits[0]);expect(out[1].drum).toBe('crossstick');expect(out[1].velocity).toBeCloseTo(.255);
 expect(out[1].ensembleColor?.kind).toBe('cross-stick');
 expect(crossStickUnderChord(hits,[{...comp,duration:.2}],0,120,192)).toEqual(hits);
 expect(crossStickUnderChord(hits,[{...comp,absBeat:3,time:'576i'}],0,120,192)).toEqual(hits);
 expect(crossStickUnderChord(hits,[],0,120,192)).toEqual(hits);
});

it('keeps at least a fifth above overlapping bass and refuses unknown bass evidence',()=>{
 const comp={time:'192i',duration:.5};
 expect(spreadFitsBass(comp,48,[{...bass[0],midi:42,time:'192i'}],120,192)).toBe(false);
 expect(spreadFitsBass(comp,48,[{...bass[0],midi:41,time:'192i'}],120,192)).toBe(true);
 expect(spreadFitsBass(comp,48,[{...bass[0],midi:42,time:'384i'}],120,192)).toBe(true);
 expect(spreadFitsBass(comp,48,undefined,120,192)).toBe(false);
});
it('checks the swung scheduled snare time against the real release',()=>{
 const hits=[{drum:'snare' as const,beatOffset:1.5,velocity:.3,role:'commentary' as const}];
 const comp:CompEvent={time:'0i',absBeat:0,duration:.8,notes:[48,55,64,70],velocity:70};
 expect(crossStickUnderChord(hits,[comp],0,120,192,()=>320)).toEqual(hits);
});
