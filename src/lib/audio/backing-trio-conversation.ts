/** Small accepted gestures shared by the current bar's players, never future performances. */
import type { BackingStyle } from '$lib/types/instruments';
import type { BarInfo, BassEvent } from './backing-generation';
import type { DrumHitSpec } from './backing-styles';

export type TrioConversation =
 | { readonly kind:'repeated-bass'; readonly sourceAbsBeat:number; readonly sourceMidi:number; readonly originalMidi:number }
 | { readonly kind:'bass-catch'; readonly sourceAbsBeat:number; readonly repeatAbsBeat:number; readonly sourceMidi:number; readonly originalVelocity:number }
 | { readonly kind:'dominant-b9'; readonly fromMidi:number; readonly toMidi:number; readonly rootPc:number; readonly targetRootPc:number };

export function allowsTrioConversation(info: BarInfo): boolean {
 const plan=info.ensemble;
 return !!plan && ['solo_build','solo_peak'].includes(plan.performanceEnergy?.phase??'') &&
  !info.isSectionFirstBar && !info.isSectionFinalBar && !info.isChorusFirstBar && !info.isChorusFinalBar && !info.isFinalBar &&
  !plan.terminalArrangement && !plan.coordinatedAccent && !plan.setupFor && !plan.drums.allowFill && plan.responseOwner==='nobody' &&
  !['leave_space','release'].includes(plan.intent) && !['leave_space','release'].includes(plan.phraseIntent) &&
  !['active_soloist','dense_soloist','under_response'].includes(plan.piano.rootlessTexture?.reason??'');
}

/** Cadential color adds no density, so a section-ending drum fill may coexist.
 * Shared arrivals, responses, heads, release phases and final endings still win. */
export function allowsDominantColor(info: BarInfo): boolean {
 const plan=info.ensemble;
 return !!plan && ['solo_build','solo_peak'].includes(plan.performanceEnergy?.phase??'') &&
  !info.isChorusFirstBar && !info.isChorusFinalBar && !info.isFinalBar &&
  !plan.terminalArrangement && !plan.coordinatedAccent && (!plan.setupFor || !plan.setupFor.participants.includes('piano')) && plan.responseOwner==='nobody' &&
  !['leave_space','release'].includes(plan.intent) && !['leave_space','release'].includes(plan.phraseIntent) &&
  !['active_soloist','dense_soloist','under_response'].includes(plan.piano.rootlessTexture?.reason??'');
}

/** Repeat beat one on beat two; the final two notes and subsequent pitch memory stay intact. */
export function repeatBassPulse(events: readonly BassEvent[], bar:number, style:BackingStyle): BassEvent[] {
 if(!['swing','straight'].includes(style) || events.length!==4 || events.some((e,i)=>e.absBeat!==bar*4+i) ||
  events[0].midi===events[1].midi || Math.abs(events[2].midi-events[0].midi)>5) return [...events];
 return events.map((event,i)=>i!==1?event:{...event,midi:events[0].midi,conversation:Object.freeze({kind:'repeated-bass' as const,
  sourceAbsBeat:events[0].absBeat,sourceMidi:events[0].midi,originalMidi:event.midi})});
}

/** A supported 3/7 shell plus an INNER ninth: no new attack, lost guide tone or moving top voice. */
export function colorDominantNinth(notes:readonly number[],rootPc:number): {notes:number[];fromMidi:number;toMidi:number}|undefined {
 const pc=(n:number)=>(n-rootPc+120)%12;
 if(!Number.isInteger(rootPc)||rootPc<0||rootPc>11||notes.length<3||notes.length>4 ||
  notes.some((n,i)=>!Number.isInteger(n)||n<48||n>84||i>0&&n<=notes[i-1]) ||
  !notes.some(n=>pc(n)===4)||!notes.some(n=>pc(n)===10))return;
 const indexes=notes.map((n,i)=>pc(n)===2?i:-1).filter(i=>i>=0);
 if(indexes.length!==1)return;
 const index=indexes[0],fromMidi=notes[index],toMidi=fromMidi-1;
 if(index===notes.length-1||toMidi<48||index>0&&toMidi-notes[index-1]<2||notes.some(n=>pc(n)===1))return;
 return {notes:notes.map((n,i)=>i===index?toMidi:n),fromMidi,toMidi};
}

/** Answer the bass on the existing beat-three feather; leave a simultaneous keyboard attack clear. */
export function catchBassRepeat(hits:readonly DrumHitSpec[],bass:readonly BassEvent[],bar:number,compOffsets:readonly number[]): DrumHitSpec[] {
 const repeated=bass.find(e=>e.conversation?.kind==='repeated-bass');
 const receipt=repeated?.conversation;
 if(!repeated||receipt?.kind!=='repeated-bass'||repeated.absBeat!==bar*4+1||repeated.midi!==receipt.sourceMidi||
  !bass.some(e=>e.absBeat===bar*4&&e.absBeat===receipt.sourceAbsBeat&&e.midi===receipt.sourceMidi)||
  compOffsets.some(offset=>Math.abs(offset-2)<.25))return [...hits];
 return hits.map(hit=>hit.drum!=='kick'||hit.role!=='timekeeping'||hit.beatOffset!==2||hit.velocity<=0||hit.velocity>.24?hit:
  {...hit,velocity:hit.velocity*1.7,conversation:Object.freeze({kind:'bass-catch' as const,sourceAbsBeat:receipt.sourceAbsBeat,
   repeatAbsBeat:repeated.absBeat,sourceMidi:receipt.sourceMidi,originalVelocity:hit.velocity})});
}

/** Root/b9 is intentional; a sounding natural ninth or doubled altered bass is not. */
export function dominantColorFitsBass(event:{time:string;duration:number},bass:readonly BassEvent[]|undefined,rootPc:number,tempo:number,ppq:number):boolean {
 if(!bass)return false;
 const onset=parseInt(event.time),release=onset+event.duration*tempo/60*ppq;
 return !bass.some(b=>[1,2].includes((b.midi-rootPc+120)%12)&&parseInt(b.time)<release&&parseInt(b.time)+b.duration*tempo/60*ppq>onset);
}
