import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';

type Style = 'swing' | 'straight' | 'bossa-nova' | 'ballad';
function fixture(style: Style, tune: 'blues' | 'aaba' = 'blues', seed = 42) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const session = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const { phrase } = session, tempo = style === 'ballad' ? 80 : 140;
 const make = (keyboardContraryMotion?: true, loopCount = 1) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}
 }, { returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
  chorusBoundaryPriority: true, loopCount, keyboardTexture: true, keyboardPhrasing:'piano', ...(keyboardContraryMotion ? { keyboardContraryMotion } : {}) });
 return { make, session };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint; return result;
 });
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('contrary motion in complete performances', () => {
 for(const style of ['swing','straight','bossa-nova','ballad'] as const) {
  it(`${style} emits actual bounded contrary movement while retaining its rhythm`, () => {
   let changed=0, retained=0, requests=0; const witnesses: unknown[]=[];
   for(const tune of ['blues','aaba'] as const) for(const seed of [42,7,19]) {
    const {make}=fixture(style,tune,seed), score=make(true), before=run(make()), after=run(score);
    const rhythm=(bars:typeof after)=>bars.map(b=>b.compEvents.map(({time,absBeat,duration,velocity})=>({time,absBeat,duration,velocity})));
    expect(rhythm(after)).toEqual(rhythm(before));
    expect(after.map(b=>b.bassEvents)).toEqual(before.map(b=>b.bassEvents));
    expect(after.map(b=>b.drumEvents)).toEqual(before.map(b=>b.drumEvents));
    for(const [i,bar] of after.entries()) {
     expect(advanceRollingBacking(score,i?JSON.parse(JSON.stringify(after[i-1].checkpoint)):undefined)).toEqual(bar);
     expect((bar.ensembleDevelopment.pianoVoicings??[]).filter(v=>v.decision.keyboardContraryMotion).length).toBeLessThanOrEqual(1);
     for(const voiced of bar.ensembleDevelopment.pianoVoicings??[]) {
      const trace=voiced.decision.keyboardContraryMotion;
      if(!trace)continue;
      requests++;
      expect(voiced.time).toBe(bar.compEvents[0].time);
      expect(trace.actualNotes).toEqual(voiced.notes);
      const line=voiced.decision.keyboardLine;
      if(line) expect(Math.abs(trace.actualNotes.at(-1)!-line.targetMidi)).toBe(Math.abs(trace.ordinaryNotes.at(-1)!-line.targetMidi));
      if(trace.status==='changed'||trace.status==='retained') {
       if(trace.status==='changed') {changed++;witnesses.push({tune,seed,bar:i+1,phrase:bar.ensembleDevelopment.pianoMotifs[0].phraseStartBar,from:trace.previousNotes,before:trace.ordinaryNotes,to:trace.actualNotes});} else retained++;
       expect(trace.fromMidi).toBe(trace.previousNotes[trace.voiceIndex!]);
       expect(trace.toMidi).toBe(trace.actualNotes[trace.voiceIndex!]);
       expect((trace.toMidi!-trace.fromMidi!)*(trace.topToMidi-trace.topFromMidi!)).toBeLessThan(0);
       expect(trace.guideDetour).toBeLessThanOrEqual(2);expect(trace.movementDetour).toBeLessThanOrEqual(4);
      }
     }
    }
   }
   process.stdout.write(`contrary-witness ${style} ${JSON.stringify({changed,retained,requests,witnesses})}\n`);
   expect(changed).toBeGreaterThan(0);expect(retained).toBeGreaterThan(0);
  });
 }
});
