<script lang="ts">
	interface Props {
		elapsedSeconds: number;
		totalSeconds: number;
	}

	let { elapsedSeconds, totalSeconds }: Props = $props();

	const progress = $derived(Math.min(1, elapsedSeconds / totalSeconds));
	const remainingSeconds = $derived(Math.max(0, totalSeconds - elapsedSeconds));

	const formatTime = (seconds: number): string => {
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	};

	const isOvertime = $derived(elapsedSeconds > totalSeconds);
</script>

<div class="flex items-center gap-3">
	<div class="flex-1 h-2 rounded-full bg-[var(--color-bg-tertiary)] overflow-hidden">
		<div
			class="h-full rounded-full transition-all duration-1000 ease-linear
				   {isOvertime ? 'bg-[var(--color-error)]' : 'bg-[var(--color-accent)]'}"
			style="width: {progress * 100}%"
		></div>
	</div>
	<span class="text-sm font-medium tabular-nums {isOvertime ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]'}">
		{isOvertime ? '+' : ''}{formatTime(isOvertime ? elapsedSeconds - totalSeconds : remainingSeconds)}
	</span>
</div>
