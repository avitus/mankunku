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

/** Native 0.7 colors retain their own rhythmic grammar and more original families. */
export function planNativeKeyboardTexture(input: Parameters<typeof planKeyboardTexture>[0] & {
 readonly style: 'bossa-nova' | 'ballad'; readonly barIndex: number;
}): ReturnType<typeof planKeyboardTexture> {
 const rng = createRng(seedFrom(input.phraseId, input.tempo, 'native-keyboard-texture-v1', input.phraseStartBar, input.seed));
 // Ballad preserves its native drop-2/quartal palette in most phrases.
 if (rng.chance(input.style === 'ballad' ? .6 : .25)) return;
 const texture = planKeyboardTexture({ ...input, answering: false });
 if (!texture) return;
 if (input.style === 'bossa-nova') {
  // A small compact chord supports the native clave; never import a Swing cell.
  const profile = texture.trace.profile === 'light' ? 'light' as const : 'compact' as const;
  return { ...texture, spacing: 'compact', trace: { ...texture.trace, profile } };
 }
 // Ballad texture can change at half-phrase pace; the native sustained attacks stay put.
 const opening = input.barIndex - input.phraseStartBar < 2;
 const profile = opening ? 'compact' as const : texture.trace.profile;
 return { ...texture, spacing: profile === 'open' ? 'open' : 'compact',
  trace: { ...texture.trace, profile } };
}
