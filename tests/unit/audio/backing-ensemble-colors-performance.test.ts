import { fractionToFloat } from '$lib/music/intervals';
import { createHash } from 'node:crypto';
import releaseThirteen from '../../fixtures/audio/musicality-0.13-hashes.json';
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
function fixture(style: Style, tune: 'blues' | 'aaba' = 'blues', seed = 42) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const session = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const { phrase } = session, tempo = style === 'ballad' ? 80 : 140;
 const make = (keyboardSuspensions?: true | 'developed', loopCount = 1, instrument: 'piano'|'organ' = 'piano', hold = false, phraseExpression = false, trioConversation = false, phraseColors = false, ensembleColors = false) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}, ...(hold ? {terminalArrangement:{ending:'hold-release' as const,melody:phrase.notes}} : {})
 }, { ...(ensembleColors?{ensembleColors:true as const}:{}), ...(phraseColors?{phraseColors:true as const}:{}), returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
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
 it(`${style}: retains the complete committed 0.13 baseline when omitted`,()=>{
  for(const tune of ['blues','aaba'] as const)for(const seed of [42,7,19])for(const instrument of ['piano','organ'] as const)
   expect(createHash('sha256').update(JSON.stringify(run(fixture(style,tune,seed).make('developed',1,instrument,false,true,true,true)))).digest('hex')).toBe(releaseThirteen.hashes[[style,tune,seed,instrument].join('/') as keyof typeof releaseThirteen.hashes]);
 });
 it(`${style}: realizes and replays full-tune ensemble colors with actual musical memory`,()=>{
  const totals={bass:0,piano:0,drums:0};
  for(const tune of ['blues','aaba'] as const)for(const seed of [42,7,19])for(const instrument of ['piano','organ'] as const){
   const {make}=fixture(style,tune,seed),score=make('developed',1,instrument,false,true,true,true,true),bars=run(score),old=run(make('developed',1,instrument,false,true,true,true));
   const witness={bass:[] as number[],piano:[] as number[],drums:[] as number[]};
   expect(()=>advanceRollingBacking(make('developed',1,instrument,false,true,true,true),bars[0].checkpoint)).toThrow();
   for(const [i,b] of bars.entries()){
    expect(advanceRollingBacking(score,i?JSON.parse(JSON.stringify(bars[i-1].checkpoint)):undefined)).toEqual(b);
    for(const field of ['bassEvents','compEvents','drumEvents'] as const)expect(b[field].map(e=>[e.time,e.absBeat])).toEqual(old[i][field].map(e=>[e.time,e.absBeat]));
    expect(b.compEvents.map(e=>[e.duration,e.velocity])).toEqual(old[i].compEvents.map(e=>[e.duration,e.velocity]));
    const arpeggio=b.bassEvents.find(e=>e.ensembleColor?.kind==='arpeggio');
    if(arpeggio){totals.bass++;witness.bass.push(i+1);const c=arpeggio.ensembleColor!;if(c.kind!=='arpeggio')throw Error();
     expect(b.bassEvents.slice(0,3).map(e=>e.midi)).toEqual([c.rootMidi,c.rootMidi+c.third,c.rootMidi+7]);
     expect(b.checkpoint.bass.previousPreviousMidi).toBe(b.bassEvents[2].midi);expect(b.checkpoint.bass.previousMidi).toBe(b.bassEvents[3].midi);
     expect(b.checkpoint.bass.direction).toBe(Math.sign(b.bassEvents[3].midi-b.bassEvents[2].midi));
     expect(b.bassEvents[3].midi).toBe(c.originalNotes[3]);
     const segment=score.harmony[b.checkpoint.bass.segmentIndex!];
     if(['enclosure','double-chromatic'].includes(b.checkpoint.bass.approach))expect((fractionToFloat(segment.startOffset)+fractionToFloat(segment.duration))*4).toBeGreaterThan((i+1)*4);
    }
    for(const e of b.compEvents)if(e.ensembleColor?.kind==='drop3'){
     totals.piano++;witness.piano.push(i+1);const c=e.ensembleColor;
     expect(c.fromMidi-c.toMidi).toBe(12);expect(e.notes).toEqual([c.toMidi,c.originalNotes[0],...c.originalNotes.slice(2)]);
     expect(b.checkpoint.piano.voicing?.notes).toEqual(e.notes);
     expect(b.ensembleDevelopment.pianoVoicings?.at(-1)?.decision.spreadVoicing).toEqual(c);
    }
    for(const e of b.drumEvents)if(e.ensembleColor?.kind==='cross-stick'){
     totals.drums++;witness.drums.push(i+1);const c=e.ensembleColor;
     expect(e.drum).toBe('crossstick');expect(e.role).toBe('commentary');expect(e.velocity).toBeCloseTo(c.originalVelocity*.85);
     const source=b.compEvents.find(p=>p.time===c.sourceTime&&p.absBeat===c.sourceAbsBeat)!;expect(source).toBeDefined();expect(source.notes).toEqual(c.sourceNotes);
     expect(parseInt(e.time)).toBeGreaterThan(parseInt(source.time));expect(parseInt(e.time)).toBeLessThan(parseInt(source.time)+source.duration*score.tempo/60*192);
    }
    if(['bossa-nova','ballad'].includes(style)){expect(b.bassEvents).toEqual(old[i].bassEvents);expect(b.drumEvents).toEqual(old[i].drumEvents);}
    for(const e of [...b.bassEvents,...b.compEvents])expect(parseInt(e.time)+e.duration*score.tempo/60*192).toBeLessThanOrEqual(b.committedThroughTick+1e-7);
   }
   if(tune==='blues')process.stdout.write(`ensemble-color-witness ${style}/${instrument}/${seed} ${JSON.stringify(witness)}\n`);
  }
  expect(totals.piano).toBeGreaterThan(0);
  if(['swing','straight'].includes(style))expect(totals.bass).toBeGreaterThan(0);
  if(['swing','straight'].includes(style))expect(totals.drums).toBeGreaterThan(0);
  else expect(totals.drums).toBe(0);
 });
}

