import { describe, expect, it } from 'vitest';
import { faderToGain, gainToFader, gainLabel, clampGain } from '$lib/audio/mixer-policy';
import { backingOutputGain } from '$lib/audio/backing-output';

describe('shared fader law', () => {
 it('has exact mute and equal dB travel for ordinary and advanced controls', () => {
  for (const max of [1,3]) {
   expect(faderToGain(0,max)).toBe(0);
   expect(faderToGain(1,max)).toBe(max);
   expect(faderToGain(.9,max)/faderToGain(.8,max)).toBeCloseTo(10**(6/20),12);
   for (const gain of [.01,.1,.5,1]) expect(faderToGain(gainToFader(gain,max),max)).toBeCloseTo(gain,12);
  }
  expect(gainLabel(.5)).toBe('-6.0 dB'); expect(gainLabel(0)).toBe('Muted');
 });
 it('keeps non-finite settings out of audio parameters', () => {
  expect(clampGain(NaN,1,.8)).toBe(.8); expect(faderToGain(Infinity)).toBe(0);
 });
 it('uses one backing reference with a linear output fader and true mute', () => {
  expect(backingOutputGain(.6)).toBe(4);
  expect(backingOutputGain(.3)).toBe(2);
  expect(backingOutputGain(0)).toBe(0);
  expect(backingOutputGain(NaN)).toBe(0);
 });
});
