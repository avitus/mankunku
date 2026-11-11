import { describe, expect, it } from 'vitest';
import { proposeKeyboardResolutionColors } from '$lib/audio/backing-keyboard-suspension';

const chord = { root: 'C' as const, quality: '7' as const };
const proposal = (notes: number[], family: 'shell'|'drop2'|'rootless-a'|'guide'|'quartal' = 'drop2') =>
 proposeKeyboardResolutionColors({ chord, notes, resolutionNotes: notes, family });

describe('native keyboard ninth and thirteenth resolution cells', () => {
 it('resolves an existing lower ninth to its root without changing the upper voice or defining third/seventh', () => {
  const [cell] = proposal([50, 52, 58], 'rootless-a');
  expect(cell).toMatchObject({ kind: '9-1', fromMidi: 50, toMidi: 48, suspendedNotes: [50,52,58], resolutionNotes: [48,52,58] });
  expect(Object.isFrozen(cell.suspendedNotes)).toBe(true);
 });
 it('resolves an existing lower thirteenth to the fifth and restores the exact original shape', () => {
  const cells = proposal([57,64,70,74], 'rootless-a');
  expect(cells).toEqual([expect.objectContaining({ kind: '13-5', fromMidi:57, toMidi:55, suspendedNotes:[57,64,70,74], resolutionNotes:[55,64,70,74] })]);
 });
 it('rejects a new semitone cluster, top-voice replacement, doubled target and missing defining harmony', () => {
  for(const notes of [[51,52,58,62],[52,58,62],[48,50,52,58],[50,55,58]]) expect(proposal(notes)).toEqual([]);
 });
 it('preserves unsupported harmony, guide/quartal texture and a changed second voicing', () => {
  for(const quality of ['min7','maj7','7b9','sus4'] as const)
   expect(proposeKeyboardResolutionColors({chord:{...chord,quality},family:'rootless-a',notes:[50,52,58],resolutionNotes:[50,52,58]})).toEqual([]);
  for(const family of ['guide','quartal'] as const) expect(proposal([50,52,58],family)).toEqual([]);
  expect(proposeKeyboardResolutionColors({chord,family:'shell',notes:[50,52,58],resolutionNotes:[50,52,59]})).toEqual([]);
 });
 it('transposes the admitted cell without moving another voice', () => {
  expect(proposeKeyboardResolutionColors({chord:{root:'F',quality:'7'},family:'shell',notes:[55,57,63],resolutionNotes:[55,57,63]})[0].resolutionNotes).toEqual([53,57,63]);
 });
});
