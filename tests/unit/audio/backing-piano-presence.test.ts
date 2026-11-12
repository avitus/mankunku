import { describe, expect, it } from 'vitest';
import { seedFrom } from '$lib/audio/generation-rng';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { COMP_FIGURES } from '$lib/audio/backing-comp-figures';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';

const styles = ['swing', 'straight', 'bossa-nova', 'ballad'] as const;
function fixture(style: typeof styles[number], tune: 'blues' | 'aaba', fast = false, swing = .67, hold = false) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const session = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const { phrase } = session;
 const tempo = fast ? 240 : style === 'ballad' ? 80 : 140;
 const params = { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(swing, BACKING_STYLES[style], tempo), sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}, ...(hold ? { terminalArrangement: { ending: 'hold-release' as const, melody: phrase.notes } } : {}) };
 const make = (presence = false) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], params, { returningMelodySpace: true, performanceEnergySeed: 42, ...(presence ? { pianoPresence: true as const } : {}) });
 return { session, tempo, make };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => { const bar = advanceRollingBacking(score, checkpoint); checkpoint = bar.checkpoint; return bar; });
}
function measure(bars: ReturnType<typeof run>, tempo = 140) {
 let gap = 0, maxGap = 0;
 for (const bar of bars) { gap = bar.compEvents.length ? 0 : gap + 1; maxGap = Math.max(maxGap, gap); }
 let soundingTicks = 0, release = 0;
 for (const event of bars.flatMap(bar => bar.compEvents).sort((a, b) => parseInt(a.time) - parseInt(b.time))) {
  const start = parseInt(event.time), end = start + event.duration * tempo / 60 * 192;
  soundingTicks += Math.max(0, end - Math.max(start, release)); release = Math.max(release, end);
 }
 return { soundingBeats: Number((soundingTicks / 192).toFixed(2)), attacks: bars.reduce((n, bar) => n + bar.compEvents.length, 0), soundingBars: bars.filter(bar => bar.compEvents.length).length, maxGap };
}

