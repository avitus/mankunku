import { createHash } from 'node:crypto';
import releaseNine from '../../fixtures/audio/musicality-0.9-hashes.json';
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
 const make = (keyboardSuspensions?: true | 'developed', loopCount = 1, instrument: 'piano'|'organ' = 'piano', hold = false) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
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

describe('0.10 full-performance resolution colors', () => {
 for (const style of ['swing','straight','bossa-nova','ballad'] as const) it(`${style}: develops actual full-tune colors with native support and replay`, () => {
  const kinds = new Set<string>(); const witnesses: unknown[] = [];
  for (const tune of ['blues','aaba'] as const) for (const seed of [42,7,19]) for (const instrument of ['piano','organ'] as const) {
   const {make} = fixture(style,tune,seed), score = make('developed',1,instrument), before = run(make(undefined,1,instrument)), after = run(score);
   expect(score.keyboardSuspensionsVersion).toBe(2);
   expect(score.fingerprint).not.toBe(make(true,1,instrument).fingerprint);
   expect(after.map(b=>b.bassEvents)).toEqual(before.map(b=>b.bassEvents));
   expect(after.map(b=>b.drumEvents)).toEqual(before.map(b=>b.drumEvents));
   for(const [i,bar] of after.entries()) {
    expect(advanceRollingBacking(score,i?JSON.parse(JSON.stringify(after[i-1].checkpoint)):undefined)).toEqual(bar);
    expect(bar.compEvents.map(({notes,...rhythm})=>rhythm)).toEqual(before[i].compEvents.map(({notes,...rhythm})=>rhythm));
    const trace=bar.ensembleDevelopment.pianoVoicings?.[0]?.decision.keyboardSuspension;
    if(!trace) continue;
    const [first,last]=bar.compEvents;
    expect(last.notes).toEqual(bar.checkpoint.piano.voicing?.notes);
    expect(last.notes).toEqual(bar.checkpoint.piano.segmentVoicing);
    expect(first.notes.at(-1)).toBe(last.notes.at(-1));
    expect(first.notes.map(n=>n===trace.fromMidi?trace.toMidi:n)).toEqual(last.notes);
    expect(trace.fromMidi-trace.toMidi).toBe(trace.kind?2:1);
    expect(bar.checkpoint.piano.lastVoicing).toEqual(last.notes);
    expect(bar.checkpoint.piano.lastSuspensionBar).toBe(i);
    for(const prior of after.slice(Math.max(0,i-2),i)) expect(prior.ensembleDevelopment.pianoVoicings?.some(v=>v.decision.keyboardSuspension)).toBe(false);
    if(trace.kind === '9-1') expect(bar.ensembleDevelopment.pianoVoicings![1].decision.rootlessTexture).toBeUndefined();
    if(trace.kind) { kinds.add(trace.kind);witnesses.push({tune,seed,instrument,bar:i+1,kind:trace.kind,notes:bar.compEvents.map(e=>e.notes)}); }
   }
  }
  process.stdout.write(`color-witness ${style} ${JSON.stringify({kinds:[...kinds],witnesses})}\n`);
  // Native admission is not a per-style quota; Ballad supplies fewer paired pads.
  if(style !== 'ballad') expect(kinds.has('9-1')).toBe(true);
  expect(kinds.has('13-5')).toBe(true);
 });
});

