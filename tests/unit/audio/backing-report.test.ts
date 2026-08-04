/**
 * Pins the committed backing-report snapshot to the current engine output.
 *
 * The report is a HUMAN-read statistics surface (documentation/reference/
 * backing-report.txt) — this test only guarantees the snapshot was
 * regenerated (and therefore the diff reviewed) whenever the engine's
 * statistical behavior changes. Regenerate with `npm run backing:report`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBackingReport } from '$lib/audio/backing-report';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const snapshotPath = join(repoRoot, 'documentation', 'reference', 'backing-report.txt');

describe('backing report snapshot', () => {
	it('matches documentation/reference/backing-report.txt', () => {
		const report = buildBackingReport();

		if (process.env.UPDATE_BACKING_REPORT === '1') {
			mkdirSync(dirname(snapshotPath), { recursive: true });
			writeFileSync(snapshotPath, report + '\n');
			return;
		}

		expect(
			existsSync(snapshotPath),
			'Snapshot missing — run `npm run backing:report` and commit the file'
		).toBe(true);
		const committed = readFileSync(snapshotPath, 'utf8');
		expect(
			committed,
			'Engine statistics drifted from the committed report — run `npm run backing:report`, review the diff, and commit it'
		).toBe(report + '\n');
	});
});
