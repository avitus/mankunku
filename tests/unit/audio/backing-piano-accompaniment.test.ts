import { describe, expect, it } from 'vitest';
import { COMP_FIGURES } from '$lib/audio/backing-comp-figures';
import { createHash } from 'node:crypto';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { HISTORICAL_MUSICALITY_STYLES as BACKING_STYLES } from '../../helpers/musicality-style-fixtures';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';
const styles = ['swing', 'straight', 'bossa-nova', 'ballad'] as const;
function fixture(style: typeof styles[number], tune: 'blues' | 'aaba', seed = 42, tempo = style === 'ballad' ? 80 : 140, swing = .67, hold = false) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const session = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const { phrase } = session;
 const params = { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(swing, BACKING_STYLES[style], tempo), sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}, ...(hold ? { terminalArrangement: { ending: 'hold-release' as const, melody: phrase.notes } } : {}) };
 const make = (pianoPresence: true | 'steady' | 'accompaniment' = 'accompaniment', loopCount = 1) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], params, { returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence, loopCount });
 return { session, tempo, make };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => { const bar = advanceRollingBacking(score, checkpoint); checkpoint = bar.checkpoint; return bar; });
}
function summarize(bars: ReturnType<typeof run>) {
 const silence: Record<string, number[]> = {};
 for (const b of bars) if (!b.compEvents.length) {
  const cause = b.ensemblePlan.bars[0].piano.silenceReason ?? (b.ensembleDevelopment.pianoFeedback?.[0].action === 'yield' ? 'drum_feedback' : b.ensembleDevelopment.pianoRecoveries?.[0].action === 'space' ? 'recovery' : b.ensembleDevelopment.pianoMotifs[0].reason ?? 'native_rest');
  (silence[cause] ??= []).push(b.fromBar);
 }
 return { attacks: bars.reduce((n,b) => n + b.compEvents.length, 0), sounding: bars.filter(b => b.compEvents.length).length, silence };
}
describe('reliable light piano accompaniment', () => {
 it('preserves previous steady receipts byte-for-byte', () => {
  const hashes = { swing: 'f6ec13cbb2f81e79b3f440590a7834e8032149a1af54850424acf7f1f2a546df', straight: 'a9301aabfbbf2ff03a06ba81d34dffbf0164d44ad3bc75d1b00b10f76d774907', 'bossa-nova': '70bb7488a50b3cc555a3c9a806e42558fbd6483924305643812a38377b5c3727', ballad: '6a32cbe1a1dfee93c33bb092b47bd23eb3cf375ef5a85c3c8580bd4e7c851ba0' };
  for (const style of styles) expect(createHash('sha256').update(JSON.stringify(run(fixture(style, 'blues').make('steady')))).digest('hex')).toBe(hashes[style]);
 });
 for (const style of styles) it(`preserves exact browser 240/.62 protected breaths, dense evidence and terminal: ${style}`, () => {
  const { make, session } = fixture(style, style === 'swing' ? 'aaba' : 'blues', 42, 240, .62, style === 'ballad');
  const score = make(), bars = run(score), headReturn = session.headBars + session.chorusBars * 2;
  for (const offset of [1,2]) {
   expect(bars[headReturn + offset].compEvents).toHaveLength(0);
   expect(bars[headReturn + offset].ensemblePlan.bars[0].piano.silenceReason).toBe('returning_melody');
  }
  expect(bars[headReturn + 3].compEvents.length).toBeGreaterThan(0);
  if (style === 'ballad') expect(bars.at(-1)!.ensembleDevelopment.terminalArrangements?.[0].status).toBe('accepted');
  const checkpoint = bars[19].checkpoint, next = checkpoint.nextBar;
  const observation = { barIndex: next, observedAtBar: next, confidence: 1, noteDensity: 1, restBeats: 0, source: 'scripted' as const };
  const dense = advanceRollingBacking(score, checkpoint, [observation]);
  expect(dense.ensemblePlan.bars[0].piano.harmonicSupport).toBeUndefined();
  if (dense.ensemblePlan.bars[0].boundaryStrength < .85) expect(dense.compEvents).toHaveLength(0);
  expect(advanceRollingBacking(score, checkpoint, [{ ...observation, barIndex: next + 1, observedAtBar: next + 1 }])).toEqual(bars[next]);
 });
 it('retains explicit sparse contrasts while ordinary harmonic support resumes after them', () => {
  let contrasts = 0, quietTails = 0;
  for (const seed of [7,19,42,83,101,127,199,211]) {
   const bars = run(fixture('swing', 'aaba', seed).make());
   for (const b of bars.filter(b => b.fromBar === b.ensemblePlan.bars[0].phraseStartBar && b.ensemblePlan.bars[0].piano.texture === 'sparse')) {
    contrasts++;
    const phrase = bars.slice(b.fromBar, b.fromBar + 4);
    expect(phrase.every(b => !b.ensemblePlan.bars[0].piano.harmonicSupport)).toBe(true);
    if (phrase.slice(2).every(b => !b.compEvents.length)) quietTails++;
    expect(bars[b.fromBar + 4].ensemblePlan.bars[0].piano.texture).toBe('steady');
    expect(bars.slice(b.fromBar + 4, b.fromBar + 8).some(b => b.compEvents.length)).toBe(true);
   }
  }
  expect(contrasts).toBeGreaterThan(2); expect(quietTails).toBeGreaterThan(2);
 });
 it('preserves causal loop prefixes and JSON replay at the wrap', () => {
  const { make } = fixture('swing', 'blues'), two = make('accompaniment', 2), three = make('accompaniment', 3), a = run(two), b = run(three);
  for (let index = 0; index < 52; index++) for (const key of ['bassEvents','compEvents','drumEvents','ensemblePlan','ensembleDevelopment'] as const) expect(a[index][key]).toEqual(b[index][key]);
  expect(advanceRollingBacking(two, JSON.parse(JSON.stringify(a[51].checkpoint)))).toEqual(a[52]);
 });
 for (const style of styles) for (const tune of ['blues', 'aaba'] as const) it(`${style} ${tune}: ordinary support reliably continues across complete tunes`, () => {
  let underResponses = 0;
  for (const seed of [7,19,42,83]) {
   const { make } = fixture(style, tune, seed), score = make(), bars = run(score);
   const ordinary = bars.filter(b => b.ensemblePlan.bars[0].piano.harmonicSupport);
   expect(ordinary.length).toBeGreaterThan(score.totalBars * .7);
   expect(ordinary.filter(b => b.compEvents.length).length / ordinary.length).toBeGreaterThan(.9);
   for (let index = 0; index < bars.length; index++) {
    const b = bars[index], p = b.ensemblePlan.bars[0];
    const motif = b.ensembleDevelopment.pianoMotifs[0];
    if (motif.reason === 'harmonic_support') {
     expect(motif.motifId).toBeNull();
     expect(COMP_FIGURES.find(figure => figure.id === motif.sourceFigureId)?.hits[0]).toEqual(motif.hits);
    }
    if (b.ensembleDevelopment.pianoFeedback?.[0].action === 'yield' && p.piano.harmonicSupport) {
     expect(b.ensembleDevelopment.pianoFeedback[0].effectiveMaxAttacks).toBe(1);
     expect(b.compEvents).toHaveLength(1); expect(b.compEvents[0].notes).toHaveLength(2);
    }

    if (p.piano.harmonicSupport && bars[index - 1]?.ensemblePlan.bars[0].piano.harmonicSupport) expect(b.compEvents.length || bars[index - 1].compEvents.length).toBeGreaterThan(0);
    if (p.piano.harmonicSupport === 'under_response' || p.piano.harmonicSupport === 'after_response') {
     if (b.fromBar === p.phraseStartBar) expect(b.checkpoint.piano.motif?.sourceId).toBeNull();
     underResponses++; expect(b.compEvents).toHaveLength(1); expect(b.compEvents[0].notes).toHaveLength(2); expect(b.compEvents[0].velocity).toBeLessThan(70); expect(p.piano.role).toBe('support');
     expect(b.ensembleDevelopment.pianoAnswers).toBeUndefined();
    }
    if (p.piano.silenceReason === 'returning_melody') expect(b.compEvents).toHaveLength(0);
    expect(b.bassEvents.length).toBeGreaterThan(0); expect(b.drumEvents.length).toBeGreaterThan(0);
    expect(b.compEvents.length).toBeLessThanOrEqual(p.piano.maxAttacks);
   }
   const middle = Math.floor(bars.length / 2);
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(bars[middle].checkpoint)))).toEqual(bars[middle + 1]);
   expect(() => advanceRollingBacking(make('steady'), bars[middle].checkpoint)).toThrow();
   console.info('accompaniment-after', style, tune, seed, JSON.stringify(summarize(bars)));
  }
  expect(underResponses).toBeGreaterThan(0);
 });
});
