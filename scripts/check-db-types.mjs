#!/usr/bin/env node
/**
 * Drift check for the hand-maintained Supabase types.
 *
 * `src/lib/supabase/types.ts` is written BY HAND in the generator's format —
 * it is not generator output. That is deliberate: the hand-written file carries
 * a source-interface → table mapping in its header, omits the unused
 * `graphql_public` schema, and narrows one view column the generator cannot
 * prove non-null (see DELIBERATE_OVERRIDES below). Piping
 * `supabase gen types` over it would lose all three, so there is no
 * regenerate-in-place script — this checker exists instead.
 *
 * What it does: generates types from the LOCAL database into a temp file,
 * parses both into a table → column → type map, and reports any divergence.
 * It never writes to src/.
 *
 * Usage:
 *   npm run db:types:check      # requires the local stack (npm run db:start)
 *
 * Exit codes: 0 = in sync, 1 = drift found, 2 = could not run the generator.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMMITTED = join(ROOT, 'src/lib/supabase/types.ts');

/**
 * Hand-written narrowings that the generator will always disagree with.
 * Each needs a reason — if you add one, say why the generator is wrong.
 */
const DELIBERATE_OVERRIDES = {
	'public_lick_authors.id': {
		committed: 'string',
		generated: 'string | null',
		reason:
			'The view selects user_profiles.id (NOT NULL primary key), but Postgres ' +
			'cannot prove non-nullability through a view. Widening this to ' +
			'`string | null` would widen the Map key type at the three ' +
			'public_lick_authors call sites in persistence/community.ts for a value ' +
			'that is structurally never null.'
	},
	'public_tune_authors.id': {
		committed: 'string',
		generated: 'string | null',
		reason:
			'Same shape as public_lick_authors.id: the view selects ' +
			'user_profiles.id (NOT NULL primary key), which Postgres cannot prove ' +
			'non-nullable through a view. The lead-sheet community layer keys its ' +
			'author Map on this value, which is structurally never null.'
	}
};

/** Parse a generated-format types file into { table: { column: type } }. */
function parseRowTypes(source) {
	const tables = {};
	// Row blocks are indented 8 spaces inside a table key indented 6.
	const blockRe = /\n {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g;
	for (const [, table, body] of source.matchAll(blockRe)) {
		// First occurrence wins: the generated file repeats table names across
		// schemas (graphql_public then public); we want the public one, which
		// the generator emits with real columns rather than an empty block.
		if (tables[table]) continue;
		const columns = {};
		for (const line of body.split('\n')) {
			const m = line.match(/^\s*(\w+)\??:\s*(.+?),?\s*$/);
			if (m) columns[m[1]] = m[2].trim();
		}
		tables[table] = columns;
	}
	return tables;
}

function generateFromLocalDb() {
	try {
		return execFileSync(
			'npx',
			['supabase', 'gen', 'types', 'typescript', '--local'],
			{ cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }
		);
	} catch (err) {
		console.error('Could not generate types from the local database.\n');
		console.error('Is the local stack running?  npm run db:start\n');
		if (err.stderr) console.error(String(err.stderr).trim());
		process.exit(2);
	}
}

const generatedSource = generateFromLocalDb();
if (!generatedSource.includes('Row: {')) {
	console.error('Generator produced no table definitions — aborting without comparing.');
	process.exit(2);
}

// Keep the raw generator output around for the run, so drift messages can
// quote it verbatim and it can be inspected after a failure.
const scratch = mkdtempSync(join(tmpdir(), 'mankunku-dbtypes-'));
const generatedPath = join(scratch, 'generated-types.ts');
let keepScratch = false;

try {
	writeFileSync(generatedPath, generatedSource);

	const committed = parseRowTypes(readFileSync(COMMITTED, 'utf8'));
	const generated = parseRowTypes(generatedSource);

	const problems = [];
	const allTables = [...new Set([...Object.keys(committed), ...Object.keys(generated)])].sort();

	for (const table of allTables) {
		if (!committed[table]) {
			problems.push(`MISSING TABLE  ${table} — in the database, absent from types.ts`);
			continue;
		}
		if (!generated[table]) {
			problems.push(`STALE TABLE    ${table} — in types.ts, absent from the database`);
			continue;
		}
		const columns = [
			...new Set([...Object.keys(committed[table]), ...Object.keys(generated[table])])
		].sort();
		for (const column of columns) {
			const mine = committed[table][column];
			const theirs = generated[table][column];
			if (mine === undefined) {
				problems.push(
					`MISSING COLUMN ${table}.${column}: ${theirs}  — add it to types.ts`
				);
			} else if (theirs === undefined) {
				problems.push(
					`STALE COLUMN   ${table}.${column}: ${mine}  — no longer in the database`
				);
			} else if (mine.replace(/\s/g, '') !== theirs.replace(/\s/g, '')) {
				const override = DELIBERATE_OVERRIDES[`${table}.${column}`];
				const matches =
					override &&
					override.committed.replace(/\s/g, '') === mine.replace(/\s/g, '') &&
					override.generated.replace(/\s/g, '') === theirs.replace(/\s/g, '');
				if (!matches) {
					problems.push(
						`TYPE DRIFT     ${table}.${column}\n` +
							`                 types.ts:  ${mine}\n` +
							`                 database:  ${theirs}`
					);
				}
			}
		}
	}

	const overrideCount = Object.keys(DELIBERATE_OVERRIDES).length;
	const tableCount = Object.keys(generated).length;

	if (problems.length === 0) {
		console.log(
			`types.ts is in sync with the local database ` +
				`(${tableCount} tables, ${overrideCount} deliberate override${overrideCount === 1 ? '' : 's'}).`
		);
		process.exit(0);
	}

	keepScratch = true;
	console.error(`types.ts has drifted from the local database (${problems.length} issue${problems.length === 1 ? '' : 's'}):\n`);
	for (const problem of problems) console.error(`  ${problem}`);
	console.error(
		`\ntypes.ts is hand-maintained — edit it directly rather than regenerating,\n` +
			`or the header docs and the deliberate overrides are lost.\n` +
			`Full generator output for reference: ${generatedPath}\n` +
			`\nIf the local database is simply behind, apply migrations first:\n` +
			`  npx supabase migration up --local`
	);
	process.exit(1);
} finally {
	if (!keepScratch) rmSync(scratch, { recursive: true, force: true });
}
