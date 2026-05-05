/**
 * Documentation tree.
 *
 * Mirrors the structure of /documentation/ at the repo root. Each `slug` is
 * the URL fragment after `/docs/` (without `.md`). Add new docs here when
 * adding files to /documentation/ — the sidebar reads from this list, and the
 * dynamic route under `/docs/[...slug]` validates against it.
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
		title: 'Quick Start',
		pages: [
			{
				slug: 'getting-started',
				title: 'Getting Started',
				blurb: 'Prerequisites, install, first run, and project structure.'
			},
			{
				slug: 'user-guide',
				title: 'User Guide',
				blurb: 'How to use the app: practice, library, progress, settings.'
			}
		]
	},
	{
		title: 'Architecture',
		pages: [
			{ slug: 'architecture/overview', title: 'Overview', blurb: 'High-level system design and component diagram.' },
			{ slug: 'architecture/tech-stack', title: 'Tech Stack', blurb: 'Technology choices and rationale.' },
			{ slug: 'architecture/data-model', title: 'Data Model', blurb: 'Core TypeScript types with field documentation.' },
			{ slug: 'architecture/audio-pipeline', title: 'Audio Pipeline', blurb: 'Playback, capture, detection, segmentation.' },
			{ slug: 'architecture/scoring-algorithm', title: 'Scoring Algorithm', blurb: 'DTW alignment, pitch and rhythm scoring, grading.' },
			{ slug: 'architecture/phrase-system', title: 'Phrase System', blurb: 'Library, generation, mutation, validation.' },
			{ slug: 'architecture/adaptive-difficulty', title: 'Adaptive Difficulty', blurb: 'Algorithm, leveling 1–100, difficulty profiles.' },
			{ slug: 'architecture/tonality-system', title: 'Tonality System', blurb: 'Daily key/scale selection, progressive unlocking.' },
			{ slug: 'architecture/state-management', title: 'State Management', blurb: 'Svelte 5 runes, state modules, persistence.' },
			{ slug: 'architecture/design-system', title: 'Design System', blurb: 'Color tokens, typography, the Blue Note aesthetic.' },
			{ slug: 'architecture/pitch-rhythm-coupling', title: 'Pitch & Rhythm Coupling', blurb: 'How the two scoring systems share state.' }
		]
	},
	{
		title: 'API Reference',
		pages: [
			{ slug: 'api-reference/audio', title: 'Audio', blurb: 'audio-context, playback, capture, pitch-detector, onset-detector.' },
			{ slug: 'api-reference/scoring', title: 'Scoring', blurb: 'alignment, pitch-scoring, rhythm-scoring, scorer, grades.' },
			{ slug: 'api-reference/music', title: 'Music', blurb: 'scales, chords, keys, intervals, notation, transposition.' },
			{ slug: 'api-reference/phrases', title: 'Phrases', blurb: 'generator, mutator, validator, library-loader.' },
			{ slug: 'api-reference/difficulty', title: 'Difficulty', blurb: 'adaptive, params.' },
			{ slug: 'api-reference/state', title: 'State', blurb: 'session, settings, progress, history, library state modules.' },
			{ slug: 'api-reference/components', title: 'Components', blurb: 'All Svelte components and route pages.' }
		]
	},
	{
		title: 'Contributing',
		pages: [
			{ slug: 'contributing/contributing', title: 'Contributing Guide', blurb: 'Workflow, branch naming, PR process, code style.' },
			{ slug: 'contributing/adding-licks', title: 'Adding Licks', blurb: 'Step-by-step guide to adding curated licks.' },
			{ slug: 'contributing/adding-scales', title: 'Adding Scales', blurb: 'Extending the scale catalog.' },
			{ slug: 'contributing/testing-guide', title: 'Testing Guide', blurb: 'Test patterns, mocking audio, writing new tests.' }
		]
	},
	{
		title: 'Reference',
		pages: [
			{ slug: 'reference/glossary', title: 'Glossary', blurb: 'Jazz, audio, and technical terminology.' },
			{ slug: 'reference/algorithm-details', title: 'Algorithm Details', blurb: 'DTW math, spectral flux, McLeod pitch method.' },
			{ slug: 'reference/browser-compatibility', title: 'Browser Compatibility', blurb: 'Web Audio API support, PWA, mobile caveats.' },
			{ slug: 'reference/scale-and-lick-catalog', title: 'Scale & Lick Catalog', blurb: 'All scales and the lick library with metadata.' }
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
