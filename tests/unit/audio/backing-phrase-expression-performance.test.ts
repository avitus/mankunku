import { createHash } from 'node:crypto';
import releaseTen from '../../fixtures/audio/musicality-0.10-hashes.json';
import { describe, expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
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
 const make = (keyboardSuspensions?: true | 'developed', loopCount = 1, instrument: 'piano'|'organ' = 'piano', hold = false, phraseExpression = false) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}, ...(hold ? {terminalArrangement:{ending:'hold-release' as const,melody:phrase.notes}} : {})
 }, { returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
  chorusBoundaryPriority: true, loopCount, ...(phraseExpression ? {phraseExpression:true as const} : {}), keyboardTexture: true, keyboardPhrasing:instrument, bassDelayedRoot:true, keyboardContraryMotion:true, drumPhraseCushioning:true, ...(keyboardSuspensions ? { keyboardSuspensions } : {}) });
 return { make, session };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint; return result;
 });
}


const styles=['swing','straight','bossa-nova','ballad'] as const;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
for(const style of styles) it(`${style}: preserves the complete committed 0.10 baseline`,()=>{
 for(const tune of ['blues','aaba'] as const) for(const seed of [42,7,19]) for(const instrument of ['piano','organ'] as const) {
 const score=fixture(style,tune,seed).make('developed',1,instrument);
 expect(digest(run(score))).toBe(releaseTen.hashes[[style,tune,seed,instrument].join('/') as keyof typeof releaseTen.hashes]);
 }
});
for(const style of styles) it(`${style}: expresses full performances without losing support, replay or native pulse`,()=>{
 const counts={bass:0,piano:0,drums:0};
 for(const tune of ['blues','aaba'] as const) for(const seed of [42,7,19]) for(const instrument of ['piano','organ'] as const) {
  const {make}=fixture(style,tune,seed),score=make('developed',1,instrument,false,true),before=run(make('developed',1,instrument)),bars=run(score);
  if(['swing','straight'].includes(style)) expect(()=>advanceRollingBacking(make('developed',1,instrument),bars[0].checkpoint)).toThrow(); else expect(bars).toEqual(before);
  const witness={bass:[] as number[],piano:[] as number[],drums:[] as number[]};
  for(const [i,bar] of bars.entries()) {
   expect(advanceRollingBacking(score,i?JSON.parse(JSON.stringify(bars[i-1].checkpoint)):undefined)).toEqual(bar);
   expect(bar.bassEvents.map(({velocity,expression,...e})=>e)).toEqual(before[i].bassEvents.map(({velocity,expression,...e})=>e));
   expect(bar.bassEvents.length).toBeGreaterThan(0);
   expect(bar.compEvents.map(({duration,expression,...e})=>e)).toEqual(before[i].compEvents.map(({duration,expression,...e})=>e));
   expect(bar.drumEvents.map(({velocity,expression,...e})=>e)).toEqual(before[i].drumEvents.map(({velocity,expression,...e})=>e));
   if(before[i].compEvents.length) expect(bar.compEvents.length).toBeGreaterThan(0);
   for(const [name,events] of [['bass',bar.bassEvents],['piano',bar.compEvents],['drums',bar.drumEvents]] as const) {
    if(events.some(e=>e.expression)){counts[name]++;witness[name].push(i+1);}
   }
   for(const e of [...bar.bassEvents,...bar.compEvents]) {
    expect(parseInt(e.time)).toBeGreaterThanOrEqual(bar.startTick);
    expect(parseInt(e.time)+e.duration*score.tempo/60*score.ppq).toBeLessThanOrEqual(bar.committedThroughTick+1e-7);
    if(e.expression)expect(Object.isFrozen(e.expression)).toBe(true);
   }
   const shaped=bar.compEvents.filter(e=>e.expression?.kind==='short-held');
   if(shaped.length) {
    expect(shaped).toHaveLength(2);expect(shaped[1].duration).toBeGreaterThanOrEqual(2*shaped[0].duration);
    expect(shaped.reduce((n,e)=>n+e.duration,0)+1e-8).toBeGreaterThanOrEqual(shaped.reduce((n,e)=>n+e.expression!.originalDuration!,0));
    expect(bar.ensembleDevelopment.pianoVoicings?.filter(v=>v.decision.keyboardSuspension)).toHaveLength(0);
   }
   const ghosted=bar.drumEvents.filter(e=>e.expression?.kind==='ghost-answer');
   if(ghosted.length){expect([1,2]).toContain(ghosted.length);if(ghosted.length===2)expect(ghosted[1].velocity).toBeLessThan(ghosted[0].velocity);for(const e of ghosted)expect(bar.ensembleDevelopment.drumPhrases[0].hits.some(h=>h.expression && h.drum===e.drum && h.velocity===e.velocity && Math.abs(h.beatOffset-(e.absBeat-i*4))<1e-8)).toBe(true);}
  }
  if(tune==='blues')process.stdout.write(`expression-witness ${style}/${instrument}/${seed} ${JSON.stringify(witness)}\n`);
 }
 if(['swing','straight'].includes(style)){expect(counts.bass).toBeGreaterThan(0);expect(counts.drums).toBeGreaterThan(0);}else{expect(counts.bass).toBe(0);expect(counts.drums).toBe(0);}
 if(['swing','straight'].includes(style))expect(counts.piano).toBeGreaterThan(0);else expect(counts.piano).toBe(0);
});
for(const style of styles) it(`${style}: protects dense observations, final arrangements and loop replay`,()=>{
 const {make}=fixture(style),score=make('developed',1,'piano',true,true),bars=run(score);
 const end=bars.at(-1)!;expect([...end.bassEvents,...end.compEvents,...end.drumEvents].some(e=>e.expression)).toBe(false);
 const index=bars.findIndex((b,i)=>i>0&&[...b.bassEvents,...b.compEvents,...b.drumEvents].some(e=>e.expression));if(['swing','straight'].includes(style))expect(index).toBeGreaterThan(0);
 if(index>=1){
 const checkpoint=bars[index-1].checkpoint,observation={barIndex:index,observedAtBar:index,source:'scripted' as const,confidence:1,noteDensity:1,restBeats:0};
 const dense=advanceRollingBacking(score,checkpoint,[observation]);expect([...dense.bassEvents,...dense.compEvents,...dense.drumEvents].some(e=>e.expression)).toBe(false);
 expect(advanceRollingBacking(score,checkpoint,[{...observation,barIndex:index+1,observedAtBar:index+1}])).toEqual(bars[index]);
 }
 const loop=make('developed',2,'organ',false,true),loops=run(loop);
 for(const index of [51,52,53,103])expect(advanceRollingBacking(loop,JSON.parse(JSON.stringify(loops[index-1].checkpoint)))).toEqual(loops[index]);
});


