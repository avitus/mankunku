/** Bounded expression of already accepted gestures; never invents an onset or pitch. */
import type { BackingStyle } from '$lib/types/instruments';
import type { BarInfo, BassEvent, CompEvent } from './backing-generation';
import type { DrumHitSpec } from './backing-styles';
import { createRng, seedFrom } from './generation-rng';

export interface PhraseExpression {
 readonly kind: 'walking-backbeats' | 'short-held' | 'ghost-answer';
 readonly originalVelocity: number;
 readonly originalDuration?: number;
 readonly part: 'statement' | 'answer';
}

/** Causal plan admission, independently seeded for each player. */
export function selectsPhraseExpression(info: BarInfo & { readonly pianoPresenceSeed?: number }, phraseId: string, player: 'bass'|'piano'|'drums'): boolean {
 const plan=info.ensemble;
 const selected=()=>createRng(seedFrom(phraseId,info.pianoPresenceSeed??0,plan!.phraseStartBar,player,'phrase-expression')).chance(player==='bass'?.7:.8);
 // A setup's landing stays strong: only an existing interior snare stroke can
 // be ghosted. This shapes the drummer's own fill without reserving new space.
 if(player==='drums' && plan?.drums.allowFill && !plan.terminalArrangement && !plan.coordinatedAccent &&
  ['nobody','drums'].includes(plan.responseOwner) && ['solo_build','solo_peak'].includes(plan.performanceEnergy?.phase??'') &&
  !['active_soloist','dense_soloist'].includes(plan.piano.rootlessTexture?.reason??'')) return selected();
 if (!plan?.performanceEnergy || !['solo_build','solo_peak'].includes(plan.performanceEnergy.phase) ||
  info.isSectionFirstBar || info.isSectionFinalBar || info.isChorusFirstBar || info.isChorusFinalBar || info.isFinalBar ||
  plan.terminalArrangement || plan.coordinatedAccent || plan.setupFor || plan.drums.allowFill || (plan.responseOwner!=='nobody' && !(player==='drums' && plan.responseOwner==='drums')) ||
  ['leave_space','release'].includes(plan.intent) || ['leave_space','release'].includes(plan.phraseIntent) ||
  ['active_soloist','dense_soloist','under_response'].includes(plan.piano.rootlessTexture?.reason??'')) return false;
 return selected();
}

export function shapeBassPulse(events: readonly BassEvent[], bar: number, style: BackingStyle): BassEvent[] {
 if (!['swing','straight'].includes(style) || events.length!==4 || events.some((e,i)=>e.absBeat!==bar*4+i || e.velocity<=0 || e.velocity>115)) return [...events];
 return events.map((e,i)=>({...e,velocity:e.velocity*(i%2?1.1:.9),expression:Object.freeze({kind:'walking-backbeats' as const,originalVelocity:e.velocity,part:i%2?'answer' as const:'statement' as const})}));
}

export function contrastKeyboardPair(events: readonly CompEvent[], context: {
 style: BackingStyle; instrument:'piano'|'organ'; tempo:number; ppq:number; endTicks:readonly number[];
}): CompEvent[] {
 const unchanged=()=>[...events];
 if(events.length!==2 || context.endTicks.length!==2) return unchanged();
 const [a,b]=events, secondsPerBeat=60/context.tempo;
 const gap=(parseInt(b.time)-parseInt(a.time))/context.ppq;
 if(gap<1 || gap>3 || a.duration<=0 || b.duration<=0) return unchanged();
 const organ=context.instrument==='organ';
 const short=context.style==='ballad'?(organ?1:.8):context.style==='bossa-nova'?(organ?.4:.28):(organ?.48:.35);
 const held=context.style==='ballad'?(organ?1.8:1.6):context.style==='bossa-nova'?(organ?1:.8):(organ?1.5:1.2);
 const durations=[Math.min(a.duration,short*secondsPerBeat),Math.max(b.duration,held*secondsPerBeat)];
 for(let i=0;i<2;i++) durations[i]=Math.min(durations[i],(Math.min(context.endTicks[i],i===0?parseInt(b.time):Infinity)-parseInt(events[i].time))*secondsPerBeat/context.ppq);
 // Never buy contrast by losing total harmonic support or by squeezing a held
 // chord into an imminent harmony change. The complete pair is admitted or kept.
 if(durations.some(d=>d<=0) || durations[1]<held*secondsPerBeat-1e-8 || durations[1]<2*durations[0] ||
  durations[0]+durations[1]+1e-8<a.duration+b.duration || durations.every((d,i)=>Math.abs(d-events[i].duration)<1e-8)) return unchanged();
 return events.map((e,i)=>({...e,duration:durations[i],expression:Object.freeze({kind:'short-held' as const,originalVelocity:e.velocity,originalDuration:e.duration,part:i?'answer' as const:'statement' as const})}));
}

export function ghostSnareAnswer(hits: readonly Readonly<DrumHitSpec>[]): DrumHitSpec[] {
 if(hits.length===3 && hits.every(h=>h.role==='commentary' && h.velocity>0 && h.velocity<=.6) &&
  hits[0].drum==='snare' && hits[1].drum==='snare' && ['snare','kick'].includes(hits[2].drum) &&
  hits[1].beatOffset-hits[0].beatOffset>=1/6 && hits[2].beatOffset-hits[1].beatOffset>=1/6) {
  return hits.map((h,i)=>i!==1?{...h}:{...h,velocity:h.velocity*.5,expression:Object.freeze({kind:'ghost-answer' as const,originalVelocity:h.velocity,part:'answer' as const})});
 }
 if(hits.length!==2 || hits.some(h=>h.drum!=='snare' || h.role!=='commentary' || h.velocity<=0 || h.velocity>.6) ||
  hits[1].beatOffset-hits[0].beatOffset<.5) return hits.map(h=>({...h}));
 return hits.map((h,i)=>({...h,velocity:h.velocity*(i?.5:1.08),expression:Object.freeze({kind:'ghost-answer' as const,originalVelocity:h.velocity,part:i?'answer' as const:'statement' as const})}));
}
