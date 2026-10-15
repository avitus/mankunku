<script lang="ts">
	let { name, size = 20 }: {
		name: 'editor' | 'pdf' | 'ireal' | 'biab' | 'musescore' | 'back' | 'arrow' | 'check' | 'book' | 'upload' | 'close';
		size?: number;
	} = $props();
	const paths = {
		editor: 'm4 16 12-12 4 4L8 20H4zM13 7l4 4M4 4h6M4 8h3',
		pdf: 'M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6',
		ireal: 'm10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
		biab: 'm12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
		musescore: 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h5',
		back: 'm10 5-7 7 7 7M3 12h18', arrow: 'M3 12h18m-7-7 7 7-7 7',
		check: 'm5 12 4 4L19 6', book: 'M12 5v16M3 3l9 2 9-2v16l-9 2-9-2z',
		upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5', close: 'm6 6 12 12M6 18 18 6'
	};
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