describe('color resolution ownership and evidence', () => {
 function witness() {
  const score=fixture('swing').make('developed'), bars=run(score);
  const index=bars.findIndex(bar=>bar.ensembleDevelopment.pianoVoicings?.[0]?.decision.keyboardSuspension?.kind);
  expect(index).toBeGreaterThan(0);
  const bar=bars[index], prior=bars[index-1].checkpoint, plan=bar.ensemblePlan.bars[0];
  const timing=restoreEnsembleTiming({phraseId:score.phraseId,tempo:score.tempo,ppq:score.ppq,swing:score.swing,timingProfiles:score.timingProfiles,trace:[bar.checkpoint.timing]});
  return {score,bars,index,bar,prior,plan,timing};
 }
 it('uses the actual resolved voicing for the next bar, including after JSON restore', () => {
  const {score,bars,index,bar}=witness();
  const first=bar.compEvents[0],last=bar.compEvents[1];
  expect(first.notes).not.toEqual(last.notes);
  expect(bar.checkpoint.piano.voicing?.notes).toEqual(last.notes);
  expect(bar.checkpoint.piano.segmentVoicing).toEqual(last.notes);
  const stale=JSON.parse(JSON.stringify(bar.checkpoint));
  stale.piano.voicing.notes=[...first.notes];stale.piano.segmentVoicing=[...first.notes];stale.piano.lastVoicing=[...first.notes];
  const {checkpointId:_,...contents}=stale;stale.checkpointId=`${stale.sessionId}:${stale.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}`;
  const actual=advanceRollingBacking(score,JSON.parse(JSON.stringify(bar.checkpoint))),wrong=advanceRollingBacking(score,stale);
  expect(actual).toEqual(bars[index+1]);
  expect(actual.ensembleDevelopment.pianoVoicings).not.toEqual(wrong.ensembleDevelopment.pianoVoicings);
 });
 it('declines a new target clashing with bass at the resolution attack, and missing bass evidence spends no cooldown', () => {
  const {score,index,bar,prior,plan,timing}=witness();
  const info={...score.bars[index],ensemble:plan,intensity:plan.energy};
  const trace=bar.ensembleDevelopment.pianoVoicings![0].decision.keyboardSuspension!;
  const second=bar.compEvents[1];
  const conflict=[...bar.bassEvents,{...bar.bassEvents[0],absBeat:second.absBeat,time:second.time,duration:second.duration,midi:trace.toMidi-11}];
  const declined=realizeRollingPiano(score,index,info,timing,prior.piano,undefined,'unavailable',conflict);
  expect(declined.voicingTrace?.[0]?.decision.keyboardSuspension?.kind).not.toBe(trace.kind);
  const first=bar.compEvents[0];
  const firstConflict=[...bar.bassEvents,{...bar.bassEvents[0],absBeat:first.absBeat,time:first.time,duration:first.duration,midi:trace.fromMidi-11}];
  const declinedFirst=realizeRollingPiano(score,index,info,timing,prior.piano,undefined,'unavailable',firstConflict);
  expect(declinedFirst.voicingTrace?.[0]?.decision.keyboardSuspension?.kind).not.toBe(trace.kind);
  const missing=realizeRollingPiano(score,index,info,timing,prior.piano);
  expect(missing.voicingTrace?.some(v=>v.decision.keyboardSuspension)).toBe(false);
  expect(missing.memory.lastSuspensionBar).toBe(prior.piano.lastSuspensionBar);
  expect(missing.events[0].notes).toEqual(missing.events[1].notes);
 });
 it('protects busy solo evidence, ignores future evidence and never borrows an uncommitted resolution', () => {
  const {score,index,bar,prior}=witness();
  const feature={barIndex:index,observedAtBar:index,source:'scripted' as const,confidence:1,noteDensity:1,restBeats:0};
  expect(advanceRollingBacking(score,prior,[feature]).ensembleDevelopment.pianoVoicings?.some(v=>v.decision.keyboardSuspension)).toBe(false);
  expect(advanceRollingBacking(score,prior,[{...feature,barIndex:index+1,observedAtBar:index+1}])).toEqual(bar);
  expect(bar.compEvents).toHaveLength(2);
 });
 it('rejects policy-mismatched checkpoints and reproduces every declared loop seam', () => {
  const {make}=fixture('swing'), score=make('developed',2), bars=run(score);
  expect(()=>advanceRollingBacking(make(true,2),bars[16].checkpoint)).toThrow();
  expect(()=>advanceRollingBacking(score,run(make(true,2))[16].checkpoint)).toThrow();
  for(const index of [50,51,52,53,100,103]) expect(advanceRollingBacking(score,JSON.parse(JSON.stringify(bars[index-1].checkpoint)))).toEqual(bars[index]);
 });
 it('explains only matching performed pairs and matching harmonic receipts', () => {
  const {bar,index}=witness();
  const score=JSON.parse(JSON.stringify(bar)) as GeneratedBacking;
  const context={barIndex:index,ppq:192,beatsPerBar:4,style:'swing' as const,orchestration:'coordinated' as const};
  const text=(value:GeneratedBacking)=>describeMusicianDecisions(value,context).flatMap(c=>c.evidence).join(' ');
  expect(text(score)).toContain('thirteenth resolves to fifth');
  const missing=structuredClone(score);missing.compEvents.pop();expect(text(missing)).not.toContain('thirteenth resolves');
  const wrong=structuredClone(score);wrong.compEvents[1].notes=[...wrong.compEvents[0].notes];expect(text(wrong)).not.toContain('thirteenth resolves');
  const mislabeled=structuredClone(score);for(const entry of mislabeled.ensembleDevelopment!.pianoVoicings!) (entry.decision.keyboardSuspension as {kind:string}).kind='9-1';
  expect(text(mislabeled)).not.toContain('ninth resolves');
  const receipt=structuredClone(score);delete (receipt.ensembleDevelopment!.pianoVoicings![1].decision as {keyboardSuspension?:unknown}).keyboardSuspension;
  expect(text(receipt)).not.toContain('thirteenth resolves');
 });
 for(const style of ['swing','straight','bossa-nova','ballad'] as const) for(const instrument of ['piano','organ'] as const)
  it(`${style}/${instrument}: preserves joint ending ownership and the actual remembered resolution`,()=>{
   const score=fixture(style).make('developed',1,instrument,true),bars=run(score),last=bars.at(-1)!;
   expect(bars.some(b=>b.ensembleDevelopment.pianoVoicings?.some(v=>v.decision.keyboardSuspension?.kind))).toBe(true);
   expect(last.ensembleDevelopment.terminalArrangements?.[0].status).toBe('accepted');
   expect(last.compEvents).toHaveLength(1);
   expect(last.ensembleDevelopment.pianoVoicings?.some(v=>v.decision.keyboardSuspension)).toBe(false);
   expect(last.checkpoint.piano.lastSuspensionBar).toBe(bars.at(-2)!.checkpoint.piano.lastSuspensionBar);
   expect(advanceRollingBacking(score,JSON.parse(JSON.stringify(bars.at(-2)!.checkpoint)))).toEqual(last);
  });
});

// Captured from a separate git-archive of the committed 0.9 release, not from this implementation.
for(const style of ['swing','straight','bossa-nova','ballad'] as const) it(`${style}: preserves the complete 0.9 event, trace and checkpoint baseline`,()=>{
 for(const tune of ['blues','aaba'] as const) for(const seed of [42,7,19]) for(const instrument of ['piano','organ'] as const) {
  const key=`${style}/${tune}/${seed}/${instrument}` as keyof typeof releaseNine.hashes;
  const bars=run(fixture(style,tune,seed).make(true,1,instrument));
  expect(createHash('sha256').update(JSON.stringify(bars)).digest('hex'),key).toBe(releaseNine.hashes[key]);
 }
});
