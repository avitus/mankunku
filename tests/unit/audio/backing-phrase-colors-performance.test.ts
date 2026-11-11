import { createHash } from 'node:crypto';
import releaseTwelve from '../../fixtures/audio/musicality-0.12-hashes.json';
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
function fixture(style: Style, tune: 'blues' | 'aaba' = 'blues', seed = 42) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const session = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const { phrase } = session, tempo = style === 'ballad' ? 80 : 140;
 const make = (keyboardSuspensions?: true | 'developed', loopCount = 1, instrument: 'piano'|'organ' = 'piano', hold = false, phraseExpression = false, trioConversation = false, phraseColors = false) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}, ...(hold ? {terminalArrangement:{ending:'hold-release' as const,melody:phrase.notes}} : {})
 }, { ...(phraseColors?{phraseColors:true as const}:{}), returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
  chorusBoundaryPriority: true, loopCount, ...(trioConversation?{trioConversation:true as const}:{}), ...(phraseExpression ? {phraseExpression:true as const} : {}), keyboardTexture: true, keyboardPhrasing:instrument, bassDelayedRoot:true, keyboardContraryMotion:true, drumPhraseCushioning:true, ...(keyboardSuspensions ? { keyboardSuspensions } : {}) });
 return { make, session };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint; return result;
 });
}



for(const style of ['swing','straight','bossa-nova','ballad'] as const) {
 it(`${style}: retains the committed 0.12 complete-performance baseline without phrase colors`,()=>{
  for(const tune of ['blues','aaba'] as const)for(const seed of [42,7,19])for(const instrument of ['piano','organ'] as const)
   expect(createHash('sha256').update(JSON.stringify(run(fixture(style,tune,seed).make('developed',1,instrument,false,true,true)))).digest('hex')).toBe(releaseTwelve.hashes[[style,tune,seed,instrument].join('/') as keyof typeof releaseTwelve.hashes]);
 });
 it(`${style}: realizes phrase colors over complete performances with intact support and replay`,()=>{
  const counts={bass:0,piano:0,hats:0};
  for(const tune of ['blues','aaba'] as const)for(const seed of [42,7,19])for(const instrument of ['piano','organ'] as const){
   const {make}=fixture(style,tune,seed),score=make('developed',1,instrument,false,true,true,true),bars=run(score),before=run(make('developed',1,instrument,false,true,true));
   const witness={bass:[] as number[],piano:[] as number[],hats:[] as number[]};
   expect(()=>advanceRollingBacking(make('developed',1,instrument,false,true,true),bars[0].checkpoint)).toThrow();
   for(const [i,bar] of bars.entries()){
    expect(advanceRollingBacking(score,i?JSON.parse(JSON.stringify(bars[i-1].checkpoint)):undefined)).toEqual(bar);
    for(const field of ['bassEvents','compEvents','drumEvents'] as const)expect(bar[field].map(e=>[e.time,e.absBeat])).toEqual(before[i][field].map(e=>[e.time,e.absBeat]));
    expect(bar.bassEvents.map(({midi,phraseColor,...e})=>e)).toEqual(before[i].bassEvents.map(({midi,...e})=>e));
    expect(bar.bassEvents.slice(-2)).toEqual(before[i].bassEvents.slice(-2));expect(bar.checkpoint.bass).toEqual(before[i].checkpoint.bass);
    expect(bar.compEvents.map(e=>[e.duration,e.velocity])).toEqual(before[i].compEvents.map(e=>[e.duration,e.velocity]));
    for(const e of bar.bassEvents)if(e.phraseColor?.kind==='root-seventh'){
     counts.bass++;witness.bass.push(i+1);expect(e.midi-e.phraseColor.rootMidi).toBe(e.phraseColor.seventh-12);
     expect(e.absBeat).toBe(i*4+1);expect(e.midi).not.toBe(e.phraseColor.originalMidi);
    }
    for(const e of bar.compEvents)if(e.phraseColor?.kind==='upper-structure'){
     counts.piano++;witness.piano.push(i+1);const c=e.phraseColor;
     expect(e.notes).toHaveLength(5);expect(e.notes.at(-1)!-c.originalNotes.at(-1)!).toBeGreaterThanOrEqual(0);expect(e.notes.at(-1)!-c.originalNotes.at(-1)!).toBeLessThanOrEqual(7);
     if(bar.checkpoint.piano.contour)expect(bar.checkpoint.piano.contour.lastTopMidi).toBe(e.notes.at(-1));
     expect(e.notes.map(n=>(n-c.rootPc+120)%12).sort((a,b)=>a-b)).toEqual([2,4,6,9,10]);
     expect(bar.checkpoint.piano.voicing?.notes).toEqual(e.notes);
     expect(bar.ensembleDevelopment.pianoVoicings?.at(-1)?.decision.upperStructure).toEqual(c);
    }
    const drums=bar.ensembleDevelopment.drumPhrases[0];
    if(drums.ride.voice==='hihat'){
     counts.hats++;witness.hats.push(i+1);
     expect(drums.phraseLength).toBeGreaterThanOrEqual(2);
     expect(bar.drumEvents.some(e=>e.drum==='hihat'&&e.role==='timekeeping')).toBe(true);
     for(const e of bar.drumEvents)if(e.drum==='hihat'&&e.role==='timekeeping'){
      const old=before[i].drumEvents.find(b=>b.time===e.time&&b.role==='timekeeping'&&b.drum==='ride');expect(old).toBeTruthy();
      expect(e.velocity).toBeCloseTo(old!.velocity*.8);
     }
    }
    if(['bossa-nova','ballad'].includes(style)){expect(bar.bassEvents).toEqual(before[i].bassEvents);expect(bar.drumEvents).toEqual(before[i].drumEvents);}
    for(const e of [...bar.bassEvents,...bar.compEvents])expect(parseInt(e.time)+e.duration*score.tempo/60*score.ppq).toBeLessThanOrEqual(bar.committedThroughTick+1e-7);
   }
   if(tune==='blues')process.stdout.write(`phrase-color-witness ${style}/${instrument}/${seed} ${JSON.stringify(witness)}\n`);
  }
  expect(counts.piano).toBeGreaterThan(0);
  if(['swing','straight'].includes(style)){expect(counts.bass).toBeGreaterThan(0);expect(counts.hats).toBeGreaterThan(0);}
 });
}

