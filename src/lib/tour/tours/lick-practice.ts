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
				"Pick licks from your book on the Licks page, tag them, and Mankunku will rotate each one through all 12 keys over a chord progression with a backing track. Builds the muscle memory for soloing across changes.",
			side: 'over',
			align: 'center'
		}
	},
	{
		popover: {
			title: 'What does "tagged" mean?',
			description:
				"Tagging is how you mark a lick for the practice rotation. On the Licks page, click the star icon on any lick to tag it. The set persists — tag once, practice forever.",
			side: 'over',
			align: 'center'
		}
	},
	{
		popover: {
			title: 'Gradual 12-key unlock',
			description:
				"Each tagged lick starts in just one key — its home key — and earns the next key once you've passed it three times cleanly (avg session score ≥ 90%, and no key below 75% in the session that earns it). Keys come in easiest-to-hardest order, one accidental at a time, alternating sharps and flats from home. You'll have all 12 in time; for now you only practice what you've earned.",
			side: 'over',
			align: 'center'
		}
	},
	{
		popover: {
			title: 'Progression types',
			description:
				"The harmony underneath each rotation. Ten of them: minor, major, and dominant vamps; short and long ii–V–I in major and minor; turnaround; iii–VI–ii–V–I; and blues. Pick the one that matches the phrase you're drilling — each progression has its own colour, and you'll see it again on the lick's card and on any tune chart where it turns up.",
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
				"Daily Practice is the default — it rotates across every progression you've tagged, so just set a duration and go. Switch to Focused Session to drill one progression, or Deep Practice to master a single lick. If your set is empty, head to your Licks page and tag a few licks first. After each lick, the tempo adjusts on your average across its keys: +2 BPM at 95%+, +1 at 90%+, −1 in the 75–89% band, and −3 below 75%. A single key under 75% blocks any INCREASE, even when the average looks fine.",
			side: 'over',
			align: 'center'
		}
	}
];
