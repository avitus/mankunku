import type { GeneratedBacking } from '../../../src/lib/audio/backing-generation';
import type { Page } from '@playwright/test';
import { expect } from './test';
import { OUTPUT_CEILING } from '../../../src/lib/audio/mixer-policy';

/** Measure both channels after the listening Master. The desk's Backing meter precedes protection. */
export async function observeListeningOutput(page: Page) {
 await page.addInitScript(ceiling => {
  const state = { peak: 0, barPeaks: [] as number[] };
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
       let peak = 0;
       for (const sample of data) peak = Math.max(peak, Math.abs(sample));
       state.peak = Math.max(state.peak, peak);
       const position = document.querySelector('[data-testid="listening-position"]');
       const index = position?.getAttribute('data-bar-index');
       if (index && position?.querySelector('[data-testid="listening-status"]')?.textContent === 'Playing') {
        const bar = Number(index);
        state.barPeaks[bar] = Math.max(state.barPeaks[bar] ?? 0, peak);
       }
      }, 75);
     }
    }
    return result;
   }
  });
 }, OUTPUT_CEILING);
}

export async function expectAudibleListeningOutput(page: Page, generated: GeneratedBacking) {
 const { peak, barPeaks } = await page.evaluate(() =>
  (window as unknown as { __listeningOutput: { peak: number; barPeaks: number[] } }).__listeningOutput);
 expect(peak).toBeLessThanOrEqual(OUTPUT_CEILING + 1e-6);
 // Only bars with scheduled attacks require sound. Entirely resting bars may be silent.
 const soundingBars = new Set([...generated.bassEvents, ...generated.compEvents, ...generated.drumEvents]
  .map(event => Math.floor(event.absBeat / 4)));
 expect(soundingBars.size).toBeGreaterThan(0);
 for (const bar of soundingBars) expect(barPeaks[bar] ?? 0, `Master output in bar ${bar + 1}`).toBeGreaterThan(.001);
}
