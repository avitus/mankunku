import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint, type RollingBackingOptions } from '$lib/audio/backing-rolling';
import { HISTORICAL_MUSICALITY_STYLES as BACKING_STYLES } from '../../helpers/musicality-style-fixtures';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { buildNativeBluesFixture } from '../../fixtures/musicality-native-blues';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';
const styles = ['swing','straight','bossa-nova','ballad'] as const;
function make(style: typeof styles[number], added: RollingBackingOptions = {}, seed=42, aaba=false, hold=false) {
 const admission=assessListeningTune(LOCAL_LISTENING_AABA,{soloChoruses:2});
 if(!admission.ok) throw new Error(admission.reason);
 const phrase=aaba?admission.session.phrase:buildNativeBluesFixture();
 const tempo=style==='ballad'?80:140;
 return createRollingBacking(phrase.harmony!,BACKING_STYLES[style],{phraseId:phrase.id,tempo,ppq:192,beatsPerBar:4,
 swing:resolveBackingSwing(.67,BACKING_STYLES[style],tempo),sectionMap:phrase.sectionMap,performanceForm:phrase.performanceForm,ensemble:{},...(hold?{terminalArrangement:{ending:'hold-release' as const,melody:buildListeningTuneSession({tuneId:MANKUNKU_BLUES.id,soloChoruses:2}).phrase.notes}}:{})},
 {returningMelodySpace:true,performanceEnergySeed:seed,pianoPresence:'accompaniment',keyboardVariety:'developed',chorusBoundaryPriority:true,keyboardTexture:true,keyboardPhrasing:'piano',...added});
}
function run(score:ReturnType<typeof make>) {
 let checkpoint:RollingBackingCheckpoint|undefined;
 return Array.from({length:score.totalBars},()=>{const bar=advanceRollingBacking(score,checkpoint);checkpoint=bar.checkpoint;return bar;});
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
describe('0.8 ensemble development release contracts',()=>{
 it('preserves exact 0.7 output when new policies are omitted',()=>{
 const hashes={swing:'d2eb721e3cfdaa4fc66b357ca1d8e56ec82ae08541a168c5d5ebf7a634fe6e9b',straight:'4ca36243526ff72c38f783bccc338e353cded109ee25687937187919cf78ed28','bossa-nova':'aaf7d9a4e9af9b1e91feb4446ad32ec6a3042ce7bc2e778816f3e6bf12d5e91a',ballad:'c9b7e095c2274cd4792d640e4d11c7b37b2bc589a9c7b5a53c9d8fb97308f425'};
 for(const style of styles) expect(digest(run(make(style)))).toBe(hashes[style]);
 });
 it.each(styles)('%s binds the new policies to checkpoint identity',style=>{
  const old=make(style), score=make(style,{bassDelayedRoot:true,keyboardContraryMotion:true,drumPhraseCushioning:true});
  expect(score.fingerprint).not.toBe(old.fingerprint);
  expect(score.bassDelayedRootVersion).toBe(1);
  expect(score.keyboardContraryMotionVersion).toBe(1);
  expect(score.drumPhraseCushioningVersion).toBe(1);
  const first=advanceRollingBacking(score);
  expect(()=>advanceRollingBacking(old,first.checkpoint)).toThrow();
  for(const options of [{bassDelayedRoot:true},{keyboardContraryMotion:true},{drumPhraseCushioning:true}] as const) {
   const isolated=make(style,options);
   expect(isolated.fingerprint).not.toBe(old.fingerprint);
   expect(isolated.fingerprint).not.toBe(score.fingerprint);
   expect(()=>advanceRollingBacking(isolated,first.checkpoint)).toThrow();
  }
  const cloned=JSON.parse(JSON.stringify(first.checkpoint));
  expect(advanceRollingBacking(score,cloned)).toEqual(advanceRollingBacking(score,first.checkpoint));
 });
});
const policies={bassDelayedRoot:true,keyboardContraryMotion:true,drumPhraseCushioning:true} as const;
describe('0.8 full-performance interaction and replay',()=>{
 for(const style of styles) it(`${style} exposes all three gestures across complete Blues and AABA performances`,()=>{
  const counts={bass:0,keyboard:0,drums:0};
  for(const aaba of [false,true]) for(const seed of [42,7,19]) {
   const score=make(style,policies,seed,aaba), bars=run(score), old=run(make(style,{},seed,aaba));
   if(seed===42 && !aaba) process.stdout.write(`default-eight ${style} ${JSON.stringify({bass:bars.filter(b=>b.ensembleDevelopment.bassDelayedRoots?.length).map(b=>b.fromBar+1),keyboard:bars.filter(b=>b.ensembleDevelopment.pianoVoicings?.some(v=>v.decision.keyboardContraryMotion?.status==='changed')).map(b=>b.fromBar+1),contraryRetained:bars.filter(b=>b.ensembleDevelopment.pianoVoicings?.some(v=>v.decision.keyboardContraryMotion?.status==='retained')).map(b=>b.fromBar+1),drums:bars.filter(b=>b.ensembleDevelopment.drumPhrases.some(d=>d.cushioning)).map(b=>b.fromBar+1)})}\n`);
   // The bass rhythmic footprint stays exact. Drum easing may change subsequent
   // dialogue choices, so the keyboard may choose a different legal cell.
   expect(bars.map(b=>b.bassEvents.map(e=>[e.time,e.absBeat,e.duration,e.velocity]))).toEqual(old.map(b=>b.bassEvents.map(e=>[e.time,e.absBeat,e.duration,e.velocity])));
   for(const bar of bars) {
    counts.bass+=bar.ensembleDevelopment.bassDelayedRoots?.length??0;
    counts.keyboard+=(bar.ensembleDevelopment.pianoVoicings??[]).filter(v=>v.decision.keyboardContraryMotion?.status==='changed').length;
    counts.drums+=bar.ensembleDevelopment.drumPhrases.filter(d=>d.cushioning).length;
    expect(bar.bassEvents.length).toBeGreaterThan(0);
    for(const e of [...bar.bassEvents,...bar.compEvents]) {
     expect(parseInt(e.time)).toBeGreaterThanOrEqual(bar.startTick);
     expect(parseInt(e.time)+e.duration*score.tempo/60*score.ppq).toBeLessThanOrEqual(bar.committedThroughTick+1e-7);
    }
    const replay=advanceRollingBacking(score,bar.fromBar?JSON.parse(JSON.stringify(bars[bar.fromBar-1].checkpoint)):undefined);
    expect(replay).toEqual(bar);
   }
   // Future observations cannot rewrite the current decision.
   const future={barIndex:score.totalBars+1,observedAtBar:score.totalBars+1,confidence:1,activity:'dense'} as never;
   expect(advanceRollingBacking(score,undefined,[future])).toEqual(bars[0]);
  }
  process.stdout.write(`release-eight ${style}/Blues+AABA ${JSON.stringify(counts)}\n`);
  expect(counts.bass).toBeGreaterThan(0); expect(counts.keyboard).toBeGreaterThan(0); expect(counts.drums).toBeGreaterThan(0);
 });
 it.each(styles)('%s retains checkpoint replay over a declared loop seam',style=>{
  // 52-bar blues repeated twice stays below the finite admission ceiling.
  const score=make(style,{...policies,loopCount:2}),bars=run(score),seam=score.sourceBars;
  expect(advanceRollingBacking(score,JSON.parse(JSON.stringify(bars[seam-1].checkpoint)))).toEqual(bars[seam]);
  expect(bars[seam].loopIndex).toBe(1);
 });
});

describe('0.8 shared protection and instruments',()=>{
 for(const style of styles) for(const instrument of ['piano','organ'] as const) it(`${style}/${instrument} protects dense observations and final release`,()=>{
  const score=make(style,{...policies,keyboardPhrasing:instrument},42,false,true),bars=run(score);
  const reservation=score.terminalArrangement!;expect(reservation).toBeDefined();
  const ending=bars[reservation.barIndex];
  expect(ending.bassEvents).toHaveLength(1);expect(ending.compEvents).toHaveLength(1);
  expect(ending.ensembleDevelopment.bassDelayedRoots).toBeUndefined();
  expect(ending.ensembleDevelopment.drumPhrases.every(d=>!d.cushioning)).toBe(true);
  expect(ending.ensembleDevelopment.pianoVoicings?.every(v=>!v.decision.keyboardContraryMotion)).toBe(true);
  expect(ending.compEvents[0].duration).toBeCloseTo(reservation.holdBeats*60/score.tempo,9);
  const index=bars.findIndex((bar,i)=>i>0&&bar.ensemblePlan.bars[0].boundaryStrength<.85&&bar.compEvents.length>0);
  expect(index).toBeGreaterThan(0);
  const checkpoint=bars[index-1].checkpoint;
  const observation={barIndex:index,observedAtBar:index,source:'scripted' as const,confidence:1,noteDensity:1,restBeats:0};
  const dense=advanceRollingBacking(score,checkpoint,[observation]);
  expect(dense.ensembleDevelopment.bassDelayedRoots).toBeUndefined();
  expect(dense.ensembleDevelopment.drumPhrases.every(d=>!d.cushioning)).toBe(true);
  expect(dense.ensembleDevelopment.pianoVoicings?.every(v=>!v.decision.keyboardContraryMotion)).toBe(true);
  expect(advanceRollingBacking(score,checkpoint,[{...observation,barIndex:index+1,observedAtBar:index+1}])).toEqual(bars[index]);
 });
});
