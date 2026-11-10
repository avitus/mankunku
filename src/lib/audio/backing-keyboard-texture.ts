/** Phrase-seeded rootless texture choices; requests precede actual voice leading. */
import type { ChordQuality } from '$lib/types/music';
import type { CoordinatedVoicingFamily, CoordinatedVoicingDecision } from './coordinated-voicing';
import { createRng, seedFrom } from './generation-rng';

type Profile = 'light' | 'compact' | 'open';
export function planKeyboardTexture(input: {
 readonly quality: ChordQuality; readonly family: CoordinatedVoicingFamily;
 readonly phraseId: string; readonly tempo: number; readonly phraseStartBar: number; readonly seed: number;
 readonly answering: boolean; readonly allowedTexture: 'two' | 'three' | 'full';
}): { family: 'rootless-a' | 'rootless-b'; rootlessTexture: 'three' | 'full'; spacing: 'compact' | 'open'; trace: NonNullable<CoordinatedVoicingDecision['keyboardTexture']> } | undefined {
 if (!['7','maj7','min7'].includes(input.quality) || input.family === 'guide' || input.allowedTexture === 'two') return;
 const rng = createRng(seedFrom(input.phraseId,input.tempo,'keyboard-texture-v1',input.phraseStartBar,input.seed));
 // Retain occasional original shell/drop-2/quartal color as a whole phrase.
 if (rng.chance(.2)) return;
 const profiles: Profile[] = ['light','compact','open'];
 const source = rng.pick(profiles);
 const profile = input.answering ? rng.pick(profiles.filter(profile => profile !== source)) : source;
 const family = rng.chance(.5) ? 'rootless-a' : 'rootless-b';
 return { family, rootlessTexture: profile === 'light' || input.allowedTexture === 'three' ? 'three' : 'full',
  spacing: profile === 'open' ? 'open' : 'compact',
  trace: Object.freeze({ profile, phraseStartBar: input.phraseStartBar, source: input.answering ? 'answer' : 'phrase' }) };
}
