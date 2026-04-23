/**
 * Descriptive name generator used when no attribution match is found.
 * Produces names like "C ii-V-I (Maj) — scalar eighths, 2 bars".
 */
import type { Note, Phrase, PhraseCategory } from '$lib/types/music';
import { CATEGORY_LABELS } from '$lib/types/music';
import { encodeNotes } from './encode';

type ShapeTag = 'scalar' | 'arpeggio' | 'chromatic' | 'enclosure' | 'wide';

export function fallbackName(phrase: Phrase): string {
	const feature = encodeNotes(phrase.notes);

	const key = phrase.key;
	const progression = progressionLabel(phrase.category);
	const shapes = detectShapes(feature.intervals).slice(0, 2);
	const rhythm = predominantRhythm(phrase.notes);
	const bars = phrase.difficulty?.lengthBars ?? Math.max(1, Math.ceil(feature.totalBeats / phrase.timeSignature[0]));

	const descriptor = shapes.length > 0
		? `${shapes.join(' + ')} ${rhythm}`
		: rhythm;

	const head = progression ? `${key} ${progression}` : key;
	return `${head} — ${descriptor}, ${bars} bar${bars === 1 ? '' : 's'}`;
}

function progressionLabel(category: PhraseCategory): string | null {
	if (category === 'user') return null;
	return CATEGORY_LABELS[category];
}

function detectShapes(intervals: number[]): ShapeTag[] {
	if (intervals.length === 0) return [];

	const abs = intervals.map((x) => Math.abs(x));
	const total = intervals.length;

	const stepCount = abs.filter((x) => x === 1 || x === 2).length;
	const leapCount = abs.filter((x) => x === 3 || x === 4 || x === 7 || x === 8).length;
	const hasWide = abs.some((x) => x >= 9);
	const hasChromatic = hasConsecutive(abs, (x) => x === 1, 2);
	const enclosureCount = countEnclosures(intervals);

	const tags: Array<{ tag: ShapeTag; priority: number }> = [];

	// Priority: rarer/more specific tags rank higher.
	if (hasWide) tags.push({ tag: 'wide', priority: 1 });
	if (enclosureCount >= 2) tags.push({ tag: 'enclosure', priority: 2 });
	if (hasChromatic) tags.push({ tag: 'chromatic', priority: 3 });
	if (leapCount / total >= 0.5) tags.push({ tag: 'arpeggio', priority: 4 });
	if (stepCount / total >= 0.7) tags.push({ tag: 'scalar', priority: 5 });

	tags.sort((a, b) => a.priority - b.priority);
	return tags.map((t) => t.tag);
}

function hasConsecutive(arr: number[], pred: (x: number) => boolean, minRun: number): boolean {
	let run = 0;
	for (const x of arr) {
		run = pred(x) ? run + 1 : 0;
		if (run >= minRun) return true;
	}
	return false;
}

/** Count up-step + down-step pairs (or vice versa) that return within 3 semitones. */
function countEnclosures(intervals: number[]): number {
	let count = 0;
	for (let i = 0; i < intervals.length - 1; i++) {
		const a = intervals[i];
		const b = intervals[i + 1];
		const sameMagnitude = Math.abs(Math.abs(a) - Math.abs(b)) <= 1;
		const oppositeDirection = Math.sign(a) === -Math.sign(b);
		const smallMove = Math.abs(a) <= 3 && Math.abs(b) <= 3;
		if (sameMagnitude && oppositeDirection && smallMove) count++;
	}
	return count;
}

function predominantRhythm(notes: Note[]): string {
	const counts = new Map<string, number>();
	for (const n of notes) {
		if (n.pitch === null) continue;
		const [num, den] = n.duration;
		counts.set(`${num}/${den}`, (counts.get(`${num}/${den}`) ?? 0) + 1);
	}
	const total = [...counts.values()].reduce((a, b) => a + b, 0);
	if (total === 0) return 'mixed rhythms';

	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	const [topKey, topCount] = sorted[0];
	if (topCount / total < 0.5) return 'mixed rhythms';
	return durationLabel(topKey);
}

function durationLabel(key: string): string {
	switch (key) {
		case '1/1': return 'whole notes';
		case '1/2': return 'half notes';
		case '1/4': return 'quarters';
		case '1/8': return 'eighths';
		case '1/16': return 'sixteenths';
		case '1/12': return 'eighth triplets';
		case '1/6': return 'quarter triplets';
		case '3/8': return 'dotted quarters';
		case '3/16': return 'dotted eighths';
		default: return 'mixed rhythms';
	}
}
