/**
 * Score-to-grade mapping.
 *
 * perfect: >= 95%
 * great:   >= 85%
 * good:    >= 70%
 * fair:    >= 55%
 * try-again: < 55%
 */

import type { Grade } from '$lib/types/scoring';

const GRADE_THRESHOLDS: { grade: Grade; min: number }[] = [
	{ grade: 'perfect', min: 0.95 },
	{ grade: 'great', min: 0.85 },
	{ grade: 'good', min: 0.70 },
	{ grade: 'fair', min: 0.55 }
];

export function scoreToGrade(overall: number): Grade {
	for (const { grade, min } of GRADE_THRESHOLDS) {
		if (overall >= min) return grade;
	}
	return 'try-again';
}

/** Display label for each grade */
export const GRADE_LABELS: Record<Grade, string> = {
	perfect: 'Perfect',
	great: 'Great',
	good: 'Good',
	fair: 'Fair',
	'try-again': 'Try Again'
};

/** CSS color variable for each grade */
export const GRADE_COLORS: Record<Grade, string> = {
	perfect: 'var(--color-success)',
	great: 'var(--color-success)',
	good: 'var(--color-accent)',
	fair: 'var(--color-warning)',
	'try-again': 'var(--color-error)'
};

/**
 * Liner-note captions shown below the grade label after each attempt — a mix
 * of Blue Note sleeve-style one-liners and classic quotes from the giants of
 * the genre. A random one is picked per attempt via {@link getGradeCaption}.
 */
export const GRADE_CAPTIONS: Record<Grade, readonly string[]> = {
	perfect: [
		'Right in the pocket.',
		'“Master your instrument, master the music, and then forget all that and just play.” — Charlie Parker',
		'“What we play is life.” — Louis Armstrong',
		'“There are two kinds of music — good music, and the other kind.” — Duke Ellington',
		'“A genius is the one most like himself.” — Thelonious Monk',
		'“Jazz washes away the dust of everyday life.” — Art Blakey',
		'“If you have to ask what jazz is, you’ll never know.” — Louis Armstrong',
		'“Music is your own experience, your own thoughts, your wisdom.” — Charlie Parker',
		'“Jazz has always been a matter of expressing oneself.” — Sonny Rollins',
		'“When you’re creating your own stuff, even the sky ain’t the limit.” — Miles Davis'
	],
	great: [
		'Cookin’.',
		'“It don’t mean a thing if it ain’t got that swing.” — Duke Ellington',
		'“If you play a tune and a person don’t tap their feet, don’t play the tune.” — Count Basie',
		'“Never play a thing the same way twice.” — Louis Armstrong',
		'“Don’t play what’s there. Play what’s not there.” — Miles Davis',
		'“I always listen for what I can leave out.” — Miles Davis',
		'“Make the drummer sound good.” — Thelonious Monk',
		'“Damn the rules — it’s the feeling that counts.” — John Coltrane',
		'“Don’t play the saxophone. Let it play you.” — Charlie Parker',
		'“Jazz is not a style but a process of making music.” — Bill Evans'
	],
	good: [
		'Swinging along.',
		'“Sometimes you have to play a long time to be able to play like yourself.” — Miles Davis',
		'“There is never any end. There are always new sounds to imagine.” — John Coltrane',
		'“A problem is a chance for you to do your best.” — Duke Ellington',
		'“It’s better to do something simple that is real.” — Bill Evans',
		'“You can’t improvise on nothing — you’ve got to improvise on something.” — Charles Mingus',
		'“Don’t play everything. Let some things go by.” — Thelonious Monk',
		'“You’ve got to look back at the old things and see them in a new light.” — John Coltrane',
		'“It’s taken me all my life to learn what not to play.” — Dizzy Gillespie',
		'“If you don’t live it, it won’t come out of your horn.” — Charlie Parker'
	],
	fair: [
		'A little off the changes.',
		'“If you hit a wrong note, it’s the next note that makes it good or bad.” — Miles Davis',
		'“Do not fear mistakes. There are none.” — Miles Davis',
		'“In hindsight, the so-called mistakes have often forged new directions.” — Herbie Hancock',
		'“The piano ain’t got no wrong notes.” — Thelonious Monk',
		'“What you don’t play can be more important than what you do.” — Thelonious Monk',
		'“Anyone can make the simple complicated. Creativity is making the complicated simple.” — Charles Mingus',
		'“You can play a shoestring if you’re sincere.” — John Coltrane',
		'“I merely took the energy it takes to pout and wrote some blues.” — Duke Ellington',
		'Find the thread. Pull.'
	],
	'try-again': [
		'Take it again from the top.',
		'“Just don’t give up trying to do what you really want to do.” — Ella Fitzgerald',
		'“Musicians don’t retire; they stop when there’s no more music in them.” — Louis Armstrong',
		'“It isn’t where you come from; it’s where you’re going that counts.” — Ella Fitzgerald',
		'“Just keep on. I’m going to work it out.” — John Coltrane',
		'“One of the things I like about jazz is, I don’t know what’s going to happen next.” — Dave Brubeck',
		'“I’m always thinking about creating. My future starts when I wake up.” — Miles Davis',
		'“The memory of things gone is important to a jazz musician.” — Louis Armstrong',
		'“I’ll play it first and tell you what it is later.” — Miles Davis',
		'Rest. Count off. Here we go.'
	]
};

/** Pick a caption at random from the pool for a given grade. */
export function getGradeCaption(grade: Grade): string {
	const pool = GRADE_CAPTIONS[grade];
	return pool[Math.floor(Math.random() * pool.length)];
}
