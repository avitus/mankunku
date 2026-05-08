/**
 * Tests for `src/lib/docs/markdown.ts`.
 *
 * The renderer is downstream of two attacker-influenced inputs: the
 * documentation files we ship (low risk) AND the streaming output of the
 * docs-chat LLM (untrusted).  DOMPurify is the load-bearing sanitizer here;
 * removing or weakening it is a security bug.  These tests pin:
 *   - slugify edge cases (heading anchors are public URLs)
 *   - relative-link rewriting (.md stripping, ../ resolution, /documentation/
 *     prefix → /docs/ prefix, external links opening in a new tab)
 *   - DOMPurify scrubbing of <script>, javascript: URLs, and event handlers
 *   - whitelist preservation of the renderer's emitted attributes
 *     (data-lang, target on external links, header anchor ids)
 *   - markdownToPlainText for search indexing
 */
import { describe, it, expect } from 'vitest';
import { slugify, renderMarkdown, markdownToPlainText } from '$lib/docs/markdown';

describe('slugify', () => {
	it('lowercases and replaces whitespace with single dashes', () => {
		expect(slugify('Hello World')).toBe('hello-world');
	});

	it('strips punctuation and collapses repeated dashes', () => {
		expect(slugify('Hello, World!')).toBe('hello-world');
		expect(slugify('foo   bar')).toBe('foo-bar');
		expect(slugify('foo--bar')).toBe('foo-bar');
	});

	it('trims leading and trailing dashes / whitespace', () => {
		expect(slugify('  --A B--  ')).toBe('a-b');
	});

	it('preserves digits and underscores (\\w match)', () => {
		expect(slugify('Section 2_b')).toBe('section-2_b');
	});

	it('returns empty string when input has no word characters', () => {
		expect(slugify('!!!')).toBe('');
		expect(slugify('   ')).toBe('');
	});
});

describe('renderMarkdown — heading anchors', () => {
	it('emits <h1> with id derived from slugify(text)', () => {
		const { html, headings } = renderMarkdown('# Hello, World!');
		expect(html).toContain('id="hello-world"');
		expect(html).toContain('class="docs-heading docs-heading-1"');
		expect(headings).toEqual([{ depth: 1, text: 'Hello, World!', slug: 'hello-world' }]);
	});

	it('captures multiple headings with correct depth in source order', () => {
		const { headings } = renderMarkdown('# A\n\n## B\n\n### C');
		expect(
			headings.map((h: (typeof headings)[number]): string => `${h.depth}:${h.slug}`)
		).toEqual(['1:a', '2:b', '3:c']);
	});
});

describe('renderMarkdown — link rewriting', () => {
	it('rewrites a relative .md link by stripping the extension', () => {
		// `currentSlug` is `'architecture/foo'`, so `./bar.md` resolves to
		// /docs/architecture/bar.
		const { html } = renderMarkdown('[bar](./bar.md)', 'architecture/foo');
		expect(html).toContain('href="/docs/architecture/bar"');
		expect(html).not.toContain('target="_blank"');
		expect(html).not.toContain('.md');
	});

	it('walks ../ to drop a path segment', () => {
		const { html } = renderMarkdown(
			'[guide](../user-guide.md#install)',
			'architecture/foo'
		);
		expect(html).toContain('href="/docs/user-guide#install"');
	});

	it('rewrites /documentation/ absolute prefix to /docs/', () => {
		const { html } = renderMarkdown('[x](/documentation/getting-started.md)');
		expect(html).toContain('href="/docs/getting-started"');
	});

	it('marks external https links with target=_blank + rel noopener', () => {
		const { html } = renderMarkdown('[anth](https://anthropic.com)');
		expect(html).toContain('href="https://anthropic.com"');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain('docs-link-external');
	});

	it('leaves anchor-only links untouched (#section)', () => {
		const { html } = renderMarkdown('[top](#top)', 'foo');
		expect(html).toContain('href="#top"');
		expect(html).not.toContain('target="_blank"');
	});
});

describe('renderMarkdown — DOMPurify sanitization (security)', () => {
	it('strips <script> tags from raw HTML inside markdown', () => {
		const { html } = renderMarkdown('Hello <script>alert(1)</script> world');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('alert(1)');
		expect(html).toContain('Hello');
		expect(html).toContain('world');
	});

	it('neutralizes javascript: hrefs by routing through the /docs/ resolver', () => {
		// The renderer's link rewriter only treats `https?:`/`mailto:` as
		// external. Anything else — including `javascript:` — falls into the
		// relative-resolution branch and emerges as a /docs/-prefixed path.
		// The end result is a dead navigation link rather than executable JS.
		const { html } = renderMarkdown('[click](javascript:alert(1))');
		// Most importantly, the href must NOT begin with `javascript:` —
		// that's what would trigger script execution on click.
		expect(html).not.toMatch(/href="javascript:/);
		// The href must start with `/docs/` (or `#`), proving it went through
		// the safe rewrite path.
		expect(html).toMatch(/href="\/docs\//);
	});

	it('removes inline event handlers like onclick=', () => {
		const { html } = renderMarkdown('<p onclick="alert(1)">hi</p>');
		expect(html).not.toMatch(/\bonclick=/);
	});

	it('preserves data-lang on code blocks (whitelist add)', () => {
		// The renderer emits `data-lang="ts"`; DOMPurify must not strip it
		// because we add it to ADD_ATTR.
		const { html } = renderMarkdown('```ts\nconst x = 1\n```');
		expect(html).toContain('data-lang="ts"');
		expect(html).toContain('class="language-ts"');
		expect(html).toContain('const x = 1');
	});

	it('preserves target=_blank on external links (whitelist add)', () => {
		const { html } = renderMarkdown('[x](https://x.com)');
		expect(html).toContain('target="_blank"');
	});
});

describe('renderMarkdown — code blocks', () => {
	it('escapes HTML special characters inside code', () => {
		// The custom code renderer escapes `<` `>` `&` BEFORE handing to
		// the parent template, so users see literal angle brackets, not
		// browser-parsed tags.
		const { html } = renderMarkdown('```\n<div>&amp;</div>\n```');
		expect(html).toContain('&lt;div&gt;');
		// `&amp;` in the source is escaped to `&amp;amp;` for display
		expect(html).toContain('&amp;amp;');
	});

	it('uses lang=plain when none is specified', () => {
		const { html } = renderMarkdown('```\nplain text\n```');
		expect(html).toContain('data-lang="plain"');
	});

	it('takes only the first whitespace-separated token as language', () => {
		const { html } = renderMarkdown('```ts foo bar\nx\n```');
		expect(html).toContain('data-lang="ts"');
	});
});

describe('markdownToPlainText', () => {
	it('extracts plain text from headings, paragraphs, and lists', () => {
		const text = markdownToPlainText('# Title\n\nHello *world*\n\n- a\n- b');
		// Marked tokenizer flattens to text segments; assert key words appear.
		expect(text).toContain('Title');
		expect(text).toContain('Hello');
		expect(text).toContain('a');
		expect(text).toContain('b');
	});

	it('collapses whitespace runs into single spaces', () => {
		// The function ends with `.replace(/\s+/g, ' ').trim()`.
		const text = markdownToPlainText('  Hello\n\n   World   ');
		expect(text).toBe(text.replace(/\s+/g, ' ').trim());
		expect(text).not.toMatch(/\s{2,}/);
	});

	it('returns empty string for whitespace-only input', () => {
		expect(markdownToPlainText('   \n  \n')).toBe('');
	});
});
