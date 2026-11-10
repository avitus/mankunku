import { describe, expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';
import { restoreEnsembleTiming } from '$lib/audio/ensemble-timing';
import { realizeRollingPiano } from '$lib/audio/backing-rolling-piano';
import { describeMusicianDecisions } from '$lib/musicality/musician-decisions';
import type { GeneratedBacking } from '$lib/audio/backing-generation';
import { seedFrom } from '$lib/audio/generation-rng';

type Style = 'swing' | 'straight' | 'bossa-nova' | 'ballad';
function fixture(style: Style, tune: 'blues' | 'aaba' = 'blues', seed = 42) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const session = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const { phrase } = session, tempo = style === 'ballad' ? 80 : 140;
 const make = (keyboardSuspensions?: true, loopCount = 1, instrument: 'piano'|'organ' = 'piano', hold = false) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}, ...(hold ? {terminalArrangement:{ending:'hold-release' as const,melody:phrase.notes}} : {})
 }, { returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
  chorusBoundaryPriority: true, loopCount, keyboardTexture: true, keyboardPhrasing:instrument, bassDelayedRoot:true, keyboardContraryMotion:true, drumPhraseCushioning:true, ...(keyboardSuspensions ? { keyboardSuspensions } : {}) });
 return { make, session };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint; return result;
 });
}

describe('0.9 complete suspension and resolution cells', () => {
 for(const style of ['swing','straight','bossa-nova','ballad'] as const) {
  it(`${style}: full Blues and AABA retain native support, replay and other players`, () => {
   let cells=0; const witnesses: unknown[]=[];
   for(const tune of ['blues','aaba'] as const) for(const seed of [42,7,19]) {
    const {make}=fixture(style,tune,seed), score=make(true), before=run(make()), after=run(score);
    expect(score.fingerprint).not.toBe(make().fingerprint);
    const rhythm=(bars:typeof after)=>bars.map(b=>b.compEvents.map(({time,absBeat,duration,velocity})=>({time,absBeat,duration,velocity})));
    expect(rhythm(after)).toEqual(rhythm(before));
    expect(after.map(b=>b.bassEvents)).toEqual(before.map(b=>b.bassEvents));
    expect(after.map(b=>b.drumEvents)).toEqual(before.map(b=>b.drumEvents));
    for(const [i,bar] of after.entries()) {
     expect(advanceRollingBacking(score,i?JSON.parse(JSON.stringify(after[i-1].checkpoint)):undefined)).toEqual(bar);
     const voiced=bar.ensembleDevelopment.pianoVoicings??[];
     const receipts=voiced.filter(v=>v.decision.keyboardSuspension);
     if(!receipts.length) { expect(bar.compEvents).toEqual(before[i].compEvents); continue; }
     cells++; witnesses.push({tune,seed,bar:i+1,notes:bar.compEvents.map(e=>e.notes)});
     expect(receipts).toHaveLength(2); expect(bar.compEvents).toHaveLength(2);
     const [first,last]=bar.compEvents, [a,b]=receipts;
     expect(a.notes).toEqual(first.notes); expect(b.notes).toEqual(last.notes);
     expect(a.decision.keyboardSuspension?.phase).toBe('suspension');
     expect(b.decision.keyboardSuspension?.phase).toBe('resolution');
     const trace=a.decision.keyboardSuspension!;
     expect(trace.fromMidi-trace.toMidi).toBe(1);
     expect(first.notes.map(n=>n===trace.fromMidi?trace.toMidi:n)).toEqual(last.notes);
     expect(first.notes.at(-1)).toBe(last.notes.at(-1));
     expect(last).toEqual(before[i].compEvents[1]);
     expect(bar.checkpoint.piano.lastVoicing).toEqual(last.notes);
     expect(bar.checkpoint.piano.lastSuspensionBar).toBe(i);
     expect(bar.ensemblePlan.bars[0].performanceEnergy?.phase).toMatch(/^solo_/);
     expect(bar.ensemblePlan.bars[0].responseOwner).toBe('nobody');
     const start=parseFloat(first.time),end=start+first.duration*score.tempo/60*score.ppq;
     expect(bar.bassEvents.some(e=>e.midi%12===trace.toMidi%12 && parseFloat(e.time)<end && parseFloat(e.time)+e.duration*score.tempo/60*score.ppq>start)).toBe(false);
     expect(i===0 || !(after[i-1].ensembleDevelopment.pianoVoicings??[]).some(v=>v.decision.keyboardSuspension)).toBe(true);
    }
   }
   process.stdout.write(`suspension-witness ${style} ${JSON.stringify({cells,witnesses})}\n`);
   expect(cells).toBeGreaterThan(0);
  });
 }
 for(const style of ['swing','straight','bossa-nova','ballad'] as const) for(const instrument of ['piano','organ'] as const) {
  it(`${style}/${instrument}: protects the joint final release and retains accepted cooldown memory`,()=>{
   const {make}=fixture(style),score=make(true,1,instrument,true),bars=run(score);
   expect(bars.some(b=>b.ensembleDevelopment.pianoVoicings?.some(v=>v.decision.keyboardSuspension))).toBe(true);
   const last=bars.at(-1)!;
   expect(last.ensembleDevelopment.terminalArrangements?.[0].status).toBe('accepted');
   expect(last.compEvents).toHaveLength(1);
   expect(last.ensembleDevelopment.pianoVoicings?.some(v=>v.decision.keyboardSuspension)).toBe(false);
   expect(last.checkpoint.piano.lastSuspensionBar).toBe(bars.at(-2)!.checkpoint.piano.lastSuspensionBar);
   expect(advanceRollingBacking(score,JSON.parse(JSON.stringify(bars.at(-2)!.checkpoint)))).toEqual(last);
  });
 }
 it('rejects cross-policy checkpoints and replays declared loop seams',()=>{
  const {make}=fixture('swing');const score=make(true,2), bars=run(score);
  expect(()=>advanceRollingBacking(make(undefined,2),bars[0].checkpoint)).toThrow();
  for(const i of [50,51,52,53,100,103]) expect(advanceRollingBacking(score,JSON.parse(JSON.stringify(bars[i-1].checkpoint)))).toEqual(bars[i]);
 });
});

