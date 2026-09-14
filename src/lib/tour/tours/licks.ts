import type { DriveStep } from 'driver.js';

/**
 * Licks tour — assumes the user is on /licks. Covers what your book
 * holds (the user's own + adopted licks), adding licks, and how the practice
 * sections relate to Lick Practice.
 */
export const licksTour: DriveStep[] = [
	{
		popover: {
			title: 'Your Licks',
			description:
				"This is your personal collection — the licks you've recorded, written in the editor, or stolen from the community. It's where you manage the lines you're learning for Lick Practice. (The app's built-in ear-training licks live inside Ear Training, not here.)",
			align: 'center'
		}
	},
	{
		element: '[data-tour="add-lick"]',
		popover: {
			title: 'Add a lick',
			description:
				'Record a line from your instrument or write it note by note in the editor. New licks land here, ready to tag for practice.',
			side: 'bottom',
			align: 'end'
		}
	},
	{
		popover: {
			title: 'Practice set',
			description:
				"Tap + Practice on a lick (or ☆ Add to Practice on its page) to add it here; Remove takes it out. Each card shows the tempo Lick Practice has you at on that line, the most recently drilled first, and Lick Practice rotates this set through every key it has earned at increasing tempo.",
			align: 'center'
		}
	},
	{
		popover: {
			title: 'Needs setup & community',
			description:
				"A lick tagged for practice but not yet assigned to a progression shows under “Needs setup” — open it to fix that. Steal more lines from the community page — Browse Community above — and they'll appear here too.",
			align: 'center'
		}
	}
];
