import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { COVERAGE_ATTACHMENT } from '../fixtures/circleci-coverage';

/**
 * Writes the coverage the circleci-coverage fixture attached to each test as
 * CircleCI's coverage JSON, at CIRCLECI_COVERAGE: source file →
 * { "<atom>!!<test title>|run": true }. The atom is the spec path relative to
 * testDir, as the "e2e tests" suite discovers it and Playwright's JUnit
 * reporter names it.
 */
export default class CircleCICoverageReporter implements Reporter {
	private readonly output: Record<string, Record<string, true>> = {};

	/** Records the source files one test's attachment lists under that test's key (every retry adds the same edges). */
	onTestEnd(test: TestCase, result: TestResult): void {
		const attachment = result.attachments.find(({ name }) => name === COVERAGE_ATTACHMENT);
		if (!attachment?.body) return;
		// titlePath(): root suite, project, spec file, ...describes, test.
		const [, , atom, ...titles] = test.titlePath();
		const testKey = `${atom}!!${titles.join(' › ')}|run`;
		for (const file of JSON.parse(attachment.body.toString()) as string[]) {
			(this.output[file] ??= {})[testKey] = true;
		}
	}

	/** Writes the gathered map to CIRCLECI_COVERAGE once the run is over. */
	onEnd(): void {
		const outputFile = process.env.CIRCLECI_COVERAGE;
		if (!outputFile) return;
		mkdirSync(dirname(outputFile), { recursive: true });
		writeFileSync(outputFile, JSON.stringify(this.output));
	}
}
