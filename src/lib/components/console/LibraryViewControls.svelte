<script lang="ts">
	interface Props {
		total: number;
		noun: string;
		view: 'compact' | 'cards';
		pageSize: number;
		onview: (view: 'compact' | 'cards') => void;
		onsize: (size: number) => void;
	}
	let { total, noun, view, pageSize, onview, onsize }: Props = $props();
</script>

<div class="library-view-controls">
	<span aria-live="polite">{total} matching {noun.toLowerCase()}</span>
	<div role="group" aria-label="Library view" class="library-view-switch">
		<button aria-pressed={view === 'compact'} onclick={() => onview('compact')}>Compact</button>
		<button aria-pressed={view === 'cards'} onclick={() => onview('cards')}>Cards</button>
	</div>
	<label
		>Show <select
			aria-label="{noun} per page"
			value={pageSize}
			onchange={(event) => onsize(Number(event.currentTarget.value))}
		>
			<option value={20}>20</option><option value={40}>40</option><option
				value={Number.MAX_SAFE_INTEGER}>All</option
			>
		</select></label
	>
</div>
