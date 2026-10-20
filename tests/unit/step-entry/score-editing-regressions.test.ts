import { beforeEach, expect, it } from 'vitest';
import { settings } from '$lib/state/settings.svelte';
import { stepEntry, reset, selectNote, setDuration, enterTiedNote, addRest, addNote, toggleTriplet } from '$lib/state/step-entry.svelte';
import { addFractions } from '$lib/music/intervals';
import type { Fraction } from '$lib/types/music';

beforeEach(() => { settings.instrumentId = 'concert'; reset(); });

it('Black Orpheus bar 32: Triplet divides the selected half rest into three quarter triplets', () => {
	stepEntry.barCount = 4;
	stepEntry.enteredNotes = [
		{ pitch: 74, offset: [3, 1], duration: [1, 2] },
		{ pitch: null, offset: [7, 2], duration: [1, 2] }
	];
	selectNote(1); // bar 32 on the editor's last four-bar page
	toggleTriplet();
	expect(stepEntry.enteredNotes).toEqual([
		{ pitch: 74, offset: [3, 1], duration: [1, 2] },
		{ pitch: null, offset: [7, 2], duration: [1, 6] },
		{ pitch: null, offset: [11, 3], duration: [1, 6] },
		{ pitch: null, offset: [23, 6], duration: [1, 6] }
	]);
	expect(stepEntry.enteredNotes.slice(1).reduce<Fraction>((sum, n) => addFractions(sum, n.duration), [0, 1])).toEqual([1, 2]);
	expect(stepEntry.selectedNoteIndex).toBe(1);
	expect([stepEntry.currentDuration, stepEntry.tripletMode, stepEntry.dottedMode]).toEqual(['quarter', true, false]);
	for (const pitch of [2, 4, 5]) expect(addNote(pitch, 4, 'natural')).toBe(true);
	expect(stepEntry.enteredNotes.map(n => n.duration)).toEqual([[1, 2], [1, 6], [1, 6], [1, 6]]);
	expect(stepEntry.enteredNotes.slice(1).every(n => n.pitch !== null)).toBe(true);
});

it.each([
	{ span: [1, 1] as Fraction, member: [1, 3] as Fraction, base: 'half' },
	{ span: [1, 4] as Fraction, member: [1, 12] as Fraction, base: 'eighth' }
])('Triplet divides a $span rest into equal thirds and preserves the following note', ({ span, member, base }) => {
	const following = { pitch: 67, offset: span, duration: [1, 4] as Fraction };
	stepEntry.enteredNotes = [{ pitch: null, offset: [0, 1], duration: span }, following];
	selectNote(0);
	toggleTriplet();
	expect(stepEntry.enteredNotes.slice(0, 3)).toEqual([
		{ pitch: null, offset: [0, 1], duration: member },
		{ pitch: null, offset: member, duration: member },
		{ pitch: null, offset: addFractions(member, member), duration: member }
	]);
	expect(stepEntry.enteredNotes[3]).toEqual(following);
	expect(stepEntry.currentDuration).toBe(base);
});

it('Black Orpheus: shortening a half rest leaves two separately editable quarter rests', () => {
	stepEntry.enteredNotes = [
		{ pitch: 62, offset: [0, 1], duration: [1, 2] },
		{ pitch: null, offset: [1, 2], duration: [1, 2] }
	];
	selectNote(1);
	expect(setDuration('quarter')).toBe(true);
	expect(stepEntry.enteredNotes.slice(1)).toEqual([
		{ pitch: null, offset: [1, 2], duration: [1, 4] },
		{ pitch: null, offset: [3, 4], duration: [1, 4] }
	]);
	expect(stepEntry.selectedNoteIndex).toBe(1);
});

it('Black Orpheus: tying a half note into an existing quarter triplet preserves the triplet rhythm', () => {
	stepEntry.enteredNotes = [
		{ pitch: 74, offset: [0, 1], duration: [1, 2] },
		{ pitch: 74, offset: [1, 2], duration: [1, 6] },
		{ pitch: 73, offset: [2, 3], duration: [1, 6] },
		{ pitch: 71, offset: [5, 6], duration: [1, 6] }
	];
	const rhythm = stepEntry.enteredNotes.map(n => [n.offset, n.duration]);
	selectNote(0);
	expect(enterTiedNote()).toBe(true);
	expect(stepEntry.enteredNotes[0].tied).toBe(true);
	expect(stepEntry.enteredNotes.map(n => [n.offset, n.duration])).toEqual(rhythm);
	expect(enterTiedNote()).toBe(true);
	expect(stepEntry.enteredNotes[0].tied).toBe(false);
});


it('confirming a resized rest with 0 preserves the split and selects its remainder', () => {
	stepEntry.enteredNotes = [{ pitch: null, offset: [0, 1], duration: [1, 2] }];
	selectNote(0);
	setDuration('quarter');
	expect(addRest()).toBe(true);
	expect(stepEntry.enteredNotes.map(n => n.duration)).toEqual([[1, 4], [1, 4]]);
	expect(stepEntry.selectedNoteIndex).toBe(1);
});
