import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { resolveCoordinatedVoicing } from '$lib/audio/coordinated-voicing';
import { HISTORICAL_MUSICALITY_STYLES as BACKING_STYLES } from '../../helpers/musicality-style-fixtures';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';

type Style = 'swing' | 'straight' | 'bossa-nova' | 'ballad';
function fixture(style: Style, tune: 'blues' | 'aaba' = 'blues', seed = 42) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const session = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const { phrase } = session, tempo = style === 'ballad' ? 80 : 140;
 const make = (keyboardTexture = false, loopCount = 1) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}
 }, { returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
  chorusBoundaryPriority: true, loopCount, ...(keyboardTexture ? { keyboardTexture: true } : {}) });
 return { make, session };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint; return result;
 });
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const span = (notes: readonly number[]) => notes.at(-1)! - notes[0];

describe('keyboard chord texture in complete performances', () => {
 it('retains the complete prior0.5 listening output when omitted', () => {
  const hashes: Record<Style,string> = { swing: 'c3b3d495d29d25f7cc06b1449401036b73a0a4e4d8a1481bcf22439834c603bb', straight: 'c435561a3ace0dfd61a3008e411599b0d9085ca1a295b47c2cee3f2f42e3d3e6', 'bossa-nova': '32eab284b74433e8fba956f3151e171d7571c907ef67824d4271f59f0d078087', ballad: 'cdfd48f917fb5399bf2beb249c311d8cc408890637392d8d3b199bfb5653bf53' };
  for (const style of ['swing','straight','bossa-nova','ballad'] as const) {
   const actual=digest(run(fixture(style).make())); console.info('prior0.5-hash',style,actual); expect.soft(actual).toBe(hashes[style]);
  }
 });
 it('makes compact and open versions of the same rootless harmony audibly different without changing its tones', () => {
  for (const root of ['C','F','F#','Bb'] as const) for (const quality of ['7','maj7','min7'] as const) {
   const input={chord:{root,quality},family:'rootless-a' as const,registerMidi:62,rootlessTexture:'full' as const};
   const compact=resolveCoordinatedVoicing({...input,spacing:'compact'});
   const open=resolveCoordinatedVoicing({...input,previous:compact.memory,spacing:'open'});
   expect(span(compact.notes)).toBeLessThanOrEqual(12); expect(span(open.notes)).toBeGreaterThanOrEqual(14);
   expect(open.notes).not.toEqual(compact.notes);
   expect(new Set(open.notes.map(n=>n%12))).toEqual(new Set(compact.notes.map(n=>n%12)));
   expect(open.decision.spacing?.applied).toBe('open');
  }
 });
 for (const style of ['swing','straight'] as const) for (const tune of ['blues','aaba'] as const) it(`${style}/${tune} plays varied thickness and spacing while keeping its rhythmic support`, () => {
  const textures=new Set<string>(); let changed=0, thinner=0, fuller=0, opens=0, compacts=0;
  for (const seed of [7,19,42,83]) {
   const {make}=fixture(style,tune,seed), score=make(true), before=run(make()), after=run(score);
   expect(score.keyboardTextureVersion).toBe(1);
   for (let i=0;i<after.length;i++) {
    const a=after[i],b=before[i], plan=a.ensemblePlan.bars[0];
    expect(a.compEvents.map(({notes,...event})=>event)).toEqual(b.compEvents.map(({notes,...event})=>event));
    expect(a.bassEvents).toEqual(b.bassEvents); expect(a.drumEvents).toEqual(b.drumEvents);
    if (plan.piano.harmonicSupport) expect(a.compEvents.length).toBeGreaterThan(0);
    if (plan.piano.silenceReason) expect(a.compEvents).toHaveLength(0);
    if (['under_response','after_response'].includes(plan.piano.harmonicSupport??'')) {
     expect(a.compEvents).toHaveLength(1); expect(a.compEvents[0].notes).toHaveLength(2);
    }
    for (const [index,event] of a.compEvents.entries()) {
     if (JSON.stringify(event.notes)!==JSON.stringify(b.compEvents[index].notes)) changed++;
     expect(event.notes.every(n=>Number.isInteger(n)&&n>=48&&n<=84)).toBe(true);
     const decision=a.ensembleDevelopment.pianoVoicings?.[index].decision;
     if (decision?.keyboardTexture) {
      textures.add(decision.keyboardTexture.profile);
      if (decision.rootlessTexture?.applied==='three') thinner++;
      if (decision.rootlessTexture?.applied==='full'&&event.notes.length===4) fuller++;
      if (decision.spacing?.applied==='open') { opens++; expect(span(event.notes)).toBeGreaterThanOrEqual(14); }
      if (decision.spacing?.applied==='compact') { compacts++; expect(span(event.notes)).toBeLessThanOrEqual(12); }
      expect(decision.resolvedFamily).toMatch(/^rootless-/);
     }
    }
   }
  }
  process.stdout.write(`texture-witness ${style}/${tune} ${JSON.stringify({textures:[...textures],changed,thinner,fuller,opens,compacts})}\n`);
  expect(textures.size).toBe(3); for(const n of [changed,thinner,fuller,opens,compacts]) expect(n).toBeGreaterThan(10);
 });
 it('limits requested spread changes by guide movement and reports any fallback truthfully', () => {
  let fallbacks=0;
  for (const root of ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'] as const) for (const quality of ['7','maj7','min7'] as const) {
   const input={chord:{root,quality},family:'rootless-a' as const,registerMidi:62,rootlessTexture:'three' as const};
   const previous=resolveCoordinatedVoicing({...input,spacing:'compact'}).memory;
   const ordinary=resolveCoordinatedVoicing({...input,previous});
   const requested=resolveCoordinatedVoicing({...input,previous,spacing:'open'});
   expect(requested.decision.guideMotion!).toBeLessThanOrEqual(ordinary.decision.guideMotion!+4);
   if (requested.decision.spacing?.reason==='voice_leading') {
    fallbacks++;expect(requested.notes).toEqual(ordinary.notes);expect(requested.decision.spacing.applied).toBe('unchanged');
   }
  }
  expect(fallbacks).toBeGreaterThan(0);
  const guide=resolveCoordinatedVoicing({chord:{root:'C',quality:'7'},family:'guide',registerMidi:62,spacing:'open'});
  expect(guide.decision.spacing?.reason).toBe('family_ineligible'); expect(guide.notes).toHaveLength(2);
 });
 it('varies notes and thickness even within one sustained harmonic segment',()=>{
  const {make}=fixture('swing'),original=make(true);
  const score=createRollingBacking([{...original.harmony[0],startOffset:[0,1],duration:[original.totalBars,1],chord:{root:'F',quality:'7'}}],BACKING_STYLES.swing,
   {phraseId:original.phraseId,tempo:140,ppq:192,beatsPerBar:4,swing:.67,performanceForm:original.performanceForm,ensemble:{}},
   {pianoPresence:'accompaniment',keyboardVariety:'developed',chorusBoundaryPriority:true,performanceEnergySeed:42,keyboardTexture:true});
  const bars=run(score),voiced=bars.flatMap(bar=>bar.ensembleDevelopment.pianoVoicings??[]).filter(v=>v.decision.keyboardTexture);
  expect(new Set(voiced.map(v=>v.notes.join(','))).size).toBeGreaterThan(3);
  expect(new Set(voiced.map(v=>v.notes.length))).toEqual(new Set([3,4]));
  expect(voiced.some(v=>v.decision.spacing?.applied==='open')).toBe(true);
  expect(voiced.some(v=>v.decision.spacing?.applied==='compact')).toBe(true);
 });
 it('reports actual default listening take texture witnesses',()=>{
  const {make}=fixture('swing'),before=run(make()),bars=run(make(true));
  const voiced=bars.flatMap(bar=>bar.ensembleDevelopment.pianoVoicings??[]).filter(v=>v.decision.keyboardTexture);
  const counts={three:voiced.filter(v=>v.notes.length===3).length,four:voiced.filter(v=>v.notes.length===4).length,
   open:voiced.filter(v=>v.decision.spacing?.applied==='open').length,compact:voiced.filter(v=>v.decision.spacing?.applied==='compact').length,
   fallback:voiced.filter(v=>v.decision.spacing?.applied==='unchanged').length,
   changed:bars.reduce((sum,b,i)=>sum+b.compEvents.filter((event,j)=>JSON.stringify(event.notes)!==JSON.stringify(before[i].compEvents[j].notes)).length,0)};
  process.stdout.write(`default-keyboard-textures ${JSON.stringify(counts)}\n`);
  expect(counts.three).toBeGreaterThan(0);expect(counts.four).toBeGreaterThan(0);expect(counts.open).toBeGreaterThan(0);expect(counts.compact).toBeGreaterThan(0);expect(counts.changed).toBeGreaterThan(10);
 });
 it('preserves native Bossa and Ballad exactly',()=>{
  for(const style of ['bossa-nova','ballad'] as const) {const {make}=fixture(style);expect(run(make(true))).toEqual(run(make()));}
 });
 it('replays actual voiced history and rejects cross-policy checkpoints',()=>{
  const {make}=fixture('swing','aaba'),score=make(true),bars=run(score),old=run(make());
  for(const i of [5,18,47,72,110]) {
   expect(advanceRollingBacking(score,JSON.parse(JSON.stringify(bars[i].checkpoint)))).toEqual(bars[i+1]);
   expect(()=>advanceRollingBacking(score,old[i].checkpoint)).toThrow();
   expect(()=>advanceRollingBacking(make(),bars[i].checkpoint)).toThrow();
  }
 });
 it('retains performed loop prefixes and ignores future evidence while giving current density priority',()=>{
  const {make}=fixture('swing'),two=make(true,2),three=make(true,3),a=run(two),b=run(three);
  const musical=(v:typeof a[number])=>[v.bassEvents,v.compEvents,v.drumEvents,v.ensemblePlan,v.ensembleDevelopment];
  expect(a.slice(0,52).map(musical)).toEqual(b.slice(0,52).map(musical));
  expect(advanceRollingBacking(two,JSON.parse(JSON.stringify(a[51].checkpoint)))).toEqual(a[52]);
  const next=20, checkpoint=a[next-1].checkpoint;
  const future={barIndex:next+1,observedAtBar:next+1,source:'scripted' as const,confidence:1,noteDensity:1,restBeats:0};
  expect(advanceRollingBacking(two,checkpoint,[future])).toEqual(a[next]);
  const dense=advanceRollingBacking(two,checkpoint,[{...future,barIndex:next,observedAtBar:next}]);
  expect(dense.ensembleDevelopment.pianoVoicings?.every(v=>!v.decision.keyboardTexture)).toBe(true);
 });
});
