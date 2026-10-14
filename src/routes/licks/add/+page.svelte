<script lang="ts">
	import StudioPage from '$lib/components/console/StudioPage.svelte';
</script>

<svelte:head>
	<title>Add Licks — Mankunku</title>
</svelte:head>

<div class="add-lick-entry">
	<a href="/licks" class="back-link"><span aria-hidden="true">←</span> Your licks</a>
	<StudioPage
		eyebrow="The Studio / Your lick library"
		title="Add licks"
		description="Write it note by note, or play it in."
	>
		<section class="studio-panel entry-console" aria-label="Choose how to add a lick">
			<a class="entry-bay" href="/licks/editor" aria-labelledby="editor-title" aria-describedby="editor-description">
				<div class="entry-channel">
					<span class="studio-panel-number" aria-hidden="true">01</span>
					<span>Note by note</span>
				</div>
				<div class="entry-illustration">
					<svg viewBox="0 0 360 126" aria-hidden="true">
						<rect x="30" y="14" width="300" height="98" rx="7" fill="#0d1724" stroke="#536174" />
						<rect x="36" y="20" width="288" height="86" rx="3" fill="#1e2b3b" />
						{#each Array.from({ length: 14 }, (_, i) => i) as i (i)}
							<rect x={40 + i * 20} y="24" width="18" height="76" rx="2"
								fill={i === 4 || i === 8 ? '#e09972' : '#b4bec5'}
								opacity={i === 4 || i === 8 ? 1 : 0.72} />
						{/each}
						{#each [0, 1, 3, 4, 5, 7, 8, 10, 11, 12] as i (i)}
							<rect x={53 + i * 20} y="24" width="12" height="45" rx="2" fill="#172333" stroke="#0c1420" />
						{/each}
						<path d="M40 104h280" stroke="#ffffff12" />
					</svg>
				</div>
				<div class="entry-copy">
					<h2 id="editor-title">Editor</h2>
					<p id="editor-description">Enter notes one at a time using your keyboard.</p>
				</div>
				<div class="entry-footer">
					<span class="studio-action editor-action">Open editor <span aria-hidden="true">↗</span></span>
				</div>
			</a>
			<a class="entry-bay" href="/licks/record" aria-labelledby="record-title" aria-describedby="record-description record-experimental">
				<div class="entry-channel">
					<span class="studio-panel-number" aria-hidden="true">02</span>
					<span>Play it in</span>
					<span class="experimental" id="record-experimental">Experimental</span>
				</div>
				<div class="entry-illustration">
					<svg viewBox="0 0 360 126" aria-hidden="true">
						<path d="M32 63h75M253 63h75" stroke="var(--studio-border)" />
						{#each [8, 14, 25, 39, 22, 12] as height, i (i)}
							<path d={`M${49 + i * 12} ${63 - height / 2}v${height} M${311 - i * 12} ${63 - height / 2}v${height}`}
								stroke="var(--entry-accent)" opacity={0.35 + i * 0.09} stroke-width="2" stroke-linecap="round" />
						{/each}
						<circle cx="180" cy="63" r="49" fill="var(--studio-well)" stroke="var(--studio-border)" />
						<rect x="168" y="29" width="24" height="47" rx="12" fill="var(--studio-panel-highlight)" stroke="var(--entry-accent)" stroke-width="1.5" />
						{#each [40, 46, 52] as y (y)}
							<path d={`M175 ${y}h10`} stroke="var(--entry-accent)" stroke-width="1.5" />
						{/each}
						<path d="M160 62v4a20 20 0 0 0 40 0v-4M180 86v12M169 98h22" stroke="var(--entry-accent)" stroke-width="1.5" fill="none" stroke-linecap="round" />
					</svg>
				</div>
				<div class="entry-copy">
					<h2 id="record-title">Record</h2>
					<p id="record-description">Play a phrase into your mic and save it as a lick.</p>
				</div>
				<div class="entry-footer">
					<span class="studio-action">Open recorder <span aria-hidden="true">↗</span></span>
				</div>
			</a>
		</section>
	</StudioPage>
</div>

<style>
	.add-lick-entry {
		--entry-accent: #e09972;
		max-width: 1136px;
		margin: 0 auto;
	}
	:global(:root.light) .add-lick-entry { --entry-accent: #974520; }
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		min-height: 44px;
		margin-bottom: 16px;
		color: var(--color-text-secondary);
		font-size: 12px;
	}
	.back-link:hover { color: var(--color-text); }
	.back-link:focus-visible { outline: 2px solid var(--color-brass); outline-offset: 4px; }
	.add-lick-entry :global(.studio-page-heading h1 span),
	.add-lick-entry :global(.studio-page-heading .studio-label) { color: var(--entry-accent); }
	.entry-console { display: grid; grid-template-columns: 1fr 1fr; padding: 4px; }
	.entry-bay {
		min-width: 0;
		display: flex;
		flex-direction: column;
		padding: 27px 34px 28px;
		border-radius: 3px;
		transition: background 180ms;
	}
	.entry-bay + .entry-bay { border-left: 1px solid color-mix(in srgb, var(--studio-border) 45%, transparent); }
	.entry-bay:hover { background: color-mix(in srgb, var(--studio-text) 3%, transparent); }
	.entry-channel {
		display: flex;
		align-items: center;
		gap: 11px;
		min-height: 25px;
		font-size: 9px;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		color: var(--studio-muted);
	}
	.experimental {
		margin-left: auto;
		border: 1px solid color-mix(in srgb, var(--entry-accent) 35%, transparent);
		color: var(--entry-accent);
		padding: 3px 7px;
		border-radius: 3px;
		letter-spacing: 0.025em;
		text-transform: none;
	}
	.entry-illustration { display: flex; justify-content: center; margin: 24px 0 21px; }
	.entry-illustration svg { display: block; width: 100%; max-width: 360px; height: 126px; }
	.entry-copy h2 { font: 500 30px/1.2 var(--font-display); letter-spacing: -0.025em; margin-bottom: 10px; }
	.entry-copy p { font-size: 13px; color: var(--studio-muted); line-height: 1.7; max-width: 330px; }
	.entry-footer { display: flex; margin-top: auto; padding-top: 27px; }
	.entry-footer .studio-action { justify-content: space-between; gap: 40px; font-weight: 500; }
	.editor-action { --studio-button: #ab5732; }
	.entry-footer .studio-action > span { font-size: 16px; transition: transform 180ms; }
	.entry-bay:hover .studio-action { filter: brightness(1.1); }
	.entry-bay:hover .studio-action > span { transform: translate(2px, -2px); }
	@media (max-width: 900px) {
		.entry-bay { padding: 26px 22px; }
		.entry-channel { gap: 8px; }
	}
	@media (max-width: 600px) {
		.entry-console { grid-template-columns: 1fr; }
		.entry-bay { padding: 24px; }
		.entry-bay + .entry-bay { border-left: 0; border-top: 1px solid color-mix(in srgb, var(--studio-border) 45%, transparent); }
		.entry-illustration { margin: 18px 0 16px; }
		.entry-illustration svg { height: 110px; }
		.entry-copy h2 { font-size: 28px; }
		.entry-copy p { max-width: 100%; }
		.entry-footer { padding-top: 22px; }
		.entry-footer .studio-action { width: 100%; }
	}
	@media (prefers-reduced-motion: reduce) {
		.entry-bay, .entry-footer .studio-action > span { transition: none; }
		.entry-bay:hover .studio-action > span { transform: none; }
	}
</style>
