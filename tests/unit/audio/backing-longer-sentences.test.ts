import { musicalSentence, sentenceOffset, sentenceBassCenters } from '$lib/audio/backing-sentences';
import { seedFrom } from '$lib/audio/generation-rng';
import { describeMusicianDecisions } from '$lib/musicality/musician-decisions';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint, type RollingBackingOptions } from '$lib/audio/backing-rolling';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { buildListeningTuneSession, assessListeningTune } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';
import type { BackingStyle } from '$lib/types/instruments';

export function sentenceScore(style: BackingStyle = 'swing', seed = 256, instrument: 'piano'|'organ' = 'piano', enabled = true, aaba = false, loops = 1, swing = .62) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const { phrase } = aaba ? admitted.session : buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
 const tempo = style === 'ballad' ? 80 : 140;
 const options = { ...releasedBackingOptions(instrument, seed), loopCount: loops } as RollingBackingOptions & { longerSentences?: true };
 delete options.longerSentences;
 if (enabled) options.longerSentences = true;
 return createRollingBacking(phrase.harmony!, BACKING_STYLES[style], { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4,
  swing: resolveBackingSwing(swing, BACKING_STYLES[style], tempo), sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {} }, options);
}
export function sentenceTake(score: ReturnType<typeof sentenceScore>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => { const b = advanceRollingBacking(score, checkpoint); checkpoint = b.checkpoint; return b; });
}

it('carries an actually sounded keyboard cell and drummer phrase across the middle of an eight-bar sentence', () => {
 let keys = 0, drums = 0, bassChanges = 0;
 for (const seed of [256, 7, 19, 42]) {
  const score = sentenceScore('swing', seed), bars = sentenceTake(score), old = sentenceTake(sentenceScore('swing', seed, 'piano', false));
  for (const b of bars) {
   const t = b.ensembleDevelopment.pianoMotifs[0];
   if (t.motifId && t.barIndex - t.phraseStartBar >= 4 && b.compEvents.length) {
    const first = bars[t.sentenceSourceBar ?? t.phraseStartBar];
    expect(first.compEvents.length).toBeGreaterThan(0);
    expect(first.ensembleDevelopment.pianoMotifs[0].motifId).toBe(t.motifId);
    keys++;
   }
   const d = b.ensembleDevelopment.drumPhrases[0];
   if (d.phraseLength === 8 && b.fromBar === d.phraseStartBar + 3) {
    expect(d.ride.phase).not.toBe('release');
    expect(d.commentary.transform).not.toBe('setup');
    drums++;
   }
   if (b.bassEvents.map(e=>e.midi).join() !== old[b.fromBar].bassEvents.map(e=>e.midi).join()) bassChanges++;
  }
 }
 expect(keys).toBeGreaterThan(5); expect(drums).toBeGreaterThan(0); expect(bassChanges).toBeGreaterThan(5);
});

for (const style of ['swing','straight','bossa-nova','ballad'] as const) it(`${style}: full forms preserve support, native pulse, actual memory and serialized replay`, () => {
 for (const aaba of [false,true]) for (const instrument of ['piano','organ'] as const) {
  const score = sentenceScore(style, 7, instrument, true, aaba), bars = sentenceTake(score), old = sentenceTake(sentenceScore(style, 7, instrument, false, aaba));
  for (const [i,b] of bars.entries()) {
   expect(advanceRollingBacking(score, i ? JSON.parse(JSON.stringify(bars[i-1].checkpoint)) : undefined)).toEqual(b);
   const plan = b.ensemblePlan.bars[0];
   if (plan.piano.harmonicSupport && plan.piano.maxAttacks > 0 && !plan.coordinatedAccent) expect(b.compEvents.length).toBeGreaterThan(0);
   expect(b.bassEvents.map(e=>[e.absBeat,e.time,e.duration,e.velocity])).toEqual(old[i].bassEvents.map(e=>[e.absBeat,e.time,e.duration,e.velocity]));
   expect(b.checkpoint.piano.lastVoicing).toEqual(b.compEvents.at(-1)?.notes ?? bars[i-1]?.checkpoint.piano.lastVoicing ?? []);
   expect(b.checkpoint.bass.previousMidi).toBe(b.bassEvents.at(-1)?.midi ?? bars[i-1]?.checkpoint.bass.previousMidi ?? null);
   if (style === 'bossa-nova' || style === 'ballad') {
    expect(b.bassEvents).toEqual(old[i].bassEvents); expect(b.drumEvents).toEqual(old[i].drumEvents);
    expect(b.compEvents.map(e=>[e.absBeat,e.time,e.duration,e.phraseDialogue?.kind==='fourth-stack'?e.phraseDialogue.originalVelocity:e.velocity])).toEqual(old[i].compEvents.map(e=>[e.absBeat,e.time,e.duration,e.phraseDialogue?.kind==='fourth-stack'?e.phraseDialogue.originalVelocity:e.velocity]));
   }
   const d=b.ensembleDevelopment.drumPhrases[0];
   if(d.phraseLength===8) {
    const context=score.bars[d.phraseStartBar];
    expect(context.role).toBe('solo');
    expect(score.bars[d.phraseStartBar+7].sectionIndex).toBe(context.sectionIndex);
    expect(score.bars[d.phraseStartBar+7].chorusIndex).toBe(context.chorusIndex);
   }
  }
 }
});

