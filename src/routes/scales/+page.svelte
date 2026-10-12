<script lang="ts">
	import SeoHead from '$lib/components/seo/SeoHead.svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import { SCALE_CATALOG, getMvpScales } from '$lib/music/scales';

	const mvpScales = getMvpScales();
	const families = [...new Set(mvpScales.map((scale) => scale.family))];
	/** Human-readable family heading without changing catalog identifiers. */
	const familyLabel = (family: string): string => {
		const label = family.replaceAll('-', ' ');
		return label[0].toUpperCase() + label.slice(1);
	};
	/** Printed accidentals; the accessible formula keeps the catalog text. */
	const degreeLabel = (degree: string): string => degree.replaceAll('b', '♭').replaceAll('#', '♯');
</script>

<SeoHead
	title="Scales — Mankunku"
	description="A reference for every scale Mankunku practices, organized by family with the scale degrees of each."
/>

<div class="studio-desk">
	<div class="scale-reference" data-domain="ear-training">
		<header class="scale-page-header">
			<div>
				<span class="studio-label">The changes</span>
				<h1>Scale reference<span>.</span></h1>
			</div>
			<p class="scale-count" data-testid="scale-count">
				<strong>{mvpScales.length}</strong> scales available
				<span>{SCALE_CATALOG.length} in the catalog</span>
			</p>
		</header>

		<div class="scale-layout">
			<aside>
				<nav aria-label="Scale families" class="scale-family-nav">
					<span class="studio-label">Families</span>
					{#each families as family, i (family)}
						<a href="#family-{family}">
							<span class="family-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
							<span>{familyLabel(family)}</span>
							<small aria-label="{mvpScales.filter(scale => scale.family === family).length} scales">
								{mvpScales.filter(scale => scale.family === family).length}
							</small>
						</a>
					{/each}
				</nav>
			</aside>

			<StudioPanel id="scale-formulas" number="01" title="Scale formulas" domain="ear-training">
				<div class="scale-column-head" aria-hidden="true"><span>Scale</span><span>Degrees</span></div>
				{#each families as family (family)}
					<section id="family-{family}" class="scale-family" aria-labelledby="heading-{family}">
						<h3 id="heading-{family}">{familyLabel(family)}</h3>
						{#each mvpScales.filter(scale => scale.family === family) as scale (scale.id)}
							<div class="scale-row">
								<h4>{scale.name}</h4>
								<div class="scale-degrees" role="group" aria-label="{scale.name} degrees: {scale.degrees.join(' ')}">
									{#each scale.degrees as degree, i (i)}
										<span aria-hidden="true" class:degree-root={degree === '1'} class:degree-altered={/[b#]/.test(degree)}>{degreeLabel(degree)}</span>
									{/each}
								</div>
							</div>
						{/each}
					</section>
				{/each}
			</StudioPanel>
		</div>
	</div>
</div>

<style>
	.scale-reference {
		max-width:  1200px;
		margin:  0 auto;
		--scale-line:  color-mix(in srgb, var(--studio-border) 35%, transparent);
	}
	.scale-page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 30px;
	}
	.scale-page-header h1 {
		font: 500 46px/1.15 var(--font-display);
		letter-spacing: -.04em;
		margin: 9px 0 0;
	}
	.scale-page-header h1 span {
		color: var(--studio-accent-text);
	}
	.scale-page-header>p {
		font-size: 12px;
		color: var(--studio-muted);
		text-align: right;
		margin: 0;
	}
	.scale-page-header>p strong {
		font: 500 25px var(--font-display);
		color: var(--studio-accent-text);
		margin-right: 4px;
	}
	.scale-page-header>p>span {
		display: block;
		margin-top: 5px;
		font-size: 11px;
	}
	.scale-layout {
		display: grid;
		grid-template-columns: 190px minmax(0,1fr);
		gap: 28px;
		align-items: start;
	}
	.scale-family-nav {
		position: sticky;
		top: 24px;
		padding: 6px 0;
	}
	.scale-layout>aside {
		position: sticky;
		top: 24px;
	}
	.scale-family-nav>.studio-label {
		display: block;
		margin: 0 0 17px 12px;
	}
	.scale-family-nav a {
		display: flex;
		gap: 12px;
		align-items: center;
		min-height: 44px;
		padding: 10px 12px;
		border-radius: 4px;
		color: var(--studio-muted);
		text-decoration: none;
		font-size: 12px;
	}
	.scale-family-nav a:hover {
		background: var(--studio-well);
		color: var(--studio-text);
	}
	.scale-family-nav a:focus-visible {
		outline: 2px solid var(--studio-accent-text);
		outline-offset: 2px;
	}
	.family-index {
		font: 10px monospace;
		color: var(--color-brass-soft);
	}
	.scale-family-nav a small {
		margin-left: auto;
		font: 10px monospace;
		color: var(--studio-muted);
	}
	.scale-reference :global(.studio-panel) {
		padding: 24px 28px;
	}
	.scale-reference :global(.studio-panel-heading) {
		margin-bottom: 24px;
	}
	.scale-column-head {
		display: grid;
		grid-template-columns: minmax(0,1fr) 290px;
		gap: 20px;
		font-size: 9px;
		color: var(--studio-muted);
		letter-spacing: .13em;
		text-transform: uppercase;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--studio-border);
	}
	.scale-family {
		scroll-margin-top: 24px;
		margin-top: 22px;
	}
	.scale-family h3 {
		font-size: 10px;
		font-weight: 600;
		line-height: 1.4;
		letter-spacing: .12em;
		text-transform: uppercase;
		color: var(--studio-accent-text);
		margin: 0 0 10px;
	}
	.scale-row {
		display: grid;
		grid-template-columns: minmax(0,1fr) 290px;
		gap: 20px;
		align-items: center;
		min-height: 49px;
		border-bottom: 1px solid var(--scale-line);
		padding: 9px 0;
	}
	.scale-row:last-child {
		border-bottom: 0;
	}
	.scale-row h4 {
		font: 400 18px/1.3 var(--font-display);
		margin: 0;
		color: var(--studio-text);
	}
	.scale-degrees {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
	}
	.scale-degrees>span {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 30px;
		height: 29px;
		border-radius: 3px;
		background: var(--studio-well);
		border: 1px solid var(--scale-line);
		font: 12px/1 ui-monospace,monospace;
		color: var(--studio-muted);
	}
	.scale-degrees>.degree-root {
		color: var(--color-brass-soft);
		border-color: color-mix(in srgb,var(--color-brass) 45%,transparent);
	}
	.scale-degrees>.degree-altered {
		color: var(--studio-accent-text);
	}
	@media(max-width:1050px) {
		.scale-layout {
			grid-template-columns: 160px minmax(0,1fr);
			gap: 20px;
		}
		.scale-column-head,.scale-row {
			grid-template-columns: minmax(0,1fr) 250px;
			gap: 12px;
		}
		.scale-degrees {
			gap: 4px;
		}
		.scale-degrees>span {
			min-width: 26px;
		}
		.scale-family-nav a {
			gap: 8px;
			padding-left: 6px;
			padding-right: 6px;
		}
	}
	@media(max-width:850px) {
		.scale-layout {
			grid-template-columns: 1fr;
		}
		.scale-layout>aside {
			position: static;
		}
		.scale-family-nav {
			display: flex;
			flex-wrap: wrap;
			gap: 5px;
			border-bottom: 1px solid var(--studio-border);
			padding-bottom: 18px;
		}
		.scale-family-nav>.studio-label {
			display: none;
		}
		.scale-family-nav a {
			background: var(--studio-well);
			min-height: 36px;
			padding: 8px 11px;
		}
		.family-index {
			display: none;
		}
		.scale-family-nav a small {
			margin-left: 3px;
		}
		.scale-reference :global(.studio-panel) {
			padding: 24px;
		}
	}
	@media(max-width:580px) {
		.scale-page-header {
			display: block;
			margin-bottom: 22px;
		}
		.scale-page-header h1 {
			font-size: 36px;
		}
		.scale-page-header>p {
			text-align: left;
			margin-top: 16px;
		}
		.scale-page-header>p strong {
			font: inherit;
			color: var(--studio-text);
		}
		.scale-page-header>p>span {
			display: inline;
			margin-left: 10px;
		}
		.scale-reference :global(.studio-panel) {
			padding: 22px 18px;
		}
		.scale-column-head {
			display: none;
		}
		.scale-row {
			grid-template-columns: 1fr;
			gap: 9px;
			padding: 13px 0;
		}
		.scale-row h4 {
			font-size: 18px;
		}
		.scale-family {
			margin-top: 24px;
		}
		.scale-degrees>span {
			min-width: 26px;
		}
		.scale-family-nav a {
			font-size: 11px;
		}
	}
</style>
