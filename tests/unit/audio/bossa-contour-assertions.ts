import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import type { GeneratedBacking } from '$lib/audio/backing-generation';
import fixture from '../../fixtures/audio/bossa-contour-baseline.json';

export type BossaContourPerformance = Pick<GeneratedBacking, 'bassEvents' | 'compEvents' | 'drumEvents' | 'ensemblePlan'> & {
	ensembleDevelopment?: Partial<Pick<NonNullable<GeneratedBacking['ensembleDevelopment']>, 'version' | 'pianoVoicings'>>;
};

/** P36 changes only explicit Bossa placements; keep the original piano events and hashes. */
export function assertBossaContourCompatibility(
	generated: BossaContourPerformance,
	originalHash: string
): void {
	const baseline = fixture.performances[originalHash as keyof typeof fixture.performances];
	expect(baseline, `Missing original Bossa performance ${originalHash}`).toBeDefined();
	const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
	expect(hash(baseline.compEvents)).toBe(originalHash);
	expect(generated.compEvents.map(({ notes, ...event }) => event))
		.toEqual(baseline.compEvents.map(({ notes, ...event }) => event));
	const pitchClasses = (notes: readonly number[]) => notes.map(note => note % 12).sort((a, b) => a - b);
	expect(generated.compEvents.map(event => pitchClasses(event.notes)))
		.toEqual(baseline.compEvents.map(event => pitchClasses(event.notes)));
	const traces = generated.ensembleDevelopment?.pianoVoicings ?? [];
	expect(traces).toHaveLength(generated.compEvents.length);
	expect(traces.map(trace => [trace.decision.requestedFamily, trace.decision.resolvedFamily]))
		.toEqual(baseline.families);
	expect(hash(generated.compEvents)).not.toBe(originalHash);
	expect(traces.some(trace => trace.decision.topLine?.eligible)).toBe(true);
}
