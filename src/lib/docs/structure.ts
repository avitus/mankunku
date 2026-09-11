/**
 * Documentation tree.
 *
 * Mirrors a subset of /documentation/ at the repo root — the in-app docs are
 * written for *musicians*, so engineering-focused files (api-reference, tech
 * stack, contributing, etc.) stay in the repo for developers but are not
 * surfaced here. Each `slug` is the URL fragment after `/docs/` (without
 * `.md`). The dynamic route under `/docs/[...slug]` validates against this
 * list — a slug not present here returns 404.
 */

export interface DocPage {
	slug: string;
	title: string;
	/** One-sentence blurb shown in section landing cards. */
	blurb?: string;
}

export interface DocSection {
	title: string;
	pages: DocPage[];
}

export const DOC_TREE: DocSection[] = [
	{
		title: 'First Steps',
		pages: [
			{
				slug: 'getting-started',
				title: 'Welcome',
				blurb: 'What Mankunku is, what it does for your ears, and how to start.'
			},
			{
				slug: 'user-guide',
				title: 'How to Practice',
				blurb:
					'Every room in the app — ear training, lick practice, your books, progress, settings — what you hear, what you play, and what each control does.'
			}
		]
	},
	{
		title: 'Tricks',
		pages: [
			{
				slug: 'tricks',
				title: 'Practicing Tricks',
				blurb:
					'Melodic devices — enclosures and triad pairs — drilled for fluency rather than exact reproduction.'
			}
		]
	},
	{
		title: 'Tunes',
		pages: [
			{
				slug: 'tunes',
				title: 'Your Tunes',
				blurb: 'Building a songbook — charting by hand, importing, and adopting whole song forms.'
			},
			{
				slug: 'tune-practice',
				title: 'Playing Over Tunes',
				blurb:
					'The session over a real form: insertion points, the setup screen, the three modes, strictness, and the head rule.'
			}
		]
	},
	{
		title: 'How It Works',
		pages: [
			{
				slug: 'architecture/overview',
				title: 'The Practice Modes',
				blurb:
					'Side A (Ear Training), Side B (Lick Practice), Tricks, and Tune Practice — when to use each.'
			},
			{
				slug: 'architecture/scoring-algorithm',
				title: 'How Scoring Works',
				blurb: 'What the app rewards, what it forgives, and why the score lands where it does.'
			},
			{
				slug: 'architecture/audio-pipeline',
				title: 'How the App Listens',
				blurb:
					'What the microphone hears, when it starts listening, why the room matters, and what to expect from pitch detection.'
			},
			{
				slug: 'architecture/tonality-system',
				title: 'The Daily Key',
				blurb: 'One key + scale at a time for ear training. Why it rotates, and how new tonalities unlock.'
			},
			{
				slug: 'architecture/adaptive-difficulty',
				title: 'Levels & Difficulty',
				blurb:
					'Your 1–100 level in each scale and key: how it climbs as you improve, and what each level adds musically.'
			},
			{
				slug: 'architecture/phrase-system',
				title: 'The Lick Catalog',
				blurb: 'Where the licks come from, what the categories mean, and how transposition keeps them on your horn.'
			}
		]
	},
	{
		title: 'Reference',
		pages: [
			{
				slug: 'reference/scale-and-lick-catalog',
				title: 'Scales & Lick Categories',
				blurb:
					'Every scale and every lick category, with lick counts, the minor-key categories, and the harmonic context each belongs to.'
			},
			{
				slug: 'reference/glossary',
				title: 'Glossary',
				blurb: 'Jazz terminology and app terms used throughout, defined in plain language.'
			}
		]
	}
];

export const ALL_PAGES: DocPage[] = DOC_TREE.flatMap((section) => section.pages);

export function getPage(slug: string): DocPage | undefined {
	return ALL_PAGES.find((p) => p.slug === slug);
}

export function getSectionFor(slug: string): DocSection | undefined {
	return DOC_TREE.find((section) => section.pages.some((p) => p.slug === slug));
}

export interface Breadcrumb {
	label: string;
	href: string;
}

/** Build breadcrumbs for the doc page at `slug`. */
export function getBreadcrumbs(slug: string): Breadcrumb[] {
	const crumbs: Breadcrumb[] = [{ label: 'Docs', href: '/docs' }];
	const section = getSectionFor(slug);
	if (section) {
		crumbs.push({ label: section.title, href: `/docs#${slugifySection(section.title)}` });
	}
	const page = getPage(slug);
	if (page) {
		crumbs.push({ label: page.title, href: `/docs/${slug}` });
	}
	return crumbs;
}

function slugifySection(title: string): string {
	return title.toLowerCase().replace(/\s+/g, '-');
}
