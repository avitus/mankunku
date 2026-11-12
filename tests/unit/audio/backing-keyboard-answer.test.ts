import { expect, it } from 'vitest';
import { keyboardAnswerFigure } from '$lib/audio/backing-keyboard-development';
import { COMP_FIGURES } from '$lib/audio/backing-comp-figures';

it('retains a valid source when a reduced vocabulary has no complementary answer', () => {
 const source = COMP_FIGURES.find(f => f.id === 'charleston')!;
 expect(keyboardAnswerFigure([], source, 'short-vocabulary', 140, 4)).toBe(source);
 expect(keyboardAnswerFigure([source], source, 'short-vocabulary', 140, 4)).toBe(source);
});
