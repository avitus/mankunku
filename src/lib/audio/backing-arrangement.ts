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

/** Null means unsupported score shape: callers retain the original arrangement. Errors are not swallowed. */
export function prepareReleasedArrangement(harmony: HarmonicSegment[], style: StyleDefinition,
 params: BackingGenerationParams, instrument: BackingInstrument, denominator: number, seed: number): GeneratedBacking | null {
 if (denominator !== 4 || params.beatsPerBar !== 4 || !style.coordinatedStyle ||
  !Number.isFinite(params.tempo) || params.tempo < 30 || params.tempo > 320) return null;
 let end = 0;
 for (const segment of harmony) {
  const start = fractionToFloat(segment.startOffset) * 4, length = fractionToFloat(segment.duration) * 4;
  if (start !== end || !Number.isInteger(length) || length <= 0) return null;
  end += length;
 }
 const bars = end / 4;
 if (!Number.isInteger(bars) || bars < 1 || bars > 128 ||
  params.performanceForm && params.performanceForm.totalBars !== bars) return null;
 const key = JSON.stringify([harmony, style.coordinatedStyle, style.defaultSwing, params, instrument, seed]);
 const hit = cache.get(key);
 if (hit !== undefined) { cache.delete(key); cache.set(key, hit); return JSON.parse(hit); }
 // Short practice phrases have no authored head/solo arrangement. Give them a
 // literal solo span so the same steady-support and articulation policies apply.
 const performanceForm = params.performanceForm ?? buildPerformanceForm({ totalBars: bars,
  sectionMap: params.sectionMap ?? [], choruses: [{ role: 'solo', startBar: 0, endBarExclusive: bars }] });
 const score = createRollingBacking(harmony, style, { ...params, performanceForm, ensemble: {} }, releasedBackingOptions(instrument, seed));
 const generated: GeneratedBacking = { bassEvents: [], compEvents: [], drumEvents: [] };
 let checkpoint: RollingBackingCheckpoint | undefined;
 for (let bar = 0; bar < score.totalBars; bar++) {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint;
  generated.bassEvents.push(...result.bassEvents);
  generated.compEvents.push(...result.compEvents);
  generated.drumEvents.push(...result.drumEvents);
 }
 // These are prepared events, not claims of live commitment or observed audio.
 // Existing Parts retain count-in, looping, handoff and recording ownership.
 const serialized = JSON.stringify(generated);
 cache.set(key, serialized);
 if (cache.size > 8) cache.delete(cache.keys().next().value!);
 return JSON.parse(serialized);
}
