/** Static eight-bar intentions. Notes and response permissions remain causal. */
import type { RollingBackingDefinition } from './backing-rolling';
import { createRng, seedFrom } from './generation-rng';
import type { CompMotifTransform } from './backing-comp-figures';

export interface MusicalSentence {
 readonly startBar: number;
 readonly endBarExclusive: number;
 readonly shape: 'arch' | 'fall-return' | 'rise-settle';
}
const contours = {
 arch: [0, 1, 3, 5, 6, 4, 2, 0],
 'fall-return': [0, -1, -3, -5, -6, -4, -2, 0],
 'rise-settle': [0, 0, 2, 3, 4, 5, 2, 0]
} as const;
const rhythms: readonly (readonly CompMotifTransform[])[] = [
 ['statement','repeat','displace','repeat','repeat','answer','displace','shorten'],
 ['statement','displace','repeat','answer','repeat','repeat','answer','shorten'],
 ['statement','repeat','answer','repeat','displace','repeat','answer','shorten']
];

/** Bounded by the authored section and chorus, never an inferred twelve-bar loop. */
export function musicalSentence(score: RollingBackingDefinition, bar: number): MusicalSentence | undefined {
 const context = score.bars[bar];
 if (!score.longerSentencesVersion || !context || context.role !== 'solo' || context.phrase8.lengthBars !== 8) return;
 const startBar = bar - context.phrase8.barIndex;
 const rng = createRng(seedFrom(score.phraseId, score.tempo, score.bars[startBar].pianoPresenceSeed ?? 0, startBar, 'sentence-v1'));
 if (!rng.chance(.8)) return;
 return { startBar, endBarExclusive: startBar + 8, shape: rng.pick(['arch','fall-return','rise-settle'] as const) };
}
export function sentenceOffset(sentence: MusicalSentence, bar: number): number {
 return contours[sentence.shape][bar - sentence.startBar] ?? 0;
}
export function sentenceKeyboardTransform(score: RollingBackingDefinition, sentence: MusicalSentence, bar: number): CompMotifTransform {
 return createRng(seedFrom(score.phraseId, score.tempo, score.bars[sentence.startBar].pianoPresenceSeed ?? 0, sentence.startBar, 'sentence-rhythm-v1'))
  .pick(rhythms)[bar - sentence.startBar];
}
/** Share a direction over several harmonies without prescribing their actual notes. */
export function sentenceBassCenters(score: RollingBackingDefinition, ordinary: readonly number[]): number[] {
 return ordinary.map((center, bar) => {
  const sentence = musicalSentence(score, bar);
  return sentence && ['swing','straight'].includes(score.style ?? 'swing')
   ? Math.max(33, Math.min(48, ordinary[sentence.startBar] + sentenceOffset(sentence, bar))) : center;
 });
}

/** Accepted bar evidence, not a claim that a register aim was always reached. */
export interface MusicalSentenceDecision extends MusicalSentence {
 readonly barIndex: number;
 readonly bass?: { readonly registerTargetMidi: number; readonly attacks: readonly { readonly time: string; readonly midi: number }[] };
 readonly keyboard?: { readonly motifId: string; readonly sourceFigureId: string; readonly attacks: readonly { readonly time: string; readonly notes: readonly number[] }[] };
 readonly keyboardLine?: readonly { readonly time: string; readonly notes: readonly number[]; readonly targetMidi: number }[];
 readonly drums?: { readonly attacks: readonly { readonly time: string; readonly drum: string; readonly velocity: number }[] };
}
