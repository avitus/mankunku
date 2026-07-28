import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Static sweeps over src/ that pin the design-token contract from app.css:
 *
 * 1. Every `var(--color-*)` reference resolves to a token defined in app.css.
 *    An undefined token fails silently in CSS (the property computes to
 *    nothing), so a typo like --color-bg-primary ships a broken hover.
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
		else if (/\.(svelte|ts)$/.test(entry)) out.push(path);
	}
	return out;
}

const files = walk(SRC);
const rel = (path: string) => relative(SRC, path);

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
		for (const file of files) {
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