describe('listening piano phrase presence', () => {
 it('gives the reported F blues a materially more connected solo accompaniment', () => {
  const { session, make } = fixture('swing', 'blues');
  const range = (bars: ReturnType<typeof run>) => bars.slice(session.headBars, session.headBars + session.chorusBars * 2);
  const old = run(make()), current = run(make(true));

  const before = measure(range(old)), after = measure(range(current));
  expect(after.soundingBars).toBeGreaterThanOrEqual(before.soundingBars + 5);
  expect(after.attacks).toBeGreaterThan(before.attacks);
  expect(after.soundingBeats).toBeGreaterThan(before.soundingBeats);
  expect(current.slice(14, 20).filter(bar => bar.compEvents.length).length).toBeGreaterThanOrEqual(3);
  const headReturn = session.headBars + session.chorusBars * 2;
  for (const offset of [1, 2]) {
   expect(current[headReturn + offset].compEvents).toHaveLength(0);
   expect(current[headReturn + offset].ensemblePlan.bars[0].piano.silenceReason).toBe("returning_melody");
  }
  console.info("piano-presence SOLO swing blues", JSON.stringify({before, after}));
  expect(after.maxGap).toBeLessThanOrEqual(before.maxGap);
 });

 for (const style of styles) it(`preserves exact 240 BPM .62 browser returning-head witness: ${style}`, () => {
  const { make, session } = fixture(style, style === 'swing' ? 'aaba' : 'blues', true, .62, style === 'ballad');
  const score = make(true), bars = run(score), headReturn = session.headBars + session.chorusBars * 2;
  for (const offset of [1,2]) {
   expect(bars[headReturn + offset].compEvents).toHaveLength(0);
   expect(bars[headReturn + offset].ensemblePlan.bars[0].piano.silenceReason).toBe('returning_melody');
  }
  expect(bars[headReturn + 3].compEvents.length).toBeGreaterThan(0);
  if (style === 'ballad') expect(bars.at(-1)!.ensembleDevelopment.terminalArrangements?.[0].status).toBe('accepted');
 });
 it('keeps the opt-in absent from metadata-free historical rolling definitions', () => {
  const harmony = [{ chord: { root: 'F' as const, quality: '7' as const }, scaleId: 'major.mixolydian', startOffset: [0,1] as [number,number], duration: [4,1] as [number,number] }];
  const params = { phraseId: 'legacy-presence', tempo: 140, ppq: 192, beatsPerBar: 4, swing: .67, ensemble: {} };
  expect(createRollingBacking(harmony, BACKING_STYLES.swing, params, { pianoPresence: true })).toEqual(createRollingBacking(harmony, BACKING_STYLES.swing, params));
 });
 it('carries actual piano silence across a declared loop and replays without changing the longer-form prefix', () => {
  const harmony = [{ chord: { root: 'F' as const, quality: '7' as const }, scaleId: 'major.mixolydian', startOffset: [0,1] as [number,number], duration: [12,1] as [number,number] }];
  const performanceForm = buildPerformanceForm({ totalBars: 12, sectionMap: [], choruses: [{ role: 'solo', startBar: 0, endBarExclusive: 12 }] });
  const params = { phraseId: 'presence-loop', tempo: 140, ppq: 192, beatsPerBar: 4, swing: .67, performanceForm, ensemble: {} };
  const two = createRollingBacking(harmony, BACKING_STYLES.swing, params, { loopCount: 2, pianoPresence: true, performanceEnergySeed: 42 });
  const three = createRollingBacking(harmony, BACKING_STYLES.swing, params, { loopCount: 3, pianoPresence: true, performanceEnergySeed: 42 });
  const a = run(two), b = run(three);
  for (let index = 0; index < 20; index++) {
   for (const key of ['bassEvents', 'compEvents', 'drumEvents', 'ensemblePlan', 'ensembleDevelopment'] as const) expect(a[index][key]).toEqual(b[index][key]);
   expect(a[index].checkpoint.pianoPresence).toEqual(b[index].checkpoint.pianoPresence);
  }
  expect(advanceRollingBacking(two, JSON.parse(JSON.stringify(a[11].checkpoint)))).toEqual(a[12]);
 });
 it('rejects rehashed contradictory actual-piano receipts and ignores future observations', () => {
  const { make } = fixture('swing', 'blues'), score = make(true), bars = run(score);
  const index = bars.findIndex(bar => bar.compEvents.length > 0 && bar.fromBar > 3);
  const checkpoint = bars[index].checkpoint;
  for (const change of [{ silentBars: 1 }, { lastSoundingEndTick: null }, { lastSoundingEndTick: 1 }, { extra: 1 }]) {
   const forged = JSON.parse(JSON.stringify(checkpoint)); Object.assign(forged.pianoPresence, change);
   const { checkpointId: _, ...contents } = forged;
   forged.checkpointId = `${forged.sessionId}:${forged.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}`;
   expect(() => advanceRollingBacking(score, forged)).toThrow('Invalid rolling checkpoint');
  }
  const next = checkpoint.nextBar;
  const observation = { barIndex: next, observedAtBar: next, confidence: 1, noteDensity: 1, restBeats: 0, source: 'scripted' as const };
  const dense = advanceRollingBacking(score, checkpoint, [observation]);
  expect(dense.ensemblePlan.bars[0].piano.presence).toBeUndefined();
  if (dense.ensemblePlan.bars[0].boundaryStrength < .85) expect(dense.compEvents).toHaveLength(0);
  expect(advanceRollingBacking(score, checkpoint, [{ ...observation, barIndex: next + 1, observedAtBar: next + 1 }])).toEqual(bars[next]);
 });
 for (const style of styles) for (const tune of ['blues', 'aaba'] as const) for (const fast of [false, true]) {
  it(`${style} ${tune} ${fast ? 240 : 'natural'}: keeps native time, protected rests and JSON replay`, () => {
   const { make, tempo } = fixture(style, tune, fast), score = make(true), legacy = make();
   const bars = run(score), before = run(legacy);
   expect(score.fingerprint).not.toEqual(legacy.fingerprint);
   expect(bars.every(bar => bar.bassEvents.length > 0 && bar.drumEvents.length > 0)).toBe(true);
   for (const bar of bars) {
    const plan = bar.ensemblePlan.bars[0];
    expect(bar.compEvents.length).toBeLessThanOrEqual(plan.piano.maxAttacks);
    for (const event of bar.compEvents) {
     expect(event.duration).toBeGreaterThan(0);
     expect(parseInt(event.time) + event.duration * tempo / 60 * score.ppq).toBeLessThanOrEqual(bar.committedThroughTick + .00001);
    }
    if (plan.piano.silenceReason || plan.responseOwner === 'bass' || plan.responseOwner === 'drums') expect(bar.compEvents).toHaveLength(0);
   }
   const middle = Math.floor(bars.length / 2);
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(bars[middle].checkpoint)))).toEqual(bars[middle + 1]);
   expect(() => advanceRollingBacking(legacy, bars[middle].checkpoint)).toThrow('Invalid rolling checkpoint');
   expect(measure(bars, tempo).soundingBars).toBeGreaterThanOrEqual(measure(before, tempo).soundingBars);
   expect(measure(bars, tempo).maxGap).toBeLessThanOrEqual(measure(before, tempo).maxGap);
   for (const bar of bars) {
    const trace = bar.ensembleDevelopment.pianoMotifs[0];
    if (trace.reason === 'phrase_reentry') {
     expect(trace.motifId).toBeNull();
     expect(COMP_FIGURES.find(figure => figure.id === trace.sourceFigureId)?.hits[0]).toEqual(trace.hits);
    }
    if (style === 'ballad') for (const event of bar.compEvents) expect([0, 2, 3.5]).toContain(event.absBeat % 4);
   }
   console.info('piano-presence', style, tune, tempo, JSON.stringify({ before: measure(before, tempo), after: measure(bars, tempo) }));
  });
 }
});
