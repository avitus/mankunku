import { describe, expect, it } from 'vitest';
import { coveredSourceFiles } from '../../helpers/circleci-coverage-reporter';

const files = new Set([
	'documentation/architecture/state-management.md',
	'src/lib/docs/markdown.ts',
	'src/routes/+page.svelte'
]);
/** A fake filesystem: only the paths in `files` exist. */
const isFile = (path: string): boolean => files.has(path);

describe('coveredSourceFiles', () => {
	it('names the file behind a ?raw import (2026-10-20: the unit analysis failed on "state-management.md?raw")', () => {
		expect(
			coveredSourceFiles(['documentation/architecture/state-management.md?raw', 'src/lib/docs/markdown.ts'], isFile)
		).toEqual(['documentation/architecture/state-management.md', 'src/lib/docs/markdown.ts']);
	});

	it('strips any Vite query, e.g. a Svelte style sub-module', () => {
		expect(coveredSourceFiles(['src/routes/+page.svelte?svelte&type=style&lang.css'], isFile)).toEqual([
			'src/routes/+page.svelte'
		]);
	});

	it('drops ids that are not files and collapses duplicates', () => {
		expect(
			coveredSourceFiles(
				['\0virtual:env/static/public', 'src/lib/docs/markdown.ts', 'src/lib/docs/markdown.ts?raw'],
				isFile
			)
		).toEqual(['src/lib/docs/markdown.ts']);
	});
});
