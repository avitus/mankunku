/** Captured from the verified 0.19 source image, never from the candidate engine. */
import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES, RHYTHM_CHANGES } from '$lib/data/tunes';
it('preserves the complete 0.19 events, traces and checkpoints without the new piano continuity option',()=>{
 const hashes:Record<string,string>={};
 for(const tune of [MANKUNKU_BLUES,RHYTHM_CHANGES])for(const style of ['swing','straight','bossa-nova','ballad'] as const)for(const instrument of ['piano','organ'] as const){
  const {phrase}=buildListeningTuneSession({tuneId:tune.id,soloChoruses:2});
  const score=createRollingBacking(phrase.harmony,BACKING_STYLES[style],{phraseId:phrase.id,tempo:140,ppq:192,beatsPerBar:4,swing:style==='swing'?.62:.5,performanceForm:phrase.performanceForm,sectionMap:phrase.sectionMap,ensemble:{}},{...releasedBackingOptions(instrument,3),rideTriplet:undefined,rhythmMemory:undefined,balladThird:undefined,brokenTwo:undefined,dominantRiff:undefined,balladReturn:undefined,bossaPickup:undefined,performanceTouch:undefined,keyboardSustain:'common-tones',pianoContinuity:undefined});
  let checkpoint:RollingBackingCheckpoint|undefined;const hash=createHash('sha256');
  for(let bar=0;bar<score.totalBars;bar++){const result=advanceRollingBacking(score,checkpoint);hash.update(JSON.stringify(result));checkpoint=result.checkpoint;}
  hashes[`${tune.id}/${style}/${instrument}`]=hash.digest('hex');
 }
 const path='tests/fixtures/musicality-019-sustain.json';
 if(process.env.CAPTURE_MUSICALITY_019==='1'){writeFileSync(path,JSON.stringify(hashes,null,2)+'\n');return;}
 expect(hashes).toEqual(JSON.parse(readFileSync(path,'utf8')));
});
