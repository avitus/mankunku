<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { scoreToGrade } from '$lib/scoring/grades';
	import { GRADE_COLORS } from '$lib/ui/score-colors';

	interface Props {
		/** The recognized lick, or null when nothing is celebrating. */
		celebration: { name: string; score: number } | null;
		onDismiss: () => void;
	}

	let { celebration, onDismiss }: Props = $props();

	// Applause captions in the GRADE_CAPTIONS liner-note spirit — copy only,
	// no thresholds; the confidence gate lives in the recognizer.
	const CAPTIONS = [
		'The band heard that one.',
		'Straight out of your book.',
		'Quotable. Very quotable.',
		'That lick has been PRACTICED.',
		'Filed under: vocabulary, deployed.'
	] as const;

	function caption(name: string): string {
		// Stable per lick, varied across licks — no RNG so replays feel intentional.
		let h = 0;
		for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
		return CAPTIONS[Math.abs(h) % CAPTIONS.length];
	}

	$effect(() => {
		if (!celebration) return;
		const timer = setTimeout(onDismiss, 3500);
		return () => clearTimeout(timer);
	});

	const grade = $derived(celebration ? scoreToGrade(celebration.score) : null);
</script>

{#if celebration && grade}
	{#key celebration.name + celebration.score}
		<div
			in:fly={{ y: 12, duration: 250 }}
			out:fade={{ duration: 400 }}
			class="flex items-center gap-3 rounded-lg border px-4 py-3"
			style="border-color: {GRADE_COLORS[grade]}; background: color-mix(in srgb, {GRADE_COLORS[grade]} 12%, transparent)"
			data-testid="lick-celebration"
		>
			<span class="text-2xl" aria-hidden="true">👏</span>
			<div class="min-w-0">
				<div class="truncate font-medium" style="color: {GRADE_COLORS[grade]}">
					{celebration.name}
				</div>
				<div class="text-xs text-[var(--color-text-secondary)]">
					{caption(celebration.name)} &middot; {Math.round(celebration.score * 100)}% match
				</div>
			</div>
		</div>
	{/key}
{/if}
