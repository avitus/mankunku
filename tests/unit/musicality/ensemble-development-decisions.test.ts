import { describe,expect,it } from 'vitest';
import { describeMusicianDecisions } from '$lib/musicality/musician-decisions';
import type { GeneratedBacking } from '$lib/audio/backing-generation';
const context={barIndex:1,ppq:192,beatsPerBar:4,style:'swing' as const,orchestration:'coordinated' as const};
function keyboard() {
 const previous={time:'0i',absBeat:0,notes:[52,58,62,67],duration:.5,velocity:64};
 const event={time:'768i',absBeat:4,notes:[52,57,62,69],duration:.5,velocity:64};
 const motion={status:'changed',previousNotes:previous.notes,ordinaryNotes:[52,60,64,69],actualNotes:event.notes,topFromMidi:67,topToMidi:69,voiceIndex:1,fromMidi:58,toMidi:57,guideDetour:1,movementDetour:2};
 return {bassEvents:[],drumEvents:[],compEvents:[previous,event],ensembleDevelopment:{version:1,pianoMotifs:[],bassTurnarounds:[],drumPhrases:[],pianoVoicings:[{...event,decision:{requestedFamily:'rootless-a',resolvedFamily:'rootless-a',correction:'none',guideMotion:2,commonTones:[],totalMovement:3,registerDistance:1,candidateCount:4,keyboardContraryMotion:motion}}]}};
}
const cards=(value:unknown)=>describeMusicianDecisions(value as GeneratedBacking,context);
describe('factual 0.8 musician evidence',()=>{
 it('describes actual opposite inner/top movement',()=>expect(cards(keyboard())[1].evidence.join(' ')).toContain('Inner voice'));
 it.each(['missing_previous','wrong_previous','wrong_actual','same_direction','wrong_index','over_bound','nonfinite','unavailable'])('does not invent contrary movement: %s',change=>{
  const score=keyboard(),motion=score.ensembleDevelopment.pianoVoicings[0].decision.keyboardContraryMotion;
  if(change==='missing_previous')score.compEvents.shift();
  if(change==='wrong_previous')motion.previousNotes=[51,58,62,67];
  if(change==='wrong_actual')motion.actualNotes=[52,58,62,69];
  if(change==='same_direction')motion.fromMidi=56;
  if(change==='wrong_index')motion.voiceIndex=3;
  if(change==='over_bound')motion.movementDetour=5;
  if(change==='nonfinite')motion.guideDetour=-Infinity;
  if(change==='unavailable')motion.status='unavailable';
  expect(cards(score)[1].evidence.join(' ')).not.toContain('Inner voice');
 });
});

function bassScore() {
 const notes=[{time:'768i',absBeat:4,midi:40},{time:'960i',absBeat:5,midi:36}];
 return {bassEvents:notes.map(note=>({...note,duration:.4,velocity:80})),compEvents:[],drumEvents:[],ensembleDevelopment:{version:1,pianoMotifs:[],drumPhrases:[],bassTurnarounds:[],bassDelayedRoots:[{version:1,barIndex:1,degree:'third',rootPc:0,notes:[...notes]}]}};
}
describe('delayed-root card',()=>{
 it('names only the emitted root landing',()=>expect(cards(bassScore())[0].action).toBe('Let the root arrive later'));
 it.each(['missing','wrong_note','wrong_time','wrong_degree','early_root'])('rejects mismatched receipt %s',change=>{
  const value=bassScore();
  if(change==='missing')value.bassEvents.pop();
  if(change==='wrong_note')value.bassEvents[1].midi=38;
  if(change==='wrong_time')value.bassEvents[1].time='970i';
  if(change==='wrong_degree')value.ensembleDevelopment.bassDelayedRoots[0].degree='fifth';
  if(change==='early_root')value.bassEvents.push({...value.bassEvents[1],absBeat:4.5,time:'864i'});
  expect(cards(value)[0].action).not.toBe('Let the root arrive later');
 });
});
function drumsScore() {
 const after={drum:'ride',beatOffset:3,velocity:.3,role:'timekeeping'};
 const before={...after,velocity:.4};
 return {bassEvents:[],compEvents:[{absBeat:6,time:'1152i',duration:.5,velocity:64,notes:[52,58,62]}],
 drumEvents:[{absBeat:7,time:'1344i',drum:'ride',velocity:.3,role:'timekeeping'}],
 ensemblePlan:{version:1,trace:[],bars:[{barIndex:1,energy:.4,phraseIntent:'release',responseOwner:'nobody',bass:{role:'time'},piano:{role:'support'},drums:{role:'time'},performanceEnergy:{phase:'solo_release',targetEnergy:.4}}]},
 ensembleDevelopment:{version:1,bassTurnarounds:[],pianoMotifs:[],drumPhrases:[{barIndex:1,ride:{mode:'quarters-only'},commentary:{hits:[],transform:'space'},
 cushioning:{basis:'structural_keyboard_release',phase:'solo_release',compAttack:{beatOffset:2,durationBeats:1,durationSeconds:.5,time:'1152i'},removedHits:[],softenedHits:[{before,after}]}}]}};
}
describe('drum cushioning card',()=>{
 it('describes actual easing around the emitted keyboard chord',()=>expect(cards(drumsScore())[2].action).toBe('Ease around the resolution'));
 it.each(['wrong_hit','wrong_source','wrong_gate','no_change','louder','wrong_phase'])('rejects unverified cushioning %s',change=>{
  const score=drumsScore(),cushion=score.ensembleDevelopment.drumPhrases[0].cushioning;
  if(change==='wrong_hit')score.drumEvents[0].velocity=.4;
  if(change==='wrong_source')score.compEvents[0].time='1153i';
  if(change==='wrong_gate')score.compEvents[0].duration=.25;
  if(change==='no_change')cushion.softenedHits=[];
  if(change==='louder')cushion.softenedHits[0].before.velocity=.2;
  if(change==='wrong_phase')cushion.phase='solo_peak';
  expect(cards(score)[2].action).not.toBe('Ease around the resolution');
 });
});
