<script lang="ts">
	import { roomStatus } from '$lib/audio/room-scoring-state.svelte';

	let { subtle = false }: { subtle?: boolean } = $props();
	const label = $derived('Backing cancellation ' + (roomStatus.active ? 'on' : 'off'));
</script>

<span class="lamp" class:subtle class:lit={roomStatus.active} role="img" aria-label={label} title={label}></span>

<style>
	.lamp {
		display: inline-block;
		flex: 0 0 auto;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--studio-muted, #797e7c);
		box-shadow: inset 0 1px 2px #0009, 0 0 0 1px #0004;
	}
	.lamp.lit {
		background: radial-gradient(circle at 35% 30%, #dcffd9, #71df8b 50%, #358956);
		box-shadow: 0 0 0 1px #318147, 0 0 5px 2px #58d57888;
	}
	.lamp.subtle {
		width: 6px;
		height: 6px;
		background: #747e86;
		box-shadow: inset 0 1px 1px #0004;
	}
	.lamp.subtle.lit { background: #71af83; }
	@media (forced-colors: active) {
		.lamp, .lamp.subtle { border: 1px solid CanvasText; background: Canvas; forced-color-adjust: none; }
		.lamp.lit, .lamp.subtle.lit { background: Highlight; }
	}
</style>
