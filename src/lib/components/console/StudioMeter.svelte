<script lang="ts">
	/** Read-only meter: the adjacent figure remains the precise source of truth. */
	interface Props {
		value: number;
		max?: number;
		label: string;
	}
	let { value, max = 20, label }: Props = $props();
	const angle = $derived(-65 + Math.min(1, Math.max(0, value / max)) * 130);
</script>

<div class="studio-meter" role="img" aria-label="{label}: {value}">
	<svg viewBox="0 0 280 150" aria-hidden="true">
		<path d="M30 98 Q140 -12 250 98" fill="none" stroke="#86754e" />
		{#each Array.from({ length: 21 }, (_, i) => i) as i}
			{@const a = ((-65 + i * 6.5) * Math.PI) / 180}
			<line
				x1={140 + Math.sin(a) * 108}
				y1={142 - Math.cos(a) * 108}
				x2={140 + Math.sin(a) * (i % 5 === 0 ? 119 : 113)}
				y2={142 - Math.cos(a) * (i % 5 === 0 ? 119 : 113)}
				stroke="#6b6047"
			/>
		{/each}
		<text x="23" y="108">0</text><text x="140" y="27" text-anchor="middle">{max / 2}</text><text
			x="250"
			y="108">{max}</text
		>
		<text x="140" y="102" text-anchor="middle" class="studio-meter-label">{label}</text>
		<line
			x1="140"
			y1="137"
			x2="140"
			y2="31"
			transform="rotate({angle} 140 137)"
			stroke="#963f2c"
			stroke-width="1.8"
		/>
		<circle cx="140" cy="137" r="5" fill="#433c2f" />
	</svg>
</div>

<style>
	.studio-meter {
		background: radial-gradient(ellipse at 50% 30%, #fff3cd, #d4bb7f);
		border: 7px solid #111822;
		border-radius: 6px;
		box-shadow:
			inset 0 2px 9px #725e3d66,
			0 0 0 1px #71808c;
		padding: 9px 7px;
	}
	svg {
		width: 100%;
		display: block;
	}
	text {
		font:
			10px Georgia,
			serif;
		fill: #65583f;
	}
	.studio-meter-label {
		font:
			7px system-ui,
			sans-serif;
		letter-spacing: 1px;
		text-transform: uppercase;
	}
</style>
