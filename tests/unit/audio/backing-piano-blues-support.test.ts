import { expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';

it('never drops all keyboard support for the middle four bars of a Blues chorus',()=>{
 const {phrase}=buildListeningTuneSession({tuneId:MANKUNKU_BLUES.id,soloChoruses:2});
 const gaps:unknown[]=[];
 for(const style of ['swing','straight'] as const)for(const tempo of [120,140])for(let seed=0;seed<64;seed++){
  const score=createRollingBacking(phrase.harmony,BACKING_STYLES[style],{phraseId:phrase.id,tempo,ppq:192,beatsPerBar:4,swing:resolveBackingSwing(.67,BACKING_STYLES[style],tempo),performanceForm:phrase.performanceForm,sectionMap:phrase.sectionMap,ensemble:{}},releasedBackingOptions('piano',seed));
  let checkpoint:RollingBackingCheckpoint|undefined;
  const bars=Array.from({length:score.totalBars},()=>{const result=advanceRollingBacking(score,checkpoint);checkpoint=result.checkpoint;return result;});
  for(const start of [8,20,32,44])if(bars.slice(start,start+4).every(b=>!b.compEvents.length))gaps.push({style,tempo,seed,start,plans:bars.slice(start,start+4).map(b=>({piano:b.ensemblePlan.bars[0].piano,motif:b.ensembleDevelopment.pianoMotifs[0]}))});
 }
 console.log('BLUES_MIDDLE_GAPS',JSON.stringify(gaps));
 expect(gaps).toEqual([]);
});

it('refits the permitted attacks without overriding rests, ownership or checkpoint replay',()=>{
 const {phrase}=buildListeningTuneSession({tuneId:MANKUNKU_BLUES.id,soloChoruses:2});
 const params={phraseId:phrase.id,tempo:140,ppq:192,beatsPerBar:4,swing:resolveBackingSwing(.62,BACKING_STYLES.swing,140),performanceForm:phrase.performanceForm,sectionMap:phrase.sectionMap,ensemble:{}};
 const current=createRollingBacking(phrase.harmony,BACKING_STYLES.swing,params,releasedBackingOptions('piano',10));
 const legacy=createRollingBacking(phrase.harmony,BACKING_STYLES.swing,params,{...releasedBackingOptions('piano',10),pianoContinuity:true});
 let checkpoint:RollingBackingCheckpoint|undefined,previous:RollingBackingCheckpoint|undefined,refits=0;
 for(let bar=0;bar<current.totalBars;bar++){
  const result=advanceRollingBacking(current,checkpoint),old=advanceRollingBacking(legacy,previous);
  expect(advanceRollingBacking(current,checkpoint?JSON.parse(JSON.stringify(checkpoint)):undefined)).toEqual(result);
  const plan=result.ensemblePlan.bars[0],motif=result.ensembleDevelopment.pianoMotifs[0];
  if([20,21,32,33].includes(bar)){
   expect(old.compEvents).toHaveLength(0);
   expect(result.compEvents).toHaveLength(1);
   expect(motif.reason).toBe('gesture_refit');refits++;
  }
  if([22,23,34,35].includes(bar))expect(result.compEvents).toHaveLength(0);
  if(motif.reason==='gesture_refit'){
   expect(plan.responseOwner).toBe('nobody');expect(plan.coordinatedAccent).toBeUndefined();
   expect(new Set(result.compEvents.map(e=>e.time)).size).toBeLessThanOrEqual(plan.piano.maxAttacks);
  }
  checkpoint=result.checkpoint;previous=old.checkpoint;
 }
 expect(refits).toBe(4);
 expect(()=>advanceRollingBacking(legacy,checkpoint)).toThrow();
});
