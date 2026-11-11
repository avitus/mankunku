/** Accepted pitch and timbre gestures. The rolling caller owns musical admission. */
import type {BassEvent,CompEvent} from './backing-generation';
import type {DrumHitSpec} from './backing-styles';

export type EnsembleColor =
 | {readonly kind:'arpeggio';readonly rootMidi:number;readonly third:3|4;readonly originalNotes:readonly number[]}
 | {readonly kind:'drop3';readonly fromMidi:number;readonly toMidi:number;readonly originalNotes:readonly number[]}
 | {readonly kind:'cross-stick';readonly sourceAbsBeat:number;readonly sourceTime:string;readonly sourceDuration:number;readonly sourceEndTick:number;readonly sourceNotes:readonly number[];readonly originalVelocity:number};

/** One complete ascending chord outline; keep the written final approach. */
export function arpeggiateWalk(events:readonly BassEvent[],bar:number,rootPc:number,third:3|4):BassEvent[] {
 if(events.length!==4 || events.some((e,i)=>e.absBeat!==bar*4+i || e.conversation || e.phraseColor || e.ensembleColor) ||
  events[0].midi%12!==rootPc)return [...events];
 const root=events[0].midi,notes=[root,root+third,root+7,events[3].midi];
 if(notes.some(n=>n<28||n>55)||Math.abs(notes[3]-notes[2])>7||notes.every((n,i)=>n===events[i].midi))return [...events];
 const receipt=Object.freeze({kind:'arpeggio' as const,rootMidi:root,third,originalNotes:Object.freeze(events.map(e=>e.midi))});
 return events.map((event,i)=>i===3?event:{...event,midi:notes[i],ensembleColor:receipt});
}

/** Four voices: lower the third voice counted from the top by one octave. */
export function dropThirdVoice(notes:readonly number[]):{notes:number[];fromMidi:number;toMidi:number}|undefined {
 if(notes.length!==4||notes.some((n,i)=>!Number.isInteger(n)||n<48||n>84||i>0&&n<=notes[i-1]))return;
 const fromMidi=notes[1],toMidi=fromMidi-12;
 if(toMidi<45||toMidi>=notes[0]||notes.at(-1)!-toMidi>28)return;
 return {notes:[toMidi,notes[0],notes[2],notes[3]],fromMidi,toMidi};
}

/** Reserve room above actually sounding bass notes, including non-root bass. */
export function spreadFitsBass(event:Pick<CompEvent,'time'|'duration'>,lowest:number,bass:readonly BassEvent[]|undefined,tempo:number,ppq:number):boolean {
 if(!bass)return false;
 const start=parseInt(event.time),end=start+event.duration*tempo/60*ppq;
 return !bass.some(b=>parseInt(b.time)<end&&parseInt(b.time)+b.duration*tempo/60*ppq>start&&lowest-b.midi<7);
}

/** Answer a held keyboard texture on an existing later commentary onset. */
export function crossStickUnderChord(hits:readonly DrumHitSpec[],comp:readonly CompEvent[],bar:number,tempo:number,ppq:number,scheduledTick:(absBeat:number)=>number=(beat)=>beat*ppq):DrumHitSpec[] {
 let changed=false;
 return hits.map(hit=>{
  if(changed||hit.drum!=='snare'||hit.role!=='commentary'||hit.expression||hit.conversation||hit.ensembleColor)return hit;
  const beat=bar*4+hit.beatOffset,tick=scheduledTick(beat);
  const source=comp.find(e=>e.notes.length>=3&&e.notes.at(-1)!-e.notes[0]>=12&&beat-e.absBeat>=.5&&
   e.absBeat>=bar*4&&parseInt(e.time)<tick&&parseInt(e.time)+e.duration*tempo/60*ppq>tick+.1*ppq);
  if(!source)return hit;
  changed=true;
  return {...hit,drum:'crossstick',velocity:hit.velocity*.85,ensembleColor:Object.freeze({kind:'cross-stick' as const,
   sourceAbsBeat:source.absBeat,sourceTime:source.time,sourceDuration:source.duration,sourceEndTick:parseInt(source.time)+source.duration*tempo/60*ppq,sourceNotes:Object.freeze([...source.notes]),originalVelocity:hit.velocity})};
 });
}
