import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { buildNativeBluesFixture } from '../../fixtures/musicality-native-blues';
import { seedFrom } from '$lib/audio/generation-rng';

const styles = ['swing', 'straight', 'bossa-nova', 'ballad'] as const;
function make(style: typeof styles[number], loops = 1, hold = false) {
 const phrase = buildNativeBluesFixture(), tempo = style === 'ballad' ? 80 : 140;
 return createRollingBacking(phrase.harmony, BACKING_STYLES[style], { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4,
  swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo), sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {},
  // This fixture is chart-only: an empty melody explicitly admits its instrumental ending.
  ...(hold ? { terminalArrangement: { ending: 'hold-release' as const, melody: [] } } : {}) },
 { returningMelodySpace: true, performanceEnergySeed: 42, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
  chorusBoundaryPriority: true, keyboardTexture: true, keyboardPhrasing: 'piano', bassDelayedRoot: true,
  keyboardContraryMotion: true, drumPhraseCushioning: true, loopCount: loops });
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
afterEach(() => vi.restoreAllMocks());

describe('exact owned rolling checkpoint reuse', () => {
 for (const style of styles) it(`${style}: reuses only the produced frozen checkpoint without its prior-state rehash or JSON clone`, () => {
  const score = make(style), first = advanceRollingBacking(score), serialized = JSON.stringify(first.checkpoint);
  const parse = vi.spyOn(JSON, 'parse'), stringify = vi.spyOn(JSON, 'stringify');
  const next = advanceRollingBacking(score, first.checkpoint);
  expect(parse.mock.calls.filter(([text]) => text === serialized)).toHaveLength(0);
  expect(stringify.mock.calls.filter(([value]) => value && typeof value === 'object' && 'nextBar' in value &&
   value.nextBar === first.checkpoint.nextBar && 'fingerprint' in value && value.fingerprint === score.fingerprint)).toHaveLength(0);
  expect(next.previousCheckpointId).toBe(first.checkpoint.checkpointId);
  expect(Object.isFrozen(first.checkpoint)).toBe(true);
  expect(Object.isFrozen(first.checkpoint.piano.lastVoicing)).toBe(true);
  expect(() => (first.checkpoint.piano.lastVoicing as number[]).push(99)).toThrow();
 });
 it('keeps restored and shallow-frozen checkpoint inputs on the validating/cloning path', () => {
  const score = make('swing'), first = advanceRollingBacking(score), expected = advanceRollingBacking(score, first.checkpoint);
  for (const supplied of [clone(first.checkpoint), Object.freeze(clone(first.checkpoint)), Object.freeze({ ...first.checkpoint })]) {
   const serialized = JSON.stringify(supplied), parse = vi.spyOn(JSON, 'parse');
   expect(advanceRollingBacking(score, supplied)).toEqual(expected);
   expect(parse.mock.calls.filter(([text]) => text === serialized)).toHaveLength(1);
   parse.mockRestore();
  }
 });
 it('binds ownership to the exact factory definition, not an equal fingerprint or a cloned definition', () => {
  const score = make('bossa-nova'), first = advanceRollingBacking(score), expected = advanceRollingBacking(score, first.checkpoint);
  for (const other of [make('bossa-nova'), clone(score), Object.freeze(clone(score))]) {
   expect(other.fingerprint).toBe(score.fingerprint);
   const serialized = JSON.stringify(first.checkpoint), parse = vi.spyOn(JSON, 'parse');
   expect(advanceRollingBacking(other, first.checkpoint)).toEqual(expected);
   expect(parse.mock.calls.filter(([text]) => text === serialized)).toHaveLength(1);
   parse.mockRestore();
  }
  expect(() => advanceRollingBacking(make('swing'), first.checkpoint)).toThrow('Invalid rolling checkpoint');
 });
 it('does not freeze or retain editable restored history inside subsequent evidence', () => {
  const score = make('swing'), first = advanceRollingBacking(score), external = clone(first.checkpoint);
  const next = advanceRollingBacking(score, external), saved = clone(next);
  expect(Object.isFrozen(external.piano.lastVoicing)).toBe(false);
  (external.piano.lastVoicing as number[]).push(99);
  (external.bass as { previousMidi: number | null }).previousMidi = 70;
  expect(next).toEqual(saved);
  expect(first.checkpoint.piano.lastVoicing).not.toContain(99);
 });
 for (const shallow of [false, true]) it(`never trusts a produced checkpoint under an external ${shallow ? 'shallow-frozen' : 'mutable'} definition`, () => {
  const external = clone(make('swing'));
  if (shallow) Object.freeze(external);
  const first = advanceRollingBacking(external), serialized = JSON.stringify(first.checkpoint), parse = vi.spyOn(JSON, 'parse');
  advanceRollingBacking(external, first.checkpoint);
  expect(parse.mock.calls.filter(([text]) => text === serialized)).toHaveLength(1);
  parse.mockRestore();
  const index = first.checkpoint.piano.segmentIndex;
  expect(index).not.toBeNull();
  (external.harmony[index!].chord as { root: string }).root = external.harmony[index!].chord.root === 'C' ? 'D' : 'C';
  expect(() => advanceRollingBacking(external, first.checkpoint)).toThrow('Invalid rolling checkpoint');
 });
 it('rejects forged frozen copies even when their checksum is recomputed', () => {
  const score = make('swing'), first = advanceRollingBacking(score), bad = clone(first.checkpoint);
  (bad.bass as { previousMidi: number }).previousMidi = 70;
  const { checkpointId: _id, ...contents } = bad;
  const forged = Object.freeze({ ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` });
  expect(() => advanceRollingBacking(score, forged)).toThrow('Invalid rolling checkpoint');
 });
 for (const style of styles) it(`${style}: matches restored replay across two loops, changing observations and the held ending without mutating trusted history`, () => {
  const score = make(style, 2, true);
  expect(score.terminalArrangement).toBeDefined();
  let checkpoint: RollingBackingCheckpoint | undefined;
  for (let bar = 0; bar < score.totalBars; bar++) {
   const before = checkpoint && JSON.stringify(checkpoint);
   const observations = bar % 7 === 2 ? [{ barIndex: bar, observedAtBar: bar - 1, source: 'microphone' as const, confidence: .95,
    noteDensity: bar % 3 ? 1 : 0, restBeats: bar % 3 ? 0 : 4, phraseEnded: bar % 3 === 0 }] : [];
   const direct = advanceRollingBacking(score, checkpoint, observations);
   const restored = advanceRollingBacking(score, checkpoint && clone(checkpoint), observations);
   expect(direct).toEqual(restored);
   if (bar === score.terminalArrangement!.barIndex) {
    expect(direct.ensembleDevelopment.terminalArrangements?.[0].status).toBe('accepted');
    expect(direct.ensembleDevelopment.pianoMotifs[0].reason).toBe('terminal_arrangement');
   }
   if (checkpoint) expect(JSON.stringify(checkpoint)).toBe(before);
   checkpoint = direct.checkpoint;
  }
  expect(() => advanceRollingBacking(score, checkpoint)).toThrow('Rolling performance is complete');
 });
});
