import { snareKickDialogue } from '$lib/audio/backing-phrase-dialogue';
import { buildNativeAabaFixture } from '../../fixtures/musicality-native-aaba';
import { seedFrom } from '$lib/audio/generation-rng';
import { fractionToFloat } from '$lib/music/intervals';
import { createHash } from 'node:crypto';
import releaseFourteen from '../../fixtures/audio/musicality-0.14-hashes.json';
import { expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { HISTORICAL_MUSICALITY_STYLES as BACKING_STYLES } from '../../helpers/musicality-style-fixtures';
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
 const make = (keyboardSuspensions?: true | 'developed', loopCount = 1, instrument: 'piano'|'organ' = 'piano', hold = false, phraseExpression = false, trioConversation = false, phraseColors = false, ensembleColors = false, phraseDialogue = false) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(swing, BACKING_STYLES[style], tempo),
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}, ...(hold ? {terminalArrangement:{ending:'hold-release' as const,melody:phrase.notes}} : {})
 }, { ...(phraseDialogue?{phraseDialogue:true as const}:{}), ...(ensembleColors?{ensembleColors:true as const}:{}), ...(phraseColors?{phraseColors:true as const}:{}), returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
  chorusBoundaryPriority: true, loopCount, ...(trioConversation?{trioConversation:true as const}:{}), ...(phraseExpression ? {phraseExpression:true as const} : {}), keyboardTexture: true, keyboardPhrasing:instrument, bassDelayedRoot:true, keyboardContraryMotion:true, drumPhraseCushioning:true, ...(keyboardSuspensions ? { keyboardSuspensions } : {}) });
 return { make, session };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint; return result;
 });
}




for(const style of ['swing','straight','bossa-nova','ballad'] as const){
 it(`${style}: preserves every 0.14 baseline when dialogue is omitted`,()=>{
  for(const tune of ['blues','aaba'] as const)for(const seed of [42,7,19])for(const instrument of ['piano','organ'] as const)
   expect(createHash('sha256').update(JSON.stringify(run(fixture(style,tune,seed).make('developed',1,instrument,false,true,true,true,true)))).digest('hex')).toBe(releaseFourteen.hashes[[style,tune,seed,instrument].join('/') as keyof typeof releaseFourteen.hashes]);
 });
 it(`${style}: complete performances retain support, causal sources and exact checkpoint replay`,()=>{
  const counts={bass:0,piano:0,drums:0};
  for(const tune of ['blues','aaba'] as const)for(const seed of [42,7,19,5])for(const instrument of ['piano','organ'] as const){
   const score=fixture(style,tune,seed).make('developed',1,instrument,false,true,true,true,true,true),bars=run(score);
   const old=run(fixture(style,tune,seed).make('developed',1,instrument,false,true,true,true,true));
   const witness={bass:[] as number[],piano:[] as number[],drums:[] as number[]};
   for(const [i,b] of bars.entries()){
    for(const key of ['bassEvents','compEvents','drumEvents'] as const)expect(b[key].map(e=>[e.time,e.absBeat])).toEqual(old[i][key].map(e=>[e.time,e.absBeat]));
    expect(b.compEvents.map(e=>[e.duration,e.phraseDialogue?.kind==='fourth-stack'?e.phraseDialogue.originalVelocity:e.velocity])).toEqual(old[i].compEvents.map(e=>[e.duration,e.velocity]));
    expect(b.bassEvents.map(e=>[e.duration,e.velocity])).toEqual(old[i].bassEvents.map(e=>[e.duration,e.velocity]));
    if(['bossa-nova','ballad'].includes(style)){expect(b.bassEvents).toEqual(old[i].bassEvents);expect(b.drumEvents).toEqual(old[i].drumEvents);}
    expect(advanceRollingBacking(score,i?JSON.parse(JSON.stringify(bars[i-1].checkpoint)):undefined)).toEqual(b);
    for(const e of b.bassEvents)if(e.phraseDialogue?.kind==='opening-recall'){
     counts.bass++;witness.bass.push(i+1);const c=e.phraseDialogue;
     expect(c.sourceBar).toBe(i-1);expect(c.sourceNotes).toEqual(bars[i-1].bassEvents.slice(0,2).map(n=>n.midi));
     expect(Math.abs((e.midi-b.bassEvents[0].midi)-(c.sourceNotes[1]-c.sourceNotes[0]))).toBeLessThanOrEqual(1);
     expect(Math.sign(e.midi-b.bassEvents[0].midi)).toBe(Math.sign(c.sourceNotes[1]-c.sourceNotes[0]));
     expect(b.checkpoint.bass.openingMotif).toBeNull();
     expect(b.checkpoint.bass.previousMidi).toBe(b.bassEvents.at(-1)!.midi);
     expect(b.checkpoint.bass.previousPreviousMidi).toBe(b.bassEvents.at(-2)!.midi);
    }
    for(const e of b.compEvents)if(e.phraseDialogue?.kind==='fourth-stack'){
     counts.piano++;witness.piano.push(i+1);const c=e.phraseDialogue;
     expect(e.velocity).toBe(c.originalVelocity*Math.sqrt(c.originalNotes.length/5));expect(c.velocityScale).toBe(Math.sqrt(c.originalNotes.length/5));
     expect(e.notes).toEqual(c.notes);expect(e.notes.slice(-3).map((n,i,a)=>i?n-a[i-1]:0)).toEqual([0,5,5]);
     expect(e.notes.slice(0,2).map(n=>(n-c.rootPc+120)%12).sort((a,b)=>a-b)).toEqual([c.third,c.seventh].sort((a,b)=>a-b));
     expect(b.checkpoint.piano.lastVoicing).toEqual(e.notes);expect(b.ensembleDevelopment.pianoVoicings?.at(-1)?.decision.fourthStack).toEqual(c);
    }
    for(const e of b.drumEvents)if(e.phraseDialogue?.kind==='kick-answer'){
     counts.drums++;witness.drums.push(i+1);const c=e.phraseDialogue;
     expect(e.drum).toBe('kick');expect(e.velocity).toBe(c.originalVelocity*.9);
     const source=b.drumEvents.find(h=>h.drum==='snare'&&h.absBeat===i*4+c.sourceOffset)!;expect(source).toBeDefined();expect(source.velocity).toBe(c.sourceVelocity);
     expect(parseInt(source.time)).toBeLessThan(parseInt(e.time));
     expect(b.drumEvents.filter(h=>h!==e&&h.drum==='kick').every(h=>Math.abs(parseInt(h.time)-parseInt(e.time))>=.2*192)).toBe(true);
    }
    for(const e of [...b.bassEvents,...b.compEvents])expect(parseInt(e.time)+e.duration*score.tempo/60*192).toBeLessThanOrEqual(b.committedThroughTick+1e-7);
   }
   if(tune==='blues')process.stdout.write(`dialogue-witness ${style}/${instrument}/${seed} ${JSON.stringify(witness)}\n`);
  }
  expect(counts.piano).toBeGreaterThan(0);
  if(['swing','straight'].includes(style)){expect(counts.bass).toBeGreaterThan(0);expect(counts.drums).toBeGreaterThan(0);}
  else {expect(counts.bass).toBe(0);expect(counts.drums).toBe(0);}
 });
}

