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

describe('supabase client construction sites', () => {
	it('every createServerClient/createBrowserClient call spreads nodeRealtimeFallback()', () => {
		const offenders: string[] = [];
		for (const file of walk(SRC)) {
			const text = readFileSync(file, 'utf8');
			let match: RegExpExecArray | null;
			CONSTRUCTORS.lastIndex = 0;
			while ((match = CONSTRUCTORS.exec(text)) !== null) {
				// Skip import statements and doc comments — only real call sites,
				// which are followed by an options object within the next ~400 chars.
				const lineStart = text.lastIndexOf('\n', match.index) + 1;
				const line = text.slice(lineStart, text.indexOf('\n', match.index));
				if (/^\s*(import|\*|\/\/|\/\*)/.test(line)) continue;
				const window = text.slice(match.index, match.index + 400);
				if (!window.includes('nodeRealtimeFallback()')) {
					offenders.push(`${file.slice(SRC.length + 1)}: ${line.trim()}`);
				}
			}
		}
		expect(offenders, `unguarded supabase client construction:\n${offenders.join('\n')}`).toEqual(
			[]
		);
	});

	it('createClient in admin.ts spreads nodeRealtimeFallback()', () => {
		const text = readFileSync(join(SRC, 'lib/supabase/admin.ts'), 'utf8');
		expect(text).toContain('nodeRealtimeFallback()');
	});
});
