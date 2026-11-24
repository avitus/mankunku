/** The musical policy shared by the listening desk and normal accompaniment. */
import type { RollingBackingOptions } from './backing-rolling';
import type { BackingInstrument } from '$lib/types/instruments';

export function releasedBackingOptions(instrument: BackingInstrument, seed?: number): RollingBackingOptions {
 return { rideTriplet: true, nativeMelodicHandoff: true, keyboardMelodicHandoff: true, melodicHandoff: true, displacedRhythm: true, rhythmMemory: true, balladThird: true, brokenTwo: true, dominantRiff: true, balladReturn: true, bossaPickup: true, performanceTouch: true, pianoContinuity: 'refit', keyboardSustain: 'harmonic-support', longerSentences: true, returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment',
  keyboardVariety: 'developed', chorusBoundaryPriority: true, keyboardTexture: true, keyboardPhrasing: instrument,
  bassDelayedRoot: true, keyboardContraryMotion: true, drumPhraseCushioning: true, keyboardSuspensions: 'developed',
  phraseExpression: true, trioConversation: true, phraseColors: true, ensembleColors: true, phraseDialogue: true, innerMotion: true };
}
