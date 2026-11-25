import {expect,it} from 'vitest';
import {MANKUNKU_BLUES} from '$lib/data/tunes';
import {BACKING_STYLES} from '$lib/audio/backing-styles';
import {buildListeningTuneSession} from '$lib/musicality/listening-tunes';
import {releasedBackingOptions} from '$lib/audio/backing-release';
import {advanceRollingBacking,createRollingBacking,type RollingBackingCheckpoint} from '$lib/audio/backing-rolling';

it('plays a recent pitched rhythm one beat away on the kit (S3, S38, S39, D27–29)',()=>{
 const {phrase}=buildListeningTuneSession({tuneId:MANKUNKU_BLUES.id,soloChoruses:2});
 const style=BACKING_STYLES.swing;
 const params={phraseId:phrase.id,tempo:128,ppq:192,beatsPerBar:4,swing:style.defaultSwing,performanceForm:phrase.performanceForm,sectionMap:phrase.sectionMap,ensemble:{}};
 const options=releasedBackingOptions('piano',3);
 const score=createRollingBacking(phrase.harmony,style,params,options);
 const oldScore=createRollingBacking(phrase.harmony,style,params,{...options,displacedRhythm:undefined});
 const played: ReturnType<typeof advanceRollingBacking>[]=[];
 let oldCp:RollingBackingCheckpoint|undefined;
 let cp:RollingBackingCheckpoint|undefined;
 let answers=0;
 for(let bar=0;bar<score.totalBars;bar++){
  const result=advanceRollingBacking(score,cp);
  const old=advanceRollingBacking(oldScore,oldCp);
  oldCp=old.checkpoint;
  const hits=result.drumEvents.filter(e=>e.displacedAnswer);
  if(hits.length){
   expect(hits).toHaveLength(2);
   expect(result.ensemblePlan.bars[0].drums.maxCommentaryHits).toBeGreaterThanOrEqual(2);
   expect(old.drumEvents.filter(e=>e.drum==='snare').map(e=>e.absBeat)).not.toEqual(hits.map(e=>e.absBeat));
   expect(result.drumEvents.filter(e=>e.role==='timekeeping').map(e=>e.absBeat)).toEqual(old.drumEvents.filter(e=>e.role==='timekeeping').map(e=>e.absBeat));
   const cell=hits[0].displacedAnswer!;
   expect([1,2]).toContain(bar-cell.bar);
   expect(result.checkpoint.rhythmMemory!.cells.some(entry=>entry.bar===cell.bar && entry.player===cell.player)).toBe(false);
   expect(result.checkpoint.rhythmMemory!.lastAnswer.drums).toBe(bar);
   const source=cell.player==='piano'?played[cell.bar].compEvents:played[cell.bar].bassEvents;
   expect(source.map(e=>e.absBeat%4)).toEqual(expect.arrayContaining([...cell.offsets]));
   const shift=hits[0].absBeat-bar*4-cell.offsets[0];
   expect(Math.abs(shift)).toBe(1);
   expect(hits.map(e=>e.absBeat%4)).toEqual(cell.offsets.map(t=>t+shift));
   expect(hits.every(e=>e.drum==='snare' && e.role==='commentary')).toBe(true);
   expect(hits[cell.stressed].velocity).toBeGreaterThan(hits[1-cell.stressed].velocity);
   expect(result.drumEvents.filter(e=>e.role==='commentary')).toEqual(hits);
   expect(result.compEvents.some(e=>hits.some(h=>h.absBeat===e.absBeat))).toBe(false);
   expect(advanceRollingBacking(score,JSON.parse(JSON.stringify(cp)))).toEqual(result);
   const busy=advanceRollingBacking(score,cp,[{source:'scripted',barIndex:bar,observedAtBar:bar,confidence:1,noteDensity:1,restBeats:0}]);
   expect(busy.drumEvents.some(e=>e.displacedAnswer)).toBe(false);
   answers++;
  }
  played.push(result);cp=result.checkpoint;
 }
 expect(answers).toBeGreaterThan(0);
 const reply=played[24].drumEvents.filter(e=>e.displacedAnswer);
 expect(reply.map(e=>e.absBeat%4)).toEqual([1,2.5]);
 expect(reply[0].displacedAnswer).toMatchObject({bar:22,player:'piano',offsets:[0,1.5]});
});
