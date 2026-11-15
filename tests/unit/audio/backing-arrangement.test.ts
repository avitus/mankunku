import { describe, it, expect } from 'vitest';
import { prepareReleasedArrangement } from '$lib/audio/backing-arrangement';
import { generateForBounce } from '$lib/audio/backing-bounce';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';

const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
function params(style: keyof typeof BACKING_STYLES) {
 const tempo = style === 'ballad' ? 80 : 140;
 return { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4,
  swing: resolveBackingSwing(.62, BACKING_STYLES[style], tempo), sectionMap: phrase.sectionMap,
  performanceForm: phrase.performanceForm, ensemble: {} };
}
describe('normal playback uses the released musical vocabulary', () => {
 for (const style of ['swing', 'straight', 'bossa-nova', 'ballad'] as const) for (const keyboard of ['piano', 'organ'] as const) {
  it(`matches every listening-desk attack for ${style} ${keyboard}`, () => {
   const p = params(style), definition = createRollingBacking(phrase.harmony, BACKING_STYLES[style], p, releasedBackingOptions(keyboard, 256));
   let checkpoint: RollingBackingCheckpoint | undefined;
   const bars = Array.from({length: definition.totalBars}, () => { const b=advanceRollingBacking(definition,checkpoint);checkpoint=b.checkpoint;return b; });
   const actual = prepareReleasedArrangement(phrase.harmony, BACKING_STYLES[style], p, keyboard, 4, 256);
   expect(actual).not.toBeNull();
   expect(generateForBounce({ phrase, style, tempo: p.tempo, swing: .62, instrument: keyboard, volume: .6, mix: DEFAULT_BACKING_MIX, orchestration: 'coordinated', performanceEnergySeed: 256 })).toEqual(actual);
   expect(actual!.bassEvents).toEqual(bars.flatMap(b => b.bassEvents));
   expect(actual!.compEvents).toEqual(bars.flatMap(b => b.compEvents));
   expect(actual!.drumEvents).toEqual(bars.flatMap(b => b.drumEvents));
  });
 }
 it('rejects unsupported meters and supports short and long 4/4 passages', () => {
  const p = params('swing'), style = BACKING_STYLES.swing;
  expect(() => prepareReleasedArrangement(phrase.harmony,style,{...p,beatsPerBar:3},'piano',4,1)).toThrow('4/4');
  expect(() => prepareReleasedArrangement(phrase.harmony,style,p,'piano',8,1)).toThrow('4/4');
  const short = prepareReleasedArrangement([{...phrase.harmony[0],duration:[1,8]}],style,{...p,performanceForm:undefined,sectionMap:undefined},'piano',4,1)!;
  expect(short.bassEvents.length).toBeGreaterThan(0);
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
