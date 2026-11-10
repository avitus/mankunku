import { describe, expect, it } from 'vitest';
import { proposeKeyboardSuspension } from '$lib/audio/backing-keyboard-suspension';

const chord = { root: 'F' as const, quality: '7' as const };
const input = { chord, notes: [55, 57, 62, 63], resolutionNotes: [55, 57, 62, 63], family: 'rootless-b' as const };

describe('complete 4–3 keyboard suspension cells', () => {
 it('moves only an inner third up a semitone, retaining the outer voices and an exact resolution', () => {
  const result = proposeKeyboardSuspension(input)!;
  expect(result.suspendedNotes).toEqual([55, 58, 62, 63]);
  expect(result.resolutionNotes).toEqual(input.notes);
  expect(result.fromMidi).toBe(58); expect(result.toMidi).toBe(57);
  expect(input.notes).toEqual([55,57,62,63]);
 });
 it.each(['maj7','min7','7b9','sus4'] as const)('does not impose an unagreed suspension on %s', quality => {
  expect(proposeKeyboardSuspension({...input,chord:{...chord,quality}})).toBeUndefined();
 });
 it.each(['guide','quartal','shell','drop2'] as const)('keeps the native %s family', family => {
  expect(proposeKeyboardSuspension({...input,family})).toBeUndefined();
 });
 it('rejects changed resolution voicings, duplicate thirds and newly crowded voices', () => {
  expect(proposeKeyboardSuspension({...input,resolutionNotes:[55,57,60,63]})).toBeUndefined();
  for(const notes of [[51,55,57],[55,57,58,63],[55,57,59,63],[55,57,63,69]])
   expect(proposeKeyboardSuspension({...input,notes,resolutionNotes:notes})).toBeUndefined();
 });
 it('supports transposition without leaving the keyboard register', () => {
  expect(proposeKeyboardSuspension({...input,chord:{root:'C',quality:'7'},notes:[62,64,69,70],resolutionNotes:[62,64,69,70]})?.suspendedNotes).toEqual([62,65,69,70]);
 });
});
