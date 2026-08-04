<script lang="ts">
	// Blind A/B comparison for backing bounces. Slot 1 is the current
	// engine's bounce (passed in), slot 2 a reference WAV the user loads
	// (typically a baseline bounce from an earlier increment). On "Start
	// blind comparison" the two are shuffled behind neutral X/Y labels;
	// the verdict is recorded before the mapping is revealed, which keeps
	// the author's expectations out of the judgment.
	import { onDestroy } from 'svelte';

	let { currentUrl = null, currentLabel = 'Current bounce' }: {
		currentUrl: string | null;
		currentLabel?: string;
	} = $props();

	let referenceUrl = $state<string | null>(null);
	let referenceName = $state<string | null>(null);

	// null until a comparison starts; true means X = current, Y = reference.
	let xIsCurrent = $state<boolean | null>(null);
	let verdict = $state<'X' | 'Y' | 'tie' | null>(null);
	let revealed = $state(false);

	function loadReference(e: Event): void {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (referenceUrl) URL.revokeObjectURL(referenceUrl);
		referenceUrl = URL.createObjectURL(file);
		referenceName = file.name;
		resetComparison();
	}

	function startBlind(): void {
		xIsCurrent = Math.random() < 0.5;
		verdict = null;
		revealed = false;
	}

	function resetComparison(): void {
		xIsCurrent = null;
		verdict = null;
		revealed = false;
	}

	function slotUrl(slot: 'X' | 'Y'): string | null {
		if (xIsCurrent === null) return null;
		const isCurrent = slot === 'X' ? xIsCurrent : !xIsCurrent;
		return isCurrent ? currentUrl : referenceUrl;
	}

	function slotSource(slot: 'X' | 'Y'): string {
		if (xIsCurrent === null) return '';
		const isCurrent = slot === 'X' ? xIsCurrent : !xIsCurrent;
		return isCurrent ? currentLabel : (referenceName ?? 'Reference');
	}

	const verdictText = $derived(
		verdict === null || xIsCurrent === null
			? null
			: verdict === 'tie'
				? 'Tie'
				: `${verdict} preferred — ${slotSource(verdict)}`
	);

	const SLOTS: Array<'X' | 'Y'> = ['X', 'Y'];
	const VERDICT_OPTIONS: Array<{ value: 'X' | 'Y' | 'tie'; label: string }> = [
		{ value: 'X', label: 'X better' },
		{ value: 'Y', label: 'Y better' },
		{ value: 'tie', label: 'Tie' }
	];

	onDestroy(() => {
		if (referenceUrl) URL.revokeObjectURL(referenceUrl);
	});
</script>

<div class="space-y-3" data-testid="blind-ab">
	<div class="flex flex-wrap items-center gap-3 text-sm">
		<label
			class="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-[var(--color-accent)]"
		>
			<span>{referenceName ?? 'Load reference WAV…'}</span>
			<input
				type="file"
				accept=".wav,audio/wav"
				class="sr-only"
				aria-label="Load reference WAV"
				onchange={loadReference}
			/>
		</label>
		<button
			onclick={startBlind}
			disabled={!currentUrl || !referenceUrl}
			class="rounded-full bg-[var(--color-accent)] text-white px-4 py-1 disabled:opacity-40"
		>
			Start blind comparison
		</button>
		{#if !currentUrl}
			<span class="text-xs text-[var(--color-text-secondary)]">Bounce the current engine first.</span>
		{/if}
	</div>

	{#if xIsCurrent !== null}
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
			{#each SLOTS as slot (slot)}
				<div class="rounded-lg bg-[var(--color-bg-tertiary)] p-3 space-y-2">
					<div class="flex items-baseline justify-between">
						<span class="font-semibold">Take {slot}</span>
						{#if revealed}
							<span class="text-xs text-[var(--color-text-secondary)]">{slotSource(slot)}</span>
						{/if}
					</div>
					<audio controls src={slotUrl(slot)} class="w-full"></audio>
				</div>
			{/each}
		</div>

		<div class="flex flex-wrap items-center gap-2 text-sm">
			<span class="text-[var(--color-text-secondary)]">Verdict:</span>
			{#each VERDICT_OPTIONS as option (option.value)}
				<button
					onclick={() => (verdict = option.value)}
					class="rounded-full px-3 py-1 transition-colors {verdict === option.value
						? 'bg-[var(--color-accent)] text-white'
						: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
				>
					{option.label}
				</button>
			{/each}
			<button
				onclick={() => (revealed = true)}
				disabled={verdict === null || revealed}
				class="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 disabled:opacity-40"
			>
				Reveal
			</button>
			{#if revealed && verdictText}
				<span class="font-medium">{verdictText}</span>
			{/if}
		</div>
	{/if}
</div>
