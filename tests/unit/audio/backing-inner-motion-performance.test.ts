import { createHash } from 'node:crypto';
import baseline from '../../fixtures/audio/musicality-0.15-hashes.json';
import { expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';
import { describeMusicianDecisions } from '$lib/musicality/musician-decisions';
import type { GeneratedBacking } from '$lib/audio/backing-generation';

type Style = 'swing' | 'straight' | 'bossa-nova' | 'ballad';
function fixture(style: Style, tune: 'blues' | 'aaba' = 'blues', seed = 42, swing = .67) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const session = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const { phrase } = session, tempo = style === 'ballad' ? 80 : 140;
 const make = (keyboardSuspensions?: true | 'developed', loopCount = 1, instrument: 'piano'|'organ' = 'piano', hold = false, phraseExpression = false, trioConversation = false, phraseColors = false, ensembleColors = false, phraseDialogue = false, innerMotion = false) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(swing, BACKING_STYLES[style], tempo),
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}, ...(hold ? {terminalArrangement:{ending:'hold-release' as const,melody:phrase.notes}} : {})
 }, { ...(innerMotion?{innerMotion:true as const}:{}), ...(phraseDialogue?{phraseDialogue:true as const}:{}), ...(ensembleColors?{ensembleColors:true as const}:{}), ...(phraseColors?{phraseColors:true as const}:{}), returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
  chorusBoundaryPriority: true, loopCount, ...(trioConversation?{trioConversation:true as const}:{}), ...(phraseExpression ? {phraseExpression:true as const} : {}), keyboardTexture: true, keyboardPhrasing:instrument, bassDelayedRoot:true, keyboardContraryMotion:true, drumPhraseCushioning:true, ...(keyboardSuspensions ? { keyboardSuspensions } : {}) });
 return { make, session };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint; return result;
 });
}




