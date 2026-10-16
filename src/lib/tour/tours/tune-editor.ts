import type { DriveStep } from 'driver.js';

/**
 * Tune editor tour — assumes the user is on /tunes/editor. Covers the chart
 * as the thing you edit (click a note, type over it), the two meanings of
 * Delete, the note-entry rail, and the PDF review panel. Anchored steps use
 * the editor's `data-tour` selectors; conceptual steps are elementless cards
 * (same shape as tunesTour).
 */
export const tuneEditorTour: DriveStep[] = [
	{
		popover: {
			title: 'Editing a chart',
			description:
				"This editor works like MuseScore: the chart is the thing you edit. Click a note to select it, then the keys act on that note — A–G change its pitch, 1–5 its length, 0 turns it into a rest. The selection moves on, so you can retype a whole misread line without touching its rhythm.",
			align: 'center'
		}
	},
	{
		element: '[data-tour="tune-chart"]',
		popover: {
			title: 'The chart',
			description:
				"Click a note to edit it in place; click an empty bar to start writing there. Delete turns a note into a rest and leaves everything else on its beat; deleting a rest, or Ctrl/⌘ + Backspace on anything, removes its time and pulls the rest of the section earlier. Press I for insert mode, where new notes push the music along instead of replacing it.",
			side: 'bottom',
			align: 'start'
		}
	},
	{
		element: '[data-tour="tune-entry-rail"]',
		popover: {
			title: 'Note entry',
			description:
				"Durations, pitches, accidentals and the octave — or use the keyboard. The status line tells you where the next note lands and why an edit was refused. Insert bar and Delete bar act on the bar you're in.",
			side: 'left',
			align: 'start'
		}
	},
	{
		popover: {
			title: 'Checking a PDF import',
			description:
				"After a PDF import, the bars the reader wasn't sure of are highlighted on the chart. Press N to jump to the next one, compare it with the original measure in the panel under the chart, and fix what's wrong — a highlight clears as soon as you edit its bar.",
			align: 'center'
		}
	},
	{
		element: '[data-tour="tune-save"]',
		popover: {
			title: 'Save when it reads right',
			description:
				"Undo and redo cover every edit. Save (Update when editing) writes the tune to your book; Cancel leaves it as it was.",
			side: 'bottom',
			align: 'end'
		}
	}
];
