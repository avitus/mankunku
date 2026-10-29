import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateForBounce, type BounceParams } from '$lib/audio/backing-bounce';
import * as generation from '$lib/audio/backing-generation';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession, HISTORICAL_LISTENING_TUNES as LISTENING_TUNES } from '../../helpers/musicality-tune-fixtures';

const input = (): BounceParams => ({
 phrase: buildListeningTuneSession({ tuneId: LISTENING_TUNES.find(tune => tune.title === 'Mankunku Blues')!.id, key: 'C', soloChoruses: 2 }).phrase,
 style: 'swing', tempo: 140, swing: .67, instrument: 'piano', volume: .6,
 mix: { ...DEFAULT_BACKING_MIX }, orchestration: 'coordinated'
});
afterEach(() => vi.restoreAllMocks());

describe('explicit listening ending at the fixed bounce boundary', () => {
 it.each(['swing', 'ballad', 'bossa-nova'].flatMap(style => ['unknown', 'late-attack'].map(kind => [style, kind])))('rejects %s %s closing melody before generating a silently continuing bounce', (style, kind) => {
  const generate = vi.spyOn(generation, 'generateBacking');
  const params = { ...input(), style, ending: 'hold-release' } as BounceParams;
  if (kind === 'unknown') params.phrase.notes = undefined as unknown as typeof params.phrase.notes;
  else params.phrase.notes[params.phrase.notes.length - 1] = { pitch: 60, offset: [207, 4], duration: [1, 4] };
  expect(() => generateForBounce(params)).toThrow(/melody/i);
  expect(generate).not.toHaveBeenCalled();
 });
 it('rejects an unavailable Bossa closing harmony before fixed generation', () => {
  const generate = vi.spyOn(generation, 'generateBacking');
  const params = { ...input(), style: 'bossa-nova', ending: 'hold-release' } as BounceParams;
  params.phrase.harmony.at(-1)!.duration = [1, 2];
  expect(() => generateForBounce(params)).toThrow(/harmony/i);
  expect(generate).not.toHaveBeenCalled();
 });
 it('admits explicitly known instrumental silence rather than treating it as missing melody', () => {
  const params = { ...input(), ending: 'hold-release' } as BounceParams; params.phrase.notes = [];
  expect(generateForBounce(params).ensembleDevelopment?.terminalArrangements?.[0]?.status).toBe('accepted');
 });
 it.each(['swing', 'straight', 'ballad', 'bossa-nova'] as const)('forwards the declared %s hold with actual score melody', style => {
  const generate = vi.spyOn(generation, 'generateBacking');
  const params = { ...input(), style, ending: 'hold-release' } as BounceParams;
  generateForBounce(params);
  expect(generate.mock.calls.at(-1)?.[2]).toMatchObject({ terminalArrangement: { ending: 'hold-release', melody: params.phrase.notes } });
 });
 it.each([
  { ending: undefined }, { ending: 'continue' },
  { ending: 'hold-release', orchestration: 'original' },
  { style: 'bossa-nova' }, { ending: 'continue', style: 'bossa-nova' }
 ])('keeps unsupported/default intent outside generation: %j', overrides => {
  const generate = vi.spyOn(generation, 'generateBacking');
  generateForBounce({ ...input(), ...overrides } as BounceParams);
  expect(generate.mock.calls.at(-1)?.[2]).not.toHaveProperty('terminalArrangement');
 });
});
