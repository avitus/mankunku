import { describe, expect, it } from 'vitest';
import { planKeyboardLine } from '$lib/audio/backing-keyboard-line';
import { resolveCoordinatedVoicing, type CoordinatedVoicingMemory } from '$lib/audio/coordinated-voicing';

const previous: CoordinatedVoicingMemory = {version:1,chord:{root:'C',quality:'7'},notes:[52,58,62,69]};
const base={style:'swing' as const,phraseId:'line-test',tempo:140,seed:42,barIndex:0,phraseStartBar:0,phase:'solo_build' as const,attackIndex:0,previous};
describe('causal keyboard line proposals',()=>{
 it('anchors each request to the last actually emitted chord without advancing any state',()=>{
  const a=planKeyboardLine({...base,barIndex:1})!;
  expect(a.anchorMidi).toBe(69); expect(a.targetMidi).toBe(a.anchorMidi+a.stepSemitones);
  expect(planKeyboardLine({...base,barIndex:1})).toEqual(a);
  expect(planKeyboardLine({...base,barIndex:1,previous:JSON.parse(JSON.stringify(previous))})).toEqual(a);
  expect(planKeyboardLine({...base,previous:undefined})).toBeUndefined();
  expect(previous.notes).toEqual([52,58,62,69]);
  const b=planKeyboardLine({...base,barIndex:1,previous:{...previous,notes:[55,58,62,70]}})!;
  expect(b.targetMidi-a.targetMidi).toBe(1); expect(Object.isFrozen(a)).toBe(true);
 });
 it('gives repeated attacks a stable note aim and lets seeds vary the phrase',()=>{
  const contours=new Set<string>();
  for (let seed=0;seed<12;seed++) {
   contours.add(planKeyboardLine({...base,seed})!.contour);
   expect(planKeyboardLine({...base,seed,barIndex:1,attackIndex:1})!.stepSemitones).toBe(0);
  }
  expect(contours.size).toBeGreaterThan(2);
 });
 it('retains Bossa repeated/cadential pacing and slower Ballad movement',()=>{
  for(let seed=0;seed<12;seed++) {
   const bossa=Array.from({length:4},(_,barIndex)=>planKeyboardLine({...base,seed,barIndex,style:'bossa-nova'})!);
   const ballad=Array.from({length:4},(_,barIndex)=>planKeyboardLine({...base,seed,barIndex,style:'ballad'})!);
   expect(bossa.filter(x=>x.stepSemitones===0).length).toBeGreaterThanOrEqual(2);
   expect(bossa.every(x=>Math.abs(x.stepSemitones)<=1&&x.maxTopLeap===4)).toBe(true);
   expect(ballad.filter(x=>x.stepSemitones!==0).map((_,i)=>i)).toHaveLength(1);
   expect(ballad[0].stepSemitones).toBe(0);expect(ballad[1].stepSemitones).toBe(0);expect(ballad[3].stepSemitones).toBe(0);
   expect(ballad.every(x=>x.maxTopLeap===3)).toBe(true);
  }
 });
 it('settles returning heads and endings instead of prescribing another rise',()=>{
  for(const style of ['swing','straight','bossa-nova','ballad'] as const) for(const phase of ['head_return','solo_release','ending'] as const)
   for(let barIndex=0;barIndex<4;barIndex++) {
    const request=planKeyboardLine({...base,style,phase,barIndex})!;
    expect(request.contour).toBe('settle');expect(request.stepSemitones).toBeLessThanOrEqual(0);
   }
 });
});

