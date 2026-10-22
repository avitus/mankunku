import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { test as base } from '@playwright/test';
import { recordAppChunks } from './app-chunks';

/**
 * Per-test coverage for CircleCI test impact analysis — the `analysis`
 * command of the "e2e tests" suite in .circleci/test-suites.yml.
 *
 * Off unless CIRCLECI_COVERAGE names the output file, and Chromium only (the
 * analysis runs that project alone; the atom is the spec FILE, so one engine's
 * view of it is enough). Coverage is by CHUNK: every app script the context
 * requested (app-chunks.ts — never page.coverage, which slows the page)
 * counts, and stands for every source file its sourcemap lists. A bundled
 * module's top level runs when its chunk loads, so loaded is used — and
 * erring towards more files only ever selects more tests. Server-only code
 * never reaches the browser; the suite's full-test-run-paths cover it.
 *
 * Each test attaches its file list; reporters/circleci-coverage.ts gathers
 * the attachments and writes CircleCI's coverage JSON.
 */

export const COVERAGE_ATTACHMENT = 'circleci-coverage';

const enabled = process.env.CIRCLECI_COVERAGE !== undefined;

// The maps' relative `sources` resolve from Vite's own output directory.
// adapter-node copies the same files into build/client, one level shallower,
// where those relative paths point outside the repository.
const CLIENT_OUTPUT = resolve('.svelte-kit/output/client');

const sourcesByPath = new Map<string, string[] | null>();

/**
 * Repo-relative source files behind an app chunk, or null when it has no map:
 * Vite writes none for the few-byte re-export chunks (entry/start.js).
 */
function sourcesOf(chunk: string): string[] | null {
	if (sourcesByPath.has(chunk)) return sourcesByPath.get(chunk) ?? null;
	const mapFile = resolve(CLIENT_OUTPUT, `.${chunk}.map`);
	let files: string[] | null = null;
	if (existsSync(mapFile)) {
		const { sources } = JSON.parse(readFileSync(mapFile, 'utf8')) as { sources: string[] };
		const mapDir = resolve(mapFile, '..');
		files = sources
			.map((source) => relative(process.cwd(), resolve(mapDir, source)))
			// Repository sources only: not dependencies, and not SvelteKit's
			// generated .svelte-kit/ files, which are build output.
			.filter(
				(file) =>
					!file.startsWith('..') &&
					!file.startsWith('.svelte-kit') &&
					!file.includes('node_modules') &&
					existsSync(file)
			);
	}
	sourcesByPath.set(chunk, files);
	return files;
}

export const test = base.extend<{ circleciCoverage: void }>({
	circleciCoverage: [
		async ({ context, browserName }, use, testInfo): Promise<void> => {
			if (!enabled || browserName !== 'chromium') return use();

			const recorder = recordAppChunks(context);
			await use();

			const files = new Set([relative(process.cwd(), testInfo.file)]);
			let chunks = 0;
			let mapped = 0;
			for (const chunk of recorder.stop()) {
				chunks++;
				const sources = sourcesOf(chunk);
				if (!sources) continue;
				mapped++;
				for (const file of sources) files.add(file);
			}
			// A build without maps would record every test as covering only its
			// own spec, so it would never be selected again: fail the analysis.
			if (chunks > 0 && mapped === 0) {
				throw new Error('circleci-coverage: no sourcemaps found; build the app with E2E_SOURCEMAPS=1');
			}
			await testInfo.attach(COVERAGE_ATTACHMENT, {
				body: JSON.stringify([...files]),
				contentType: 'application/json'
			});
		},
		{ auto: true }
	]
});
