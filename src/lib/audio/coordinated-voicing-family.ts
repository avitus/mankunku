import type { PitchClass, ChordQuality } from '$lib/types/music';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import type { StyleDefinition } from './backing-styles';
import type { CoordinatedVoicingFamily } from './coordinated-voicing';
import { quartalVoicing } from './voicings';
import { createRng, seedFrom } from './generation-rng';
import { lerp } from './backing-intensity';

export interface CoordinatedVoicingFamilyInput {
	readonly chord: { readonly root: PitchClass; readonly quality: ChordQuality };
	readonly phraseId: string;
	readonly tempo: number;
	readonly segmentIndex: number;
	/** Energy of the bar owning this accepted attack, including anticipations. */
	readonly intensity: number;
	readonly voicingBias?: StyleDefinition['voicingBias'];
}

/**
 * Shared causal family policy for explicit-form Coordinated performances.
 * Retains the fixed renderer's exact family order, weights, eligibility and
 * segment seed. It makes one independent draw; rejected/silent attacks never
 * consume a stream or alter history. Native style bias remains authoritative.
 * Guide-tone overrides stay in callers and bypass this family selection.
 */
export function selectCoordinatedVoicingFamily(input: CoordinatedVoicingFamilyInput): Exclude<CoordinatedVoicingFamily, 'guide'> {
	const { chord, phraseId, tempo, segmentIndex, intensity, voicingBias: bias = {} } = input;
	const rng = createRng(seedFrom(phraseId, tempo, 'voicing', segmentIndex));
	const seventh = CHORD_DEFINITIONS[chord.quality]?.intervals.some((interval) => interval >= 9 && interval <= 11);
	if (!seventh) return rng.weighted<'shell' | 'drop2'>([
		{ value: 'shell', weight: 2 * (bias.shell ?? 1) },
		{ value: 'drop2', weight: 1 * (bias.drop2 ?? 1) }
	]);
	const options: Array<{ value: Exclude<CoordinatedVoicingFamily, 'guide'>; weight: number }> = [
		{ value: 'rootless-a', weight: 4 * (bias.rootlessA ?? 1) },
		{ value: 'rootless-b', weight: 3 * (bias.rootlessB ?? 1) },
		{ value: 'shell', weight: 2 * lerp(1.5, 0.6, intensity) * (bias.shell ?? 1) },
		{ value: 'drop2', weight: 1 * (bias.drop2 ?? 1) }
	];
	if (quartalVoicing(chord.root, chord.quality).length > 0) {
		options.push({ value: 'quartal', weight: lerp(0.5, 1.5, intensity) * (bias.quartal ?? 1) });
	}
	return rng.weighted(options);
}
