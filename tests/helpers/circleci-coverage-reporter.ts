import { existsSync } from 'node:fs';
import type { TestCase } from 'vitest/node';
import CircleCICoverageReporter from '@circleci/vitest-circleci-coverage/reporter';

/**
 * The source files a test's coverage names, as CircleCI's testsuite CLI
 * accepts them: real files, once each. Vite module ids carry queries (the
 * docs bundle documentation/*.md through `import.meta.glob` with `?raw`), and
 * the CLI fails the whole analysis on a path that is not a file — the unit
 * suite's analysis did, on "state-management.md?raw", 2026-10-20.
 */
export function coveredSourceFiles(
	ids: readonly string[],
	isFile: (path: string) => boolean = existsSync
): string[] {
	return [...new Set(ids.map((id) => id.replace(/\?.*$/, '')))].filter((path) => isFile(path));
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