it('example 243 exposes all three gestures with either keyboard and truthful cards',()=>{
 for(const instrument of ['piano','organ'] as const)for(const swing of [.62,.67]){
  const bars=run(fixture('swing','blues',243,swing).make('developed',1,instrument,false,true,true,true,true,true));
  for(const [key,player,label,expected] of [['bassEvents','bass','Carry the bass idea',22],['compEvents','piano','Fourth-stack color',37],['drumEvents','drums','Snare → kick answer',24]] as const){
   const bar=bars.find(b=>b[key].some(e=>e.phraseDialogue))!;expect(bar,`${instrument}/${swing}/${key}`).toBeDefined();expect(bar.fromBar+1).toBe(expected);
   const generated=JSON.parse(JSON.stringify({...bar,bassEvents:bars.flatMap(b=>b.bassEvents)})) as GeneratedBacking;
   const context={barIndex:bar.fromBar,ppq:192,beatsPerBar:4,style:'swing' as const,orchestration:'coordinated' as const};
   const action=(g:GeneratedBacking)=>describeMusicianDecisions(g,context).find(c=>c.instrument===player)!.action;
   expect(action(generated)).toBe(label);
   const wrong=structuredClone(generated);
   if(player==='bass')wrong.bassEvents.find(e=>e.absBeat===(bar.fromBar-1)*4+1)!.midi+=4;
   if(player==='piano')wrong.compEvents.find(e=>e.phraseDialogue)!.notes[2]++;
   if(player==='drums')wrong.drumEvents=wrong.drumEvents.filter(e=>e.drum!=='snare');
   expect(action(wrong)).not.toBe(label);
   expect(describeMusicianDecisions(generated,{...context,orchestration:'original'}).find(c=>c.instrument===player)!.action).not.toBe(label);
  }
 }
});
for(const style of ['swing','straight','bossa-nova','ballad'] as const)it(`${style}: protects dense playing, historical identities, endings and loop replay`,()=>{
 const {make}=fixture(style,'blues',147),score=make('developed',1,'piano',true,true,true,true,true,true),bars=run(score);
 expect(()=>advanceRollingBacking(make('developed',1,'piano',true,true,true,true,true),bars[0].checkpoint)).toThrow();
 expect([...bars.at(-1)!.bassEvents,...bars.at(-1)!.compEvents,...bars.at(-1)!.drumEvents].some(e=>e.phraseDialogue)).toBe(false);
 for(const bar of bars.filter(b=>[...b.bassEvents,...b.compEvents,...b.drumEvents].some(e=>e.phraseDialogue))){
  const checkpoint=bars[bar.fromBar-1].checkpoint,observation={barIndex:bar.fromBar,observedAtBar:bar.fromBar,source:'scripted' as const,confidence:1,noteDensity:1,restBeats:0};
  const dense=advanceRollingBacking(score,checkpoint,[observation]);expect([...dense.bassEvents,...dense.compEvents,...dense.drumEvents].some(e=>e.phraseDialogue)).toBe(false);
  expect(advanceRollingBacking(score,checkpoint,[{...observation,barIndex:bar.fromBar+1,observedAtBar:bar.fromBar+1}])).toEqual(bar);
 }
 const loop=make('developed',2,'organ',false,true,true,true,true,true),loops=run(loop);
 for(const i of [51,52,53,103])expect(advanceRollingBacking(loop,JSON.parse(JSON.stringify(loops[i-1].checkpoint)))).toEqual(loops[i]);
});

