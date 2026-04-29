import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ALL_PAGES } from './structure';

/**
 * Slugs whose content is bundled into every chat request as system context.
 * Keep this small — every token costs latency and money. Architecture
 * details and API reference are intentionally excluded; the assistant cites
 * them by URL when relevant.
 */
const CORE_DOC_SLUGS = [
	'user-guide',
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

/** Read a doc file from /documentation/<slug>.md, returning empty on failure. */
async function readDoc(slug: string): Promise<string> {
	const filePath = path.resolve(process.cwd(), 'documentation', `${slug}.md`);
	try {
		return await readFile(filePath, 'utf-8');
	} catch (err) {
		console.warn(`[docs/context] Failed to read ${filePath}:`, err);
		return '';
	}
}

/**
 * Build the concatenated documentation block injected into the chat system
 * prompt. Each doc is prefixed with its slug so Claude can cite them.
 */
export async function getDocContext(): Promise<string> {
	if (cachedContext !== null) return cachedContext;

	const sections: string[] = [];
	for (const slug of CORE_DOC_SLUGS) {
		const content = await readDoc(slug);
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

	const content = await readDoc(slug);
	if (!content) return '';

	return `The user is currently viewing /docs/${slug} ("${meta.title}").\n\n${content}`;
}
