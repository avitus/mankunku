/** Related four-bar ideas, proposed afresh against each bar's actual permission. */
import type { CompFigure, CompFigureHit, CompMotifTransform } from './backing-comp-figures';
import { createRng, seedFrom } from './generation-rng';

export const KEYBOARD_DEVELOPMENTS = {
	question_answer: ['statement', 'answer', 'repeat', 'answer'],
	answer_return: ['statement', 'shorten', 'answer', 'repeat'],
	forward: ['statement', 'displace', 'answer', 'shorten'],
	echo_release: ['statement', 'repeat', 'answer', 'shorten'],
	recast: ['statement', 'answer', 'displace', 'repeat']
} as const;
export type KeyboardDevelopment = keyof typeof KEYBOARD_DEVELOPMENTS;

export function keyboardDevelopment(phraseId: string, tempo: number, startBar: number, seed: number): KeyboardDevelopment {
	return createRng(seedFrom(phraseId, tempo, 'keyboard-development-v2', startBar, seed))
		.pick(Object.keys(KEYBOARD_DEVELOPMENTS) as KeyboardDevelopment[]);
}

/** Keep the source identifiable; the answer speaks in a different part of the bar. */
export function keyboardAnswerFigure(figures: readonly CompFigure[], source: CompFigure,
	phraseId: string, tempo: number, startBar: number): CompFigure {
	const ids = source.hits[0][0].b < 1
		? ['late-answer', 'and2-4', 'offbeat-hold', 'two-and-four']
		: ['charleston', 'short-long', 'reverse-charleston', 'offbeat-pair'];
	const candidates = figures.filter(figure => ids.includes(figure.id) && figure.id !== source.id &&
		figure.hits[0].map(hit => hit.b).join(',') !== source.hits[0].map(hit => hit.b).join(','));
	return createRng(seedFrom(phraseId, tempo, 'keyboard-answer-v2', startBar, source.id)).pick(candidates);
}

/** Length is audible on organ too. Never add attacks; nominal lengths fit the next hit and bar. The renderer bounds timed releases. */
export function articulateKeyboardDevelopment(hits: readonly CompFigureHit[], action: CompMotifTransform,
	development: KeyboardDevelopment): CompFigureHit[] {
	if (hits.length !== 2) return hits.map(hit => ({ ...hit }));
	const room = hits.map((hit, index) => (hits[index + 1]?.b ?? 4) - hit.b - .08);
	const preferFirst = development === 'echo_release' || development === 'answer_return';
	const longIndex = preferFirst && room[0] >= .9 ? 0 : room[1] >= .9 ? 1 : 0;
	return hits.map((hit, index) => ({ b: hit.b, d: Math.min(room[index], index === longIndex
		? (action === 'answer' ? 1.5 : 1.25) : (development === 'forward' ? .3 : .4)) }));
}

/** An answering chord follows the leading chord, rather than two unrelated velocities. */
export function keyboardDevelopmentVelocity(base: number, index: number, count: number, action: CompMotifTransform): number {
	const center = Math.max(48, Math.min(82, base));
	return Math.round(center + (count === 1 ? -3 : index === (action === 'answer' ? count - 1 : 0) ? 6 : -6));
}
