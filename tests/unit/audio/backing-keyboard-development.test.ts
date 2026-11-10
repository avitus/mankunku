import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint, type RollingBackingOptions } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';

type Style = 'swing' | 'straight' | 'bossa-nova' | 'ballad';
function fixture(style: Style, tune: 'blues' | 'aaba' = 'blues', seed = 42, tempoOverride?: number) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const session = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const { phrase } = session, tempo = tempoOverride ?? (style === 'ballad' ? 80 : 140);
 const params = { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4,
  swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo), sectionMap: phrase.sectionMap,
  performanceForm: phrase.performanceForm, ensemble: {} };
 const make = (keyboardVariety: RollingBackingOptions['keyboardVariety'] = 'developed', loopCount = 1, chorusBoundaryPriority = false) =>
  createRollingBacking(phrase.harmony!, BACKING_STYLES[style], params,
   { returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', loopCount, keyboardVariety, ...(chorusBoundaryPriority ? { chorusBoundaryPriority: true as const } : {}) });
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

describe('developed keyboard phrasing in complete performances', () => {
 it('preserves the previous vocabulary release byte-for-byte', () => {
  const expected: Record<Style, string> = { swing: 'e090f7df08a523faff1bb5b1c262b9d9c9d0f5034744984b71de243f392f999a', straight: 'a26fdc0b560db7bd91f04a2587d32894c60a90f4813c0910ba018f76dca9e73f', 'bossa-nova': '32eab284b74433e8fba956f3151e171d7571c907ef67824d4271f59f0d078087', ballad: 'cdfd48f917fb5399bf2beb249c311d8cc408890637392d8d3b199bfb5653bf53' };
  for (const style of ['swing', 'straight', 'bossa-nova', 'ballad'] as const) {
   const actual = digest(run(fixture(style).make(true)));
   console.info('keyboard-v1-hash', style, actual);
   expect.soft(actual).toBe(expected[style]);
  }
 });
 for (const style of ['swing', 'straight'] as const) for (const tune of ['blues', 'aaba'] as const) {
  it(`${style} ${tune}: develops audible answers and varied phrase contours without losing ordinary support`, () => {
   const profiles = new Set<string>(), answers = new Set<string>(), sequences = new Set<string>();
   let contrasts = 0, voicedAnswers = 0, support = 0;
   for (const seed of [7, 19, 42, 83]) {
    const { make, session } = fixture(style, tune, seed), score = make(), bars = run(score);
    expect(score.keyboardVarietyVersion).toBe(2);
    expect(bars.map(b => b.compEvents)).not.toEqual(run(make(true)).map(b => b.compEvents));
    const phrases = new Map<number, string[]>();
    for (const b of bars) {
     const plan = b.ensemblePlan.bars[0], trace = b.ensembleDevelopment.pianoMotifs[0];
     if (trace.development) {
      profiles.add(trace.development);
      const phrase = phrases.get(trace.phraseStartBar) ?? [];
      phrase.push(trace.transform); phrases.set(trace.phraseStartBar, phrase);
     }
     if (trace.transform === 'answer') {
      expect(trace.answerFigureId).toBeTruthy();
      expect(trace.sourceFigureId).toBeTruthy();
      expect(trace.answerFigureId).not.toBe(trace.sourceFigureId);
      expect(b.compEvents).toHaveLength(trace.hits.length);
      expect(b.compEvents.map(e => e.absBeat % 4)).toEqual(trace.hits.map(h => h.b));
      expect(trace.recall).toBeUndefined();
      answers.add(trace.answerFigureId!); voicedAnswers++;
     }
     if (trace.development && b.compEvents.length === 2) {
      const [first, last] = b.compEvents;
      if (Math.abs(first.velocity - last.velocity) >= 8 && Math.max(first.duration, last.duration) / Math.min(first.duration, last.duration) >= 2) contrasts++;
     }
     expect(b.compEvents.length).toBeLessThanOrEqual(plan.piano.maxAttacks);
     if (plan.piano.harmonicSupport) { support++; expect(b.compEvents.length).toBeGreaterThan(0); }
     if (['under_response', 'after_response', 'under_drums'].includes(plan.piano.harmonicSupport ?? '')) {
      expect(b.compEvents).toHaveLength(1); expect(b.compEvents[0].notes).toHaveLength(2);
      expect(trace.development).toBeUndefined(); expect(trace.answerFigureId).toBeUndefined();
     }
     if (plan.piano.silenceReason) expect(b.compEvents).toHaveLength(0);
     if (['shared_arrival', 'drum_reply'].includes(trace.reason ?? '')) {
      expect(trace.development).toBeUndefined(); expect(trace.answerFigureId).toBeUndefined();
     }
     for (const [index, event] of b.compEvents.entries()) {
      const end = Number(event.time.slice(0, -1)) + event.duration * score.tempo / 60 * score.ppq;
      expect(end).toBeLessThanOrEqual((b.fromBar + 1) * 4 * score.ppq + 1e-8);
      if (trace.development && b.compEvents[index + 1]) expect(end).toBeLessThanOrEqual(Number(b.compEvents[index + 1].time.slice(0, -1)) + 1e-8);
      expect(event.velocity).toBeGreaterThanOrEqual(24); expect(event.velocity).toBeLessThanOrEqual(100);
     }
    }
    for (const sequence of phrases.values()) if (sequence.length >= 3) sequences.add(sequence.join(','));
    const returnBar = session.headBars + session.chorusBars * 2;
    for (const offset of [1, 2]) expect(bars[returnBar + offset].compEvents).toHaveLength(0);
   }
   console.info('keyboard-development', style, tune, { profiles: [...profiles], answers: [...answers], sequences: [...sequences], voicedAnswers, contrasts, support });
   expect(profiles.size).toBeGreaterThanOrEqual(3);
   expect(sequences.size).toBeGreaterThanOrEqual(3);
   expect(answers.size).toBeGreaterThanOrEqual(3);
   expect(voicedAnswers).toBeGreaterThanOrEqual(8);
   expect(contrasts).toBeGreaterThanOrEqual(8);
   expect(support).toBeGreaterThan(tune === 'blues' ? 140 : 350);
  });
 }
 it('emits complementary answers in the actual combined-policy Blues listening take', () => {
  for (const tempo of [140, 240]) {
   const { make } = fixture('swing', 'blues', 42, tempo);
   const score = make('developed', 1, true), bars = run(score);
   const answers = bars.filter(b => b.ensembleDevelopment.pianoMotifs[0].transform === 'answer');
   expect(answers.length).toBeGreaterThanOrEqual(2);
   for (const bar of answers) expect(bar.compEvents).toHaveLength(2);
   console.info('combined-keyboard-witness', tempo, JSON.stringify(answers.map(b => ({
    bar: b.fromBar, trace: b.ensembleDevelopment.pianoMotifs[0],
    events: b.compEvents.map(e => ({ absBeat: e.absBeat, durationBeats: e.duration * tempo / 60, velocity: e.velocity }))
   }))));
  }
 });
 it('keeps native Bossa and Ballad unchanged', () => {
  for (const style of ['bossa-nova', 'ballad'] as const) {
   const { make } = fixture(style);
   expect(run(make())).toEqual(run(make(true)));
  }
 });
 it('restores actual phrase progress and refuses checkpoints from another policy', () => {
  const { make } = fixture('swing', 'aaba'), score = make(), bars = run(score), old = run(make(true));
  for (const index of [5, 18, 47, 72, 110]) {
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(bars[index].checkpoint)))).toEqual(bars[index + 1]);
   expect(() => advanceRollingBacking(score, old[index].checkpoint)).toThrow();
   expect(() => advanceRollingBacking(make(true), bars[index].checkpoint)).toThrow();
  }
 });
 it('leaves already performed prefixes fixed across loops and future observations', () => {
  const { make } = fixture('swing'), two = make('developed', 2), three = make('developed', 3), a = run(two), b = run(three);
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
