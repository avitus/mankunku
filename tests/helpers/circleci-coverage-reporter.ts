import { existsSync } from 'node:fs';
import type { TestCase } from 'vitest/node';
import CircleCICoverageReporter from '@circleci/vitest-circleci-coverage/reporter';

/**
 * SvelteKit's output directory. Kit 3 writes `$app/env/public` and friends as
 * real modules under `.svelte-kit/generated/`, so a test that loads one
 * unmocked (route-methods imports the real /api routes) covers a file that
 * exists on disk but is gitignored. The CLI does not count it as part of the
 * project and failed main's whole unit analysis on
 * ".svelte-kit/generated/dev/env/public/server.js", 2026-11-15. Its inputs,
 * src/env.ts and vite.config.ts, are full-test-run paths already.
 */
const SVELTEKIT_OUTPUT = /(^|\/)\.svelte-kit\//;

/**
 * The source files a test's coverage names, as CircleCI's testsuite CLI
 * accepts them: real project files, once each. Vite module ids carry queries
 * (the docs bundle documentation/*.md through `import.meta.glob` with `?raw`),
 * and the CLI fails the whole analysis on a path that is not a file — the unit
 * suite's analysis did, on "state-management.md?raw", 2026-10-20 — or on
 * generated output ({@link SVELTEKIT_OUTPUT}).
 */
export function coveredSourceFiles(
	ids: readonly string[],
	isFile: (path: string) => boolean = existsSync
): string[] {
	return [...new Set(ids.map((id) => id.replace(/\?.*$/, '')))].filter(
		(path) => !SVELTEKIT_OUTPUT.test(path) && isFile(path)
	);
}

/**
 * CircleCI's Vitest coverage reporter (vite.config.ts uses it when
 * CIRCLECI_COVERAGE is set), handed {@link coveredSourceFiles} rather than
 * raw module ids.
 */
export default class CoveredFilesReporter extends CircleCICoverageReporter {
	/** Cleans the covered paths the coverage runner put on the test's meta, then records them. */
	onTestCaseResult(testCase: TestCase): void {
		const meta = testCase.meta() as { coveredFiles?: string[] };
		if (meta.coveredFiles) meta.coveredFiles = coveredSourceFiles(meta.coveredFiles);
		super.onTestCaseResult(testCase);
	}
}
