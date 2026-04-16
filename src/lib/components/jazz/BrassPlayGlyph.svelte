<script lang="ts">
	// Filled play-triangle glyph. Uses currentColor so callers can set the
	// tone via text-[var(--color-brass)] or any other utility. The default
	// is brass because this is the Blue Note CTA glyph.
	interface Props {
		size?: number;
		class?: string;
	}
	let { size = 14, class: klass = '' }: Props = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 12 14"
	width={size}
	height={(size * 14) / 12}
	fill="currentColor"
	aria-hidden="true"
	class={klass}
>
	<path d="M1.5 0.5 L11 7 L1.5 13.5 Z" />
</svg>
