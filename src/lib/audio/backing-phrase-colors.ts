/** Scoped pitch colors; the rolling policy owns admission and existing attack envelopes. */
import type { BassEvent } from './backing-generation';

export type PhraseColor =
 | {readonly kind:'root-seventh'; readonly rootMidi:number; readonly seventh:10|11; readonly originalMidi:number}
 | {readonly kind:'upper-structure'; readonly rootPc:number; readonly addedMidi:number; readonly originalNotes:readonly number[]};

/** Beat two dips below the root; final approach notes and retained bass history are untouched. */
export function rootSeventhPulse(events:readonly BassEvent[],bar:number,rootPc:number,seventh:10|11):BassEvent[] {
 if(events.length!==4||events.some((e,i)=>e.absBeat!==bar*4+i)||events[0].midi%12!==rootPc||
  events.some(e=>e.conversation||e.phraseColor))return [...events];
 const target=events[0].midi+seventh-12;
 if(target<28||target>55||events[1].midi===target||Math.abs(events[2].midi-target)>7)return [...events];
 return events.map((event,i)=>i!==1?event:{...event,midi:target,phraseColor:Object.freeze({kind:'root-seventh' as const,
  rootMidi:events[0].midi,seventh,originalMidi:event.midi})});
}

/** Major triad a whole step above a plain dominant: 9/#11/13 over its 3/7 shell. */
export function upperStructureTriad(notes:readonly number[],rootPc:number):{notes:number[];addedMidi:number}|undefined {
 const pc=(n:number)=>(n-rootPc+120)%12;
 if(!Number.isInteger(rootPc)||rootPc<0||rootPc>11||notes.length!==4||
  notes.some((n,i)=>!Number.isInteger(n)||n<48||n>84||i>0&&n<=notes[i-1]||![0,2,4,7,9,10].includes(pc(n)))||
  ![4,10].every(p=>notes.some(n=>pc(n)===p)))return;
 // Prefer the existing top. Otherwise permit a bounded lift, never beyond a
 // perfect fifth: the actual higher voice must become subsequent phrase memory.
 for(let top=notes.at(-1)!;top<=Math.min(84,notes.at(-1)!+7);top++){
  if(![2,9].includes(pc(top)))continue;
  const triad=Array.from({length:12},(_,i)=>top-i).filter(n=>[2,6,9].includes(pc(n))).sort((a,b)=>a-b);
  const shell=[4,10].map(p=>Array.from({length:Math.max(0,triad[0]-48)},(_,i)=>triad[0]-1-i).find(n=>pc(n)===p));
  if(shell.some(n=>n===undefined))continue;
  const result=[...shell as number[],...triad].sort((a,b)=>a-b);
  if(result.at(-1)!-result[0]>24||result.some((n,i)=>i>0&&n-result[i-1]<2)||
   [4,10].some(p=>Math.abs(notes.find(n=>pc(n)===p)!-result.find(n=>pc(n)===p)!)>12))continue;
  return {notes:result,addedMidi:triad.find(n=>pc(n)===6)!};
 }
}

/** Avoid a close fourth/fifth bass clash. Widely separated Lydian-dominant color is intentional. */
export function upperStructureFitsBass(event:{time:string;duration:number},bass:readonly BassEvent[]|undefined,rootPc:number,tempo:number,ppq:number,addedMidi:number):boolean {
 if(!bass)return false;
 const onset=parseInt(event.time),release=onset+event.duration*tempo/60*ppq;
 return !bass.some(b=>[5,7].includes((b.midi-rootPc+120)%12)&&Math.abs(addedMidi-b.midi)<=13&&parseInt(b.time)<release&&parseInt(b.time)+b.duration*tempo/60*ppq>onset);
}
