import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { HISTORICAL_MUSICALITY_STYLES as BACKING_STYLES } from '../../helpers/musicality-style-fixtures';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { buildNativeBluesFixture } from '../../fixtures/musicality-native-blues';

// Captured before the WebKit performance-only change. These cover complete
// actual event streams, all decisions, score identities and every checkpoint.
const baseline = {
	swing: '485e9b27e44e00e61bad6e9f32b5a11888e860d63f45f6f448287327d43e1d36',
	straight: '332b9f13b8ecfd32d7a61d096bb1f3ed50f1a0593fa00c3d437bdecaf1937766',
	'bossa-nova': '41e6e262b223d8235980ffa7767ce41cf70904e4634587c3da2f788ebee0d6fb',
	ballad: 'd83595677e510eef0c3a9353e8d87b70cfafaadbca4849b7e54c9a1963f9f07a'
} as const;

describe('0.8 rolling performance optimization neutrality', () => {
	for (const style of ['swing', 'straight', 'bossa-nova', 'ballad'] as const) {
		it(`${style} retains every complete Blues event and receipt, including JSON replay`, () => {
			const phrase = buildNativeBluesFixture();
			const tempo = style === 'ballad' ? 80 : 140;
			const definition = createRollingBacking(phrase.harmony, BACKING_STYLES[style], {
				phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4,
				swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
				sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}
			}, { returningMelodySpace: true, performanceEnergySeed: 42, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
				chorusBoundaryPriority: true, keyboardTexture: true, keyboardPhrasing: 'piano',
				bassDelayedRoot: true, keyboardContraryMotion: true, drumPhraseCushioning: true });
			let checkpoint: RollingBackingCheckpoint | undefined;
			const bars = Array.from({ length: definition.totalBars }, () => {
				const direct = advanceRollingBacking(definition, checkpoint);
				const restored = advanceRollingBacking(definition, checkpoint ? JSON.parse(JSON.stringify(checkpoint)) : undefined);
				expect(restored).toEqual(direct);
				checkpoint = direct.checkpoint;
				return direct;
			});
			expect(bars).toHaveLength(52);
			const actual = createHash('sha256').update(JSON.stringify(bars)).digest('hex');
			expect(actual).toBe(baseline[style]);
		});
	}
});
