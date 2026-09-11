import type { DriveStep } from 'driver.js';
import { navTourElement } from '$lib/tour/nav-target';

/**
 * First-run welcome tour — assumes the user is on the home page.
 * Covers the Side A / Side B split, the daily key concept, the books
 * (licks and tunes), and progress, then ends with a CTA to start practicing.
 *
 * Nav steps resolve through `navTourElement` rather than a raw
 * `[data-tour="nav-*"]` selector: the layout renders that attribute in both
 * the desktop bar and the mobile menu, and driver.js's `querySelector` would
 * always take the desktop one — invisible below the `sm` breakpoint. See
 * `nav-target.ts`.
 */
export const welcomeTour: DriveStep[] = [
	{
		popover: {
			title: 'Welcome to Mankunku',
			description:
				"A jazz ear-training practice tool. The app plays a phrase, you play it back on your instrument, and pitch + rhythm get scored in real time. Let's walk through the key spots.",
			align: 'center'
		}
	},
	{
		element: '[data-tour="side-a"]',
		popover: {
			title: 'Side A — Ear Training',
			description:
				"This is the call-and-response side. Mankunku plays a lick, you play it back. It works in one key + scale at a time — the daily key — and the difficulty adapts to your recent accuracy.",
			side: 'right',
			align: 'start'
		}
	},
	{
		element: '[data-tour="todays-key"]',
		popover: {
			title: "Today's key",
			description:
				"The key + scale you're working in. It holds for a few days at first, then changes daily once you've unlocked more, and new keys and scales join as you improve. Practicing all 12 keys is the canonical jazz drill — Coltrane practiced standards in every key before recording.",
			side: 'bottom',
			align: 'start'
		}
	},
	{
		element: '[data-tour="side-b"]',
		popover: {
			title: 'Side B — Lick Practice',
			description:
				"This side rotates a tagged lick through the keys it has earned over a chord progression (ii–V–I, turnaround, blues…), adding keys until it has all 12. A generated rhythm section keeps time. Tag licks from your book to fill your set.",
			side: 'left',
			align: 'start'
		}
	},
	{
		element: navTourElement('licks'),
		popover: {
			title: 'Your Licks',
			description:
				"Your lick book — everything you've recorded, written in the editor, or stolen from the community. Tag a lick here to send it to Lick Practice.",
			side: 'bottom',
			align: 'center'
		}
	},
	{
		element: navTourElement('tunes'),
		popover: {
			title: 'Your Tunes',
			description:
				"Whole song forms — charted by hand, imported from iReal Pro, Band-in-a-Box, MuseScore or a PDF, or adopted from the community. Open one and hit Practice licks: the band plays the form, and the app finds the ii-Vs and turnarounds in the changes and hands you those spots to fill with licks from your book. It's where Side A and Side B pay off.",
			side: 'bottom',
			align: 'center'
		}
	},
	{
		element: navTourElement('progress'),
		popover: {
			title: 'Progress',
			description:
				"Your practice calendar, streak, scale proficiency, key unlocks, and recent sessions live here. The calendar keeps every day you've practiced, even after older session details roll off.",
			side: 'bottom',
			align: 'center'
		}
	},
	{
		element: navTourElement('ear-training'),
		popover: {
			title: "Let's go.",
			description:
				"Tap Ear Training when you're ready. The app will load your instrument samples, play a phrase, then listen for your response. You can take this tour again from Settings → Tours & Help.",
			side: 'bottom',
			align: 'center'
		}
	}
];
