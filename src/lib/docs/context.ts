import { ALL_PAGES } from './structure';

// Bundle every documentation/*.md into the build at compile time. Reading from
// process.cwd() at runtime fails in production because the deploy ships only
// build/ + package files (see .circleci/continue-config.yml), not the
// documentation/ tree — which left this chat doc context EMPTY in prod, so the
// assistant answered every question as "not documented". Mirrors the docs-site
// loader in src/routes/docs/[...slug]/+page.server.ts. See Sentry MANKUNKU-N.
const DOC_FILES = import.meta.glob<string>('/documentation/**/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
});

/**
 * Slugs whose content is bundled into every chat request as system context.
 * Keep this small — every token costs latency and money. Architecture
 * details and API reference are intentionally excluded; the assistant cites
 * them by URL when relevant.
 *
 * `tunes` and `tune-practice` earn their place despite the size rule: the
 * tune half of the app has its own vocabulary (insertion points, the head
 * rule, the importers) that appears nowhere else in the core set, so without
 * them the assistant answers a third of the product with "not documented" —
 * the same failure this module's bundling exists to prevent. `tricks` is here
 * for the same reason: it is a whole practice mode, and its vocabulary
 * (variants, the mastery ladder, conformance vs. exact reproduction, the
 * fluency score) appears in no other core doc.
 */
const CORE_DOC_SLUGS = [
	'user-guide',
	'tricks',
	'tunes',
	'tune-practice',
	'architecture/overview',
	'architecture/scoring-algorithm',
	'architecture/adaptive-difficulty',
	'architecture/tonality-system',
	'reference/glossary'
];

/**
 * Lazily-loaded cache of the concatenated doc context. Read once on first
 * request and reused thereafter; restart the server to pick up doc edits.
 */
let cachedContext: string | null = null;

/** Return the bundled markdown for /documentation/<slug>.md, or '' if absent. */
function readDoc(slug: string): string {
	return DOC_FILES[`/documentation/${slug}.md`] ?? '';
}

/**
 * Build the concatenated documentation block injected into the chat system
 * prompt. Each doc is prefixed with its slug so Claude can cite them.
 */
export async function getDocContext(): Promise<string> {
	if (cachedContext !== null) return cachedContext;

	const sections: string[] = [];
	for (const slug of CORE_DOC_SLUGS) {
		const content = readDoc(slug);
		if (!content) continue;
		sections.push(`<doc slug="${slug}" url="/docs/${slug}">\n${content}\n</doc>`);
	}

	cachedContext = sections.join('\n\n');
	return cachedContext;
}

/**
 * Build a short page-context block from the current doc the user is viewing.
 * Pre-pended to the user's message so questions like "what does this mean?"
 * have a referent. Returns empty string when no slug or no matching page.
 */
export async function getPageContext(slug: string | undefined): Promise<string> {
	if (!slug) return '';
	const meta = ALL_PAGES.find((p) => p.slug === slug);
	if (!meta) return '';

	const content = readDoc(slug);
	if (!content) return '';

	return `The user is currently viewing /docs/${slug} ("${meta.title}").\n\n${content}`;
}
