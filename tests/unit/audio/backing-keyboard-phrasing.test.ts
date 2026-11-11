import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { HISTORICAL_MUSICALITY_STYLES as BACKING_STYLES } from '../../helpers/musicality-style-fixtures';
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
 const make = (keyboardPhrasing?: 'piano' | 'organ', loopCount = 1) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}
 }, { returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
  chorusBoundaryPriority: true, loopCount, keyboardTexture: true, ...(keyboardPhrasing ? { keyboardPhrasing } : {}) });
 return { make, session };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint; return result;
 });
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('connected keyboard phrases in complete performances', () => {
 it('captures the prior 0.6 listening baseline', () => {
  const hashes: Record<Style,string> = { swing: 'c97dbba0a145c4acf98a3663087ecfa7d5ca73a858f5267079e87959c17d281a', straight: 'b8d37608f3c4a95a2a55d245e2ea41625f520f18739398a8a93d390809198f9d', 'bossa-nova': '32eab284b74433e8fba956f3151e171d7571c907ef67824d4271f59f0d078087', ballad: 'cdfd48f917fb5399bf2beb249c311d8cc408890637392d8d3b199bfb5653bf53' };
  for (const style of ['swing','straight','bossa-nova','ballad'] as const) expect(digest(run(fixture(style).make()))).toBe(hashes[style]);
 });
 it.each(['swing','straight','bossa-nova','ballad'] as const)('%s emits connected lines and instrument-specific articulation with native attacks', style => {
  const {make}=fixture(style), old=run(make()), piano=run(make('piano')), organ=run(make('organ'));
  expect(make('piano').fingerprint).not.toBe(make().fingerprint);
  expect(make('piano').fingerprint).not.toBe(make('organ').fingerprint);
  const traces=piano.flatMap(bar=>bar.ensembleDevelopment.pianoVoicings??[]);
  expect(traces.some(v=>v.decision.keyboardLine)).toBe(true);
  expect(piano.some((bar,i)=>bar.compEvents.some((event,j)=>event.duration!==organ[i].compEvents[j]?.duration))).toBe(true);
  const attacks=(bars: typeof piano)=>bars.map(bar=>bar.compEvents.map(e=>[e.time,e.absBeat,e.velocity]));
  expect(attacks(piano)).toEqual(attacks(old)); expect(attacks(organ)).toEqual(attacks(piano));
  expect(organ.map(b=>b.compEvents.map(e=>e.notes))).toEqual(piano.map(b=>b.compEvents.map(e=>e.notes)));
  expect(piano.map(b=>b.bassEvents)).toEqual(old.map(b=>b.bassEvents));
  expect(piano.map(b=>b.drumEvents)).toEqual(old.map(b=>b.drumEvents));
  for (const bars of [piano,organ]) for (const [i,bar] of bars.entries()) for(const [j,event] of bar.compEvents.entries()) {
   const end=Number(event.time.slice(0,-1))+event.duration*make('piano').tempo/60*192;
   expect(end).toBeLessThanOrEqual((i+1)*4*192+1e-8);
   if(bar.compEvents[j+1]) expect(end).toBeLessThanOrEqual(Number(bar.compEvents[j+1].time.slice(0,-1))+1e-8);
  }
 });
});


describe('heard keyboard connections across complete forms', () => {
 for (const style of ['swing','straight','bossa-nova','ballad'] as const) for (const tune of ['blues','aaba'] as const) {
  it(`${style}/${tune} makes bounded, actual pitch choices across different seeds`, () => {
   let connections=0, changes=0, traces=0, nativeTextures=0; const contours=new Set<string>();
   for (const seed of [42,7,19]) {
    const {make}=fixture(style,tune,seed), old=run(make()), played=run(make('piano'));
    for(const [i,bar] of played.entries()) {
     for(const [j,event] of bar.compEvents.entries()) if(JSON.stringify(event.notes)!==JSON.stringify(old[i].compEvents[j]?.notes)) changes++;
     for(const voiced of bar.ensembleDevelopment.pianoVoicings??[]) {
      const line=voiced.decision.keyboardLine;
      if(voiced.decision.keyboardTexture) nativeTextures++;
      if(!line) continue; traces++; contours.add(line.contour);
      expect(line.actualMidi).toBe(voiced.notes.at(-1));
      expect(bar.compEvents.some(e=>e.time===voiced.time && JSON.stringify(e.notes)===JSON.stringify(voiced.notes))).toBe(true);
      if(line.status==='connected') {
       connections++;
       expect(line.distance).toBeLessThan(line.ordinaryDistance);
       expect(line.actualMidi).not.toBe(line.ordinaryMidi);
       expect(line.guideDetour).toBeLessThanOrEqual(2); expect(line.movementDetour).toBeLessThanOrEqual(4);
       expect(Math.abs(line.actualMidi-line.anchorMidi)).toBeLessThanOrEqual(line.maxTopLeap);
      }
     }
    }
   }
   process.stdout.write(`connected-witness ${style}/${tune} ${JSON.stringify({connections,changes,traces,nativeTextures,contours:[...contours]})}\n`);
   expect(connections).toBeGreaterThan(3); expect(changes).toBeGreaterThan(10); expect(contours.size).toBeGreaterThan(1);
   expect(nativeTextures).toBeGreaterThan(0);
  });
 }
});
