import { describe, expect, it } from 'vitest';
import { articulateKeyboardHit } from '$lib/audio/backing-keyboard-articulation';
import type { BackingInstrument, BackingStyle } from '$lib/types/instruments';

const styles: BackingStyle[] = ['swing', 'straight', 'bossa-nova', 'ballad'];
const instruments: BackingInstrument[] = ['piano', 'organ'];
function hit(style: BackingStyle, instrument: BackingInstrument, durationBeats: number, availableBeats = 4) {
 return articulateKeyboardHit({ style, instrument, durationBeats, availableBeats, velocity: 67 });
}

describe('instrument-specific keyboard articulation', () => {
 for (const style of ['swing', 'straight'] as const) {
  it(`${style}: piano releases short answers clearly while organ sustains them without turning them into pads`, () => {
   const piano = hit(style, 'piano', .4), organ = hit(style, 'organ', .4);
   expect(piano.durationBeats).toBeLessThan(.4);
   expect(piano.durationBeats).toBeGreaterThanOrEqual(.32);
   expect(organ.durationBeats).toBeGreaterThan(.4);
   expect(organ.durationBeats).toBeLessThan(1);
   expect(hit(style, 'organ', .75).durationBeats).toBeLessThan(1);
   expect(piano.profile).not.toBe(organ.profile);
  });
  it(`${style}: held support remains supported, with audible short/held contrast on both instruments`, () => {
   for (const instrument of instruments) {
    const short = hit(style, instrument, .4), held = hit(style, instrument, 1.5);
    expect(held.durationBeats).toBeGreaterThanOrEqual(1.5);
    expect(held.durationBeats / short.durationBeats).toBeGreaterThan(2.5);
    expect(held.durationBeats).toBeLessThanOrEqual(1.8);
   }
  });
 }
 it('keeps Bossa cells short instead of importing swing articulation or making pads', () => {
  for (const instrument of instruments) for (const duration of [.63, .8, .99, 1.21]) {
   const result = hit('bossa-nova', instrument, duration);
   expect(result.durationBeats).toBeGreaterThanOrEqual(duration * .9);
   expect(result.durationBeats).toBeLessThanOrEqual(1.25);
  }
  expect(hit('bossa-nova', 'piano', .8).durationBeats).not.toBe(hit('swing', 'piano', .8).durationBeats);
  expect(hit('bossa-nova', 'organ', .8).durationBeats).not.toBe(hit('swing', 'organ', .8).durationBeats);
 });
 it('keeps Ballad support sustained while the organ breathes at the end of whole pads and keeps pickups short', () => {
  for (const instrument of instruments) {
   expect(hit('ballad', instrument, 1.8).durationBeats).toBeGreaterThanOrEqual(1.8);
   expect(hit('ballad', instrument, .45).durationBeats).toBeLessThan(.6);
  }
  expect(hit('ballad', 'piano', 3.6).durationBeats).toBe(3.6);
  expect(hit('ballad', 'organ', 3.6).durationBeats).toBeGreaterThanOrEqual(3.2);
  expect(hit('ballad', 'organ', 3.6).durationBeats).toBeLessThanOrEqual(3.3);
  expect(hit('ballad', 'organ', 3.6).durationBeats).toBeLessThan(3.6);
  expect(hit('ballad', 'organ', 1.8).durationBeats).toBeGreaterThan(hit('ballad', 'piano', 1.8).durationBeats);
  expect(hit('ballad', 'organ', 1.8).durationBeats).toBeLessThan(2);
 });
 for (const style of styles) for (const instrument of instruments) {
  it(`${style}/${instrument}: preserves protected background, arrival and reply support and velocities`, () => {
   for (const protection of ['background', 'arrival', 'reply'] as const) for (const duration of [.3, 1.8, 3.6]) {
    const input = { style, instrument, durationBeats: duration, availableBeats: 4, velocity: 83, protection };
    expect(articulateKeyboardHit(input)).toEqual({ durationBeats: duration, velocity: 83, profile: 'protected' });
    expect(input.durationBeats).toBe(duration);
    expect(articulateKeyboardHit({ ...input, availableBeats: .125 }).durationBeats).toBe(.125);
   }
  });
  it(`${style}/${instrument}: never overlaps the supplied next attack or harmonic boundary or creates a hit in zero room`, () => {
   for (const room of [0, .02, .125, .7, 1.4]) {
    const result = hit(style, instrument, 1.5, room);
    expect(result.durationBeats).toBeGreaterThanOrEqual(0);
    expect(result.durationBeats).toBeLessThanOrEqual(room);
    expect(result.velocity).toBe(67);
    expect(result).toEqual(hit(style, instrument, 1.5, room));
   }
   expect(hit(style, instrument, 0).durationBeats).toBe(0);
  });
 }
 it('preserves quiet and accented velocities without making invalid duration inputs audible', () => {
  for (const velocity of [0, 37, 64, 100, 127]) {
   expect(articulateKeyboardHit({ style: 'swing', instrument: 'organ', durationBeats: .4, availableBeats: 1, velocity }).velocity).toBe(velocity);
  }
  for (const durationBeats of [NaN, Infinity, -1]) {
   expect(() => articulateKeyboardHit({ style: 'swing', instrument: 'organ', durationBeats, availableBeats: 1, velocity: 64 })).toThrow(RangeError);
  }
  for (const availableBeats of [NaN, Infinity, -1]) {
   expect(() => articulateKeyboardHit({ style: 'ballad', instrument: 'piano', durationBeats: 3.6, availableBeats, velocity: 64 })).toThrow(RangeError);
  }
 });
});
