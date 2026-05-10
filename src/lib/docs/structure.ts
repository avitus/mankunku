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
				blurb: 'A walk through the practice loop — what you hear, what you play, what gets scored.'
			}
		]
	},
	{
		title: 'How It Works',
		pages: [
			{
				slug: 'architecture/overview',
				title: 'Two Practice Modes',
				blurb: 'Side A (Ear Training) and Side B (Lick Practice) — when to use each.'
			},
			{
				slug: 'architecture/scoring-algorithm',
				title: 'How Scoring Works',
				blurb: 'What the app rewards, what it forgives, and why the score lands where it does.'
			},
			{
				slug: 'architecture/audio-pipeline',
				title: 'How the App Listens',
				blurb: 'What the microphone hears, why the room matters, and what to expect from pitch detection.'
			},
			{
				slug: 'architecture/tonality-system',
				title: 'The Daily Key',
				blurb: 'A new key + scale every day. Why it rotates, and how new tonalities unlock.'
			},
			{
				slug: 'architecture/adaptive-difficulty',
				title: 'Levels & Difficulty',
				blurb: 'How the difficulty climbs as you improve — and what each level adds musically.'
			},
			{
				slug: 'architecture/phrase-system',
				title: 'The Lick Library',
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
				blurb: 'Every scale and every lick category, with the harmonic context they belong to.'
			},
			{
				slug: 'reference/glossary',
				title: 'Glossary',
				blurb: 'Jazz terminology used throughout the app, defined in plain language.'
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
