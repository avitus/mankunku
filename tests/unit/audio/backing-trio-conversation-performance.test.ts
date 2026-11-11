import { createHash } from 'node:crypto';
import releaseEleven from '../../fixtures/audio/musicality-0.11-hashes.json';
import { describe, expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';
import { describeMusicianDecisions } from '$lib/musicality/musician-decisions';
import { describeCoordinatedPlacement } from '$lib/audio/coordinated-voicing';
import { fractionToFloat } from '$lib/music/intervals';
import type { GeneratedBacking } from '$lib/audio/backing-generation';

type Style = 'swing' | 'straight' | 'bossa-nova' | 'ballad';
function fixture(style: Style, tune: 'blues' | 'aaba' = 'blues', seed = 42) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const session = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const { phrase } = session, tempo = style === 'ballad' ? 80 : 140;
 const make = (keyboardSuspensions?: true | 'developed', loopCount = 1, instrument: 'piano'|'organ' = 'piano', hold = false, phraseExpression = false, trioConversation = false) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}, ...(hold ? {terminalArrangement:{ending:'hold-release' as const,melody:phrase.notes}} : {})
 }, { returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
  chorusBoundaryPriority: true, loopCount, ...(trioConversation?{trioConversation:true as const}:{}), ...(phraseExpression ? {phraseExpression:true as const} : {}), keyboardTexture: true, keyboardPhrasing:instrument, bassDelayedRoot:true, keyboardContraryMotion:true, drumPhraseCushioning:true, ...(keyboardSuspensions ? { keyboardSuspensions } : {}) });
 return { make, session };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint; return result;
 });
}



