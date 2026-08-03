import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Class guard for Sentry MANKUNKU-1E.
 *
 * supabase-js 2.111 resolves the realtime WebSocket constructor at CLIENT
 * CONSTRUCTION, so on a Node < 22 host any construction site missing
 * `nodeRealtimeFallback()` 500s whatever request runs it. The first hotfix
 * patched hooks.server.ts but missed the universal `+layout.ts` load — this
 * test scans src/ so a construction site can never again ship unguarded.
 * Delete together with node-websocket-fallback.ts once no host runs Node < 22.
 */

const SRC = join(__dirname, '../../../src');
const CONSTRUCTORS = /\b(createServerClient|createBrowserClient)\s*(<[^>]*>)?\s*\(/g;

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) return walk(full);
		return /\.(ts|svelte)$/.test(name) ? [full] : [];
	});
}

/**
 * The argument list of the call whose opening paren sits at `openParen`,
 * extracted by balanced-paren walk — binds assertions to THIS call, so
 * matching text elsewhere in the file can never satisfy the check.
 */
function callArguments(text: string, openParen: number): string {
	let depth = 0;
	for (let i = openParen; i < text.length; i++) {
		if (text[i] === '(') depth++;
		else if (text[i] === ')' && --depth === 0) return text.slice(openParen + 1, i);
	}
	return text.slice(openParen + 1);
}

function unguardedCalls(text: string, file: string, pattern: RegExp): string[] {
	const offenders: string[] = [];
	let match: RegExpExecArray | null;
	pattern.lastIndex = 0;
	while ((match = pattern.exec(text)) !== null) {
		// Skip import statements and doc comments — only real call sites.
		const lineStart = text.lastIndexOf('\n', match.index) + 1;
		const line = text.slice(lineStart, text.indexOf('\n', match.index));
		if (/^\s*(import|\*|\/\/|\/\*)/.test(line)) continue;
		const args = callArguments(text, match.index + match[0].length - 1);
		if (!args.includes('...nodeRealtimeFallback()')) {
			offenders.push(`${file}: ${line.trim()}`);
		}
	}
	return offenders;
}

describe('supabase client construction sites', () => {
	it('every createServerClient/createBrowserClient call spreads nodeRealtimeFallback()', () => {
		const offenders = walk(SRC).flatMap((file) =>
			unguardedCalls(readFileSync(file, 'utf8'), file.slice(SRC.length + 1), CONSTRUCTORS)
		);
		expect(offenders, `unguarded supabase client construction:\n${offenders.join('\n')}`).toEqual(
			[]
		);
	});

	it('the createClient call in admin.ts spreads nodeRealtimeFallback()', () => {
		const text = readFileSync(join(SRC, 'lib/supabase/admin.ts'), 'utf8');
		const offenders = unguardedCalls(
			text,
			'lib/supabase/admin.ts',
			/\bcreateClient\s*(<[^>]*>)?\s*\(/g
		);
		expect(offenders).toEqual([]);
	});
});
