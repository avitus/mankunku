/**
 * Pure edits on the step-entry buffer — a dense prefix-sum of notes and
 * rests (`Note.pitch === null` is a rest) whose offsets run from 0 with no
 * gaps. Every function returns a NEW array and never mutates its input, so
 * the state modules can assign the result to the `$state` rune.
 *
 * Two meanings of "delete" live here since 2026-10-15 (MuseScore's rule, by
 * Andy's call): `replaceWithRest` keeps the score on its beats, `removeTime`
 * closes the gap. `coalesceRests` keeps one engraved rest ≈ one selectable
 * element after an in-place edit; `stripTrailingRests` is how a saved lick's
 * pad rest leaves the buffer on load (trailing silence is implied — save
 * always re-pads).
 */

import type { Fraction, Note } from '$lib/types/music';
import { addFractions, compareFractions, fractionToFloat, subtractFractions } from '$lib/music/intervals';
import { getTripletBase } from '$lib/music/notation';

/** Shallow-copy every element so callers can hand the result to a rune. */
function cloneAll(notes: readonly Note[]): Note[] {
	return notes.map((n) => ({ ...n }));
}

/** True when `index` addresses an element of `notes`. */
function inRange(notes: readonly Note[], index: number): boolean {
	return Number.isInteger(index) && index >= 0 && index < notes.length;
}

/**
 * Turn element `index` into a rest of the same offset and duration. Nothing
 * else moves. A tie pointing INTO the element is cleared (a rest now
 * follows the head); the element's own `tied`, spelling and articulation go
 * with it. An out-of-range index returns an unchanged copy.
 */
export function replaceWithRest(notes: readonly Note[], index: number): Note[] {
	const out = cloneAll(notes);
	if (!inRange(notes, index)) return out;
	const target = out[index];
	out[index] = { pitch: null, duration: target.duration, offset: target.offset };
	if (index > 0 && out[index - 1].tied) out[index - 1].tied = false;
	return out;
}

/**
 * Remove element `index` AND its time: every later element moves earlier by
 * the removed duration (MuseScore's Ctrl+Del, "remove selected range"). A tie
 * pointing into the removed element survives only when the element that
 * slides in has the same pitch. An out-of-range index returns an unchanged
 * copy.
 */
export function removeTime(notes: readonly Note[], index: number): Note[] {
	const out = cloneAll(notes);
	if (!inRange(notes, index)) return out;
	const removed = out[index].duration;
	for (let i = index + 1; i < out.length; i++) {
		out[i].offset = subtractFractions(out[i].offset, removed);
	}
	out.splice(index, 1);
	if (index > 0) {
		const prev = out[index - 1];
		if (prev.tied) {
			const next = out[index];
			if (!next || next.pitch !== prev.pitch) prev.tied = false;
		}
	}
	return out;
}

/**
 * Merge contiguous non-triplet rests whose STARTS fall in the same bar into
 * one element (a rest may already run past the barline — a saved lick's pad
 * does — so the end is not the test). Triplet rests belong to their group and
 * are never merged, matching `mergeConsecutiveRests` on the display side.
 * `indexMap[old]` gives the index of the element that now holds old element
 * `old`, so a caller can re-aim its selection.
 */
export function coalesceRests(
	notes: readonly Note[],
	barLength: Fraction = [1, 1]
): { notes: Note[]; indexMap: number[] } {
	const out: Note[] = [];
	const indexMap: number[] = [];
	const bar = fractionToFloat(barLength);
	const barOf = (f: Fraction): number => Math.floor(fractionToFloat(f) / bar + 1e-9);
	for (const n of notes) {
		const prev = out.at(-1);
		const mergeable =
			n.pitch === null &&
			prev !== undefined &&
			prev.pitch === null &&
			getTripletBase(n.duration) === null &&
			getTripletBase(prev.duration) === null &&
			compareFractions(addFractions(prev.offset, prev.duration), n.offset) === 0 &&
			barOf(prev.offset) === barOf(n.offset);
		if (mergeable) {
			prev.duration = addFractions(prev.duration, n.duration);
			indexMap.push(out.length - 1);
			continue;
		}
		out.push({ ...n });
		indexMap.push(out.length - 1);
	}
	return { notes: out, indexMap };
}