const scoreFor=(style:Style,tune:'blues'|'aaba',seed:number,instrument:'piano'|'organ',enabled=true,loop=1,hold=false,swing=.62)=>fixture(style,tune,seed,swing).make('developed',loop,instrument,hold,true,true,true,true,true,enabled);
for(const style of ['swing','straight','bossa-nova','ballad'] as const){
 it(`${style}: omission preserves the complete 0.15 baseline`,()=>{
  for(const tune of ['blues','aaba'] as const)for(const seed of [42,7,19])for(const instrument of ['piano','organ'] as const)
   expect(createHash('sha256').update(JSON.stringify(run(scoreFor(style,tune,seed,instrument,false,1,false,.67)))).digest('hex')).toBe(baseline.hashes[[style,tune,seed,instrument].join('/') as keyof typeof baseline.hashes]);
 });
 it(`${style}: complete tunes keep native support, actual memory and exact checkpoint replay`,()=>{
  const counts={bass:0,piano:0,drums:0};
  for(const tune of ['blues','aaba'] as const)for(const seed of [42,7,19,1,2,256])for(const instrument of ['piano','organ'] as const){
   const score=scoreFor(style,tune,seed,instrument),bars=run(score),old=run(scoreFor(style,tune,seed,instrument,false));
   const witness={bass:[] as number[],piano:[] as number[],drums:[] as number[]};
   for(const [i,b] of bars.entries()){
    for(const key of ['bassEvents','compEvents','drumEvents'] as const)expect(b[key].map(e=>[e.time,e.absBeat])).toEqual(old[i][key].map(e=>[e.time,e.absBeat]));
    expect(b.compEvents.map(e=>e.duration)).toEqual(old[i].compEvents.map(e=>e.duration));
    expect(b.bassEvents.map(e=>[e.duration,e.velocity])).toEqual(old[i].bassEvents.map(e=>[e.duration,e.velocity]));
    expect(advanceRollingBacking(score,i?JSON.parse(JSON.stringify(bars[i-1].checkpoint)):undefined)).toEqual(b);
    if(['bossa-nova','ballad'].includes(style)){expect(b.bassEvents).toEqual(old[i].bassEvents);expect(b.drumEvents).toEqual(old[i].drumEvents);}
    for(const e of b.bassEvents)if(e.innerMotion?.kind==='ninth-pulse'){
     counts.bass++;witness.bass.push(i+1);expect(e.absBeat).toBe(i*4+2);expect((e.midi-e.innerMotion.rootMidi+120)%12).toBe(2);
     expect(Math.abs(e.midi-b.bassEvents[1].midi)).toBeLessThanOrEqual(5);expect(Math.abs(e.midi-b.bassEvents[3].midi)).toBeLessThanOrEqual(5);
     expect(b.checkpoint.bass.previousPreviousMidi).toBe(e.midi);expect(b.checkpoint.bass.previousMidi).toBe(b.bassEvents.at(-1)!.midi);
    }
    for(const e of b.compEvents)if(e.innerMotion?.kind==='chromatic-inner'&&e.innerMotion.phase==='approach'){
     counts.piano++;witness.piano.push(i+1);const c=e.innerMotion,last=b.compEvents[1];
     expect(last.innerMotion).toEqual({...c,phase:'resolution'});expect(e.notes.slice(1,-1)).toContain(c.fromMidi);expect(last.notes.slice(1,-1)).toContain(c.toMidi);expect(c.toMidi-c.fromMidi).toBe(1);
     expect(parseInt(e.time)+e.duration*score.tempo/60*192).toBeLessThanOrEqual(parseInt(last.time)+1e-8);
     expect(b.checkpoint.piano.lastVoicing).toEqual(last.notes);expect(b.ensembleDevelopment.pianoVoicings![0].decision.chromaticInner).toEqual(c);
    }
    for(const e of b.drumEvents)if(e.innerMotion?.kind==='hat-lift'){
     counts.drums++;witness.drums.push(i+1);expect(e.drum).toBe('hihat-pedal');expect(e.absBeat).toBe(i*4+3);expect(e.velocity).toBe(e.innerMotion.originalVelocity*1.5);expect(e.velocity).toBeLessThanOrEqual(.825);
    }
    for(const [key,player,label] of [['bassEvents','bass','Walk through the ninth'],['compEvents','piano','Resolve an inner voice'],['drumEvents','drums','Lift the foot hi-hat']] as const)if(b[key].some(e=>e.innerMotion)){
     const g=JSON.parse(JSON.stringify(b)) as GeneratedBacking,context={barIndex:i,ppq:192,beatsPerBar:4,style,orchestration:'coordinated' as const};
     expect(describeMusicianDecisions(g,context).find(c=>c.instrument===player)!.action).toBe(label);
     if(player==='bass')g.bassEvents[0].midi++;
     if(player==='piano')g.compEvents[0].notes[1]++;
     if(player==='drums')g.drumEvents.find(e=>e.innerMotion)!.velocity+=.1;
     expect(describeMusicianDecisions(g,context).find(c=>c.instrument===player)!.action).not.toBe(label);
    }
   }
   process.stdout.write(`inner-witness ${style}/${tune}/${instrument}/${seed} ${JSON.stringify(witness)}\n`);
  }
  expect(counts.piano).toBeGreaterThan(0);
  if(style==='swing'||style==='straight'){expect(counts.bass).toBeGreaterThan(0);expect(counts.drums).toBeGreaterThan(0);}
  process.stdout.write(`inner-total ${style} ${JSON.stringify(counts)}\n`);
 });
}
it('protects dense observations, final arrangements, future independence, old identities and loop replay',()=>{
 for(const style of ['swing','straight','bossa-nova','ballad'] as const){
  const score=scoreFor(style,'blues',42,'piano',true,2,true),bars=run(score);
  expect(()=>advanceRollingBacking(scoreFor(style,'blues',42,'piano',false,2,true),bars[0].checkpoint)).toThrow();
  for(const i of [51,52,53,103])expect(advanceRollingBacking(score,JSON.parse(JSON.stringify(bars[i-1].checkpoint)))).toEqual(bars[i]);
  expect([...bars.at(-1)!.bassEvents,...bars.at(-1)!.compEvents,...bars.at(-1)!.drumEvents].some(e=>e.innerMotion)).toBe(false);
  for(const b of bars.filter(b=>[...b.bassEvents,...b.compEvents,...b.drumEvents].some(e=>e.innerMotion))){
   const obs={barIndex:b.fromBar,observedAtBar:b.fromBar,source:'scripted' as const,confidence:1,noteDensity:1,restBeats:0};
   const dense=advanceRollingBacking(score,bars[b.fromBar-1].checkpoint,[obs]);expect([...dense.bassEvents,...dense.compEvents,...dense.drumEvents].some(e=>e.innerMotion)).toBe(false);
   expect(advanceRollingBacking(score,bars[b.fromBar-1].checkpoint,[{...obs,barIndex:b.fromBar+1,observedAtBar:b.fromBar+1}])).toEqual(b);
  }
 }
});

it('the listening example contains all three actual gestures for both keyboards and swing settings',()=>{
 for(const instrument of ['piano','organ'] as const)for(const swing of [.62,.67]){
  const bars=run(scoreFor('swing','blues',256,instrument,true,1,false,swing));
  expect(bars[17].compEvents.some(e=>e.innerMotion?.kind==='chromatic-inner')).toBe(true);
  expect(bars[23].drumEvents.some(e=>e.innerMotion?.kind==='hat-lift')).toBe(true);
  expect(bars[36].bassEvents.some(e=>e.innerMotion?.kind==='ninth-pulse')).toBe(true);
 }
});
