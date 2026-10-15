<script lang="ts">
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import TuneSourceIcon from '$lib/components/tunes/TuneSourceIcon.svelte';
	import '$lib/components/tunes/tune-add-desk.css';
	const primary = [
		{ id: 'editor', name: 'Editor', label: 'From an idea', detail: 'Enter the melody, shape the changes, and build the form. One note at a time.', cta: 'Open the editor', href: '/tunes/editor' },
		{ id: 'musescore', name: 'MuseScore', label: 'From your score', detail: 'Import a score with its melody, changes, and form. Check the matched part and written pitch.', cta: 'Import from MuseScore', href: '/tunes/import/musescore' }
	] as const;
	const secondary = [
		{ id: 'pdf', name: 'PDF Upload', formats: 'PDF · Up to 10 MB', detail: 'Turn a lead sheet into a draft, then review it.', cta: 'Import a PDF', href: '/tunes/import/pdf' },
		{ id: 'ireal', name: 'iReal Pro', formats: 'irealb:// share link', detail: 'A song or playlist link. Chords and form.', cta: 'Import from iReal Pro', href: '/tunes/import/ireal' },
		{ id: 'biab', name: 'Band-in-a-Box', formats: 'SGU / MGU · MusicXML', detail: 'Your song’s changes and form. Check import notes.', cta: 'Import from Band-in-a-Box', href: '/tunes/import/biab' }
	] as const;
</script>

<svelte:head><title>Add Tunes — Mankunku</title></svelte:head>

<div class="tune-add-desk">
	<a class="ta-back" href="/tunes"><TuneSourceIcon name="back" size={14} />Your tunes</a>
	<StudioPage eyebrow="Build your book" title="Add tunes" description="Start with an idea. Bring a score. Make it yours.">
		{#snippet actions()}{/snippet}
		<section class="ta-panel ta-primary" aria-label="Create in Editor or import from MuseScore">
			{#each primary as method, i (method.id)}
				<article class="ta-bay">
					<div class="ta-bay-heading"><span class="studio-label">0{i + 1} / {method.label}</span>{#if method.id === 'musescore'}<span class="ta-recommended">Most reliable import</span>{:else}<TuneSourceIcon name={method.id} size={21} />{/if}</div>
					{#if method.id === 'editor'}
						<div class="ta-art ta-editor" aria-hidden="true"><div class="ta-mini-heading"><span>YOUR CHART</span><TuneSourceIcon name="editor" size={17} /></div><div class="ta-untitled">Untitled tune<span>▏</span></div><div class="ta-entry-banks"><span>Melody</span><span>Changes</span><span>Form</span></div><div class="ta-chart-rule"><i></i><i></i><i></i><i></i></div></div>
					{:else}
						<div class="ta-art ta-score" aria-hidden="true"><div class="ta-paper"><span>A score worth keeping.</span><TuneSourceIcon name="musescore" size={44} /><small>SCORE</small></div><span>MSCZ · MSCX</span></div>
					{/if}
					<div class="ta-copy"><h2>{method.name}<span aria-hidden="true">.</span></h2><p>{method.detail}</p></div>
					<a class="ta-action" href={method.href}>{method.cta}<TuneSourceIcon name="arrow" size={16} /></a>
				</article>
			{/each}
		</section>
		<section class="ta-more" aria-label="More ways to add a tune">
			<header><span class="studio-label">More ways to add a tune</span><span>PDFs, links, and song files.</span></header>
			<div class="ta-panel ta-secondary">
				{#each secondary as method (method.id)}
					<article><span class="ta-method-icon"><TuneSourceIcon name={method.id} size={23} /></span><div><h3>{method.name}</h3><span class="ta-format">{method.formats}</span></div><p>{method.detail}</p><a class="ta-action ta-quiet" href={method.href}>{method.cta}<TuneSourceIcon name="arrow" size={16} /></a></article>
				{/each}
			</div>
		</section>
		<div class="ta-closing"><TuneSourceIcon name="book" size={19} /><p>However it starts, it ends up in your book.<span>Review, edit, and practice with the same familiar tools.</span></p></div>
		<footer class="ta-footer"><span>MANKUNKU <b>/</b> Your repertoire, in your hands.</span><span>From an idea to your next session.</span></footer>
	</StudioPage>
</div>
