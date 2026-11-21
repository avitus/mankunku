import type { Page } from '@playwright/test';
import { expect } from './test';
import { OUTPUT_CEILING } from '../../../src/lib/audio/mixer-policy';

/** Measure both channels after the listening Master. The desk's Backing meter precedes protection. */
export async function observeListeningOutput(page: Page) {
 await page.addInitScript(ceiling => {
  const state = { peak: 0 };
  Object.assign(window, { __listeningOutput: state });
  const connect = WaveShaperNode.prototype.connect;
  Object.defineProperty(WaveShaperNode.prototype, 'connect', {
   configurable: true,
   writable: true,
   value: function (this: WaveShaperNode, target: AudioNode, ...ports: number[]) {
    const result = Reflect.apply(connect, this, [target, ...ports]);
    if (target instanceof GainNode && this.context instanceof AudioContext &&
        this.curve && Math.abs(this.curve[this.curve.length - 1] - ceiling) < 1e-6) {
     const split = this.context.createChannelSplitter(2);
     target.connect(split);
     for (const channel of [0, 1]) {
      const meter = this.context.createAnalyser();
      split.connect(meter, channel);
      const data = new Float32Array(meter.fftSize);
      setInterval(() => {
       meter.getFloatTimeDomainData(data);
       for (const sample of data) state.peak = Math.max(state.peak, Math.abs(sample));
      }, 75);
     }
    }
    return result;
   }
  });
 }, OUTPUT_CEILING);
}

export async function expectAudibleListeningOutput(page: Page) {
 const peak = await page.evaluate(() => (window as unknown as { __listeningOutput: { peak: number } }).__listeningOutput.peak);
 expect(peak).toBeGreaterThan(.001);
 expect(peak).toBeLessThanOrEqual(OUTPUT_CEILING + 1e-6);
}
