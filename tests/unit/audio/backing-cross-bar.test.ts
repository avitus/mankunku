import { describeMusicianDecisions } from '$lib/musicality/musician-decisions';
import type { CompEvent } from '$lib/audio/backing-generation';
import { it, expect } from 'vitest';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { RHYTHM_CHANGES } from '$lib/data/tunes';
import { fractionToFloat } from '$lib/music/intervals';
const {phrase}=buildListeningTuneSession({tuneId:RHYTHM_CHANGES.id,soloChoruses:2});
for(const style of ['swing','straight','bossa-nova','ballad'] as const)for(const instrument of ['piano','organ'] as const)
 it(`${style}/${instrument}: crosses selected bar lines, breathes with support, restores exactly and closes at form boundaries`,()=>{
  let carries=0;
  for(const seed of [3,7,256]){
   const selected=style==='bossa-nova'?assessListeningTune(LOCAL_LISTENING_AABA,{soloChoruses:2}):null;
   const tune=selected?.ok?selected.session.phrase:phrase;
   const score=createRollingBacking(tune.harmony,BACKING_STYLES[style],{phraseId:tune.id,tempo:style==='ballad'?80:140,ppq:192,beatsPerBar:4,swing:style==='swing'?.62:.5,performanceForm:tune.performanceForm,sectionMap:tune.sectionMap,ensemble:{}},{...releasedBackingOptions(instrument,seed),keyboardSustain:true,...(seed===7?{loopCount:2}:{})});
   let previous:RollingBackingCheckpoint|undefined;
   let precedingComp:CompEvent[]=[];
   for(let bar=0;bar<score.totalBars;bar++){
    const result=advanceRollingBacking(score,previous);
    expect(advanceRollingBacking(score,previous?JSON.parse(JSON.stringify(previous)):undefined)).toEqual(result);
    for(const e of result.compEvents){
     const end=parseInt(e.time,10)+e.duration*score.tempo/60*score.ppq;
     if(end>(bar+1)*4*score.ppq+1e-7){
      carries++;
      expect(e.barLineSustain).toBeTruthy();
      expect(end).toBeLessThanOrEqual(((bar+1)*4+1)*score.ppq+1e-7);
      expect(score.bars[bar].sourceChorusIndex).toBe(score.bars[bar+1].sourceChorusIndex);
      expect(score.bars[bar].loopIndex).toBe(score.bars[bar+1].loopIndex);
      expect(score.bars[bar].sourceSectionIndex).toBe(score.bars[bar+1].sourceSectionIndex);
      const current=score.harmony.find(h=>e.absBeat>=fractionToFloat(h.startOffset)*4&&e.absBeat<(fractionToFloat(h.startOffset)+fractionToFloat(h.duration))*4)!;
      for(const h of score.harmony.filter(h=>fractionToFloat(h.startOffset)*4<end/score.ppq&&(fractionToFloat(h.startOffset)+fractionToFloat(h.duration))*4>(bar+1)*4))expect(h.chord).toEqual(current.chord);
      expect(result.checkpoint.piano.crossBarReleaseTick).toBeCloseTo(end,7);
     }
    }
    if(previous?.piano.crossBarReleaseTick&&result.ensembleDevelopment.pianoMotifs[0].carriedReleaseTick!==undefined){
     expect(result.compEvents.length).toBeGreaterThan(0);
     expect(Math.min(...result.compEvents.map(e=>parseInt(e.time,10)))).toBeGreaterThanOrEqual(previous.piano.crossBarReleaseTick);
     expect(result.drumEvents.some(e=>e.role==='timekeeping')).toBe(true);
     expect(result.drumEvents.some(e=>e.role==='commentary')).toBe(false);
     const cards=describeMusicianDecisions({...result,bassEvents:[...result.bassEvents],drumEvents:[...result.drumEvents],compEvents:[...precedingComp,...result.compEvents]},{barIndex:bar,ppq:score.ppq,beatsPerBar:4,style,orchestration:'coordinated'});
     expect(cards[1].action).toBe('Breathe over the held harmony');
    }
    precedingComp=[...result.compEvents];
    previous=result.checkpoint;
   }
  }
  expect(carries).toBeGreaterThan(0);
 });

it('future observations cannot rewrite a committed carry or renew it into a second bar',()=>{
 const score=createRollingBacking(phrase.harmony,BACKING_STYLES.swing,{phraseId:phrase.id,tempo:160,ppq:192,beatsPerBar:4,swing:.62,performanceForm:phrase.performanceForm,sectionMap:phrase.sectionMap,ensemble:{}},releasedBackingOptions('organ',3));
 let checkpoint:RollingBackingCheckpoint|undefined, witnessed=false;
 for(let bar=0;bar<score.totalBars-1;bar++){
  const result=advanceRollingBacking(score,checkpoint);
  if(result.compEvents.some(e=>e.barLineSustain)){
   witnessed=true;const saved=JSON.stringify(result);
   const future={barIndex:bar+1,observedAtBar:bar,source:'microphone' as const,confidence:.95,noteDensity:1,restBeats:0};
   expect(advanceRollingBacking(score,checkpoint,[future])).toEqual(result);
   const next=advanceRollingBacking(score,result.checkpoint,[future]);
   expect(next.compEvents.some(e=>e.barLineSustain)).toBe(false);
   expect(next.drumEvents.some(e=>e.role==='timekeeping')).toBe(true);
   expect(JSON.stringify(result)).toBe(saved);
   const damaged=JSON.parse(saved).checkpoint as RollingBackingCheckpoint;
   expect(()=>advanceRollingBacking(score,{...damaged,piano:{...damaged.piano,crossBarReleaseTick:0}})).toThrow('Invalid rolling checkpoint');
   break;
  }
  checkpoint=result.checkpoint;
 }
 expect(witnessed).toBe(true);
});
