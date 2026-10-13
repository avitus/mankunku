<script lang="ts">
	/** Small, font-independent transport and editor icons. */
	let { name, size = 18 }: {
		name: 'play' | 'stop' | 'back' | 'undo' | 'redo' | 'save' | 'check' | 'keyboard' | 'loop' | 'trash' | 'close';
		size?: number;
	} = $props();
	const paths = {
		play: 'M8 5 19 12 8 19Z', stop: 'M6 6H18V18H6Z',
		back: 'm10 5-7 7 7 7M3 12h18',
		undo: 'm8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v3',
		redo: 'm16 4 5 5-5 5M21 9H11a7 7 0 0 0-7 7v3',
		save: 'M5 3H17L21 7V21H3V3ZM7 3V9H16V3M7 21V13H17V21',
		check: 'm5 12 4 4L19 6', keyboard: 'M2 5H22V19H2ZM5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M7 16h10',
		loop: 'm17 2 4 4-4 4M21 6H8a5 5 0 0 0-5 5m4 11-4-4 4-4M3 18h13a5 5 0 0 0 5-5',
		trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
		close: 'm6 6 12 12M6 18 18 6'
	};
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'play' || name === 'stop' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<path d={paths[name]} />
</svg>