it('versions the policy and keeps future observations from rewriting a committed sentence', () => {
 const score=sentenceScore(),bars=sentenceTake(score),old=sentenceScore('swing',256,'piano',false);
 expect(()=>advanceRollingBacking(old,bars[0].checkpoint)).toThrow();
 for(const b of bars.slice(16,28)) {
  const feature={barIndex:b.fromBar+1,observedAtBar:b.fromBar+1,source:'scripted' as const,confidence:1,noteDensity:1,restBeats:0};
  expect(advanceRollingBacking(score,bars[b.fromBar-1].checkpoint,[feature])).toEqual(b);
 }
 const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const before=hash(bars);
 const loop=sentenceScore('swing',256,'piano',true,false,2),repeated=sentenceTake(loop);
 for(const i of [51,52,53,103])expect(advanceRollingBacking(loop,JSON.parse(JSON.stringify(repeated[i-1].checkpoint)))).toEqual(repeated[i]);
 expect(hash(bars)).toBe(before);
});

it('uses varied bounded sentence contours without crossing authored form boundaries', () => {
 const shapes=new Set<string>(), selections=new Set<string>();
 for(let seed=0;seed<20;seed++) {
  const score=sentenceScore('swing',seed);
  const starts:number[]=[];
  for(let bar=0;bar<score.totalBars;bar++) {
   const sentence=musicalSentence(score,bar);if(!sentence)continue;
   expect(score.bars[bar].role).toBe('solo');
   expect(score.bars[sentence.startBar].sectionIndex).toBe(score.bars[sentence.endBarExclusive-1].sectionIndex);
   if(bar===sentence.startBar) {
    starts.push(bar);shapes.add(sentence.shape);
    const centers=sentenceBassCenters(score,Array(score.totalBars).fill(40));
    expect(centers[bar+7]).toBe(centers[bar]);
    expect(Math.max(...centers.slice(bar,bar+8))-Math.min(...centers.slice(bar,bar+8))).toBeGreaterThanOrEqual(5);
    expect(sentenceOffset(sentence,bar)).toBe(0);
   }
  }
  selections.add(starts.join(','));
 }
 expect(shapes.size).toBe(3);expect(selections.size).toBeGreaterThan(1);
});

it('rejects a forged future keyboard source even after the outer checksum is recomputed',()=>{
 const score=sentenceScore('swing',7),bars=sentenceTake(score);
 const cp=JSON.parse(JSON.stringify(bars.find(b=>b.checkpoint.piano.motif?.sourceBar!==undefined)!.checkpoint));
 cp.piano.motif.sourceBar=cp.nextBar;
 const {checkpointId:_,...body}=cp;
 cp.checkpointId=`${cp.sessionId}:${cp.nextBar}:${seedFrom(JSON.stringify(body)).toString(16)}`;
 expect(()=>advanceRollingBacking(score,cp)).toThrow();
});