it('live cards require accepted notes, source chords and matching traces',()=>{
 const bars=[4,7,8].flatMap(seed=>run(fixture('swing','blues',seed).make('developed',1,'piano',false,true,true,true,true)));
 for(const [instrument,key,label] of [['bass','bassEvents','Chord outline'],['piano','compEvents','Wider chord'],['drums','drumEvents','Held-chord response']] as const){
  const bar=bars.find(b=>b[key].some(e=>e.ensembleColor))!;expect(bar).toBeDefined();
  const generated=JSON.parse(JSON.stringify(bar)) as GeneratedBacking;
  const context={barIndex:bar.fromBar,ppq:192,beatsPerBar:4,style:'swing' as const,orchestration:'coordinated' as const};
  const evidence=(g:GeneratedBacking)=>describeMusicianDecisions(g,context).find(c=>c.instrument===instrument)!.evidence.join(' ');
  expect(evidence(generated)).toContain(label);
  const missing=structuredClone(generated);missing[key]=[];expect(evidence(missing)).not.toContain(label);
  const wrong=structuredClone(generated);
  if(instrument==='bass')wrong.bassEvents[1].midi++;
  else if(instrument==='piano')wrong.compEvents.find(e=>e.ensembleColor)!.notes[0]++;
  else wrong.compEvents=[];
  expect(evidence(wrong)).not.toContain(label);
  const noTrace=structuredClone(generated);
  if(instrument==='drums')(noTrace.ensembleDevelopment!.drumPhrases as unknown[]).length=0;
  if(instrument==='piano')(noTrace.ensembleDevelopment!.pianoVoicings as unknown[]).length=0;
  if(instrument!=='bass')expect(evidence(noTrace)).not.toContain(label);
  expect(describeMusicianDecisions(generated,{...context,orchestration:'original'}).flatMap(c=>c.evidence).join(' ')).not.toContain(label);
 }
});
for(const style of ['swing','straight','bossa-nova','ballad'] as const)it(`${style}: protects dense playing and endings, ignores future evidence and replays loop seams`,()=>{
 const {make}=fixture(style,'blues',7),score=make('developed',1,'piano',true,true,true,true,true),bars=run(score);
 expect([...bars.at(-1)!.bassEvents,...bars.at(-1)!.compEvents].some(e=>e.ensembleColor)).toBe(false);
 for(const bar of bars.filter(b=>[...b.bassEvents,...b.compEvents].some(e=>e.ensembleColor))){
  const checkpoint=bars[bar.fromBar-1].checkpoint,observation={barIndex:bar.fromBar,observedAtBar:bar.fromBar,source:'scripted' as const,confidence:1,noteDensity:1,restBeats:0};
  const dense=advanceRollingBacking(score,checkpoint,[observation]);expect([...dense.bassEvents,...dense.compEvents].some(e=>e.ensembleColor)).toBe(false);
  expect(advanceRollingBacking(score,checkpoint,[{...observation,barIndex:bar.fromBar+1,observedAtBar:bar.fromBar+1}])).toEqual(bar);
 }
 const loop=make('developed',2,'organ',false,true,true,true,true),loops=run(loop);
 for(const i of [51,52,53,103])expect(advanceRollingBacking(loop,JSON.parse(JSON.stringify(loops[i-1].checkpoint)))).toEqual(loops[i]);
});

it('seed 9 Blues provides all three audition gestures with either keyboard',()=>{
 for(const instrument of ['piano','organ'] as const){
  const bars=run(fixture('swing','blues',9).make('developed',1,instrument,false,true,true,true,true));
  for(const [key,expected] of [['bassEvents',21],['compEvents',25],['drumEvents',23]] as const){
   const bar=bars.find(b=>b[key].some(e=>e.ensembleColor))!;expect(bar.fromBar+1).toBe(expected);
  }
 }
});

it('a wider chord keeps the prior short-to-held articulation explicit in its card',()=>{
 const bars=run(fixture('swing','blues',42).make('developed',1,'piano',false,true,true,true,true));
 const bar=bars.find(b=>b.compEvents.some(e=>e.ensembleColor?.kind==='drop3'&&e.expression))!;expect(bar).toBeDefined();
 const card=describeMusicianDecisions(JSON.parse(JSON.stringify(bar)) as GeneratedBacking,{barIndex:bar.fromBar,ppq:192,beatsPerBar:4,style:'swing',orchestration:'coordinated'}).find(c=>c.instrument==='piano')!;
 expect(card.action).toBe('Open drop-3 voicing');expect(card.detail).toContain('Short chord → held answer');expect(card.detail).toContain('Other attacks:');
});
