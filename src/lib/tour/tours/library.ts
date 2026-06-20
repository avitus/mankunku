import type { DriveStep } from 'driver.js';

/**
 * Library tour — assumes the user is on /library. Covers what the library now
 * holds (the user's own + adopted licks), adding licks, and how the practice
 * sections relate to Lick Practice.
 */
export const libraryTour: DriveStep[] = [
	{
		popover: {
			title: 'Your Licks',
			description:
				"This is your personal collection — the licks you've recorded, step-entered, or adopted from the community. It's where you manage the lines you're learning for Lick Practice. (The app's built-in ear-training licks live inside Ear Training and Lick Practice, not here.)",
			side: 'over',
			align: 'center'
		}
	},
	{
		element: '[data-tour="add-lick"]',
		popover: {
			title: 'Add a lick',
			description:
				'Record a line from your instrument or step-enter it note by note. New licks land here, ready to tag for practice.',
			side: 'bottom',
			align: 'end'
		}
	},
	{
		popover: {
			title: 'Practice set',
			description:
				"Open a lick and tag it for practice to add it here. Each card shows when you last drilled it, and Lick Practice rotates this set through every key at increasing tempo.",
			side: 'over',
			align: 'center'
		}
	},
	{
		popover: {
			title: 'Needs setup & community',
			description:
				"A lick tagged for practice but not yet assigned to a progression shows under “Needs setup” — open it to fix that. Adopt more lines from the Community page and they'll appear here too.",
			side: 'over',
			align: 'center'
		}
	}
];
