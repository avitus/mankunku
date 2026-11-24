import { expect, it } from 'vitest';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { prepareReleasedArrangement } from '$lib/audio/backing-arrangement';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';

for (const keyboard of ['piano', 'organ'] as const) {
 it(`shares a broken two between upright, ${keyboard} and kick in the Straight Blues heads`, () => {
  const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
  const params = { phraseId: phrase.id, sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm,
   tempo: 136, ppq: 192, beatsPerBar: 4, swing: .5, ensemble: {} };
  const options = releasedBackingOptions(keyboard, 3);
  const style = BACKING_STYLES.straight;
  const score = createRollingBacking(phrase.harmony, style, params, options);
  const previous = { ...options, brokenTwo: undefined };
  for (const other of ['swing', 'ballad', 'bossa-nova'] as const) {
   expect(createRollingBacking(phrase.harmony, BACKING_STYLES[other], params, options))
    .toEqual(createRollingBacking(phrase.harmony, BACKING_STYLES[other], params, previous));
  }
  let cp: RollingBackingCheckpoint | undefined;
  const catches: number[] = [];
  let walkingSoloBars = 0;
  for (let bar = 0; bar < score.totalBars; bar++) {
   const r = advanceRollingBacking(score, cp);
   const pickup = r.bassEvents.find(e => e.brokenTwo);
   const chords = r.compEvents.filter(e => e.brokenTwo);
   const kicks = r.drumEvents.filter(e => e.brokenTwo);
   if (bar >= 16 && bar < 40 && r.bassEvents.filter(e => Number.isInteger(e.absBeat)).length === 4) walkingSoloBars++;
   if (pickup) {
    expect(['head_in', 'head_return']).toContain(r.ensemblePlan.bars[0].performanceEnergy?.phase);
    expect(r.bassEvents.map(e => e.absBeat % 4)).toEqual([0, 2, 3]);
    expect(pickup.midi).toBe(r.bassEvents[1].midi);
    expect(pickup.velocity).toBeLessThan(r.bassEvents[1].velocity);
    expect(parseInt(r.bassEvents[1].time) + r.bassEvents[1].duration * params.tempo / 60 * params.ppq).toBeLessThan(parseInt(pickup.time));
    expect(r.checkpoint.bass.previousPreviousMidi).toBe(pickup.midi);
    expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(r.checkpoint)))).toEqual(advanceRollingBacking(score, r.checkpoint));
    const busy = advanceRollingBacking(score, cp, [{ source: 'scripted', observedAtBar: bar, barIndex: bar, confidence: 1, noteDensity: 1, restBeats: 0 }]);
    expect(busy.bassEvents.some(e => e.brokenTwo)).toBe(false);
   }
   if (chords.length || kicks.length) expect(pickup).toBeDefined();
   if (chords.length) {
    expect([...new Set(chords.map(e => e.absBeat % 4))]).toEqual([1, 3]);
    expect(chords.every(e => e.duration * params.tempo / 60 < 1 && !e.barLineSustain)).toBe(true);
   }
   expect(kicks.every(e => e.drum === 'kick' && [0, 2].includes(e.absBeat % 4))).toBe(true);
   if (chords.length && kicks.length === 2) catches.push(bar + 1);
   cp = r.checkpoint;
  }
  expect(walkingSoloBars).toBeGreaterThanOrEqual(18);
  expect(catches).toEqual([2, 6, 7, 11, 47, 48]);
  const prepared = prepareReleasedArrangement(phrase.harmony, style, params, keyboard, 4, 3);
  for (const n of catches) expect(prepared.bassEvents.some(e => e.absBeat === n * 4 - 1 && e.brokenTwo)).toBe(true);
 });
}
