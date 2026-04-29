import type { DriveStep } from 'driver.js';

/**
 * Lick-practice tour — assumes the user is on /lick-practice. Explains
 * what "tagged" means, the 12-key rotation, progressions, and backing
 * styles.
 */
export const lickPracticeTour: DriveStep[] = [
	{
		popover: {
			title: 'Lick Practice — Side B',
			description:
				"Pick licks from the Library, tag them, and Mankunku will rotate each one through all 12 keys over a chord progression with a backing track. Builds the muscle memory for soloing across changes.",
			side: 'over',
			align: 'center'
		}
	},
	{
		popover: {
			title: 'What does "tagged" mean?',
			description:
				"Tagging is how you mark a lick for the practice rotation. In the Library, click the star icon on any lick to tag it. The set persists — tag once, practice forever.",
			side: 'over',
			align: 'center'
		}
	},
	{
		popover: {
			title: '12-key rotation',
			description:
				"Each tagged lick gets rotated through all 12 keys in a session. The app tracks your tempo and pass-rate per lick, per key — so the keys you struggle with surface more often.",
			side: 'over',
			align: 'center'
		}
	},
	{
		popover: {
			title: 'Progression types',
			description:
				"The harmony underneath each rotation. ii–V–I is the staple jazz cadence; turnaround adds a vi–ii–V loop; rhythm changes uses the I–vi–ii–V Gershwin pattern. Pick the one that matches the phrase you're drilling.",
			side: 'over',
			align: 'center'
		}
	},
	{
		popover: {
			title: 'Backing styles',
			description:
				"Swing for straight-ahead jazz, bossa nova for Latin feel, ballad for slow tempos with sustained comping, straight for rock/funk. The bass + drums + comping are generated to match.",
			side: 'over',
			align: 'center'
		}
	},
	{
		popover: {
			title: "When you're ready",
			description:
				"Pick a progression, a backing style, and a duration. If your set is empty, head to the Library and tag a few licks first. Pass a key cleanly and the next attempt bumps tempo +5 BPM.",
			side: 'over',
			align: 'center'
		}
	}
];
