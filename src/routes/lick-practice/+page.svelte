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
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Lick Practice</h1>
	</div>

	<p class="text-sm text-[var(--color-text-secondary)]">
		Practice licks through all 12 keys with a backing track.
		Tag licks in the <a href="/library" class="text-[var(--color-accent)] underline">library</a> to add them to your practice set.
	</p>

	<PracticeSetup
		config={lickPractice.config}
		{availableLickCount}
		onstart={handleStart}
		onupdate={handleUpdate}
	/>
</div>
