import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Class guard for Sentry MANKUNKU-1E.
 *
 * supabase-js 2.111 resolves the realtime WebSocket constructor at CLIENT
 * CONSTRUCTION, so on a Node < 22 host any construction site missing
 * `...nodeRealtimeFallback()` 500s whatever request runs it. The first hotfix
 * patched hooks.server.ts but missed the universal `+layout.ts` load — this
 * test scans src/ so a construction site can never again ship unguarded.
 *
 * The scan is syntax-aware (TypeScript AST, not substrings): a commented-out
 * or stringified spread does NOT count as guarded, and comments/strings can't
 * confuse call extraction. Svelte files contribute their <script> blocks;
 * markup expressions can't construct supabase clients.
 *
 * Delete together with node-websocket-fallback.ts once no host runs Node < 22.
 */

const SRC = join(__dirname, '../../../src');
const FACTORY_NAMES = new Set(['createServerClient', 'createBrowserClient']);

interface ScanResult {
	/** Real constructor CALL expressions found (imports/declarations excluded by parsing). */
	matched: number;
	offenders: string[];
}

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) return walk(full);
		return /\.(ts|svelte)$/.test(name) ? [full] : [];
	});
}

function scriptSources(file: string, text: string): string[] {
	if (!file.endsWith('.svelte')) return [text];
	return [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/** True when the call's final argument is an object literal spreading nodeRealtimeFallback(). */
function hasFallbackSpread(call: ts.CallExpression, sf: ts.SourceFile): boolean {
	const last = call.arguments[call.arguments.length - 1];
	if (!last || !ts.isObjectLiteralExpression(last)) return false;
	return last.properties.some(
		(prop) =>
			ts.isSpreadAssignment(prop) &&
			ts.isCallExpression(prop.expression) &&
			prop.expression.expression.getText(sf) === 'nodeRealtimeFallback'
	);
}

function scanSource(source: string, factoryNames: Set<string>, label: string): ScanResult {
	const sf = ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true);
	const result: ScanResult = { matched: 0, offenders: [] };
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const callee = node.expression;
			if (ts.isIdentifier(callee) && factoryNames.has(callee.text)) {
				result.matched++;
				if (!hasFallbackSpread(node, sf)) {
					const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
					result.offenders.push(`${label}:${line + 1} ${callee.text}(...)`);
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return result;
}

function scanFile(file: string, factoryNames: Set<string>): ScanResult {
	const label = file.slice(SRC.length + 1);
	const text = readFileSync(file, 'utf8');
	return scriptSources(file, text)
		.map((source) => scanSource(source, factoryNames, label))
		.reduce(
			(acc, scan) => ({
				matched: acc.matched + scan.matched,
				offenders: [...acc.offenders, ...scan.offenders]
			}),
			{ matched: 0, offenders: [] }
		);
}

describe('supabase client construction sites', () => {
	it('every createServerClient/createBrowserClient call spreads nodeRealtimeFallback()', () => {
		const scans = walk(SRC).map((file) => scanFile(file, FACTORY_NAMES));
		// A zero-match scan means the pattern rotted (e.g. factories renamed) —
		// that must fail, not pass vacuously.
		const matched = scans.reduce((count, scan) => count + scan.matched, 0);
		expect(matched).toBeGreaterThan(0);
		const offenders = scans.flatMap((scan) => scan.offenders);
		expect(offenders, `unguarded supabase client construction:\n${offenders.join('\n')}`).toEqual(
			[]
		);
	});

	it('the createClient call in admin.ts spreads nodeRealtimeFallback()', () => {
		const scan = scanFile(join(SRC, 'lib/supabase/admin.ts'), new Set(['createClient']));
		expect(scan.matched).toBe(1);
		expect(scan.offenders).toEqual([]);
	});
});

describe('the scanner itself', () => {
	const NAMES = new Set(['createServerClient', 'createBrowserClient']);

	it('accepts a real spread, including generic calls', () => {
		const scan = scanSource(
			`const c = createServerClient<Database>(url, key, {
				...nodeRealtimeFallback(),
				cookies: { getAll: () => [] }
			});`,
			NAMES,
			'fixture'
		);
		expect(scan).toEqual({ matched: 1, offenders: [] });
	});

	it('flags an unguarded call', () => {
		const scan = scanSource(`createBrowserClient(url, key, { global: { fetch } });`, NAMES, 'fx');
		expect(scan.matched).toBe(1);
		expect(scan.offenders).toHaveLength(1);
	});

	it('a commented-out spread does not count as guarded', () => {
		const scan = scanSource(
			`createBrowserClient(url, key, {
				// ...nodeRealtimeFallback(),
				global: { fetch }
			});`,
			NAMES,
			'fx'
		);
		expect(scan.offenders).toHaveLength(1);
	});

	it('a string mentioning the spread does not count as guarded', () => {
		const scan = scanSource(
			`createBrowserClient(url, key, { note: '...nodeRealtimeFallback()' });`,
			NAMES,
			'fx'
		);
		expect(scan.offenders).toHaveLength(1);
	});

	it('parentheses inside strings do not break call extraction', () => {
		const scan = scanSource(
			`createServerClient(url, ':-) (((', { ...nodeRealtimeFallback() });`,
			NAMES,
			'fx'
		);
		expect(scan).toEqual({ matched: 1, offenders: [] });
	});

	it('imports and identifiers that merely start with a factory name are not calls', () => {
		const scan = scanSource(
			`import { createServerClient } from '@supabase/ssr';
			const createServerClientFactory = () => null;
			createServerClientFactory();`,
			NAMES,
			'fx'
		);
		expect(scan.matched).toBe(0);
	});
});