it('backs the sentence display with accepted notes and refuses mismatched bass evidence',()=>{
 const score=sentenceScore('swing',3),bars=sentenceTake(score);
 for(const b of bars.filter(b=>b.ensembleDevelopment.musicalSentences?.[0].bass)) {
  const cards=describeMusicianDecisions({...b,bassEvents:[...b.bassEvents],compEvents:[...b.compEvents],drumEvents:[...b.drumEvents]},{barIndex:b.fromBar,ppq:192,beatsPerBar:4,style:'swing',orchestration:'coordinated'});
  if(b.checkpoint.bass.feel==='four')expect(cards[0].evidence.join()).toContain('Eight-bar sentence');
  expect(cards[0].detail).not.toMatch(/undefined|NaN/);
  if(b.fromBar===21)expect(cards[0].detail).toContain('G2');
  const bad=JSON.parse(JSON.stringify(b));bad.bassEvents[0].midi++;
  expect(describeMusicianDecisions(bad,{barIndex:b.fromBar,ppq:192,beatsPerBar:4,style:'swing',orchestration:'coordinated'})[0].evidence.join()).not.toContain('Eight-bar sentence');
 }
});

it('dense activity yields keyboard motifs and drum commentary while keeping the band present',()=>{
 const score=sentenceScore('swing',7),bars=sentenceTake(score);
 for(const b of bars.filter(b=>b.ensembleDevelopment.musicalSentences?.[0].keyboard)) {
  const dense=advanceRollingBacking(score,b.fromBar?bars[b.fromBar-1].checkpoint:undefined,[{barIndex:b.fromBar,observedAtBar:b.fromBar,source:'scripted',confidence:1,noteDensity:1,restBeats:0}]);
  expect(dense.ensembleDevelopment.pianoMotifs[0].development).toBeUndefined();
  expect(dense.ensembleDevelopment.drumPhrases[0].commentary.hits).toHaveLength(0);
  expect(dense.bassEvents.length).toBeGreaterThan(0);
  expect(dense.drumEvents.length).toBeGreaterThan(0);
 }
});

it('the released factory enables longer sentences explicitly',()=>expect(releasedBackingOptions('piano',7).longerSentences).toBe(true));


it('the release example develops both solo sentences with piano and organ at both swing settings',()=>{
 for(const instrument of ['piano','organ'] as const) for(const swing of [.62,.67]) {
  const score=sentenceScore('swing',3,instrument,true,false,1,swing),bars=sentenceTake(score);
  for(const start of [16,28]) {
   const source=bars.slice(start,start+3).find(b=>b.ensembleDevelopment.pianoMotifs[0].transform==='statement')!;
   expect(source).toBeTruthy();
   const ending=bars[start+7];
   expect(ending.ensembleDevelopment.pianoMotifs[0].motifId).toBe(source.ensembleDevelopment.pianoMotifs[0].motifId);
   expect(ending.ensembleDevelopment.pianoMotifs[0].transform).toBe('shorten');
   expect(bars[start+3].ensembleDevelopment.drumPhrases[0].ride.phase).toBe('variation');
   expect(ending.ensembleDevelopment.drumPhrases[0].ride.phase).toBe('release');
   expect(bars.slice(start+1,start+8).every(b=>b.compEvents.length>0)).toBe(true);
  }
  const old=sentenceTake(sentenceScore('swing',3,instrument,false,false,1,swing));
  expect(bars.slice(16,24).flatMap(b=>b.bassEvents.map(e=>e.midi))).not.toEqual(old.slice(16,24).flatMap(b=>b.bassEvents.map(e=>e.midi)));
 }
});

it('native keyboard direction changes actual pitches without borrowing Swing rhythm',()=>{
 for(const style of ['bossa-nova','ballad'] as const) {
  let changes=0,connections=0;
  for(const seed of [3,7,19,42]) {
   const bars=sentenceTake(sentenceScore(style,seed)),old=sentenceTake(sentenceScore(style,seed,'piano',false));
   for(const [i,b] of bars.entries()) {
    if(JSON.stringify(b.compEvents.map(e=>e.notes))!==JSON.stringify(old[i].compEvents.map(e=>e.notes)))changes++;
    const receipts=b.ensembleDevelopment.musicalSentences?.[0].keyboardLine??[];
    connections+=receipts.length;
    for(const receipt of receipts) {
     const line=b.ensembleDevelopment.pianoVoicings?.find(v=>v.time===receipt.time)?.decision.keyboardLine;
     expect(line?.status).toBe('connected');expect(line?.contour).not.toBe('settle');
    }
   }
  }
  expect(changes,style).toBeGreaterThan(0);expect(connections,style).toBeGreaterThan(0);
 }
});
