import type { DriveStep } from 'driver.js';

/**
 * Tunes tour — assumes the user is on /tunes. Covers what a tune is (as
 * distinct from a lick), the five ways to get one into the book, the chart
 * itself, and the hand-off to tune practice.
 *
 * Anchored steps use selectors that exist on /tunes; conceptual steps are
 * elementless so they read as full-width cards (same shape as licksTour).
 */
export const tunesTour: DriveStep[] = [
	{
		popover: {
			title: 'Your Tunes',
			description:
				"Your songbook. Where the Licks page holds one- and two-bar lines, this holds whole song forms — melody, changes, sections, repeats, endings. Read them, hear them, and practice your vocabulary over them.",
			side: 'over',
			align: 'center'
		}
	},
	{
		element: '[data-tour="add-tune"]',
		popover: {
			title: 'Five ways in',
			description:
				"Chart a tune by hand in the editor, or import one: paste an iReal Pro link, drop a Band-in-a-Box song, upload a MuseScore score, or let the AI read a PDF of a printed chart. Imports land in a review panel first — nothing is saved until you've looked at it.",
			side: 'bottom',
			align: 'end'
		}
	},
	{
		element: '[data-tour="browse-tune-community"]',
		popover: {
			title: 'Or steal one',
			description:
				"Charts other players have shared. Adopt one and it joins your book with their name on it; Return to community removes your copy.",
			side: 'bottom',
			align: 'end'
		}
	},
	{
		element: '[data-tour="tune-search"]',
		popover: {
			title: 'Finding a tune',
			description:
				'Searches your book and the curated shelf at once — by title, composer, style, or tag.',
			side: 'bottom',
			align: 'start'
		}
	},
	{
		popover: {
			title: 'Reading a chart',
			description:
				"Open any tune and it engraves Real Book style — jazz chord symbols, section letters, repeats, stacked first and second endings. The key selector reads in YOUR written pitch, so tap a key and the chart re-engraves where your horn reads it. Hit Play to hear it with the rhythm section.",
			side: 'over',
			align: 'center'
		}
	},
	{
		popover: {
			title: 'Then put your licks in it',
			description:
				"The Practice licks button on any tune is where the two halves of the app meet: Mankunku finds the ii-Vs and turnarounds hiding in the changes and hands you those spots to fill from your own practice set. Settings → Tours & Help has a walkthrough of that session.",
			side: 'over',
			align: 'center'
		}
	}
];
