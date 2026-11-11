import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseMusicalitySpec, validateMusicalityManifest, filterMusicalityRequirements } from '$lib/musicality/spec';
import { MUSICALITY_AUDIT, buildMusicalityRequirements } from '$lib/musicality/manifest';
import type { MusicalityAudit } from '$lib/musicality/spec';

const markdown = readFileSync(new URL('../../../documentation/musicality/spec.md', import.meta.url), 'utf8');

describe('living musicality specification', () => {
	it('preserves the original 2026-10-15 specification byte for byte', () => {
		// Recorded from the user-supplied original before importing it into the repository.
		expect(createHash('sha256').update(markdown).digest('hex')).toBe('454694188b3274d1b486e56ed787e2e05d11cb697691697556a35dbffb13da3e');
	});
	it('accounts for all 50 sections and every original device exactly once', () => {
		const parsed = parseMusicalitySpec(markdown);
		expect(parsed.filter((entry) => entry.kind === 'section')).toHaveLength(50);
		expect(parsed.filter((entry) => entry.instrument === 'piano' && entry.kind === 'device')).toHaveLength(58);
		expect(parsed.filter((entry) => entry.instrument === 'bass' && entry.kind === 'device')).toHaveLength(59);
		expect(parsed.filter((entry) => entry.instrument === 'drums' && entry.kind === 'device')).toHaveLength(85);
		expect(() => validateMusicalityManifest(markdown, MUSICALITY_AUDIT)).not.toThrow();
	});

	it('rejects duplicate, missing and unknown spec or audit IDs', () => {
		expect(() => parseMusicalitySpec(markdown + '\n### P1. Duplicate\n')).toThrow(/duplicate/i);
		expect(() => validateMusicalityManifest(markdown.replace('### P1. Four-to-the-bar', '### No device'), MUSICALITY_AUDIT)).toThrow(/P1/);
		expect(() => validateMusicalityManifest(markdown, MUSICALITY_AUDIT.slice(1))).toThrow(/missing/i);
		expect(() => validateMusicalityManifest(markdown, [...MUSICALITY_AUDIT, MUSICALITY_AUDIT[0]])).toThrow(/duplicate/i);
		expect(() => validateMusicalityManifest(markdown, [...MUSICALITY_AUDIT, { ...MUSICALITY_AUDIT[0], id: 'P99' }])).toThrow(/unknown/i);
		expect(() => validateMusicalityManifest(markdown, [{ ...MUSICALITY_AUDIT[0], status: 'done' } as unknown as MusicalityAudit, ...MUSICALITY_AUDIT.slice(1)])).toThrow(/invalid status/i);
		expect(() => validateMusicalityManifest(markdown, [{ ...MUSICALITY_AUDIT[0], evidence: [] }, ...MUSICALITY_AUDIT.slice(1)])).toThrow(/evidence/i);
	});

	it('keeps source and test references resolvable in the repository', () => {
		for (const entry of MUSICALITY_AUDIT) {
			for (const evidence of entry.evidence) {
				expect(existsSync(new URL(`../../../${evidence.path}`, import.meta.url)), `${entry.id}: ${evidence.path}`).toBe(true);
			}
		}
	});

	it('keeps inspected implementation, test references and listening acceptance distinct', () => {
		const entries = buildMusicalityRequirements(markdown);
		const charleston = entries.find((entry) => entry.id === 'P3')!;
		expect(charleston.status).toBe('implemented');
		expect(charleston.validation.method).toBe('source-audit');
		expect(charleston.validation.listening).toBe('not-assessed');
		expect(charleston.evidence.some((evidence) => evidence.kind === 'test')).toBe(true);
		expect(entries.find((entry) => entry.id === 'S50')?.status).toBe('reference');
		expect(entries.find((entry) => entry.id === 'D15')?.status).toBe('implemented');
		expect(entries.find((entry) => entry.id === 'D15')?.scope).toContain('listening-lab preview');
	});

	it('combines instrument, status and case-insensitive text filters without losing original text', () => {
		const entries = buildMusicalityRequirements(markdown);
		const results = filterMusicalityRequirements(entries, { search: 'p3', instrument: 'piano', status: 'implemented' });
		expect(results.map((entry) => entry.id)).toEqual(['P3']);
		expect(results[0].markdown).toContain('and-of-2');
		expect(filterMusicalityRequirements(entries, { search: 'phrase', instrument: 'drums', status: 'partial' }).every((entry) => entry.instrument === 'drums' && entry.status === 'partial')).toBe(true);
		expect(filterMusicalityRequirements(entries, { search: 'unfindable-musicality-device' })).toEqual([]);
	});
});

it('retains both native keyboard articulation and later phrase expression in the P14 ledger', () => {
 const row = MUSICALITY_AUDIT.find(entry => entry.id === 'P14')!;
 expect(row.assessment).toContain('0.7.0');
 expect(row.assessment).toContain('0.11.0');
 expect(row.evidence.some(e => e.path.endsWith('/backing-keyboard-articulation.ts'))).toBe(true);
 expect(row.evidence.some(e => e.path.endsWith('/backing-phrase-expression.ts'))).toBe(true);
});

it('pins current evidence to the release engine while retaining the original audit and historical revisions', async () => {
 const { musicalityEvidenceUrl, MUSICALITY_AUDIT_REVISION } = await import('$lib/musicality/manifest');
 const { CURRENT_MUSICALITY_RELEASE } = await import('$lib/musicality/release');
 const evidence = { kind: 'source' as const, path: 'src/lib/audio/backing-arrangement.ts', revision: 'musicality' };
 expect(musicalityEvidenceUrl(evidence)).toContain(`/blob/${CURRENT_MUSICALITY_RELEASE.engineRevision}/`);
 expect(musicalityEvidenceUrl({ ...evidence, revision: '1234' })).toContain('/blob/1234/');
 expect(musicalityEvidenceUrl({ ...evidence, revision: undefined })).toContain(`/blob/${MUSICALITY_AUDIT_REVISION}/`);
 const row = MUSICALITY_AUDIT.find(entry => entry.id === 'P32')!;
 expect(row.evidence.filter(e => e.path.endsWith('/backing-inner-motion.ts')).every(e => e.revision === 'musicality')).toBe(true);
 expect(row.evidence[0].revision).toBe(MUSICALITY_AUDIT_REVISION);
});
