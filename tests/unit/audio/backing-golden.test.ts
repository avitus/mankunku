/**
 * Golden event fixtures: the full generated backing for fixed
 * (preset, tempo) pairs, committed under tests/fixtures/backing/.
 *
 * These pin the ENTIRE audible output of the engine — any intentional
 * musical change must regenerate them (`npm run backing:golden`) so the
 * event-level diff is part of the PR. They are also the permanent "old
 * engine" side of the listening lab's A/B: a WAV of any committed
 * generation can be re-bounced from its JSON at any time.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { BackingStyle } from '$lib/types/instruments';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import {
	generateBacking,
	resolveBackingSwing,
	type BackingGenerationParams,
	type GeneratedBacking
} from '$lib/audio/backing-generation';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const fixtureDir = join(repoRoot, 'tests', 'fixtures', 'backing');

// Swing cases keep their original filenames; non-swing styles carry the
// style id in the name so each style PR pins its own fixture.
const GOLDEN_CASES: Array<{ presetId: string; tempo: number; style?: BackingStyle }> = [
	{ presetId: 'backing-mixer-loop', tempo: 140 },
	{ presetId: 'lab-blues-f', tempo: 160 },
	{ presetId: 'lab-aaba-c', tempo: 160 },
	{ presetId: 'lab-blues-f', tempo: 130, style: 'bossa-nova' },
	{ presetId: 'lab-aaba-c', tempo: 72, style: 'ballad' },
	{ presetId: 'lab-blues-f', tempo: 140, style: 'straight' }
];

function generateCase(
	presetId: string,
	tempo: number,
	styleId: BackingStyle
): { params: BackingGenerationParams & { style: string } } & GeneratedBacking {
	const preset = BACKING_LAB_PRESETS.find((p) => p.id === presetId);
	if (!preset) throw new Error(`Unknown preset ${presetId}`);
	const style = BACKING_STYLES[styleId];
	const params = {
		phraseId: preset.phrase.id,
		tempo,
		ppq: 192,
		beatsPerBar: 4,
		swing: resolveBackingSwing(0.5, style, tempo),
		sectionMap: preset.phrase.sectionMap
	};
	return { params: { ...params, style: styleId }, ...generateBacking(preset.phrase.harmony, style, params) };
}

describe('golden backing fixtures', () => {
	for (const { presetId, tempo, style = 'swing' } of GOLDEN_CASES) {
		it(`${presetId} (${style}) @ ${tempo} BPM matches the committed fixture`, () => {
			const current = generateCase(presetId, tempo, style);
			const suffix = style === 'swing' ? '' : `-${style}`;
			const fixturePath = join(fixtureDir, `golden-${presetId}${suffix}-${tempo}.json`);

			if (process.env.UPDATE_BACKING_GOLDEN === '1') {
				mkdirSync(fixtureDir, { recursive: true });
				writeFileSync(fixturePath, JSON.stringify(current, null, 1) + '\n');
				return;
			}

			expect(
				existsSync(fixturePath),
				`Fixture missing — run \`npm run backing:golden\` and commit ${fixturePath}`
			).toBe(true);
			const committed = JSON.parse(readFileSync(fixturePath, 'utf8'));
			expect(
				current,
				'Generated events drifted from the golden fixture — if intentional, run `npm run backing:golden` and commit the diff'
			).toEqual(committed);
		});
	}
});