/** Drop every rest at the end of the buffer; trailing silence is implied. */
export function stripTrailingRests(notes: readonly Note[]): Note[] {
	let end = notes.length;
	while (end > 0 && notes[end - 1].pitch === null) end--;
	return cloneAll(notes.slice(0, end));
}

/** Where the dense buffer ends: the last element's end, 0 when empty. */
function contentEnd(notes: readonly Note[]): Fraction {
	const last = notes.at(-1);
	return last ? addFractions(last.offset, last.duration) : [0, 1];
}

/**
 * Write `element` into the buffer at its own offset, OVERWRITING whatever
 * its span covers — the one write policy since 2026-10-15 (MuseScore's note
 * input: "notes entered this way will replace any rests or notes that were
 * already present at the cursor location"). Durations are conserved and no
 * later element's offset moves: an element the span starts inside keeps its
 * head (a note keeps its pitch, loses its tie — the new element follows it
 * now), fully covered elements go, an element the span ends inside keeps its
 * tail (a rest stays a rest, a note keeps its pitch and its own tie). Past
 * the content end, one gap rest bridges the silence first. The element's
 * own `tied` is kept as given. Returns the new list and the element's index.
 */
export function spliceElement(
	notes: readonly Note[],
	element: Note
): { notes: Note[]; index: number } {
	const start = element.offset;
	const end = addFractions(start, element.duration);
	const inserted: Note = { ...element };
	const tail = contentEnd(notes);
	if (compareFractions(start, tail) >= 0) {
		const out = cloneAll(notes);
		const gap = subtractFractions(start, tail);
		if (gap[0] > 0) out.push({ pitch: null, duration: gap, offset: tail });
		out.push(inserted);
		return { notes: out, index: out.length - 1 };
	}
	const out: Note[] = [];
	let index = -1;
	for (const el of notes) {
		const elEnd = addFractions(el.offset, el.duration);
		if (compareFractions(elEnd, start) <= 0) {
			out.push({ ...el });
			continue;
		}
		if (compareFractions(el.offset, end) >= 0) {
			if (index === -1) {
				index = out.length;
				out.push(inserted);
			}
			out.push({ ...el });
			continue;
		}
		// Overlapping element.
		if (compareFractions(el.offset, start) < 0) {
			const head: Note = { ...el, duration: subtractFractions(start, el.offset) };
			if (head.tied) head.tied = false;
			out.push(head);
		}
		if (index === -1) {
			index = out.length;
			out.push(inserted);
		}
		if (compareFractions(elEnd, end) > 0) {
			const remainder = subtractFractions(elEnd, end);
			out.push(
				el.pitch === null
					? { pitch: null, duration: remainder, offset: end }
					: { ...el, offset: end, duration: remainder }
			);
		}
	}
	if (index === -1) {
		index = out.length;
		out.push(inserted);
	}
	return { notes: out, index };
}

/**
 * Make a section's notes monophonic again after an overwrite reached past a
 * page window: an element that runs into the next one is shortened to end
 * where the next begins (a note keeps its pitch, loses its tie); an element
 * another starts ON TOP of is dropped. Sorted by offset on the way out.
 */
export function trimOverlappingNotes(notes: readonly Note[]): Note[] {
	const sorted = cloneAll(notes).sort((a, b) => compareFractions(a.offset, b.offset));
	const out: Note[] = [];
	for (let i = 0; i < sorted.length; i++) {
		const cur = sorted[i];
		const next = sorted[i + 1];
		if (next && compareFractions(addFractions(cur.offset, cur.duration), next.offset) > 0) {
			if (compareFractions(next.offset, cur.offset) <= 0) continue;
			cur.duration = subtractFractions(next.offset, cur.offset);
			if (cur.tied) cur.tied = false;
		}
		out.push(cur);
	}
	return out;
}