describe('suspension admission and honest musician evidence',()=>{
 function witness() {
  const score=fixture('swing').make(true),bars=run(score);
  const index=bars.findIndex(b=>b.ensembleDevelopment.pianoVoicings?.some(v=>v.decision.keyboardSuspension));
  expect(index).toBeGreaterThan(0);
  const bar=bars[index],plan=bar.ensemblePlan.bars[0];
  const timing=restoreEnsembleTiming({phraseId:score.phraseId,tempo:score.tempo,ppq:score.ppq,swing:score.swing,
   timingProfiles:score.timingProfiles,trace:[bar.checkpoint.timing]});
  return {score,bars,index,bar,plan,timing,prior:bars[index-1].checkpoint};
 }
 it('declines a conflicting actually sounded bass third, and does not spend the cooldown',()=>{
  const {score,index,bar,plan,timing,prior}=witness();
  const info={...score.bars[index],ensemble:plan,intensity:plan.energy};
  const ordinary=realizeRollingPiano(score,index,info,timing,prior.piano,undefined,'unavailable',bar.bassEvents);
  expect(ordinary.voicingTrace?.[0].decision.keyboardSuspension).toBeDefined();
  const first=ordinary.events[0],third=ordinary.voicingTrace![0].decision.keyboardSuspension!.toMidi;
  const clashing=[{...bar.bassEvents[0],time:first.time,absBeat:first.absBeat,midi:third-12,duration:first.duration}];
  const declined=realizeRollingPiano(score,index,info,timing,prior.piano,undefined,'unavailable',clashing);
  expect(declined.voicingTrace?.some(v=>v.decision.keyboardSuspension)).toBe(false);
  expect(declined.events[0].notes).toEqual(ordinary.events[1].notes);
  expect(declined.memory.lastSuspensionBar).toBe(prior.piano.lastSuspensionBar);
  const missing=realizeRollingPiano(score,index,info,timing,prior.piano);
  expect(missing.voicingTrace?.some(v=>v.decision.keyboardSuspension)).toBe(false);
 });
 it('protects dense live evidence and ignores observations from future bars',()=>{
  const {score,index,bar,prior}=witness();
  const observation={barIndex:index,observedAtBar:index,source:'scripted' as const,confidence:1,noteDensity:1,restBeats:0};
  const dense=advanceRollingBacking(score,prior,[observation]);
  expect(dense.ensembleDevelopment.pianoVoicings?.some(v=>v.decision.keyboardSuspension)).toBe(false);
  expect(dense.checkpoint.piano.lastSuspensionBar).toBe(prior.piano.lastSuspensionBar);
  expect(advanceRollingBacking(score,prior,[{...observation,barIndex:index+1,observedAtBar:index+1}])).toEqual(bar);
 });
 it('retains the accepted cooldown in JSON and rejects invalid re-signed memory',()=>{
  const {score,index,bar}=witness();
  for(const lastSuspensionBar of [-1, .5, index+1, 0]) {
   const checkpoint=JSON.parse(JSON.stringify(bar.checkpoint));checkpoint.piano.lastSuspensionBar=lastSuspensionBar;
   const {checkpointId:_,...contents}=checkpoint;
   checkpoint.checkpointId=`${checkpoint.sessionId}:${checkpoint.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}`;
   expect(()=>advanceRollingBacking(score,checkpoint)).toThrow();
  }
 });
 it('shows a resolution only when both actual attacks and both receipts agree',()=>{
  const {bar,index}=witness();
  const score=JSON.parse(JSON.stringify(bar)) as GeneratedBacking;
  const context={barIndex:index,ppq:192,beatsPerBar:4,style:'swing' as const,orchestration:'coordinated' as const};
  const text=(value:GeneratedBacking)=>describeMusicianDecisions(value,context).flatMap(c=>c.evidence).join(' ');
  expect(text(score)).toContain('fourth resolves to third');
  const missing=structuredClone(score);missing.compEvents.pop();expect(text(missing)).not.toContain('fourth resolves to third');
  const wrong=structuredClone(score);wrong.compEvents[1].notes[1]++;expect(text(wrong)).not.toContain('fourth resolves to third');
  const receipt=structuredClone(score);delete (receipt.ensembleDevelopment!.pianoVoicings![1].decision as {keyboardSuspension?:unknown}).keyboardSuspension;
  expect(text(receipt)).not.toContain('fourth resolves to third');
  expect(describeMusicianDecisions(score,{...context,orchestration:'original'}).flatMap(c=>c.evidence).join(' ')).not.toContain('fourth resolves to third');
 });
});
