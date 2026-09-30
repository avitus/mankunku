<script lang="ts">
	import type { TuningAlert } from '$lib/scoring/tuning';
	let { alert }: { alert: TuningAlert | null } = $props();
</script>

<!-- Reserve the line even when clear so feedback never moves the play button. -->
<div class="h-6 text-center text-xs text-[var(--color-text-secondary)]" role="status" aria-atomic="true">
	{#if alert}
		<span data-testid="tuning-notice">
			<span aria-hidden="true" class="mr-1 text-[var(--color-brass)]">{alert.direction === 'sharp' ? '♯' : '♭'}</span>
			Consistently {alert.direction} · check your tuning
		</span>
	{/if}
</div>
