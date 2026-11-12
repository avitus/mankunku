/** The musical policy shared by the listening desk and normal accompaniment. */
import type { RollingBackingOptions } from './backing-rolling';
import type { BackingInstrument } from '$lib/types/instruments';

export function releasedBackingOptions(instrument: BackingInstrument, seed?: number): RollingBackingOptions {
 return { returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment',
  keyboardVariety: 'developed', chorusBoundaryPriority: true, keyboardTexture: true, keyboardPhrasing: instrument,
  bassDelayedRoot: true, keyboardContraryMotion: true, drumPhraseCushioning: true, keyboardSuspensions: 'developed',
  phraseExpression: true, trioConversation: true, phraseColors: true, ensembleColors: true, phraseDialogue: true, innerMotion: true };
}
