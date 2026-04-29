import { Marked } from 'marked';
import type { Tokens } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Slugify text into a URL-safe heading anchor (matches GitHub's algorithm
 * loosely — lowercase, dashes for spaces, drop non-word characters).
 */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

/** Strip Markdown emphasis tokens to plain text for slug generation. */
function tokensToText(tokens: Tokens.Heading['tokens']): string {
	const parts: string[] = [];
	for (const tok of tokens) {
		if ('text' in tok) parts.push(tok.text);
		else if ('raw' in tok) parts.push(tok.raw);
	}
	return parts.join('');
}

/**
 * Decide whether a markdown link is internal-app (relative to /docs) or
 * external. Internal links beginning with `./`, `../`, or a doc relative path
 * are rewritten to `/docs/<resolved>`; external (http://, https://, mailto:)
 * stay verbatim and open in a new tab.
 */
function rewriteLink(href: string, currentSlug: string): { href: string; external: boolean } {
	if (/^(https?:|mailto:)/i.test(href)) {
		return { href, external: true };
	}

	if (href.startsWith('#')) {
		return { href, external: false };
	}

	// Strip .md extension; resolve relative paths against the current doc slug.
	const cleaned = href.replace(/\.md(#|$)/, '$1');

	if (cleaned.startsWith('/')) {
		// Absolute path inside the project — assume it's the same shape as `/docs/...`
		const docPath = cleaned.replace(/^\/?documentation\//, '/docs/');
		return { href: docPath, external: false };
	}

	// Relative resolution
	const slugParts = currentSlug ? currentSlug.split('/').slice(0, -1) : [];
	const targetParts = cleaned.split('/');
	for (const part of targetParts) {
		if (part === '..') slugParts.pop();
		else if (part !== '.') slugParts.push(part);
	}
	const resolved = slugParts.join('/');
	return { href: resolved ? `/docs/${resolved}` : '/docs', external: false };
}

export interface RenderResult {
	html: string;
	headings: { depth: number; text: string; slug: string }[];
}

/**
 * Render markdown to HTML with anchored headings, syntax-aware code-block
 * classes, and internal/external link rewriting.
 *
 * `currentSlug` is the doc the markdown belongs to — used to resolve relative
 * links like `./foo.md` to `/docs/<dir>/foo`.
 */
export function renderMarkdown(markdown: string, currentSlug = ''): RenderResult {
	const headings: RenderResult['headings'] = [];
	const m = new Marked();
	m.use({
		gfm: true,
		breaks: false,
		renderer: {
			heading(token) {
				const text = tokensToText(token.tokens);
				const slug = slugify(text);
				headings.push({ depth: token.depth, text, slug });
				const inner = this.parser.parseInline(token.tokens);
				return `<h${token.depth} id="${slug}" class="docs-heading docs-heading-${token.depth}"><a class="docs-anchor" href="#${slug}" aria-hidden="true">#</a>${inner}</h${token.depth}>\n`;
			},
			code({ text, lang }) {
				const language = (lang ?? '').trim().split(/\s+/)[0] || 'plain';
				const escaped = text
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;');
				return `<pre class="docs-code" data-lang="${language}"><code class="language-${language}">${escaped}</code></pre>\n`;
			},
			codespan({ text }) {
				return `<code class="docs-codespan">${text}</code>`;
			},
			link(token) {
				const inner = this.parser.parseInline(token.tokens);
				const { href: resolved, external } = rewriteLink(token.href, currentSlug);
				const titleAttr = token.title ? ` title="${token.title.replace(/"/g, '&quot;')}"` : '';
				if (external) {
					return `<a class="docs-link docs-link-external" href="${resolved}" target="_blank" rel="noopener noreferrer"${titleAttr}>${inner}</a>`;
				}
				return `<a class="docs-link" href="${resolved}"${titleAttr}>${inner}</a>`;
			},
			table(token) {
				const headRow = token.header
					.map((cell) => `<th>${this.parser.parseInline(cell.tokens)}</th>`)
					.join('');
				const bodyRows = token.rows
					.map(
						(row) =>
							`<tr>${row.map((cell) => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join('')}</tr>`
					)
					.join('');
				return `<div class="docs-table-wrap"><table class="docs-table"><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table></div>\n`;
			}
		}
	});

	const rawHtml = m.parse(markdown, { async: false }) as string;
	// Sanitize: marked v18 doesn't strip raw HTML by default, and the chat
	// renderer streams untrusted LLM output through this. DOMPurify scrubs
	// any `<script>`, inline event handlers, and javascript: URLs while
	// keeping our renderer's emitted attributes (id, class, href, target,
	// rel, title, data-lang) intact.
	const html = DOMPurify.sanitize(rawHtml, {
		ADD_ATTR: ['target', 'data-lang']
	});
	return { html, headings };
}

/** Strip markdown formatting and return plain text. Used for search indexing. */
export function markdownToPlainText(markdown: string): string {
	const m = new Marked({ async: false });
	const tokens = m.lexer(markdown);
	const parts: string[] = [];
	for (const tok of tokens) {
		if ('text' in tok && typeof tok.text === 'string') parts.push(tok.text);
		else if ('raw' in tok && typeof tok.raw === 'string') parts.push(tok.raw);
	}
	return parts.join(' ').replace(/\s+/g, ' ').trim();
}
