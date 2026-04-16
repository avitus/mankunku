<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import PracticeSetup from '$lib/components/lick-practice/PracticeSetup.svelte';
	import {
		lickPractice,
		hydrateLickPracticeProgress,
		getPracticeLicks,
		startSession
	} from '$lib/state/lick-practice.svelte';
	import type { LickPracticeConfig } from '$lib/types/lick-practice';

	onMount(() => {
		hydrateLickPracticeProgress(page.data?.supabase ?? null);
	});

	// Trigger reactivity on config/progress changes to update the lick count.
	// getPracticeLicks() reads from localStorage (non-reactive), so we must
	// track progress as a dependency to re-derive after cloud hydration.
	const availableLickCount = $derived.by(() => {
		lickPractice.config.progressionType;
		void lickPractice.progress;
		return getPracticeLicks().length;
	});

	function handleUpdate(update: Partial<LickPracticeConfig>) {
		Object.assign(lickPractice.config, update);
	}

	function handleStart() {
		startSession();
		if (lickPractice.plan.length > 0) {
			goto('/lick-practice/session');
		}
	}
</script>

<div class="space-y-6">
	<div>
		<div class="smallcaps text-[var(--color-brass)]">Side B</div>
		<h1 class="font-display text-4xl font-bold tracking-tight text-[var(--color-accent)]">
			Lick Practice
		</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>

	<p class="text-sm italic text-[var(--color-text-secondary)]">
		Play the licks through all 12 keys with a backing track.
		Tag a few in the <a href="/library" class="text-[var(--color-accent)] underline">library</a> to start your set.
	</p>

	<PracticeSetup
		config={lickPractice.config}
		{availableLickCount}
		onstart={handleStart}
		onupdate={handleUpdate}
	/>
</div>
