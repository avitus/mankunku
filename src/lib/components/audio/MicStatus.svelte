<script lang="ts">
	import type { MicPermissionState } from '$lib/types/audio';

	interface Props {
		permission: MicPermissionState;
		inputLevel: number;
		onrequest: () => void;
	}

	let { permission, inputLevel, onrequest }: Props = $props();

	const levelWidth = $derived(Math.round(inputLevel * 100));

	const statusText = $derived(
		permission === 'granted'
			? 'Mic active'
			: permission === 'denied'
				? 'Mic blocked'
				: permission === 'unavailable'
					? 'No mic available'
					: 'Mic needed'
	);

	const statusColor = $derived(
		permission === 'granted'
			? 'var(--color-success)'
			: permission === 'denied'
				? 'var(--color-error)'
				: 'var(--color-text-secondary)'
	);
</script>

<div class="flex items-center gap-3 rounded-lg bg-[var(--color-bg-secondary)] px-4 py-2">
	<!-- Status indicator -->
	<div class="flex items-center gap-2">
		<div
			class="h-2 w-2 rounded-full"
			style="background-color: {statusColor}"
		></div>
		<span class="text-xs text-[var(--color-text-secondary)]">{statusText}</span>
	</div>

	{#if permission === 'granted'}
		<!-- Level meter -->
		<div class="flex-1">
			<div class="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
				<div
					class="h-full rounded-full transition-all duration-75"
					style="width: {levelWidth}%; background-color: {inputLevel > 0.8 ? 'var(--color-error)' : inputLevel > 0.5 ? 'var(--color-warning)' : 'var(--color-success)'}"
				></div>
			</div>
		</div>
	{:else if permission === 'prompt' || permission === 'denied'}
		<button
			onclick={onrequest}
			class="rounded bg-[var(--color-accent)] px-2 py-1 text-xs text-white hover:bg-[var(--color-accent-hover)] transition-colors"
		>
			{permission === 'denied' ? 'Retry Mic' : 'Enable Mic'}
		</button>
		{#if permission === 'denied'}
			<span class="text-xs text-[var(--color-error)]">
				Check browser permissions
			</span>
		{/if}
	{/if}
</div>
