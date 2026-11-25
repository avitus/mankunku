import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import compiledAppCss from '../../../src/app.css?inline';

/**
 * Static sweeps over src/ that pin the design-token contract from app.css:
 *
 * 1. Every `var(--color-*)` reference resolves to a token defined in app.css.
 *    An undefined token fails silently in CSS (the property computes to
 *    nothing), so a typo like --color-bg-primary ships a broken hover.
 *    Font references are checked against the compiled stylesheet, including Tailwind.
 * 2. Solid colored fills (accent/success/error, incl. hover: variants) on
 *    text-bearing elements carry an explicit `text-white`. Without it the
 *    label inherits var(--color-text), which flips to near-black in light
 *    mode — dark-on-dark on the light-mode slate/teal fills.
 * 3. Small feedback text uses the text-safe tokens (--color-error-text /
 *    --color-warning-text), which exist precisely because the fill tokens
 *    fall below 4.5:1 as text on page/card surfaces.
 */

const SRC = join(__dirname, '../../../src');
const APP_CSS = readFileSync(join(SRC, 'app.css'), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (/\.(css|svelte|ts)$/.test(entry)) out.push(path);
	}
	return out;
}

const files = walk(SRC);
const rel = (path: string): string => relative(SRC, path);

// Vite resolves the same stylesheet imports and Tailwind theme as the app.
const fontDeclarations = compiledAppCss
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.matchAll(/[;{]\s*(--font-[\w-]+)\s*:/g);
const definedFonts = new Set(
	Array.from(fontDeclarations, (match) => match[1])
);

function undefinedFonts(source: string): Set<string> {
	const missing = new Set<string>();
	for (const [, token] of source.matchAll(/var\(\s*(--font-[\w-]+)\s*[,)]/g)) {
		if (!definedFonts.has(token)) missing.add(token);
	}
	return missing;
}

/** All class="…" attribute values in a Svelte file, including multi-line
 * attributes and embedded {ternary} expressions (inner quotes are single). */
function classAttrs(source: string): string[] {
	return [...source.matchAll(/class="([^"]*)"/gs)].map((m) => m[1]);
}

describe('design token consistency', () => {
	it('every var(--color-*) referenced in src/ is defined in app.css', () => {
		const defined = new Set(
			[...APP_CSS.matchAll(/(--color-[a-z0-9-]+)\s*:/g)].map((m) => m[1])
		);
		const undefinedUses = new Map<string, string[]>();
		for (const file of files.filter((file) => !file.endsWith('.css'))) {
			const source = readFileSync(file, 'utf8');
			for (const m of source.matchAll(/var\((--color-[a-z0-9-]+)\)/g)) {
				if (!defined.has(m[1])) {
					const users = undefinedUses.get(m[1]) ?? [];
					if (!users.includes(rel(file))) users.push(rel(file));
					undefinedUses.set(m[1], users);
				}
			}
		}
		expect(
			[...undefinedUses.entries()].map(([token, users]) => `${token} (${users.join(', ')})`)
		).toEqual([]);
	});

	it('every referenced font token is defined in the app stylesheet or its imports', () => {
		const violations: string[] = [];
		for (const file of files) {
			for (const token of undefinedFonts(readFileSync(file, 'utf8'))) {
				violations.push(`${token} (${rel(file)})`);
			}
		}
		expect(violations).toEqual([]);
	});

	it('accepts local and imported fonts and reports unknown fonts even with a fallback', () => {
		const source = `
			h1 { font-family: var(--font-display); }
			p { font-family: var(--font-sans); }
			b { font-family: var(--font-snsa); }
			i { font-family: var(--font-dispaly, Georgia); }
		`;
		expect([...undefinedFonts(source)]).toEqual(['--font-snsa', '--font-dispaly']);
	});

	it('solid colored fills on text-bearing elements set explicit white text', () => {
		// Heuristic: a font-weight utility marks a text-bearing control
		// (buttons/links); meters, dots, and hairlines that also use solid
		// fills never carry one.
		const solidFill = /(?:^|[\s'"{])(?:hover:)?bg-\[var\(--color-(?:accent|success|error)\)\](?!\/)/;
		const fontWeight = /\bfont-(?:medium|semibold|bold)\b/;
		const violations: string[] = [];
		for (const file of files.filter((f) => f.endsWith('.svelte'))) {
			for (const attr of classAttrs(readFileSync(file, 'utf8'))) {
				if (solidFill.test(attr) && fontWeight.test(attr) && !/text-white/.test(attr)) {
					violations.push(`${rel(file)}: "${attr.replace(/\s+/g, ' ').trim()}"`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it('phase colours are semantic aliases: the player PLAYS in brass, LISTENS in on-air red', () => {
		// Red reads as "stop" to most people, so it marks the phase in which the
		// user must NOT play (the app's demo), and brass marks the user's turn.
		// Defined once as aliases so each theme's brass/on-air values flow
		// through, and so a future swap is two lines here and nowhere else.
		expect(APP_CSS).toMatch(/--color-phase-play:\s*var\(--color-brass\)\s*;/);
		expect(APP_CSS).toMatch(/--color-phase-listen:\s*var\(--color-onair\)\s*;/);
	});

	it('the active practice row never reaches past the phase aliases to the palette tokens', () => {
		const source = readFileSync(join(SRC, 'lib/components/lick-practice/UpcomingKeysDisplay.svelte'), 'utf8');
		expect(source).not.toMatch(/var\(--color-(?:brass|brass-soft|onair|onair-hover)\)/);
	});

	it('feedback text uses the text-safe token variants, never the fill tokens', () => {
		const fillAsText = /text-\[var\(--color-(?:error|warning)\)\]/g;
		const violations: string[] = [];
		for (const file of files.filter((f) => f.endsWith('.svelte'))) {
			const source = readFileSync(file, 'utf8');
			source.split('\n').forEach((line, i) => {
				if (fillAsText.test(line)) violations.push(`${rel(file)}:${i + 1}`);
				fillAsText.lastIndex = 0;
			});
		}
		expect(violations).toEqual([]);
	});
});
