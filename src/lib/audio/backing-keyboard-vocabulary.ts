/** Additional listening vocabulary; never changes the historical figure registry. */
import { COMP_FIGURES, type CompFigure } from './backing-comp-figures';

const additional: CompFigure[] = [
 { id: 'reverse-charleston', bars: 1, hits: [[{ b: .5, d: .45 }, { b: 2, d: 1.35 }]], weight: 3, busy: 2, tags: [] },
 { id: 'short-long', bars: 1, hits: [[{ b: 0, d: .4 }, { b: 2.5, d: 1.35 }]], weight: 2.5, busy: 2, tags: ['early'] },
 { id: 'late-answer', bars: 1, hits: [[{ b: 1, d: .45 }, { b: 2.5, d: .65 }]], weight: 2.5, busy: 2, tags: [] },
 { id: 'anticipation-answer', bars: 1, hits: [[{ b: .5, d: .5 }, { b: 3.5, d: 1.1 }]], weight: 2, busy: 2, tags: ['push'] },
 { id: 'offbeat-hold', bars: 1, hits: [[{ b: 1.5, d: .35 }, { b: 2.5, d: 1.35 }]], weight: 2, busy: 2, tags: [] }
];
for (const figure of additional) {
 for (const hits of figure.hits) { hits.forEach(Object.freeze); Object.freeze(hits); }
 Object.freeze(figure.hits); Object.freeze(figure.tags); Object.freeze(figure);
}
export const KEYBOARD_VARIETY_FIGURES: readonly CompFigure[] = Object.freeze([...COMP_FIGURES, ...additional]);
export const keyboardFigures = (score: { readonly keyboardVarietyVersion?: 1 | 2 }): readonly CompFigure[] =>
 score.keyboardVarietyVersion ? KEYBOARD_VARIETY_FIGURES : COMP_FIGURES;
export const hasWrittenKeyboardArticulation = (id: string): boolean => additional.some(figure => figure.id === id);
