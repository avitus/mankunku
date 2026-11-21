import { expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES, RHYTHM_CHANGES } from '$lib/data/tunes';
import type { CompEvent } from '$lib/audio/backing-generation';

// Gates are a support measure, not a claim about the loudness of decaying samples.
function soundingBeats(events: readonly CompEvent[], tempo: number) {
 const spans=events.map(e=>[parseInt(e.time)/192,parseInt(e.time)/192+e.duration*tempo/60]).sort((a,b)=>a[0]-b[0]);
 let end=0,total=0;
 for(const [a,b] of spans){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
 return total;
}
for(const style of ['swing','straight'] as const)it(`${style}: gives full-tune piano more audible supporting length and connected releases`,()=>{
 let oldBeats=0,newBeats=0,oldAttacks=0,newAttacks=0,carries=0;
 for(const tune of [MANKUNKU_BLUES,RHYTHM_CHANGES])for(const seed of [3,7,256]){
  const {phrase}=buildListeningTuneSession({tuneId:tune.id,soloChoruses:2});
  for(const enabled of [false,true]){
   const score=createRollingBacking(phrase.harmony,BACKING_STYLES[style],{phraseId:phrase.id,tempo:140,ppq:192,beatsPerBar:4,swing:style==='swing'?.62:.5,performanceForm:phrase.performanceForm,sectionMap:phrase.sectionMap,ensemble:{}},{...releasedBackingOptions('piano',seed),pianoContinuity:enabled?true:undefined});
   let checkpoint:RollingBackingCheckpoint|undefined;const events:CompEvent[]=[];
   for(let bar=0;bar<score.totalBars;bar++){
    const result=advanceRollingBacking(score,checkpoint);
    if(enabled)expect(advanceRollingBacking(score,checkpoint?JSON.parse(JSON.stringify(checkpoint)):undefined)).toEqual(result);
    events.push(...result.compEvents);checkpoint=result.checkpoint;
    if(enabled)for(const held of result.compEvents.filter(e=>e.barLineSustain)){
     carries++;expect(held.barLineSustain!.releaseTick-(bar+1)*4*192).toBe(192);
     expect(held.duration).toBeGreaterThan(held.barLineSustain!.originalDuration);
    }
   }
   const attacks=new Set(events.map(e=>e.time)).size,beats=soundingBeats(events,140);
   if(enabled)expect(events.some(e=>e.duration*140/60<.5 && !e.barLineSustain)).toBe(true);
   if(tune===MANKUNKU_BLUES && seed===3)console.log('BLUES_CONTINUITY',JSON.stringify({style,enabled,attacks,soundingBeats:beats,totalBeats:score.totalBars*4}));
   if(enabled){newBeats+=beats;newAttacks+=attacks;}else{oldBeats+=beats;oldAttacks+=attacks;}
  }
 }
 console.log('PIANO_CONTINUITY',JSON.stringify({style,oldBeats,newBeats,oldAttacks,newAttacks,carries}));
 expect(carries).toBeGreaterThan(0);
 expect(newBeats).toBeGreaterThan(oldBeats*1.3);
 expect(newAttacks).toBeGreaterThan(oldAttacks*1.05);
});

it('preserves organ, Bossa and Ballad output exactly',()=>{
 const {phrase}=buildListeningTuneSession({tuneId:MANKUNKU_BLUES.id,soloChoruses:2});
 for(const [style,instrument] of [['swing','organ'],['straight','organ'],['bossa-nova','piano'],['bossa-nova','organ'],['ballad','piano'],['ballad','organ']] as const){
  const create=(enabled:boolean)=>createRollingBacking(phrase.harmony,BACKING_STYLES[style],{phraseId:phrase.id,tempo:140,ppq:192,beatsPerBar:4,swing:.5,performanceForm:phrase.performanceForm,sectionMap:phrase.sectionMap,ensemble:{}},{...releasedBackingOptions(instrument,3),pianoContinuity:enabled?true:undefined});
  const old=create(false),current=create(true);expect(current).toEqual(old);
  let checkpoint:RollingBackingCheckpoint|undefined;
  for(let bar=0;bar<current.totalBars;bar++){const result=advanceRollingBacking(current,checkpoint);expect(result).toEqual(advanceRollingBacking(old,checkpoint));checkpoint=result.checkpoint;}
 }
});
