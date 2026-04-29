import type { DriveStep } from 'driver.js';

/**
 * First-run welcome tour — assumes the user is on the home page.
 * Covers the Side A / Side B split, the daily key concept, the level
 * system, and the auth panel, then ends with a CTA to start practicing.
 */
export const welcomeTour: DriveStep[] = [
	{
		popover: {
			title: 'Welcome to Mankunku',
			description:
				"A jazz ear-training practice tool. The app plays a phrase, you play it back on your instrument, and pitch + rhythm get scored in real time. Let's walk through the key spots.",
			side: 'over',
			align: 'center'
		}
	},
	{
		element: '[data-tour="side-a"]',
		popover: {
			title: 'Side A — Ear Training',
			description:
				"This is the call-and-response side. Mankunku plays a lick, you play it back. Each day rotates a new key + scale combination, and the difficulty adapts to your recent accuracy.",
			side: 'right',
			align: 'start'
		}
	},
	{
		element: '[data-tour="todays-key"]',
		popover: {
			title: "Today's key",
			description:
				"Every 24 hours rotates through a new key + scale. Practicing all 12 keys is the canonical jazz drill — Coltrane practiced standards in every key before recording.",
			side: 'bottom',
			align: 'start'
		}
	},
	{
		element: '[data-tour="side-b"]',
		popover: {
			title: 'Side B — Lick Practice',
			description:
				"This side rotates a tagged lick across all 12 keys over a chord progression (ii–V–I, blues, rhythm changes…). Backing track keeps time. Tag licks from the Library to fill your set.",
			side: 'left',
			align: 'start'
		}
	},
	{
		element: '[data-tour="nav-library"]',
		popover: {
			title: 'Library',
			description:
				"Curated and user-recorded licks live here. Star a lick to tag it for Lick Practice, filter by category and difficulty, search by name.",
			side: 'bottom',
			align: 'center'
		}
	},
	{
		element: '[data-tour="nav-progress"]',
		popover: {
			title: 'Progress',
			description:
				"Your practice calendar, streak, scale proficiency, and recent sessions live here. Daily summaries persist beyond the 100-session pruning window.",
			side: 'bottom',
			align: 'center'
		}
	},
	{
		element: '[data-tour="nav-ear-training"]',
		popover: {
			title: "Let's go.",
			description:
				"Tap Ear Training when you're ready. The app will load your instrument samples, play a phrase, then listen for your response. You can take this tour again from Settings.",
			side: 'bottom',
			align: 'center'
		}
	}
];
