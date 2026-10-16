import { beforeEach, expect, it } from 'vitest';
import { settings } from '$lib/state/settings.svelte';
import { stepEntry, reset, selectNote, setDuration, enterTiedNote } from '$lib/state/step-entry.svelte';

beforeEach(() => { settings.instrumentId = 'concert'; reset(); });

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
