import { describe, it, expect } from 'vitest';
import { prepareReleasedArrangement } from '$lib/audio/backing-arrangement';
import { generateForBounce } from '$lib/audio/backing-bounce';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { buildJamForm } from '$lib/tunes/jam-form';
import { MANKUNKU_BLUES } from '$lib/data/tunes';

const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
function params(style: keyof typeof BACKING_STYLES) {
 const tempo = style === 'ballad' ? 80 : 140;
 return { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4,
  swing: resolveBackingSwing(.62, BACKING_STYLES[style], tempo), sectionMap: phrase.sectionMap,
  performanceForm: phrase.performanceForm, ensemble: {} };
}
describe('normal playback uses the released musical vocabulary', () => {
 it.each(['swing','straight','bossa-nova','ballad'] as const)('plays the normal tune desk’s complete %s head/solos/head form', style => {
  const jam=buildJamForm(MANKUNKU_BLUES,2);
  expect(jam.phraseBars).toBe(52);
  expect(jam.phrase.performanceForm?.totalBars).toBe(jam.phraseBars);
  expect(jam.phrase.performanceForm?.choruses.map(c=>[c.role,c.startBar,c.endBarExclusive])).toEqual([
   ['head',0,16],['solo',16,28],['solo',28,40],['head',40,52]
  ]);
  const take=prepareReleasedArrangement(jam.phrase.harmony,BACKING_STYLES[style],{
   ...params(style),tempo:240,phraseId:jam.phrase.id,sectionMap:jam.phrase.sectionMap,performanceForm:jam.phrase.performanceForm
  },'piano',4,0);
  expect(take.ensemblePlan?.bars).toHaveLength(52);
  for(const stem of [take.bassEvents,take.compEvents,take.drumEvents])expect(stem.some(e=>e.absBeat>=51*4)).toBe(true);
 });
 for (const style of ['swing', 'straight', 'bossa-nova', 'ballad'] as const) for (const keyboard of ['piano', 'organ'] as const) {
  it(`matches every listening-desk attack for ${style} ${keyboard}`, () => {
   const p = params(style), definition = createRollingBacking(phrase.harmony, BACKING_STYLES[style], p, releasedBackingOptions(keyboard, 256));
   let checkpoint: RollingBackingCheckpoint | undefined;
   const bars = Array.from({length: definition.totalBars}, () => { const b=advanceRollingBacking(definition,checkpoint);checkpoint=b.checkpoint;return b; });
   const actual = prepareReleasedArrangement(phrase.harmony, BACKING_STYLES[style], p, keyboard, 4, 256);
   expect(actual).not.toBeNull();
   expect(generateForBounce({ phrase, style, tempo: p.tempo, swing: .62, instrument: keyboard, volume: .6, mix: DEFAULT_BACKING_MIX, orchestration: 'coordinated', performanceEnergySeed: 256 })).toEqual(actual);
   expect(actual.ensembleTiming).toEqual([...new Map(bars.flatMap(b=>b.ensembleTiming.map(t=>[t.phraseStartBar,t] as const))).values()]);
   expect(actual!.bassEvents).toEqual(bars.flatMap(b => b.bassEvents));
   expect(actual!.compEvents).toEqual(bars.flatMap(b => b.compEvents));
   expect(actual!.drumEvents).toEqual(bars.flatMap(b => b.drumEvents));
  });
 }
 it('supports short and long 4/4 passages', () => {
  const p = params('swing'), style = BACKING_STYLES.swing;
  const short = prepareReleasedArrangement([{...phrase.harmony[0],duration:[1,8]}],style,{...p,performanceForm:undefined,sectionMap:undefined},'piano',4,1)!;
  expect(short.bassEvents.length).toBeGreaterThan(0);
  for(const e of [...short.bassEvents,...short.compEvents])expect(parseInt(e.time,10)/p.ppq+e.duration*p.tempo/60).toBeLessThanOrEqual(.5+1e-9);
  expect([...short.bassEvents,...short.compEvents,...short.drumEvents].every(e => e.absBeat < .5)).toBe(true);
  const long = prepareReleasedArrangement([{...phrase.harmony[0],duration:[129,1]}],style,{...p,performanceForm:undefined,sectionMap:undefined},'piano',4,1)!;
  expect(long.bassEvents.some(e => e.absBeat >= 128 * 4)).toBe(true);
 });
 it('supports fractional chord changes and positive tempos beyond lab limits', () => {
  const harmony = [
   { ...phrase.harmony[0], startOffset: [0,1] as [number,number], duration: [1,8] as [number,number] },
   { ...phrase.harmony[1], startOffset: [1,8] as [number,number], duration: [7,8] as [number,number] }
  ];
  for (const tempo of [20, 360]) {
   const result = prepareReleasedArrangement(harmony, BACKING_STYLES.swing,
    { ...params('swing'), tempo, performanceForm: undefined, sectionMap: undefined }, 'piano', 4, 1)!;
   expect(result.bassEvents.length).toBeGreaterThan(0);
   expect(result.compEvents.every(e => Number.isFinite(e.duration) && e.duration > 0)).toBe(true);
  }
 });
 it('keeps valid walking pitches when the final change arrives on the and of four', () => {
  const segment = phrase.harmony[0];
  const harmony: typeof phrase.harmony = [
   { ...segment, startOffset: [0, 1], duration: [7, 8] },
   { ...phrase.harmony[1], startOffset: [7, 8], duration: [1, 8] },
   { ...segment, startOffset: [1, 1], duration: [3, 1] }
  ];
  const p = { ...params('swing'), performanceForm: undefined, sectionMap: undefined };
  const take = prepareReleasedArrangement(harmony, BACKING_STYLES.swing, p, 'piano', 4, 1);
  expect(take.bassEvents.some(event => event.absBeat === 3)).toBe(true);
  expect(take.bassEvents.every(event => Number.isInteger(event.midi))).toBe(true);
 });

 it('ends partial final bars without a stale carried-release claim',()=>{
  for(const beats of [4.25,8.25,12.25,20.25])for(const seed of [3,7,256]){
   const p={...params('ballad'),performanceForm:undefined,sectionMap:undefined};
   const take=prepareReleasedArrangement([{...phrase.harmony[0],startOffset:[0,1],duration:[beats,4]}],BACKING_STYLES.ballad,p,'organ',4,seed);
   for(const e of take.compEvents){
    const end=parseInt(e.time,10)+e.duration*p.tempo/60*p.ppq;
    expect(end).toBeLessThanOrEqual(beats*p.ppq+1e-7);
    if(e.barLineSustain)expect(e.barLineSustain.releaseTick).toBeCloseTo(end,7);
   }
  }
 });
 it('reports malformed harmony instead of silently substituting Original', () => {
  expect(() => prepareReleasedArrangement([{ ...phrase.harmony[0], startOffset: [1,4] }],
   BACKING_STYLES.swing, params('swing'), 'piano', 4, 1)).toThrow('contiguous');
 });
 it('keeps cached performances isolated and keys them by keyboard and variation', () => {
  const p=params('swing'), style=BACKING_STYLES.swing;
  const a=prepareReleasedArrangement(phrase.harmony,style,p,'piano',4,7)!;
  expect(a).not.toBeNull();
  const clean=structuredClone(a); a.compEvents[0].notes[0]=1;
  expect(prepareReleasedArrangement(phrase.harmony,style,p,'piano',4,7)).toEqual(clean);
  expect(prepareReleasedArrangement(phrase.harmony,style,p,'organ',4,7)?.compEvents).not.toEqual(clean.compEvents);
  expect(prepareReleasedArrangement(phrase.harmony,style,p,'piano',4,256)?.compEvents).not.toEqual(clean.compEvents);
 });
 it('supports a short practice phrase without inventing a head, and reports mismatched form metadata', () => {
  const harmony = [{ ...phrase.harmony[0], startOffset: [0,1] as [number,number], duration: [2,1] as [number,number] }];
  const p = { ...params('ballad'), performanceForm: undefined, sectionMap: undefined };
  expect(BACKING_STYLES.ballad.defaultSwing).toBe(.53);
  const score = prepareReleasedArrangement(harmony, BACKING_STYLES.ballad, p, 'organ', 4, 256)!;
  expect(score.bassEvents.length).toBeGreaterThan(0);
  expect(score.compEvents.length).toBeGreaterThan(0);
  expect(score.drumEvents.length).toBeGreaterThan(0);
  expect([...score.bassEvents, ...score.compEvents, ...score.drumEvents].every(e => e.absBeat! < 8)).toBe(true);
  expect(() => prepareReleasedArrangement(harmony, BACKING_STYLES.ballad, params('ballad'), 'organ', 4, 256)).toThrow('form must match');
 });
});
