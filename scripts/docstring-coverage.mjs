#!/usr/bin/env node
// Docstring coverage of the functions a diff touches — the metric CodeRabbit's
// pre-merge "Docstring Coverage" check scores on every PR (threshold 80%).
//
// CodeRabbit maps every changed line to its ENCLOSING function declaration —
// a body edit counts the function even when its signature line is untouched —
// and credits it only with a `/** ... */` block directly above the declaration
// (a `//` comment does not count; a named inner arrow const does). The check
// names no functions, so this scan lists them: every declaration the diff
// touches, and the ones with no docstring, per file.
//
// Usage: node scripts/docstring-coverage.mjs [base-ref] [--json out.json]
//   base-ref defaults to origin/main. The diff is WORKING TREE vs base, so the
//   numbers are right before and after committing (a committed-range diff read
//   against a working tree with uncommitted insertions lands its line numbers
//   on the wrong declarations).
import ts from 'typescript';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const base = args.find((a, i) => !a.startsWith('--') && (jsonIdx < 0 || i !== jsonIdx + 1)) ?? 'origin/main';

const diff = execSync(
	`git diff -U0 ${base} --diff-filter=AM -- '*.ts' '*.svelte' '*.js' '*.mjs' '*.cjs'`,
	{ encoding: 'utf8', maxBuffer: 1 << 28 }
);

/** Changed line numbers per file, read off the unified-diff hunk headers. */
const changed = new Map();
let file = null;
for (const line of diff.split('\n')) {
	if (line.startsWith('+++ b/')) {
		file = line.slice(6);
		changed.set(file, new Set());
		continue;
	}
	const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
	if (m && file) {
		const start = +m[1];
		const count = m[2] === undefined ? 1 : +m[2];
		const set = changed.get(file);
		if (count === 0) set.add(start); // a pure deletion touches the line it lands on
		for (let i = 0; i < count; i++) set.add(start + i);
	}
}

/** The `<script>` blocks of a .svelte file with their line offsets; a .ts file is one block. */
function scriptBlocks(path, src) {
	if (!path.endsWith('.svelte')) return [{ code: src, lineOffset: 0 }];
	const blocks = [];
	const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
	let m;
	while ((m = re.exec(src))) {
		const before = src.slice(0, m.index + m[0].indexOf('>') + 1);
		blocks.push({ code: m[1], lineOffset: before.split('\n').length - 1 });
	}
	return blocks;
}

/** A declaration's display name. */
function nameOf(node) {
	if (ts.isVariableDeclaration(node)) return node.name.getText();
	return node.name ? node.name.getText() : '<anonymous>';
}

/** True when the last comment directly above `node` is a JSDoc block (one opening with slash-star-star). */
function hasDocstring(sf, node) {
	const text = sf.getFullText();
	const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) || [];
	if (ranges.length === 0) return false;
	const last = ranges[ranges.length - 1];
	return text.slice(last.pos, last.pos + 3) === '/**';
}

const results = [];
for (const [path, lines] of changed) {
	if (!fs.existsSync(path)) continue;
	const src = fs.readFileSync(path, 'utf8');
	for (const { code, lineOffset } of scriptBlocks(path, src)) {
		const sf = ts.createSourceFile(
			path,
			code,
			ts.ScriptTarget.ESNext,
			true,
			path.endsWith('.svelte') ? ts.ScriptKind.TS : undefined
		);
		/** Walk one script block: record every declaration whose span holds a changed line. */
		const visit = (node) => {
			let decl = null;
			let docNode = null;
			if (
				ts.isFunctionDeclaration(node) ||
				ts.isMethodDeclaration(node) ||
				ts.isGetAccessor(node) ||
				ts.isSetAccessor(node)
			) {
				if (node.body) {
					decl = node;
					docNode = node;
				}
			} else if (
				ts.isVariableDeclaration(node) &&
				node.initializer &&
				(ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
			) {
				decl = node;
				// The docstring sits above the statement when it is the only declarator.
				const stmt = node.parent && node.parent.parent;
				docNode =
					stmt && ts.isVariableStatement(stmt) && node.parent.declarations.length === 1
						? stmt
						: node;
			}
			if (decl) {
				const startLine = sf.getLineAndCharacterOfPosition(decl.getStart()).line + 1 + lineOffset;
				const endLine = sf.getLineAndCharacterOfPosition(decl.getEnd()).line + 1 + lineOffset;
				let touched = false;
				for (let l = startLine; l <= endLine; l++) {
					if (lines.has(l)) {
						touched = true;
						break;
					}
				}
				if (touched) {
					results.push({ path, name: nameOf(decl), line: startLine, endLine, doc: hasDocstring(sf, docNode) });
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sf);
	}
}

results.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
const byFile = new Map();
for (const r of results) {
	if (!byFile.has(r.path)) byFile.set(r.path, []);
	byFile.get(r.path).push(r);
}
let total = 0;
let documented = 0;
for (const [p, rs] of byFile) {
	const d = rs.filter((r) => r.doc).length;
	total += rs.length;
	documented += d;
	console.log(`${p}: ${d}/${rs.length}`);
	for (const r of rs) if (!r.doc) console.log(`    - ${r.name} @${r.line}-${r.endLine}`);
}
const pct = ((100 * documented) / Math.max(total, 1)).toFixed(1);
console.log(`\nTOTAL files=${byFile.size} functions=${total} documented=${documented} (${pct}%)`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
