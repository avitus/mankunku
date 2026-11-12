import { describe, expect, it } from 'vitest';
import { planKeyboardLine } from '$lib/audio/backing-keyboard-line';
import { resolveCoordinatedVoicing } from '$lib/audio/coordinated-voicing';

const roots = ['C', 'D', 'F', 'G', 'Bb'] as const;
const qualities = ['7', 'maj7', 'min7'] as const;
const families = ['rootless-a', 'rootless-b', 'shell', 'drop2'] as const;

describe('bounded keyboard contrary motion', () => {
 it('adds actual opposite inner movement without disturbing the selected upper note or harmonic palette', () => {
  let changed = 0, retained = 0;
  for (const from of roots) for (const to of roots) for (const quality of qualities) for (const family of families) {
   const previous = resolveCoordinatedVoicing({ chord: {root: from, quality}, family, registerMidi: 62 }).memory;
   const input = { chord: {root: to, quality}, family, registerMidi: 62, previous };
   const ordinary = resolveCoordinatedVoicing(input);
   const actual = resolveCoordinatedVoicing({...input, keyboardContraryMotion: true});
   const trace = actual.decision.keyboardContraryMotion!;
   expect(trace).toBeDefined();
   expect(trace.previousNotes).toEqual(previous.notes);
   expect(trace.ordinaryNotes).toEqual(ordinary.notes);
   expect(trace.actualNotes).toEqual(actual.notes);
   expect(actual.notes.at(-1)).toBe(ordinary.notes.at(-1));
   expect(new Set(actual.notes.map(n => n % 12))).toEqual(new Set(ordinary.notes.map(n => n % 12)));
   if (trace.status === 'changed' || trace.status === 'retained') {
    const index = trace.voiceIndex!;
    expect(index).toBeGreaterThan(0); expect(index).toBeLessThan(actual.notes.length - 1);
    expect(trace.fromMidi).toBe(previous.notes[index]); expect(trace.toMidi).toBe(actual.notes[index]);
    expect((trace.toMidi! - trace.fromMidi!) * (trace.topToMidi! - trace.topFromMidi!)).toBeLessThan(0);
    expect(Math.abs(trace.toMidi! - trace.fromMidi!)).toBeLessThanOrEqual(5);
    expect(trace.guideDetour).toBeLessThanOrEqual(2); expect(trace.movementDetour).toBeLessThanOrEqual(4);
    if(trace.status === 'changed') { changed++; expect(actual.notes).not.toEqual(ordinary.notes); }
    else { retained++; expect(actual.notes).toEqual(ordinary.notes); }
   } else expect(actual.notes).toEqual(ordinary.notes);
  }
  expect(changed).toBeGreaterThan(0); expect(retained).toBeGreaterThan(0);
 });
 it('preserves guide/quartal identities and retains held upper notes', () => {
  for(const family of ['guide','quartal','rootless-a'] as const) {
   const chord = {root:'C' as const,quality:'7' as const};
   const previous = resolveCoordinatedVoicing({chord,family,registerMidi:62}).memory;
   const input = {chord,family,registerMidi:62,previous};
   const actual = resolveCoordinatedVoicing({...input,keyboardContraryMotion:true});
   expect(actual.notes).toEqual(resolveCoordinatedVoicing(input).notes);
   expect(actual.decision.keyboardContraryMotion?.status).toBe(family === 'rootless-a' ? 'unavailable' : 'family_ineligible');
  }
 });
});


describe('contrary motion with the existing line policy', () => {
 it('keeps accepted spacing and every existing line bound when the line policy also participates', () => {
  let checked = 0;
  for(const from of roots) for(const to of roots) for(const family of ['rootless-a','rootless-b'] as const) for(const spacing of ['compact','open'] as const) {
   const previous = resolveCoordinatedVoicing({chord:{root:from,quality:'7'},family,registerMidi:62}).memory;
   const line = planKeyboardLine({style:'swing',phraseId:'contrary-test',tempo:140,barIndex:2,phraseStartBar:0,attackIndex:0,seed:42,phase:'solo_build',previous});
   const input = {chord:{root:to,quality:'7' as const},family,registerMidi:62,previous,spacing,keyboardLine:line};
   const ordinary = resolveCoordinatedVoicing(input);
   const actual = resolveCoordinatedVoicing({...input,keyboardContraryMotion:true});
   expect(actual.decision.keyboardLine?.distance).toBe(ordinary.decision.keyboardLine?.distance);
   expect(actual.decision.keyboardLine?.status).toBe(ordinary.decision.keyboardLine?.status);
   if(actual.decision.keyboardLine?.status==='connected') {
    checked++;
    expect(actual.decision.keyboardLine.guideDetour).toBeLessThanOrEqual(2);
    expect(actual.decision.keyboardLine.movementDetour).toBeLessThanOrEqual(4);
   }
   expect(actual.decision.spacing?.applied).toBe(ordinary.decision.spacing?.applied);
   const span = actual.notes.at(-1)!-actual.notes[0];
   if(actual.decision.spacing?.applied==='compact') expect(span).toBeLessThanOrEqual(12);
   if(actual.decision.spacing?.applied==='open') expect(span).toBeGreaterThanOrEqual(14);
  }
  expect(checked).toBeGreaterThan(0);
 });
});
