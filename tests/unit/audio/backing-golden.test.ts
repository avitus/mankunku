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
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import {
	generateBacking,
	resolveEffectiveSwing,
	type BackingGenerationParams,
	type GeneratedBacking
} from '$lib/audio/backing-generation';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const fixtureDir = join(repoRoot, 'tests', 'fixtures', 'backing');

const GOLDEN_CASES: Array<{ presetId: string; tempo: number }> = [
	{ presetId: 'backing-mixer-loop', tempo: 140 },
	{ presetId: 'lab-blues-f', tempo: 160 },
	{ presetId: 'lab-aaba-c', tempo: 160 }
];

function generateCase(
	presetId: string,
	tempo: number
): { params: BackingGenerationParams & { style: string } } & GeneratedBacking {
	const preset = BACKING_LAB_PRESETS.find((p) => p.id === presetId);
	if (!preset) throw new Error(`Unknown preset ${presetId}`);
	const style = BACKING_STYLES.swing;
	const params = {
		phraseId: preset.phrase.id,
		tempo,
		ppq: 192,
		beatsPerBar: 4,
		swing: resolveEffectiveSwing(0.5, style),
		sectionMap: preset.phrase.sectionMap
	};
	return { params: { ...params, style: 'swing' }, ...generateBacking(preset.phrase.harmony, style, params) };
}

describe('golden backing fixtures', () => {
	for (const { presetId, tempo } of GOLDEN_CASES) {
		it(`${presetId} @ ${tempo} BPM matches the committed fixture`, () => {
			const current = generateCase(presetId, tempo);
			const fixturePath = join(fixtureDir, `golden-${presetId}-${tempo}.json`);

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