const styles=['swing','straight','bossa-nova','ballad'] as const;
for(const style of styles) it(`${style}: preserves complete 0.11 output when omitted`,()=>{
 for(const tune of ['blues','aaba'] as const) for(const seed of [42,7,19]) for(const instrument of ['piano','organ'] as const) {
  expect(createHash('sha256').update(JSON.stringify(run(fixture(style,tune,seed).make('developed',1,instrument,false,true)))).digest('hex')).toBe(releaseEleven.hashes[[style,tune,seed,instrument].join('/') as keyof typeof releaseEleven.hashes]);
 }
});
for(const style of styles) it(`${style}: develops complete tunes with actual bass-to-drum evidence and harmonic support`,()=>{
 const totals={bass:0,piano:0,drums:0};
 for(const tune of ['blues','aaba'] as const)for(const seed of [42,7,19])for(const instrument of ['piano','organ'] as const){
  const {make}=fixture(style,tune,seed),score=make('developed',1,instrument,false,true,true),bars=run(score),before=run(make('developed',1,instrument,false,true));
  const witness={bass:[] as number[],piano:[] as number[],drums:[] as number[]};
  expect(()=>advanceRollingBacking(make('developed',1,instrument,false,true),bars[0].checkpoint)).toThrow();
  for(const [i,bar] of bars.entries()){
   expect(advanceRollingBacking(score,i?JSON.parse(JSON.stringify(bars[i-1].checkpoint)):undefined)).toEqual(bar);
   for(const key of ['bassEvents','compEvents','drumEvents'] as const)expect(bar[key].map(e=>[e.time,e.absBeat])).toEqual(before[i][key].map(e=>[e.time,e.absBeat]));
   expect(bar.compEvents.map(e=>[e.duration,e.velocity])).toEqual(before[i].compEvents.map(e=>[e.duration,e.velocity]));
   expect(bar.bassEvents.map(({midi,conversation,...e})=>e)).toEqual(before[i].bassEvents.map(({midi,...e})=>e));
   expect(bar.bassEvents.slice(-2)).toEqual(before[i].bassEvents.slice(-2));
   expect(bar.checkpoint.bass).toEqual(before[i].checkpoint.bass);
   for(const [name,events] of [['bass',bar.bassEvents],['piano',bar.compEvents],['drums',bar.drumEvents]] as const)if(events.some(e=>e.conversation)){totals[name]++;witness[name].push(i+1);}
   for(const event of bar.bassEvents)if(event.conversation?.kind==='repeated-bass'){
    expect(event.midi).toBe(bar.bassEvents[0].midi);expect(event.absBeat).toBe(i*4+1);
    expect(event.midi).not.toBe(event.conversation.originalMidi);
   }
   for(const event of bar.drumEvents)if(event.conversation?.kind==='bass-catch'){
    const repeated=bar.bassEvents.find(b=>b.conversation?.kind==='repeated-bass');expect(repeated).toBeDefined();
    expect(event.absBeat).toBe(i*4+2);expect(event.velocity).toBeCloseTo(event.conversation.originalVelocity*1.7);
    expect(parseInt(event.time)).toBeGreaterThan(parseInt(repeated!.time));
    expect(event.drum).toBe('kick');
   }
   for(const event of bar.compEvents)if(event.conversation?.kind==='dominant-b9'){
    expect(event.absBeat+(event.absBeat % 1 ? 0.5 : 0)).toBeLessThan((i+1)*4);
    const c=event.conversation;expect(c.fromMidi-c.toMidi).toBe(1);expect(event.notes).toContain(c.toMidi);
    expect(event.notes).not.toContain(c.fromMidi);expect(event.notes.map(n=>(n-c.rootPc+120)%12)).toEqual(expect.arrayContaining([1,4,10]));
    expect((c.targetRootPc-c.rootPc+12)%12).toBe(5);
    expect(bar.checkpoint.piano.voicing?.notes).toEqual(event.notes);
    expect(bar.ensembleDevelopment.pianoVoicings?.at(-1)?.decision.keyboardColor).toEqual(c);
   }
   for(const event of [...bar.bassEvents,...bar.compEvents]){
    expect(parseInt(event.time)).toBeGreaterThanOrEqual(bar.startTick);
    expect(parseInt(event.time)+event.duration*score.tempo/60*score.ppq).toBeLessThanOrEqual(bar.committedThroughTick+1e-7);
   }
   if(['bossa-nova','ballad'].includes(style)){expect(bar.bassEvents).toEqual(before[i].bassEvents);expect(bar.drumEvents).toEqual(before[i].drumEvents);}
  }
  if(tune==='blues')process.stdout.write(`conversation-witness ${style}/${instrument}/${seed} ${JSON.stringify(witness)}\n`);
 }
 expect(totals.piano).toBeGreaterThan(0);
 if(['swing','straight'].includes(style)){expect(totals.bass).toBeGreaterThan(0);expect(totals.drums).toBeGreaterThan(0);}
});
for(const style of styles)it(`${style}: protects dense playing and endings, ignores future evidence and replays loop seams`,()=>{
 const {make}=fixture(style,'blues',7),score=make('developed',1,'piano',true,true,true),bars=run(score);
 expect([...bars.at(-1)!.bassEvents,...bars.at(-1)!.compEvents,...bars.at(-1)!.drumEvents].some(e=>e.conversation)).toBe(false);
 for(const bar of bars.filter(b=>[...b.bassEvents,...b.compEvents,...b.drumEvents].some(e=>e.conversation))){
  const checkpoint=bars[bar.fromBar-1].checkpoint,observation={barIndex:bar.fromBar,observedAtBar:bar.fromBar,source:'scripted' as const,confidence:1,noteDensity:1,restBeats:0};
  const dense=advanceRollingBacking(score,checkpoint,[observation]);expect([...dense.bassEvents,...dense.compEvents,...dense.drumEvents].some(e=>e.conversation)).toBe(false);
  expect(advanceRollingBacking(score,checkpoint,[{...observation,barIndex:bar.fromBar+1,observedAtBar:bar.fromBar+1}])).toEqual(bar);
 }
 const loop=make('developed',2,'organ',false,true,true),loops=run(loop);
 for(const i of [51,52,53,103])expect(advanceRollingBacking(loop,JSON.parse(JSON.stringify(loops[i-1].checkpoint)))).toEqual(loops[i]);
});

