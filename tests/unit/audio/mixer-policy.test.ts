import { describe, expect, it } from 'vitest';
import { faderToGain, gainToFader, gainLabel, clampGain } from '$lib/audio/mixer-policy';
import { backingOutputGain } from '$lib/audio/backing-output';

describe('shared fader law', () => {
 it('maps the practice-volume landmarks to gain and preserves advanced boost', () => {
  for (const max of [1,3]) {
   expect(faderToGain(0,max)).toBe(0);
   expect(faderToGain(1,max)).toBe(max);
   for (const [position, db] of [[.01,-60], [.13,-42], [.25,-24], [.375,-18], [.5,-12], [.625,-9], [.75,-6], [.875,-3], [1,0]]) {
    const gain = max * 10 ** (db / 20);
    expect(faderToGain(position, max)).toBeCloseTo(gain, 12);
    expect(gainToFader(gain, max)).toBeCloseTo(position, 12);
   }
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
