import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';

const styles = ['swing', 'straight', 'bossa-nova', 'ballad'] as const;
type Style = typeof styles[number];
function fixture(style: Style, tune: 'blues' | 'aaba' = 'blues', seed = 42) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const session = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const { phrase } = session;
 const tempo = style === 'ballad' ? 80 : 140;
 const params = { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4,
  swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo), sectionMap: phrase.sectionMap,
  performanceForm: phrase.performanceForm, ensemble: {} };
 const make = (variety = false, loopCount = 1) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], params,
  { returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', loopCount, ...(variety ? { keyboardVariety: true as const } : {}) });
 return { make, session };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint; return result;
 });
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const musicalKeys = ['bassEvents', 'compEvents', 'drumEvents', 'ensemblePlan', 'ensembleDevelopment'] as const;

describe('keyboard rhythmic vocabulary in complete performances', () => {
 it('keeps the previous accompaniment release byte-identical when not opted in', () => {
  const expected: Record<Style, string> = { swing: '60d4a41ab94c14bc989f36a64169b19c0ea8f32c3290ea4728b69b681c9400d1', straight: '925dd82f6ee85b6b89b318861b74ec887e5c2ee634ea692609fe77cae8d4eff5', 'bossa-nova': '32eab284b74433e8fba956f3151e171d7571c907ef67824d4271f59f0d078087', ballad: 'cdfd48f917fb5399bf2beb249c311d8cc408890637392d8d3b199bfb5653bf53' };
  for (const style of styles) {
   const actual = digest(run(fixture(style).make()));
   expect(actual).toBe(expected[style]);
  }
 });
 for (const style of ['swing', 'straight'] as const) for (const tune of ['blues', 'aaba'] as const) {
  it(`${style} ${tune}: adds different audible rhythm shapes without withdrawing ordinary harmony`, () => {
   const newShapes = new Set<string>();
   let support = 0, shortLong = 0;
   for (const seed of [7, 19, 42, 83]) {
    const { make, session } = fixture(style, tune, seed);
    const score = make(true), bars = run(score);
    const previous = run(make());
    expect(bars.map(b => b.compEvents)).not.toEqual(previous.map(b => b.compEvents));
    for (const b of bars) {
     const plan = b.ensemblePlan.bars[0];
     const offsets = b.compEvents.map(e => Math.round((e.absBeat - b.fromBar * 4) * 1000) / 1000).join(',');
     if (['0.5,2', '0,2.5', '1,2.5', '0,1.5,3', '0.5,3.5', '1.5,2.5'].includes(offsets)) newShapes.add(offsets);
     const motif = b.ensembleDevelopment.pianoMotifs[0];
     if (motif.reason === 'shared_arrival' || motif.reason === 'drum_reply') expect(motif.sourceFigureId).toBeNull();
     if (['short-long', 'offbeat-hold'].includes(motif.sourceFigureId ?? '') && b.compEvents.length === 2) {
      // The long offbeat must survive realization; the old blanket stab
      // cap would turn both written articulations into short jabs.
      const [short, long] = b.compEvents;
      if (long.absBeat % 4 === 2.5) {
       expect(short.duration * score.tempo / 60).toBeLessThan(.8);
       expect(long.duration * score.tempo / 60).toBeGreaterThan(.8);
       shortLong++;
      }
     }
     expect(b.compEvents.length).toBeLessThanOrEqual(plan.piano.maxAttacks);
     if (plan.piano.harmonicSupport) { support++; expect(b.compEvents.length).toBeGreaterThan(0); }
     if (['under_response', 'after_response'].includes(plan.piano.harmonicSupport ?? '')) {
      expect(b.compEvents).toHaveLength(1);
      expect(b.compEvents[0].notes).toHaveLength(2);
      expect(b.compEvents[0].velocity).toBeLessThan(70);
     }
     if (plan.piano.silenceReason) expect(b.compEvents).toHaveLength(0);
     expect(b.bassEvents.length).toBeGreaterThan(0);
     expect(b.drumEvents.length).toBeGreaterThan(0);
     for (const event of b.compEvents) {
      expect(event.absBeat).toBeGreaterThanOrEqual(b.fromBar * 4);
      expect(event.absBeat).toBeLessThan((b.fromBar + 1) * 4);
      expect(event.duration).toBeGreaterThan(0);
      expect(event.notes.length).toBeGreaterThanOrEqual(2);
     }
    }
    const returnBar = session.headBars + session.chorusBars * 2;
    for (const offset of [1, 2]) expect(bars[returnBar + offset].compEvents).toHaveLength(0);
    expect(bars[returnBar + 3].compEvents.length).toBeGreaterThan(0);
   }
   expect(newShapes.size).toBeGreaterThanOrEqual(2);
   expect(shortLong).toBeGreaterThan(0);
   console.info('keyboard-variety', style, tune, JSON.stringify({ newShapes: [...newShapes], shortLong, support }));
   expect(support).toBeGreaterThan(tune === 'blues' ? 140 : 350);
  });
 }
 for (const style of ['bossa-nova', 'ballad'] as const) it(`${style}: keeps native rhythm and articulation unchanged`, () => {
  const { make } = fixture(style);
  const before = run(make()), after = run(make(true));
  for (let bar = 0; bar < before.length; bar++) for (const key of musicalKeys) expect(after[bar][key]).toEqual(before[bar][key]);
 });
 it('replays new phrase memory and rejects crossing the policy boundary', () => {
  const { make } = fixture('swing', 'aaba');
  const score = make(true), bars = run(score), previous = run(make());
  for (const index of [5, 18, 47, 72, 110]) {
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(bars[index].checkpoint)))).toEqual(bars[index + 1]);
   expect(() => advanceRollingBacking(make(), bars[index].checkpoint)).toThrow();
   expect(() => advanceRollingBacking(score, previous[index].checkpoint)).toThrow();
  }
 });
 it('keeps loop prefixes and accepts only completed evidence for the next bar', () => {
  const { make } = fixture('swing');
  const two = make(true, 2), three = make(true, 3), a = run(two), b = run(three);
  for (let index = 0; index < 52; index++) for (const key of musicalKeys) expect(a[index][key]).toEqual(b[index][key]);
  expect(advanceRollingBacking(two, JSON.parse(JSON.stringify(a[51].checkpoint)))).toEqual(a[52]);
  const checkpoint = a[19].checkpoint, next = checkpoint.nextBar;
  const observation = { barIndex: next + 1, observedAtBar: next + 1, confidence: 1, noteDensity: 1, restBeats: 0, source: 'scripted' as const };
  expect(advanceRollingBacking(two, checkpoint, [observation])).toEqual(a[next]);
  const dense = advanceRollingBacking(two, checkpoint, [{ ...observation, barIndex: next, observedAtBar: next }]);
  expect(dense.ensemblePlan.bars[0].piano.harmonicSupport).toBeUndefined();
  if (dense.ensemblePlan.bars[0].boundaryStrength < .85) expect(dense.compEvents).toHaveLength(0);
 });
});
