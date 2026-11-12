import { createHash } from 'node:crypto';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import baseline from '../../fixtures/audio/musicality-0.16-hashes.json';
import { expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { HISTORICAL_MUSICALITY_STYLES as BACKING_STYLES } from '../../helpers/musicality-style-fixtures';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';

type Style = 'swing' | 'straight' | 'bossa-nova' | 'ballad';
function scoreFor(style: Style, tune: 'blues' | 'aaba', seed: number, instrument: 'piano' | 'organ') {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const { phrase } = tune === 'blues'
  ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
 const tempo = style === 'ballad' ? 80 : 140;
 return createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4,
  swing: resolveBackingSwing(.62, BACKING_STYLES[style], tempo),
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}
 }, { ...releasedBackingOptions(instrument, seed), loopCount: 1 }
 );
}
function run(score: ReturnType<typeof createRollingBacking>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint && JSON.parse(JSON.stringify(checkpoint))); checkpoint = result.checkpoint; return result;
 });
}

// Captured from the released 0.16.0 engine, before the playback performance fix.
// Hash the entire result: events, source decisions and checkpoints, not just pitches.
for (const style of ['swing', 'straight', 'bossa-nova', 'ballad'] as const) {
 for (const tune of ['blues', 'aaba'] as const) {
  it(`preserves released ${style} ${tune} performances for both keyboards`, () => {
   for (const seed of [42, 7, 9, 243, 256]) for (const instrument of ['piano', 'organ'] as const) {
    const key = [style, tune, seed, instrument].join('/');
    const actual = createHash('sha256').update(JSON.stringify(run(scoreFor(style, tune, seed, instrument)))).digest('hex');
    expect(actual, key).toBe(baseline.hashes[key as keyof typeof baseline.hashes]);
   }
  });
 }
}
