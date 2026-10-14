import { describe, it, expect } from 'vitest';
import { tuneHarmonyMarkers, harmonyRole } from '$lib/tunes/harmony-colors';
import type { Tune } from '$lib/types/tune';
import type { HarmonicSegment } from '$lib/types/music';
const segment = (root: HarmonicSegment['chord']['root'], quality: HarmonicSegment['chord']['quality']): HarmonicSegment => ({chord:{root,quality},scaleId:'major.ionian',startOffset:[0,1],duration:[1,1]});
describe('tune harmony colors',()=>{
 it('recognizes familiar relative roles without guessing unfamiliar changes',()=>{
  expect(harmonyRole(segment('D','maj6'),'D')).toBe('tonic');
  expect(harmonyRole(segment('E','min7'),'D')).toBe('subdominant');
  expect(harmonyRole(segment('G','maj7'),'D')).toBe('subdominant');
  expect(harmonyRole(segment('A','7'),'D')).toBe('dominant');
  expect(harmonyRole(segment('Ab','maj7'),'D')).toBeNull();
 });
 it('maps partial-bar segments into notation order in 3/4, without expanding repeats',()=>{
  const tune: Tune={id:'x',title:'x',key:'C',timeSignature:[3,4],tags:[],source:'user',sections:[{label:'A',bars:2,repeatStart:true,repeatEnd:true,notes:[],harmony:[]},{label:'B',bars:2,notes:[],harmony:[{...segment('G','7'),startOffset:[1,4],duration:[1,1]}]}]};
  expect(tuneHarmonyMarkers(tune)).toEqual([{id:'harmony-1-0',startBar:2,endBarExclusive:4,timeRange:{start:1.75,end:2.75},status:'upcoming',color:'var(--tune-dominant)'}]);
 });
});