describe('audible bounded line preference',()=>{
 it('can follow the line ahead of strict minimal motion without changing chord tones',()=>{
  let changed=0;
  for(const root of ['C','D','F','G','Bb'] as const) for(const quality of ['7','maj7','min7'] as const)
   for(const family of ['rootless-a','rootless-b','shell','drop2'] as const) {
    const input={chord:{root,quality},family,registerMidi:62,previous};
    const ordinary=resolveCoordinatedVoicing(input);
    for(const delta of [-2,-1,0,1,2]) {
     const request={...planKeyboardLine(base)!,targetMidi:69+delta,stepSemitones:delta};
     const actual=resolveCoordinatedVoicing({...input,keyboardLine:request});
     expect(new Set(actual.notes.map(n=>n%12))).toEqual(new Set(ordinary.notes.map(n=>n%12)));
     if(actual.decision.keyboardLine?.status==='connected') {
      changed++;
      expect(Math.abs(actual.notes.at(-1)!-request.targetMidi)).toBeLessThan(Math.abs(ordinary.notes.at(-1)!-request.targetMidi));
      expect(actual.decision.guideMotion!).toBeLessThanOrEqual(ordinary.decision.guideMotion!+2);
      expect(actual.decision.totalMovement).toBeLessThanOrEqual(ordinary.decision.totalMovement+4);
      expect(Math.abs(actual.notes.at(-1)!-previous.notes.at(-1)!)).toBeLessThanOrEqual(5);
     } else expect(actual.notes).toEqual(ordinary.notes);
    }
   }
  expect(changed).toBeGreaterThan(10);
 });
 it('keeps accepted spacing, guide support and quartal identity authoritative',()=>{
  for(const spacing of ['compact','open'] as const) {
   const actual=resolveCoordinatedVoicing({chord:{root:'C',quality:'7'},family:'rootless-a',registerMidi:62,previous,spacing,
    keyboardLine:planKeyboardLine({...base,barIndex:2})});
   const span=actual.notes.at(-1)!-actual.notes[0];
   if(actual.decision.spacing?.applied==='compact')expect(span).toBeLessThanOrEqual(12);
   if(actual.decision.spacing?.applied==='open')expect(span).toBeGreaterThanOrEqual(14);
  }
  for(const family of ['guide','quartal'] as const) {
   const input={chord:{root:'C' as const,quality:'7' as const},family,registerMidi:62,previous};
   const actual=resolveCoordinatedVoicing({...input,keyboardLine:planKeyboardLine(base)});
   expect(actual.notes).toEqual(resolveCoordinatedVoicing(input).notes);
   expect(actual.decision.keyboardLine?.status).toBe('family_ineligible');
  }
 });
 it('retains the exact ordinary notes when no bounded candidate follows the target',()=>{
  const input={chord:{root:'C' as const,quality:'7' as const},family:'rootless-a' as const,registerMidi:62,previous};
  const actual=resolveCoordinatedVoicing({...input,keyboardLine:planKeyboardLine(base)});
  expect(actual.decision.keyboardLine?.status).toBe('bounded_fallback');
  expect(actual.notes).toEqual([52,58,62,67]);
  expect(actual.notes).toEqual(resolveCoordinatedVoicing(input).notes);
  expect(actual.decision.keyboardLine?.distance).toBe(2);
 });
 it('replays a connected progression from only actual emitted history in every style',()=>{
  for (const style of ['swing','straight','bossa-nova','ballad'] as const) {
   let connected=0;
   for (let seed=0;seed<12;seed++) {
    let history=previous;
    for(let barIndex=0;barIndex<12;barIndex++) {
     const context={...base,style,seed,barIndex,phraseStartBar:Math.floor(barIndex/4)*4,previous:history};
     const line=planKeyboardLine(context)!;
     const input={chord:{root:(['C','F','D','G'] as const)[barIndex%4],quality:'7' as const},family:'rootless-a' as const,registerMidi:62,previous:history,keyboardLine:line};
     const actual=resolveCoordinatedVoicing(input);
     const replay=resolveCoordinatedVoicing({...input,previous:JSON.parse(JSON.stringify(history)),keyboardLine:planKeyboardLine({...context,previous:JSON.parse(JSON.stringify(history))})});
     expect(replay).toEqual(actual);
     expect(line.anchorMidi).toBe(history.notes.at(-1));
     const trace=actual.decision.keyboardLine!;
     expect(trace.actualMidi).toBe(actual.notes.at(-1));
     expect(trace.distance).toBeLessThanOrEqual(trace.ordinaryDistance);
     if(trace.status==='connected') {
      connected++;
      expect(trace.distance).toBeLessThan(trace.ordinaryDistance);
      expect(Math.abs(trace.actualMidi-trace.anchorMidi)).toBeLessThanOrEqual(trace.maxTopLeap);
      expect(trace.guideDetour).toBeLessThanOrEqual(2);
      expect(trace.movementDetour).toBeLessThanOrEqual(4);
     }
     history=actual.memory;
    }
   }
   expect(connected).toBeGreaterThan(0);
  }
 });
 it('rejects a stale anchor or widened motion budget',()=>{
  const input={chord:previous.chord,family:'rootless-a' as const,registerMidi:62,previous};
  const line=planKeyboardLine(base)!;
  expect(()=>resolveCoordinatedVoicing({...input,keyboardLine:{...line,anchorMidi:68}})).toThrow('Invalid keyboard line');
  expect(()=>resolveCoordinatedVoicing({...input,keyboardLine:{...line,maxGuideDetour:12 as 2}})).toThrow('Invalid keyboard line');
  expect(()=>resolveCoordinatedVoicing({...input,keyboardLine:{...line,maxMovementDetour:12 as 4}})).toThrow('Invalid keyboard line');
  expect(()=>resolveCoordinatedVoicing({...input,previous:undefined,keyboardLine:line})).toThrow('Invalid keyboard line');
 });
});
