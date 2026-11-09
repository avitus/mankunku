import { describe, expect, it } from 'vitest';
import { COMP_FIGURES } from '$lib/audio/backing-comp-figures';
import { createHash } from 'node:crypto';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
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
 const make = (pianoPresence: true | 'steady' = 'steady', loopCount = 1) => createRollingBacking(phrase.harmony!, BACKING_STYLES[style], params, { returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence, loopCount });
 return { session, tempo, make };
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => { const bar = advanceRollingBacking(score, checkpoint); checkpoint = bar.checkpoint; return bar; });
}
function metrics(bars: ReturnType<typeof run>, tempo: number) {
 let gap = 0, maxGap = 0, end = 0, soundingTicks = 0;
 for (const bar of bars) {
  gap = bar.compEvents.length ? 0 : gap + 1; maxGap = Math.max(gap, maxGap);
  for (const event of bar.compEvents) { const start = parseInt(event.time), release = start + event.duration * tempo / 60 * 192; soundingTicks += Math.max(0, release - Math.max(start, end)); end = Math.max(end, release); }
 }
 return { bars: bars.length, attacks: bars.reduce((n, b) => n + b.compEvents.length, 0), sounding: bars.filter(b => b.compEvents.length).length, twoHit: bars.filter(b => b.compEvents.length === 2).length, soundingBeats: +(soundingTicks / 192).toFixed(2), maxGap };
}
const digest = (bars: ReturnType<typeof run>) => createHash('sha256').update(JSON.stringify(bars)).digest('hex');
describe('steady light piano with phrase contrasts', () => {
 it('keeps the archived v1 receipts and events byte-identical', () => {
  const expected = {
   swing: 'd308b81c1c2bb0e04e504ec6b85a7fd054b1fd94b2d47a155c6662abcd3f9dcf',
   straight: '0914459179eb5bc9ec73e8b198d32a4219e3821d0d70c074ddd396bfbd1043e6',
   'bossa-nova': '6f190508d7a5a974d7c919d183d4f3a708e6b8b2fafd8bd58f06cdff76fdb506',
   ballad: '01208776b8db2c41dc22b32eb9d246e572541155b0a6ad22a144ade76b4741b0'
  };
  for (const style of styles) expect(digest(run(fixture(style, 'blues').make(true)))).toBe(expected[style]);
 });
 for (const style of styles) it(`keeps exact 240 BPM browser breaths, reentry and terminal: ${style}`, () => {
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
  expect(dense.ensemblePlan.bars[0].piano.presence).toBeUndefined();
  if (dense.ensemblePlan.bars[0].boundaryStrength < .85) expect(dense.compEvents).toHaveLength(0);
  expect(advanceRollingBacking(score, checkpoint, [{ ...observation, barIndex: next + 1, observedAtBar: next + 1 }])).toEqual(bars[next]);
 });
 it('retains occasional non-adjacent sparse solo phrases with quiet tails and later support', () => {
  let phrases = 0, contrasts = 0, quietTails = 0;
  const positions = new Set<string>();
  for (const seed of [7,19,42,83,101,127,199,211]) {
   const bars = run(fixture('swing', 'aaba', seed).make());
   const starts = bars.filter(b => b.fromBar === b.ensemblePlan.bars[0].phraseStartBar);
   const selected: number[] = [];
   for (const start of starts) {
    const plan = start.ensemblePlan.bars[0]; phrases++;
    if (plan.piano.texture !== 'sparse') continue;
    contrasts++; selected.push(start.fromBar);
    const phrase = bars.slice(start.fromBar, start.fromBar + 4);
    expect(phrase.every(b => b.ensemblePlan.bars[0].piano.texture === 'sparse')).toBe(true);
    if (phrase.slice(2).every(b => !b.compEvents.length)) quietTails++;
    expect(bars[start.fromBar + 4].ensemblePlan.bars[0].piano.texture).toBe('steady');
    expect(bars.slice(start.fromBar + 4, start.fromBar + 8).some(b => b.compEvents.length)).toBe(true);
   }
   positions.add(selected.join(','));
  }
  expect(contrasts).toBeGreaterThan(2); expect(contrasts / phrases).toBeLessThan(.2);
  expect(quietTails).toBeGreaterThan(2); expect(positions.size).toBeGreaterThan(2);
 });
 it('keeps the full accepted prefix across loop extension and replays the seam', () => {
  const { make } = fixture('swing', 'blues'), two = make('steady', 2), three = make('steady', 3);
  const a = run(two), b = run(three);
  for (let index = 0; index < 52; index++) for (const key of ['bassEvents','compEvents','drumEvents','ensemblePlan','ensembleDevelopment'] as const) expect(a[index][key]).toEqual(b[index][key]);
  expect(advanceRollingBacking(two, JSON.parse(JSON.stringify(a[51].checkpoint)))).toEqual(a[52]);
 });
 for (const style of styles) for (const tune of ['blues', 'aaba'] as const) it(`${style} ${tune}: sustains ordinary support across varied complete performances`, () => {
  let total = 0, attacks = 0, sounding = 0, twoHit = 0, occupied = 0;
  const shapes = new Set<string>();
  for (const seed of [7, 19, 42, 83]) {
   const { make, tempo } = fixture(style, tune, seed), score = make(), bars = run(score), before = run(make(true));
   const m = metrics(bars, tempo); total += m.bars; attacks += m.attacks; sounding += m.sounding; twoHit += m.twoHit; occupied += m.soundingBeats;
   shapes.add(bars.map(b => b.compEvents.length).join(','));
   expect(m.sounding / m.bars).toBeGreaterThan(.55);
   for (const bar of bars) {
    const plan = bar.ensemblePlan.bars[0];
    const trace = bar.ensembleDevelopment.pianoMotifs[0];
    if (trace.reason === 'gesture_refit' || trace.reason === 'phrase_reentry') {
     expect(trace.motifId).toBeNull();
     expect(COMP_FIGURES.find(figure => figure.id === trace.sourceFigureId)?.hits[0]).toEqual(trace.hits);
    }
    expect(bar.bassEvents.length).toBeGreaterThan(0); expect(bar.drumEvents.length).toBeGreaterThan(0);
    expect(bar.compEvents.length).toBeLessThanOrEqual(plan.piano.maxAttacks);
    if (plan.piano.silenceReason || ['bass', 'drums'].includes(plan.responseOwner)) expect(bar.compEvents).toHaveLength(0);
   }
   const middle = Math.floor(bars.length / 2);
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(bars[middle].checkpoint)))).toEqual(bars[middle + 1]);
   expect(() => advanceRollingBacking(make(true), bars[middle].checkpoint)).toThrow();
   console.info('steady-witness', style, tune, seed, tempo, JSON.stringify({ before: metrics(before, tempo), after: m }));
  }
  expect(shapes.size).toBeGreaterThan(1);
  expect(sounding / total).toBeGreaterThan(.65);
  if (style === 'ballad') expect(occupied / (total * 4)).toBeGreaterThan(.5);
  else { expect(attacks / total).toBeGreaterThan(.9); expect(twoHit / total).toBeGreaterThan(.2); }
 });
});