it('describes only performed expression, and suppresses each player under dense solo evidence',()=>{
 const score=fixture('swing').make('developed',1,'piano',false,true),bars=run(score);
 for(const [instrument,key,label] of [['bass','bassEvents','Walking expression'],['piano','compEvents','Short/held contrast'],['drums','drumEvents','Snare expression']] as const){
  const bar=bars.find(b=>b[key].some(e=>e.expression))!;expect(bar).toBeDefined();
  const generated=JSON.parse(JSON.stringify(bar)) as GeneratedBacking;
  const context={barIndex:bar.fromBar,ppq:192,beatsPerBar:4,style:'swing' as const,orchestration:'coordinated' as const};
  const text=(g:GeneratedBacking)=>describeMusicianDecisions(g,context).find(c=>c.instrument===instrument)!.evidence.join(' ');
  expect(text(generated)).toContain(label);
  const missing=structuredClone(generated);missing[key]=missing[key].filter(e=>!e.expression) as never;expect(text(missing)).not.toContain(label);
  if(instrument==='drums'){const receipt=structuredClone(generated);(receipt.ensembleDevelopment!.drumPhrases as unknown as unknown[]).length=0;expect(text(receipt)).not.toContain(label);}
  const wrong=structuredClone(generated);for(const event of wrong[key]) if(event.expression) event.velocity+=1;expect(text(wrong)).not.toContain(label);
  expect(describeMusicianDecisions(generated,{...context,orchestration:'original'}).flatMap(c=>c.evidence).join(' ')).not.toContain(label);
  const observation={barIndex:bar.fromBar,observedAtBar:bar.fromBar,source:'scripted' as const,confidence:1,noteDensity:1,restBeats:0};
  const dense=advanceRollingBacking(score,bars[bar.fromBar-1].checkpoint,[observation]);
  expect(dense[key].some(e=>e.expression)).toBe(false);
 }
});
