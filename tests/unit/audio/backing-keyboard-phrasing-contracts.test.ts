import { describe, expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { realizeRollingBalladReply } from '$lib/audio/backing-rolling-piano';
import { restoreEnsembleTiming } from '$lib/audio/ensemble-timing';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';

const styles = ['swing', 'straight', 'bossa-nova', 'ballad'] as const;
const instruments = ['piano', 'organ'] as const;
type Style = typeof styles[number];
type Instrument = typeof instruments[number];
function fixture(style: Style, tune: 'blues' | 'aaba') {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const { phrase } = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const tempo = style === 'ballad' ? 80 : 140;
 return (keyboardPhrasing?: Instrument, loopCount = 1, hold = false) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {},
  ...(hold ? { terminalArrangement: { ending: 'hold-release' as const, melody: phrase.notes } } : {})
 }, { keyboardTexture: true, keyboardVariety: 'developed', chorusBoundaryPriority: true, pianoPresence: 'accompaniment',
  returningMelodySpace: true, performanceEnergySeed: 42, loopCount, ...(keyboardPhrasing ? { keyboardPhrasing } : {}) });
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint; return result;
 });
}
type Bar = ReturnType<typeof advanceRollingBacking>;
const musical = (bar: Bar) => [bar.bassEvents, bar.compEvents, bar.drumEvents, bar.ensemblePlan, bar.ensembleDevelopment];
function expectProtected(bar: Bar) {
 for (const voicing of bar.ensembleDevelopment.pianoVoicings ?? []) {
  expect(voicing.decision.keyboardArticulation).toBeUndefined();
  expect(voicing.decision.keyboardLine).toBeUndefined();
 }
}