for(const style of ['swing','straight','bossa-nova','ballad'] as const)it(`${style}: protects dense playing and endings, ignores future evidence and replays loop seams`,()=>{
 const {make}=fixture(style,'blues',7),score=make('developed',1,'piano',true,true,true,true),bars=run(score);
 expect([...bars.at(-1)!.bassEvents,...bars.at(-1)!.compEvents].some(e=>e.phraseColor)).toBe(false);
 for(const bar of bars.filter(b=>[...b.bassEvents,...b.compEvents].some(e=>e.phraseColor))){
  const checkpoint=bars[bar.fromBar-1].checkpoint,observation={barIndex:bar.fromBar,observedAtBar:bar.fromBar,source:'scripted' as const,confidence:1,noteDensity:1,restBeats:0};
  const dense=advanceRollingBacking(score,checkpoint,[observation]);expect([...dense.bassEvents,...dense.compEvents].some(e=>e.phraseColor)).toBe(false);
  expect(advanceRollingBacking(score,checkpoint,[{...observation,barIndex:bar.fromBar+1,observedAtBar:bar.fromBar+1}])).toEqual(bar);
 }
 const loop=make('developed',2,'organ',false,true,true,true),loops=run(loop);
 for(const i of [51,52,53,103])expect(advanceRollingBacking(loop,JSON.parse(JSON.stringify(loops[i-1].checkpoint)))).toEqual(loops[i]);
});
it('musician cards require matching sounded notes, timekeeping and accepted traces',()=>{
 const bars=[7,42].flatMap(seed=>run(fixture('swing','blues',seed).make('developed',1,'piano',false,true,true,true)));
 for(const [instrument,key,label] of [['bass','bassEvents','Walking color'],['piano','compEvents','Sounded voicing'],['drums','drumEvents','Phrase texture']] as const){
  const bar=bars.find(b=>instrument==='drums'?b.ensembleDevelopment.drumPhrases[0].ride.voice==='hihat':b[key].some(e=>'phraseColor' in e && e.phraseColor))!;expect(bar).toBeDefined();
  const generated=JSON.parse(JSON.stringify(bar)) as GeneratedBacking;
  const context={barIndex:bar.fromBar,ppq:192,beatsPerBar:4,style:'swing' as const,orchestration:'coordinated' as const};
  const evidence=(g:GeneratedBacking)=>describeMusicianDecisions(g,context).find(c=>c.instrument===instrument)!.evidence.join(' ');
  expect(evidence(generated)).toContain(label);
  const missing=structuredClone(generated);missing[key]=[];expect(evidence(missing)).not.toContain(label);
  const wrong=structuredClone(generated);
  if(instrument==='bass')wrong.bassEvents.find(e=>e.phraseColor)!.midi++;
  else if(instrument==='drums')wrong.drumEvents.find(e=>e.drum==='hihat'&&e.role==='timekeeping')!.velocity+=.01;
  else wrong.compEvents.find(e=>e.phraseColor)!.notes[0]++;
  expect(evidence(wrong)).not.toContain(label);
  const noTrace=structuredClone(generated);
  if(instrument==='drums')(noTrace.ensembleDevelopment!.drumPhrases as unknown[]).length=0;
  if(instrument==='piano')(noTrace.ensembleDevelopment!.pianoVoicings as unknown[]).length=0;
  if(instrument!=='bass')expect(evidence(noTrace)).not.toContain(label);
  expect(describeMusicianDecisions(generated,{...context,orchestration:'original'}).flatMap(c=>c.evidence).join(' ')).not.toContain(label);
 }
});

