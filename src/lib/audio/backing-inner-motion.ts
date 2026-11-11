import type { BassEvent, CompEvent } from './backing-generation';
import type { DrumHitSpec } from './backing-styles';

export type InnerMotion =
 | { readonly kind: 'ninth-pulse'; readonly rootMidi: number; readonly originalMidi: number }
 | { readonly kind: 'chromatic-inner'; readonly phase: 'approach' | 'resolution'; readonly fromMidi: number; readonly toMidi: number; readonly approachBeat: number; readonly resolutionBeat: number; readonly rootPc: number }
 | { readonly kind: 'hat-lift'; readonly originalVelocity: number };

/** Keep the root, second pulse and final approach; color only the third pulse. */
export function ninthPulse(events: readonly BassEvent[], bar: number, rootPc: number): BassEvent[] {
 if(events.length!==4 || events.some((e,i)=>e.absBeat!==bar*4+i || i>=2 && (e.conversation || e.phraseDialogue) || e.phraseColor || e.ensembleColor || e.innerMotion) || events[0].midi%12!==rootPc)return [...events];
 const targets=Array.from({length:28},(_,i)=>28+i).filter(n=>n%12===(rootPc+2)%12 && n!==events[2].midi && n!==events[1].midi && n!==events[3].midi && Math.abs(n-events[1].midi)<=5 && Math.abs(n-events[3].midi)<=5);
 const target=targets.sort((a,b)=>Math.abs(a-events[2].midi)-Math.abs(b-events[2].midi))[0];
 if(target===undefined)return [...events];
 return events.map((e,i)=>i!==2?e:{...e,midi:target,innerMotion:Object.freeze({kind:'ninth-pulse' as const,rootMidi:events[0].midi,originalMidi:e.midi})});
}

/** A chromatic lower neighbor resolves to an inner fifth or ninth; shell/top stay. */
export function chromaticInnerPair(events: readonly CompEvent[], rootPc: number, bass: readonly BassEvent[] | undefined, tempo: number, ppq: number): CompEvent[] {
 if(!bass || events.length!==2 || events.some(e=>e.conversation || e.phraseColor || e.ensembleColor || e.phraseDialogue || e.innerMotion || e.notes.length<3 || e.notes.length>4))return [...events];
 const [first,second]=events, gap=second.absBeat-first.absBeat;
 if(gap<.5 || gap>3 || parseInt(first.time)+first.duration*tempo/60*ppq>parseInt(second.time)+1e-8)return [...events];
 const pc=(n:number)=>(n-rootPc+120)%12;
 if(!events.every(e=>[4,10].every(p=>e.notes.some(n=>pc(n)===p))))return [...events];
 const index=first.notes.findIndex((n,i)=>i>0 && i<first.notes.length-1 && [2,7].includes(pc(n)) && second.notes.slice(1,-1).includes(n));
 if(index<0)return [...events];
 const toMidi=first.notes[index],fromMidi=toMidi-1;
 if(fromMidi-first.notes[index-1]<2)return [...events];
 const start=parseInt(first.time),end=start+first.duration*tempo/60*ppq;
 if(bass.some(b=>(pc(toMidi)===2 ? pc(b.midi)===2 : [5,7].includes(pc(b.midi))) && Math.abs(fromMidi-b.midi)<=13 && parseInt(b.time)<end && parseInt(b.time)+b.duration*tempo/60*ppq>start))return [...events];
 return events.map((e,i)=>({...e,notes:i===0?e.notes.map((n,j)=>j===index?fromMidi:n):[...e.notes],innerMotion:Object.freeze({kind:'chromatic-inner' as const,phase:i===0?'approach' as const:'resolution' as const,fromMidi,toMidi,rootPc,approachBeat:first.absBeat,resolutionBeat:second.absBeat})}));
}

/** An occasional stronger left-foot chick; no added onset or borrowed stick. */
export function liftFootHat(hits: readonly DrumHitSpec[], comp: readonly CompEvent[], bar: number, ppq: number, hatTick = (bar*4+3)*ppq): DrumHitSpec[] {
 if(hits.some(h=>h.expression || h.conversation || h.ensembleColor || h.phraseDialogue || h.role!=='timekeeping' && h.beatOffset>=2.5) || comp.some(e=>Math.abs(e.absBeat-(bar*4+3))<.5 || Math.abs(parseInt(e.time)-hatTick)<.4*ppq))return [...hits];
 return hits.map(h=>h.drum==='hihat-pedal' && h.role==='timekeeping' && h.beatOffset===3 && h.velocity>0 && h.velocity<=.55 && !h.innerMotion
  ? {...h,velocity:h.velocity*1.5,innerMotion:Object.freeze({kind:'hat-lift' as const,originalVelocity:h.velocity})}:h);
}
