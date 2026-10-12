<script lang="ts">
	interface Props {
		total: number;
		pageSize: number;
		page: number;
		noun: string;
		position: 'Top' | 'Bottom';
		onchange: (page: number) => void;
	}
	let { total, pageSize, page, noun, position, onchange }: Props = $props();
	const pages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	const current = $derived(Math.min(page, pages));
	const start = $derived(total ? (current - 1) * pageSize + 1 : 0);
</script>

<nav class="library-pagination" aria-label="{position} {noun} pagination">
	<span>{start}–{Math.min(current * pageSize, total)} of {total} {noun}</span>
	<div>
		<button
			aria-label="Previous page"
			disabled={current === 1}
			onclick={() => onchange(current - 1)}>←</button
		>
		<span aria-live="polite">Page {current} of {pages}</span>
		<button
			aria-label="Next page"
			disabled={current === pages}
			onclick={() => onchange(current + 1)}>→</button
		>
	</div>
</nav>
