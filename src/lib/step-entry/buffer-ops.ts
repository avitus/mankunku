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
