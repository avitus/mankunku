import { prepareBasicMeterArrangement } from './backing-meter';
/** Prepare the released accompaniment for an existing transport, without owning its clock. */
import type { HarmonicSegment } from '$lib/types/music';
import type { BackingInstrument } from '$lib/types/instruments';
import type { StyleDefinition } from './backing-styles';
import type { BackingGenerationParams, GeneratedBacking } from './backing-generation';
import { fractionToFloat } from '$lib/music/intervals';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from './backing-rolling';
import { buildPerformanceForm } from './performance-form';
import { releasedBackingOptions } from './backing-release';

const cache = new Map<string, string>();

/** Prepare Musicality for every backing caller. Unsupported meters fail explicitly. */
export function prepareReleasedArrangement(harmony: HarmonicSegment[], style: StyleDefinition,
 params: BackingGenerationParams, instrument: BackingInstrument, denominator: number, seed: number): GeneratedBacking {
 let end = 0;
 for (const segment of harmony) {
  const start = fractionToFloat(segment.startOffset) * 4, length = fractionToFloat(segment.duration) * 4;
  if (!Number.isFinite(start) || Math.abs(start - end) > 1e-8 || !Number.isFinite(length) || length <= 0) {
   throw new Error('Backing harmony must be positive and contiguous');
  }
  end = start + length;
 }
 if (end <= 0) throw new Error('Backing harmony must not be empty');
 if (denominator !== 4 || params.beatsPerBar !== 4) return prepareBasicMeterArrangement(harmony, style, params, instrument, denominator, seed);
 const bars = Math.ceil(end / 4);
 // Plan a complete final bar, then discard its extra attacks. The transport
 // continues to own the original passage length and loop boundary.
 const preparedHarmony = [...harmony];
 const last = preparedHarmony[preparedHarmony.length - 1];
 if (end < bars * 4) preparedHarmony[preparedHarmony.length - 1] = { ...last,
  duration: [bars * 4 - fractionToFloat(last.startOffset) * 4, 4] };
 const key = JSON.stringify([harmony, style.coordinatedStyle, style.defaultSwing, params, instrument, seed]);
 const hit = cache.get(key);
 if (hit !== undefined) { cache.delete(key); cache.set(key, hit); return JSON.parse(hit); }
 // Short practice phrases have no authored head/solo arrangement. Give them a
 // literal solo span so the same steady-support and articulation policies apply.
 const performanceForm = params.performanceForm ?? buildPerformanceForm({ totalBars: bars,
  sectionMap: params.sectionMap ?? [], choruses: [{ role: 'solo', startBar: 0, endBarExclusive: bars }] });
 // A synthesized practice solo is useful for support, but it does not identify a tune’s solo chorus.
 const score = createRollingBacking(preparedHarmony, style, { ...params, performanceForm, ensemble: {} }, { ...releasedBackingOptions(instrument, seed), ...(!params.performanceForm ? { quarterPedal: undefined, dottedQuarterComp: undefined, rhythmMemory: undefined, dominantRiff: undefined, brokenTwo: undefined, balladThird: undefined } : {}), preparedPlayback: true });
 const generated: GeneratedBacking = { bassEvents: [], compEvents: [], drumEvents: [] };
 let checkpoint: RollingBackingCheckpoint | undefined;
 const planBars: NonNullable<GeneratedBacking['ensemblePlan']>['bars'][number][] = [];
 const planTrace: NonNullable<GeneratedBacking['ensemblePlan']>['trace'][number][] = [];
 generated.ensemblePlan = { version: 1, bars: planBars, trace: planTrace };
 generated.ensembleDevelopment = { version: 1, pianoMotifs: [], bassTurnarounds: [], drumPhrases: [] };
 const timing = new Map<number, NonNullable<GeneratedBacking['ensembleTiming']>[number]>();
 for (let bar = 0; bar < score.totalBars; bar++) {
  const result = advanceRollingBacking(score, checkpoint, params.ensemble?.soloFeatures); checkpoint = result.checkpoint;
  generated.bassEvents.push(...result.bassEvents.filter(event => event.absBeat < end));
  generated.compEvents.push(...result.compEvents.filter(event => event.absBeat < end));
  generated.drumEvents.push(...result.drumEvents.filter(event => event.absBeat < end));
  planBars.push(...result.ensemblePlan.bars);
  planTrace.push(...result.ensemblePlan.trace);
  generated.ensembleMemory = result.checkpoint.ensemble;
  for (const trace of result.ensembleTiming) if (!timing.has(trace.phraseStartBar)) timing.set(trace.phraseStartBar, trace);
  for (const [key, value] of Object.entries(result.ensembleDevelopment)) {
   if (!Array.isArray(value)) continue;
   const target = generated.ensembleDevelopment as unknown as Record<string, unknown[]>;
   (target[key] ??= []).push(...value);
  }

 }
 generated.ensembleTiming = [...timing.values()];
 // A padded final bar must not sustain beyond the caller's real passage.
 const endTick=end*params.ppq;
 generated.bassEvents=generated.bassEvents.filter(e=>parseInt(e.time,10)<endTick).map(e=>({...e,duration:Math.min(e.duration,(endTick-parseInt(e.time,10))*60/params.tempo/params.ppq)}));
 generated.compEvents=generated.compEvents.filter(e=>parseInt(e.time,10)<endTick).map(e=>{
  const duration=Math.min(e.duration,(endTick-parseInt(e.time,10))*60/params.tempo/params.ppq);
  // A clipped partial-bar carry no longer proves the originally declared release.
  return {...e,duration,...(duration < e.duration && e.barLineSustain ? {barLineSustain:undefined} : {})};
 });
 generated.drumEvents=generated.drumEvents.filter(e=>parseInt(e.time,10)<endTick);
 // These are prepared events, not claims of live commitment or observed audio.
 // Existing Parts retain count-in, looping, handoff and recording ownership.
 const serialized = JSON.stringify(generated);
 cache.set(key, serialized);
 if (cache.size > 8) cache.delete(cache.keys().next().value!);
 return JSON.parse(serialized);
}
