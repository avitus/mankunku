/** Small accepted gestures; the rolling caller reserves structural/dense passages. */
import type {BassEvent} from './backing-generation';
import type {DrumHitSpec} from './backing-styles';
export interface BassOpening {readonly barIndex:number;readonly notes:readonly [number,number]}
export type PhraseDialogue =
 | {readonly kind:'opening-recall';readonly sourceBar:number;readonly sourceNotes:readonly [number,number];readonly fromMidi:number;readonly toMidi:number;readonly rootMidi:number}
 | {readonly kind:'fourth-stack';readonly originalVelocity:number;readonly velocityScale:number;readonly originalNotes:readonly number[];readonly notes:readonly number[];readonly rootPc:number;readonly third:3|4;readonly seventh:10|11}
 | {readonly kind:'kick-answer';readonly sourceOffset:number;readonly sourceVelocity:number;readonly originalVelocity:number};

export function recallBassOpening(events:readonly BassEvent[],bar:number,rootPc:number,scale:readonly number[],source?:BassOpening|null):BassEvent[] {
 if(!source||source.barIndex!==bar-1||events.length!==4||events.some((e,i)=>e.absBeat!==bar*4+i||e.conversation||e.phraseColor||e.ensembleColor||e.phraseDialogue)||events[0].midi%12!==rootPc)return [...events];
 const interval=source.notes[1]-source.notes[0],ideal=events[0].midi+interval;
 const target=[ideal,ideal-1,ideal+1].find(n=>scale.includes(n%12)&&Math.sign(n-events[0].midi)===Math.sign(interval)&&Math.abs(n-events[0].midi)<=5)??ideal;
 if(!interval||Math.abs(interval)>5||target<28||target>55||target===events[1].midi||!scale.includes(target%12)||Math.abs(events[2].midi-target)>5)return [...events];
 return events.map((e,i)=>i===1?{...e,midi:target,phraseDialogue:Object.freeze({kind:'opening-recall' as const,sourceBar:source.barIndex,sourceNotes:Object.freeze([...source.notes]) as readonly [number,number],rootMidi:events[0].midi,fromMidi:e.midi,toMidi:target})}:e);
}

/** Defining 3/7 shell beneath 9–5–root: two genuine perfect fourths. */
export function fourthStack(original:readonly number[],root:number,quality:string):number[]|undefined {
 if(original.length<3||original.length>4||!['7','min7','maj7'].includes(quality))return;
 const third=quality==='min7'?3:4,seventh=quality==='maj7'?11:10;
 const candidates:number[][]=[];
 for(let ninth=54;ninth<=74;ninth++)if(ninth%12===(root+2)%12){
  const shell=Array.from({length:ninth-48},(_,i)=>i+48).filter(n=>[third,seventh].includes((n-root+120)%12));
  for(const a of shell)for(const b of shell)if(a<b&&(a-root+120)%12!==(b-root+120)%12&&ninth-b>=2&&ninth+10-a<=28&&Math.abs(ninth+10-original.at(-1)!)<=7)candidates.push([a,b,ninth,ninth+5,ninth+10]);
 }
 return candidates.sort((a,b)=>Math.abs(a[4]-original.at(-1)!)*3+Math.abs(a[0]-original[0])-Math.abs(b[4]-original.at(-1)!)*3-Math.abs(b[0]-original[0]))[0];
}

/** Transfer the last stroke of a complete snare figure to an unoccupied right foot. */
export function snareKickDialogue(hits:readonly DrumHitSpec[],comp:readonly {absBeat:number}[],bar:number):DrumHitSpec[] {
 const pair=hits.filter(h=>h.role==='commentary').sort((a,b)=>a.beatOffset-b.beatOffset);
 if(![2,3].includes(pair.length)||pair.some((h,i)=>h.drum!=='snare'||(h.expression&&!(pair.length===3&&i===1&&h.expression.kind==='ghost-answer'))||h.conversation||h.ensembleColor)||pair.at(-1)!.beatOffset-pair[0].beatOffset<.5||pair.at(-1)!.beatOffset-pair[0].beatOffset>2)return [...hits];
 const answer=pair.at(-1)!;
 if(hits.some(h=>h.drum==='kick'&&Math.abs(h.beatOffset-answer.beatOffset)<.3)||comp.some(e=>Math.abs(e.absBeat-(bar*4+answer.beatOffset))<.25))return [...hits];
 return hits.map(h=>h!==answer?h:{...h,drum:'kick',velocity:h.velocity*.9,phraseDialogue:Object.freeze({kind:'kick-answer' as const,sourceOffset:pair[0].beatOffset,sourceVelocity:pair[0].velocity,originalVelocity:h.velocity})});
}