it('restored source memory rejects malformed or stale openings even with a recomputed identity',()=>{
 const score=fixture('swing','blues',147).make('developed',1,'piano',false,true,true,true,true,true),bars=run(score);
 const original=bars.find(b=>b.checkpoint.bass.openingMotif)!.checkpoint;
 for(const value of [undefined,{barIndex:original.nextBar-2,notes:[36,40]},{barIndex:original.nextBar-1,notes:[36,48]},{barIndex:original.nextBar-1,notes:[36,36]},{barIndex:original.nextBar-1,notes:null},{barIndex:original.nextBar-1,notes:[36,40],invented:true}]){
  const broken=JSON.parse(JSON.stringify(original));broken.bass.openingMotif=value;
  const {checkpointId:_,...contents}=broken;
  broken.checkpointId=`${broken.sessionId}:${broken.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}`;
  expect(()=>advanceRollingBacking(score,broken)).toThrow('Invalid rolling checkpoint');
 }
});

it('native AABA audio fixture uses the same complete form and harmony as the listening adapter',()=>{
 const native=buildNativeAabaFixture(),{session}=fixture('ballad','aaba',7);
 expect(native).toEqual({id:session.phrase.id,harmony:session.phrase.harmony,sectionMap:session.phrase.sectionMap,performanceForm:session.phrase.performanceForm});
});

it('fourth-stack level normalization keeps short-to-held articulation visible and source-backed',()=>{
 const bar=run(fixture('swing','aaba',2).make('developed',1,'piano',false,true,true,true,true,true)).find(b=>b.compEvents.some(e=>e.phraseDialogue?.kind==='fourth-stack'&&e.expression?.kind==='short-held'));
 expect(bar).toBeDefined();
 if(!bar)throw new Error("No articulated fourth stack witness");
 const generated=JSON.parse(JSON.stringify(bar)) as GeneratedBacking;
 const context={barIndex:bar.fromBar,ppq:192,beatsPerBar:4,style:'swing' as const,orchestration:'coordinated' as const};
 const card=(g:GeneratedBacking)=>describeMusicianDecisions(g,context).find(c=>c.instrument==='piano')!;
 expect(card(generated).action).toBe('Fourth-stack color');expect(card(generated).detail).toContain('Short chord → held answer');
 const wrong=structuredClone(generated);wrong.compEvents.find(e=>e.phraseDialogue)!.velocity+=10;
 expect(card(wrong).detail).not.toContain('Short chord → held answer');
});

it('the prior example preserves its held-chord cross-stick at default swing with Organ',()=>{
 const bars=run(fixture('swing','blues',147,.62).make('developed',1,'organ',false,true,true,true,true,true));
 expect(bars.flatMap(b=>b.drumEvents).some(e=>e.phraseDialogue)).toBe(false);
 expect(bars[23].drumEvents.some(e=>e.ensembleColor?.kind==='cross-stick')).toBe(true);
 expect(run(fixture('swing','blues',147,.67).make('developed',1,'organ',false,true,true,true,true,true))[23].drumEvents.some(e=>e.phraseDialogue?.kind==='kick-answer')).toBe(true);
});

it('describes a triplet admitted by the dialogue kernel at a nonzero absolute bar',()=>{
 const bar=run(fixture('swing','blues',243).make('developed',1,'piano',false,true,true,true,true,true))[23];
 const generated=JSON.parse(JSON.stringify(bar)) as GeneratedBacking;
 // A synthetic triplet boundary fixture uses the same acceptance kernel as playback.
 // It is not a claim that the current example naturally selects this figure.
 const hits=snareKickDialogue([3,3+1/3,3+2/3].map(beatOffset=>({drum:'snare' as const,beatOffset,velocity:.4,role:'commentary' as const})),[],23);
 generated.drumEvents=hits.map(h=>({...h,absBeat:92+h.beatOffset,time:`${Math.round((92+h.beatOffset)*192)}i`}));
 generated.ensembleDevelopment={...generated.ensembleDevelopment!,drumPhrases:generated.ensembleDevelopment!.drumPhrases.map(p=>({...p,hits,commentary:{...p.commentary,hits}}))};
 const context={barIndex:23,ppq:192,beatsPerBar:4,style:'swing' as const,orchestration:'coordinated' as const};
 expect(describeMusicianDecisions(generated,context).find(c=>c.instrument==='drums')!.action).toBe('Snare → kick answer');
 generated.drumEvents.at(-1)!.absBeat+=.01;
 expect(describeMusicianDecisions(generated,context).find(c=>c.instrument==='drums')!.action).not.toBe('Snare → kick answer');
});
