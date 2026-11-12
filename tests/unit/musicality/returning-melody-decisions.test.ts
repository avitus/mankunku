import { describe, expect, it } from 'vitest';
import { describeMusicianDecisions } from '$lib/musicality/musician-decisions';
import type { GeneratedBacking } from '$lib/audio/backing-generation';
import type { BackingStyle } from '$lib/types/instruments';

function score() {
 return {
  bassEvents: [], compEvents: [] as Array<{time:string;absBeat:number;notes:number[];velocity:number;duration:number}>, drumEvents: [],
  ensemblePlan: { version: 1, trace: [], bars: [{ barIndex: 41, phraseStartBar: 40, phraseIntent: 'support', intent: 'support', energy: .5,
   performanceEnergy: { phase: 'head_return', chorusIndex: 3, targetEnergy: .5 }, responseOwner: 'nobody',
   piano: { role: 'leave_space', maxAttacks: 0, densityScale: 0, silenceReason: 'returning_melody' },
   bass: { role: 'time', keepPulse: true, ornamentScale: 0 },
   drums: { role: 'time', keepTime: true, maxCommentaryHits: 0, commentaryScale: 0, allowFill: false } }] },
  ensembleDevelopment: { version: 1, bassTurnarounds: [], drumPhrases: [],
   pianoMotifs: [{ barIndex: 41, phraseStartBar: 40, motifId: null, sourceFigureId: null, transform: 'space', shiftBeats: 0, hits: [], reason: 'ensemble_silence' }] }
 };
}
const action = 'Make room for the returning melody';
function card(value: ReturnType<typeof score>, style: BackingStyle = 'swing', orchestration: 'original'|'coordinated' = 'coordinated') {
 return describeMusicianDecisions(value as unknown as GeneratedBacking, { barIndex:41, ppq:192, beatsPerBar:4, style, orchestration })[1];
}
describe('returning melody scheduled piano space', () => {
 it.each(['swing','straight','bossa-nova','ballad'] as const)('describes the actual planned breathing bar in %s', style => {
  expect(card(score(),style)).toMatchObject({action,eventCount:0});
  expect(card(score(),style).detail).toBe('The piano leaves space after the returning head’s arrival.');
 });
 it.each(['original','wrong-phase','positive-budget','other-reason','missing-motif','sounding-attack','nominal-attack'] as const)('does not invent structural space for %s', change => {
  const value=score();
  if(change==='wrong-phase') value.ensemblePlan.bars[0].performanceEnergy.phase='solo_build';
  if(change==='positive-budget') value.ensemblePlan.bars[0].piano.maxAttacks=1;
  if(change==='other-reason') value.ensemblePlan.bars[0].piano.silenceReason='soloist_dense';
  if(change==='missing-motif') value.ensembleDevelopment.pianoMotifs=[];
  if(change==='sounding-attack'||change==='nominal-attack') value.compEvents.push({time: change==='nominal-attack'?'31487i':'31488i',absBeat:164,notes:[52,57,60],velocity:60,duration:.1});
  expect(card(value,'swing',change==='original'?'original':'coordinated').action).not.toBe(action);
 });
});