it('keeps a selected hat phrase coherent and rejects malformed texture continuation',()=>{
 const score=fixture('swing').make('developed',1,'piano',false,true,true,true),bars=run(score);
 const phrases=new Map<number,boolean>();
 for(const bar of bars){
  const phrase=bar.ensembleDevelopment.drumPhrases[0],hat=phrase.ride.voice==='hihat';
  if(phrases.has(phrase.phraseStartBar))expect(hat).toBe(phrases.get(phrase.phraseStartBar));
  phrases.set(phrase.phraseStartBar,hat);
 }
 const colors=[...phrases.values()];for(let i=1;i<colors.length;i++)expect(colors[i]&&colors[i-1]).toBe(false);
 const other=run(fixture('swing','blues',7).make('developed',1,'piano',false,true,true,true));
 expect(bars.slice(0,16).map(b=>b.ensembleDevelopment.drumPhrases[0].ride.voice)).not.toEqual(other.slice(0,16).map(b=>b.ensembleDevelopment.drumPhrases[0].ride.voice));
 const checkpoint=JSON.parse(JSON.stringify(bars[0].checkpoint));
 checkpoint.drums.phrase.hatTexture='true';
 expect(()=>advanceRollingBacking(score,checkpoint)).toThrow();
});
it('explains both short-held articulation and upper-triad color when they coexist',()=>{
 const bars=run(fixture('swing','blues',42).make('developed',1,'organ',false,true,true,true));
 const bar=bars.find(b=>b.compEvents.some(e=>e.phraseColor&&e.expression?.kind==='short-held'))!;
 expect(bar).toBeDefined();
 const card=describeMusicianDecisions(JSON.parse(JSON.stringify(bar)) as GeneratedBacking,{barIndex:bar.fromBar,ppq:192,beatsPerBar:4,style:'swing',orchestration:'coordinated'}).find(c=>c.instrument==='piano')!;
 expect(card.action).toBe('Upper-triad color');
 expect(card.detail).toContain('Short chord → held answer');
 expect(card.detail).toContain('Other attacks:');
});
it('keeps the resolution-cushion decision visible over a stick-hat texture',()=>{
 let found=0;
 for(let seed=0;seed<30&&!found;seed++)for(const bar of run(fixture('swing','blues',seed).make('developed',1,'piano',false,true,true,true))){
  const drums=bar.ensembleDevelopment.drumPhrases[0];
  if(drums.ride.voice!=='hihat'||!drums.cushioning)continue;
  found++;
  const card=describeMusicianDecisions(JSON.parse(JSON.stringify(bar)) as GeneratedBacking,{barIndex:bar.fromBar,ppq:192,beatsPerBar:4,style:'swing',orchestration:'coordinated'}).find(c=>c.instrument==='drums')!;
  expect(card.action).toBe('Ease around the resolution');
  expect(card.evidence.join(' ')).toContain('Phrase texture');
 }
 expect(found).toBeGreaterThan(0);
});
