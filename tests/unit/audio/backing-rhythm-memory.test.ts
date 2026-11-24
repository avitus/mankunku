import type { BassEvent, CompEvent, DrumEvent } from '$lib/audio/backing-generation';
import { it, expect } from 'vitest';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';

it('develops actually played two-attack cells on all three instruments across a full solo form (S3, S38, S39)', () => {
 const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
 const style = BACKING_STYLES.swing;
 const params = { phraseId: phrase.id, tempo: 144, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing,
  performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
 const opts = releasedBackingOptions('piano', 14);
 const score = createRollingBacking(phrase.harmony, style, params, opts);
 const baseline = createRollingBacking(phrase.harmony, style, params, { ...opts, rhythmMemory: undefined });
 const history: { bass: readonly BassEvent[]; piano: readonly CompEvent[]; drums: readonly DrumEvent[] }[] = [];
 const usedSources = new Set<string>();
 let cp: RollingBackingCheckpoint | undefined, prior: RollingBackingCheckpoint | undefined;
 const speakers = new Set<string>();
 for (let bar=0; bar<score.totalBars; bar++) {
  const r = advanceRollingBacking(score, cp);
  const old = advanceRollingBacking(baseline, prior);
  prior = old.checkpoint;
  const parts = { bass:r.bassEvents, piano:r.compEvents, drums:r.drumEvents };
  const oldParts = { bass:old.bassEvents, piano:old.compEvents, drums:old.drumEvents };
  const replies = Object.entries(parts).filter(([,events])=>events.some(e=>e.rhythmAnswer));
  expect(replies.length).toBeLessThanOrEqual(1);
  for (const name of ['bass','piano','drums'] as const) {
   const events=parts[name];
   expect(events.map(e=>[e.absBeat,e.time])).toEqual(oldParts[name].map(e=>[e.absBeat,e.time]));
   const marked=events.filter(e=>e.rhythmAnswer).sort((a,b)=>a.absBeat-b.absBeat);
   if (!marked.length) continue;
   expect(marked).toHaveLength(2);
   expect(marked.every(e=>oldParts[name].find(old=>old.time===e.time && (!('drum' in e) || 'drum' in old && old.drum===e.drum))?.velocity!==e.velocity)).toBe(true);
   const source=marked[0].rhythmAnswer!;
   expect(source.player).not.toBe(name);
   const sourceId = source.player + ':' + source.bar;
   expect(usedSources.has(sourceId)).toBe(false);
   usedSources.add(sourceId);
   expect(marked[source.stressed].velocity).toBeGreaterThan(marked[1-source.stressed].velocity);
   expect(bar-source.bar).toBeGreaterThanOrEqual(4);
   expect(bar-source.bar).toBeLessThanOrEqual(16);
   expect(marked[1].absBeat-marked[0].absBeat).toBe(source.offsets[1]-source.offsets[0]);
   for(const offset of source.offsets) expect(history[source.bar][source.player].some(e=>e.absBeat===source.bar*4+offset)).toBe(true);
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(cp)))).toEqual(r);
   const busy=advanceRollingBacking(score, cp,[{source:'scripted',barIndex:bar,observedAtBar:bar,confidence:1,noteDensity:1,restBeats:0}]);
   expect([...busy.bassEvents,...busy.compEvents,...busy.drumEvents].some(e=>e.rhythmAnswer)).toBe(false);
   speakers.add(name);
  }
  history.push(parts); cp=r.checkpoint;
 }
 expect([...speakers].sort()).toEqual(['bass','drums','piano']);
});

it.each(['swing','straight','bossa-nova','ballad'] as const)('keeps %s pitches, gates and drum voices during rhythmic development (S3, S39)', name => {
 const {phrase} = buildListeningTuneSession({ tuneId:MANKUNKU_BLUES.id, soloChoruses:2 });
 const style=BACKING_STYLES[name];
 const params={phraseId:phrase.id,tempo:144,ppq:192,beatsPerBar:4,swing:style.defaultSwing,
  performanceForm:phrase.performanceForm,sectionMap:phrase.sectionMap,ensemble:{}};
 const options=releasedBackingOptions('organ',14);
 const score=createRollingBacking(phrase.harmony,style,params,options);
 const baseline=createRollingBacking(phrase.harmony,style,params,{...options,rhythmMemory:undefined});
 let cp:RollingBackingCheckpoint|undefined, old:RollingBackingCheckpoint|undefined;
 for(let bar=0;bar<score.totalBars;bar++) {
  const result=advanceRollingBacking(score,cp), original=advanceRollingBacking(baseline,old);
  const strip = ({velocity: _velocity,rhythmAnswer:_answer,...note}:BassEvent|CompEvent|DrumEvent) => note;
  for(const lane of ['bassEvents','compEvents','drumEvents'] as const) {
   expect(result[lane].map(strip)).toEqual(original[lane].map(strip));
   if(score.bars[bar].role !== 'solo') expect(result[lane]).toEqual(original[lane]);
  }
  cp=JSON.parse(JSON.stringify(result.checkpoint));
  old=original.checkpoint;
 }
});