it('musician cards require matching actual notes, velocities and accepted traces',()=>{
 const bars=run(fixture('swing','blues',7).make('developed',1,'piano',false,true,true));
 for(const [instrument,key,label] of [['bass','bassEvents','Repeated-note propulsion'],['piano','compEvents','Altered dominant'],['drums','drumEvents','Bass dialogue']] as const){
  const bar=bars.find(b=>b[key].some(e=>e.conversation))!;expect(bar).toBeDefined();
  const generated=JSON.parse(JSON.stringify(bar)) as GeneratedBacking;
  const context={barIndex:bar.fromBar,ppq:192,beatsPerBar:4,style:'swing' as const,orchestration:'coordinated' as const};
  const evidence=(g:GeneratedBacking)=>describeMusicianDecisions(g,context).find(c=>c.instrument===instrument)!.evidence.join(' ');
  expect(evidence(generated)).toContain(label);
  const missing=structuredClone(generated);missing[key]=missing[key].filter(e=>!e.conversation) as never;expect(evidence(missing)).not.toContain(label);
  const wrong=structuredClone(generated);
  if(instrument==='bass')wrong.bassEvents.find(e=>e.conversation)!.midi++;
  else if(instrument==='drums')wrong.drumEvents.find(e=>e.conversation)!.velocity+=.01;
  else wrong.compEvents.find(e=>e.conversation)!.notes[0]++;
  expect(evidence(wrong)).not.toContain(label);
  const noTrace=structuredClone(generated);
  if(instrument==='drums')(noTrace.ensembleDevelopment!.drumPhrases as unknown[]).length=0;
  if(instrument==='piano')(noTrace.ensembleDevelopment!.pianoVoicings as unknown[]).length=0;
  if(instrument!=='bass')expect(evidence(noTrace)).not.toContain(label);
  expect(describeMusicianDecisions(generated,{...context,orchestration:'original'}).flatMap(c=>c.evidence).join(' ')).not.toContain(label);
 }
});

it('reassesses dominant color against the actual preceding harmony in a mixed-chord bar',()=>{
 let colored=0;
 for(const seed of [12]) {
  const {make}=fixture('swing','blues',seed),base=make('developed',1,'piano',false,true,true);
  const harmony=base.harmony.flatMap(segment=>fractionToFloat(segment.startOffset)*4===100
   ? [{...segment,duration:[1,2] as [number,number],chord:{root:'G' as const,quality:'min7' as const},scaleId:'major.dorian',symbol:'Gm7'}, {...segment,startOffset:[51,2] as [number,number],duration:[1,2] as [number,number]}]
   : [segment]);
  // The second chord begins at beat 102 (bar 26, beat three).
  const score=createRollingBacking(harmony,BACKING_STYLES.swing,{phraseId:`${base.phraseId}-mixed-${seed}`,tempo:140,ppq:192,beatsPerBar:4,swing:base.swing,
   performanceForm:base.performanceForm,ensemble:{}}, {returningMelodySpace:true,performanceEnergySeed:seed,pianoPresence:'accompaniment',
   keyboardVariety:'developed',chorusBoundaryPriority:true,keyboardTexture:true,keyboardPhrasing:'piano',phraseExpression:true,trioConversation:true});
  const bars=run(score),bar=bars[25];
  const index=bar.compEvents.findIndex(e=>e.conversation?.kind==='dominant-b9');
  if(index<1)continue;
  const event=bar.compEvents[index],previous=bar.compEvents[index-1];
  if(previous.absBeat+(previous.absBeat % 1 ? 0.5 : 0)>=102)continue;
  colored++;
  const chordAt=(beat:number)=>harmony.find(s=>beat>=fractionToFloat(s.startOffset)*4&&beat<(fractionToFloat(s.startOffset)+fractionToFloat(s.duration))*4)!.chord;
  const trace=bar.ensembleDevelopment.pianoVoicings![index];
  const expected=describeCoordinatedPlacement(chordAt(event.absBeat),event.notes,trace.decision.resolvedFamily,60,
   {version:1,chord:chordAt(previous.absBeat+(previous.absBeat % 1 ? 0.5 : 0)),notes:previous.notes});
  expect(trace.decision.guideMotion, `mixed harmony seed ${seed}`).toBe(expected.guideMotion);
 }
 expect(colored).toBeGreaterThan(0);
});
