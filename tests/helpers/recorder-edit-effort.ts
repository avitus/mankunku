import { addFractions, compareFractions, subtractFractions } from '$lib/music/intervals';
import { extractSoundingNotes } from '$lib/music/expression';
import { PITCH_CLASSES, type Fraction, type Note, type PitchClass } from '$lib/types/music';

type Span = Pick<Note, 'pitch' | 'duration'>;

function spans(notes: Note[], shift: number): Span[] {
	const result: Span[] = [];
	let end: Fraction = [0, 1];
	for (const note of extractSoundingNotes(notes)) {
		// Make a gap and an explicitly notated rest equivalent. A leading
		// rest is editable content; silence after the final note is padding.
		if (compareFractions(note.offset, end) > 0) {
			result.push({ pitch: null, duration: subtractFractions(note.offset, end) });
		}
		result.push({ pitch: note.pitch + shift, duration: note.duration });
		end = addFractions(note.offset, note.duration);
	}
	return result;
}

function align(source: Span[], target: Span[], shift: number) {
	const empty = { total: Number(shift !== 0), shift, pitch: 0, duration: 0, insert: 0, remove: 0 };
	let previous = Array.from({ length: target.length + 1 }, (_, j) => ({
		...empty, total: empty.total + j, insert: j
	}));
	for (const [i, from] of source.entries()) {
		const next = [{ ...empty, total: empty.total + i + 1, remove: i + 1 }];
		for (const [j, to] of target.entries()) {
			const pitch = Number((from.pitch === null ? null : from.pitch + shift) !== to.pitch);
			const duration = Number(compareFractions(from.duration, to.duration) !== 0);
			const pair = previous[j];
			const add = next[j];
			const drop = previous[j + 1];
			// On ties, retain the existing event instead of deleting and re-entering it.
			let best = { ...pair, total: pair.total + pitch + duration,
				pitch: pair.pitch + pitch, duration: pair.duration + duration };
			if (add.total + 1 < best.total) best = { ...add, total: add.total + 1, insert: add.insert + 1 };
			if (drop.total + 1 < best.total) best = { ...drop, total: drop.total + 1, remove: drop.remove + 1 };
			next.push(best);
		}
		previous = next;
	}
	return previous[target.length];
}

/** Minimum logical corrections to the saved C-normalized melody under the documented edit model. */
export function estimateRecorderEdits(saved: Note[], reference: Note[], practiceKey: PitchClass) {
	const source = spans(saved, 0);
	const target = spans(reference, -PITCH_CLASSES.indexOf(practiceKey));
	const shifts = new Set<number>();
	for (const from of source) for (const to of target) {
		if (from.pitch !== null && to.pitch !== null) shifts.add(to.pitch - from.pitch);
	}
	let best = align(source, target, 0);
	// A whole-line transpose can only improve the alignment if at least
	// one sounding pitch matches afterwards. Prefer no shift on equal cost.
	for (const shift of [...shifts].filter(Boolean).sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)) {
		const candidate = align(source, target, shift);
		if (candidate.total < best.total) best = candidate;
	}
	return best;
}