describe('connected keyboard phrasing scheduling and interaction contracts', () => {
 for (const style of styles) for (const tune of ['blues', 'aaba'] as const) for (const instrument of instruments) {
  it(`${style}/${tune}/${instrument}: JSON replay restores complete performed history and rejects incompatible keyboard policies`, () => {
   const make = fixture(style, tune), score = make(instrument), bars = run(score);
   const other = make(instrument === 'piano' ? 'organ' : 'piano'), old = make();
   // Include each formal seam, interior phrase progress and the final gate.
   const positions = new Set([1, 5, 19, bars.length - 1, ...score.bars.flatMap((bar, index) =>
    index > 0 && (bar.isChorusFirstBar || bar.isSectionFirstBar) ? [index] : [])]);
   for (const index of positions) {
    const saved = JSON.parse(JSON.stringify(bars[index - 1].checkpoint));
    expect(advanceRollingBacking(score, saved)).toEqual(bars[index]);
    expect(() => advanceRollingBacking(other, saved)).toThrow();
    expect(() => advanceRollingBacking(old, saved)).toThrow();
   }
   const previous = run(old)[5].checkpoint;
   expect(() => advanceRollingBacking(score, previous)).toThrow();
  });
  it(`${style}/${tune}/${instrument}: future solo evidence cannot change accepted music and current density takes priority over keyboard development`, () => {
   const score = fixture(style, tune)(instrument), bars = run(score);
   const index = bars.findIndex((bar, i) => i > 0 && bar.ensemblePlan.bars[0].boundaryStrength < .85 &&
    bar.ensembleDevelopment.pianoVoicings?.some(voicing => voicing.decision.keyboardLine));
   expect(index).toBeGreaterThan(0);
   const checkpoint = JSON.parse(JSON.stringify(bars[index - 1].checkpoint));
   const future = { barIndex: index + 1, observedAtBar: index + 1, source: 'scripted' as const, confidence: 1, noteDensity: 1, restBeats: 0 };
   expect(advanceRollingBacking(score, checkpoint, [future])).toEqual(bars[index]);
   const dense = advanceRollingBacking(score, checkpoint, [{ ...future, barIndex: index, observedAtBar: index }]);
   expect(dense.ensemblePlan.bars[0].piano.harmonicSupport).toBeUndefined();
   expect(dense.compEvents).toHaveLength(0);
   expectProtected(dense);
   expect(checkpoint).toEqual(bars[index - 1].checkpoint);
  });
 }
 for (const style of styles) for (const instrument of instruments) {
  it(`${style}/${instrument}: adding a later loop preserves the first complete performed loop and its replay seam`, () => {
   const make = fixture(style, 'blues'), two = make(instrument, 2), three = make(instrument, 3);
   const a = run(two), b = run(three), seam = two.sourceBars;
   expect(a.slice(0, seam).map(musical)).toEqual(b.slice(0, seam).map(musical));
   expect(advanceRollingBacking(two, JSON.parse(JSON.stringify(a[seam - 1].checkpoint)))).toEqual(a[seam]);
  });
  it(`${style}/${instrument}: hold-and-release retains a bounded shared ending without keyboard embellishment`, () => {
   const make = fixture(style, 'blues'), score = make(instrument, 1, true), bars = run(score);
   expect(score.terminalArrangement).toBeDefined();
   const reservation = score.terminalArrangement!, terminal = bars[reservation.barIndex];
   expect(terminal.compEvents).toHaveLength(1);
   expect(terminal.bassEvents).toHaveLength(1);
   expect(terminal.ensembleDevelopment.pianoMotifs[0].reason).toBe('terminal_arrangement');
   expectProtected(terminal);
   const event = terminal.compEvents[0];
   expect(event.absBeat).toBe(reservation.absBeat);
   expect(Number(event.time.slice(0, -1)) / score.ppq + event.duration * score.tempo / 60).toBeLessThanOrEqual(reservation.releaseBeat + 1e-8);
   expect(event.duration).toBeCloseTo(reservation.holdBeats * 60 / score.tempo, 9);
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(bars[reservation.barIndex - 1].checkpoint)))).toEqual(terminal);
  });
 }
 it('keeps shared arrivals and quiet background support free of articulation and line overlays', () => {
  const witnessed = new Set<string>();
  for (const style of styles) for (const tune of ['blues', 'aaba'] as const) for (const instrument of instruments) {
   for (const bar of run(fixture(style, tune)(instrument))) {
    const plan = bar.ensemblePlan.bars[0], reason = bar.ensembleDevelopment.pianoMotifs[0].reason;
    const protection = reason === 'shared_arrival' ? 'arrival' : ['drum_reply', 'native_drum_reply'].includes(reason ?? '') ? 'reply' :
     plan.piano.harmonicSupport && plan.piano.harmonicSupport !== 'ordinary' ? 'background' : undefined;
    if (!protection || !bar.compEvents.length) continue;
    witnessed.add(protection); expectProtected(bar);
   }
  }
  expect(witnessed.has('arrival')).toBe(true);
  expect(witnessed.has('background')).toBe(true);
 });
 for (const instrument of instruments) it(`${instrument}: a native Ballad reply candidate keeps its measured late pad free of ordinary articulation and line overlays`, () => {
  const score = fixture('ballad', 'aaba')(instrument), bars = run(score);
  // The tune need not supply a preceding independent drum color. Exercise the actual
  // recipient transaction on an existing ordinary whole pad; source admission has its own tests.
  const index = bars.findIndex((bar, i) => i > 0 && bar.ensembleDevelopment.pianoMotifs[0].reason === 'native_pattern' &&
   bar.ensembleDevelopment.pianoMotifs[0].hits.length === 1 && bar.ensembleDevelopment.pianoMotifs[0].hits[0].d === 3.6 &&
   bar.ensembleDevelopment.pianoVoicings?.some(voicing => voicing.decision.keyboardArticulation));
  expect(index).toBeGreaterThan(0);
  const bar = bars[index], plan = bar.ensemblePlan.bars[0];
  const timing = restoreEnsembleTiming({ phraseId: score.phraseId, tempo: score.tempo, ppq: score.ppq, swing: score.swing,
   timingProfiles: score.timingProfiles, trace: [bar.checkpoint.timing] });
  const reply = realizeRollingBalladReply(score, index, { ...score.bars[index], ensemble: plan, intensity: plan.energy }, timing, bars[index - 1].checkpoint.piano);
  expect(reply.trace.reason).toBe('native_drum_reply');
  expect(reply.events).toHaveLength(1);
  expect(reply.events[0].absBeat).toBe(index * 4 + 2);
  expect(reply.events[0].duration).toBeCloseTo(1.8 * 60 / score.tempo, 9);
  expect(reply.events[0].velocity).toBe(bar.compEvents[0].velocity - 2);
  expect(reply.voicingTrace).toHaveLength(1);
  expect(reply.voicingTrace![0].decision.keyboardArticulation).toBeUndefined();
  expect(reply.voicingTrace![0].decision.keyboardLine).toBeUndefined();
 });
});
