import { expect, it } from 'vitest';
import { generateBackingCached } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';

it('keeps rootless texture evidence immutable after a cached JSON read', () => {
	const phrase = BACKING_LAB_PRESETS.find(preset => preset.id === 'lab-aaba-c')!.phrase;
	const params = { phraseId: 'cached-rootless-evidence', tempo: 140, ppq: 192, beatsPerBar: 4, swing: .67,
		performanceForm: phrase.performanceForm, ensemble: {} };
	const first = generateBackingCached(phrase.harmony, BACKING_STYLES.swing, params);
	const cached = generateBackingCached(phrase.harmony, BACKING_STYLES.swing, params);
	const firstTexture = first.ensembleDevelopment!.pianoVoicings!.find(attack => attack.decision.rootlessTexture)!.decision.rootlessTexture!;
	const texture = cached.ensembleDevelopment!.pianoVoicings!.find(attack => attack.decision.rootlessTexture)!.decision.rootlessTexture!;
	expect(texture).toEqual(firstTexture);
	expect(texture).not.toBe(firstTexture);
	expect(() => { (texture as { noteCount: number }).noteCount = 99; }).toThrow(TypeError);
	expect(texture).toEqual(firstTexture);
});

it('keeps target and actual top-note evidence immutable after a cached JSON read', () => {
	const phrase = BACKING_LAB_PRESETS.find(preset => preset.id === 'lab-aaba-c')!.phrase;
	const params = { phraseId: 'cached-top-line-evidence', tempo: 140, ppq: 192, beatsPerBar: 4, swing: .67,
		performanceForm: phrase.performanceForm, ensemble: {} };
	const first = generateBackingCached(phrase.harmony, BACKING_STYLES.swing, params);
	const cached = generateBackingCached(phrase.harmony, BACKING_STYLES.swing, params);
	const firstTop = first.ensembleDevelopment!.pianoVoicings!.find(attack => attack.decision.topLine)?.decision.topLine;
	const top = cached.ensembleDevelopment!.pianoVoicings!.find(attack => attack.decision.topLine)?.decision.topLine;
	expect(firstTop).toBeDefined();
	expect(top).toEqual(firstTop);
	expect(top).not.toBe(firstTop);
	expect(() => { (top as { targetMidi: number }).targetMidi = 99; }).toThrow(TypeError);
	expect(top).toEqual(firstTop);
});
