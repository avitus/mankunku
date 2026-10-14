<script lang="ts">
	import type { Phrase, PhraseCategory } from '$lib/types/music';
	import { CATEGORY_LABELS } from '$lib/types/music';
	import type { ChordProgressionType } from '$lib/types/lick-practice';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
	import { progressionColor } from '$lib/music/progression-display';

	let { phrase }: { phrase: Phrase } = $props();
	// Community phrases have no personal practice tags. Use their declared
	// harmonic category, without guessing a progression for generic devices.
	const categoryProgression: Partial<Record<PhraseCategory, ChordProgressionType>> = {
		'minor-chord': 'minor-vamp', 'major-chord': 'major-vamp',
		'dominant-chord': 'dominant-vamp', blues: 'blues',
		'ii-V-I-major': 'ii-V-I-major-long', 'short-ii-V-I-major': 'ii-V-I-major',
		'ii-V-I-minor': 'ii-V-I-minor-long', 'short-ii-V-I-minor': 'ii-V-I-minor'
	};
	const progression = $derived(categoryProgression[phrase.category]);
	const hue = $derived(progression ? progressionColor(progression) : 'var(--color-brass)');
	const label = $derived(
		(progression ? PROGRESSION_TEMPLATES[progression].shortName : CATEGORY_LABELS[phrase.category])
			.replace(/^(Short|Long) /, '')
	);
</script>

<span class="progression" style:--progression-hue={hue}>{label}</span>

<style>
	.progression {
		display: inline-block;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border: 1px solid color-mix(in srgb, var(--progression-hue) 34%, transparent);
		border-radius: 3px;
		background: color-mix(in srgb, var(--progression-hue) 15%, transparent);
		color: var(--progression-hue);
		padding: 2px 6px;
		font-size: 10px;
		line-height: 1.4;
	}
</style>
