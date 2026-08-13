<script lang="ts">
	import BrassPlayGlyph from '$lib/components/jazz/BrassPlayGlyph.svelte';
	import { getPage } from '$lib/docs/structure';

	// Docs teaser cards reuse the DOC_TREE titles/blurbs so landing copy can't
	// drift from the docs themselves.
	const docTeasers = [
		'getting-started',
		'architecture/scoring-algorithm',
		'architecture/audio-pipeline',
		'architecture/tonality-system'
	]
		.map((slug) => {
			const page = getPage(slug);
			return page ? { slug, title: page.title, blurb: page.blurb ?? '' } : null;
		})
		.filter((p) => p !== null);

	const steps = [
		{
			label: 'Listen',
			text: 'The app plays a jazz phrase in the day’s key — a real line, generated for your level, not a random interval quiz.'
		},
		{
			label: 'Echo',
			text: 'You answer on your own instrument. Concert, B♭, or E♭ — notation and playback are transposed for your horn.'
		},
		{
			label: 'See the score',
			text: 'The microphone hears your take; pitch tracking at 60 frames a second and onset detection catch every note, and your pitch and rhythm are scored in real time.'
		}
	];
</script>

<div class="space-y-12">
	<!-- Hero -->
	<section class="space-y-4 pt-4">
		<div class="smallcaps text-[var(--color-brass)]">Yakhal' Inkomo &middot; Cry of the Bull</div>
		<h1 class="font-display text-4xl font-semibold tracking-tight text-[var(--color-text)] sm:text-5xl">
			Jazz ear training that listens
		</h1>
		<p class="max-w-2xl text-lg text-[var(--color-text-secondary)]">
			Mankunku plays a phrase. You play it back on your instrument. The app listens through the
			microphone and scores your pitch and rhythm in real time — call and response, the way the
			music has always been learned.
		</p>
		<p class="max-w-2xl text-sm text-[var(--color-text-secondary)]">
			Free and open source. Runs in your browser — nothing to install, just a microphone and your
			horn.
		</p>
		<div class="flex flex-wrap items-center gap-4 pt-2">
			<a
				href="/ear-training"
				class="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
			>
				<BrassPlayGlyph size={11} class="text-white" />
				Start practicing
			</a>
			<a
				href="/docs/getting-started"
				class="rounded-lg border border-[var(--color-bg-tertiary)] px-6 py-3 text-sm font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--color-text-secondary)]"
			>
				Read the guide
			</a>
			<a
				href="/auth"
				class="text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
			>
				Sign in &rarr;
			</a>
		</div>
		<div class="jazz-rule mt-4 max-w-xs"></div>
	</section>

	<!-- How it works -->
	<section class="space-y-4">
		<h2 class="smallcaps text-[var(--color-text-secondary)]">How it works</h2>
		<div class="flex flex-col gap-4 sm:flex-row">
			{#each steps as step, i (step.label)}
				<div class="flex-1 space-y-1">
					<div class="font-display text-lg font-semibold text-[var(--color-brass)]">
						<span class="tabular-nums">{i + 1}.</span>
						{step.label}
					</div>
					<p class="text-sm text-[var(--color-text-secondary)]">{step.text}</p>
				</div>
			{/each}
		</div>
	</section>

	<!-- The two practice modes — same LP-sleeve doors as the signed-in home -->
	<section class="space-y-4">
		<h2 class="smallcaps text-[var(--color-text-secondary)]">Two sides of the record</h2>
		<div class="flex flex-col gap-4 sm:flex-row">
			<div
				data-domain="ear-training"
				data-tour="side-a"
				class="panel relative flex flex-1 flex-col overflow-hidden rounded-xl bg-[var(--color-bg-secondary)] p-6"
			>
				<div class="absolute left-0 top-0 h-full w-1 bg-[var(--color-accent)]"></div>
				<div class="flex flex-1 flex-col pl-3">
					<div class="smallcaps text-[var(--color-brass)]">Side A &middot; Ear Training</div>
					<div class="mt-2 font-display text-3xl font-semibold tracking-tight text-[var(--color-accent)]">
						Call &amp; response
					</div>
					<div class="jazz-rule my-4"></div>
					<p class="mb-5 text-sm text-[var(--color-text-secondary)]">
						The app plays, you answer. A new key and scale every day, difficulty that adapts as
						your ear sharpens, and a score for every phrase — pitch and rhythm, note by note.
					</p>
					<a
						href="/ear-training"
						class="mt-auto flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
					>
						<BrassPlayGlyph size={11} class="text-white" />
						Begin first session
					</a>
				</div>
			</div>

			<div
				data-domain="lick-practice"
				data-tour="side-b"
				class="panel relative flex flex-1 flex-col overflow-hidden rounded-xl bg-[var(--color-bg-secondary)] p-6"
			>
				<div class="absolute left-0 top-0 h-full w-1 bg-[var(--color-accent)]"></div>
				<div class="flex flex-1 flex-col pl-3">
					<div class="smallcaps text-[var(--color-brass)]">Side B &middot; Lick Practice</div>
					<div class="mt-2 font-display text-3xl font-semibold tracking-tight text-[var(--color-accent)]">
						Through the keys
					</div>
					<div class="jazz-rule my-4"></div>
					<p class="mb-5 text-sm text-[var(--color-text-secondary)]">
						Take the lines in your book through all twelve keys over a live rhythm section —
						walking bass, comping, drums — with tempo that climbs as you master each key.
					</p>
					<a
						href="/lick-practice"
						class="mt-auto flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
					>
						<BrassPlayGlyph size={11} class="text-white" />
						See how it works
					</a>
				</div>
			</div>
		</div>
	</section>

	<!-- Beyond the drills -->
	<section class="space-y-4">
		<h2 class="smallcaps text-[var(--color-text-secondary)]">Beyond the drills</h2>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-1">
				<a href="/tricks" class="font-display font-semibold text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
					Tricks
				</a>
				<p class="text-sm text-[var(--color-text-secondary)]">
					Melodic devices — enclosures, triad pairs — drilled for fluency in every key, not exact
					reproduction.
				</p>
			</div>
			<div class="space-y-1">
				<a href="/tunes" class="font-display font-semibold text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
					Tunes
				</a>
				<p class="text-sm text-[var(--color-text-secondary)]">
					Build a songbook by hand or import from iReal Pro, Band-in-a-Box, MuseScore, or a PDF
					chart — then practice your vocabulary over the changes of a real form.
				</p>
			</div>
			<div class="space-y-1">
				<a href="/licks/community" class="font-display font-semibold text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
					Community
				</a>
				<p class="text-sm text-[var(--color-text-secondary)]">
					Browse licks and tunes shared by other players, and adopt the ones worth stealing —
					every jazz musician's oldest tradition.
				</p>
			</div>
			<div class="space-y-1">
				<a href="/scales" class="font-display font-semibold text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
					Scales
				</a>
				<p class="text-sm text-[var(--color-text-secondary)]">
					A reference for every scale the app practices, organized by family with the scale
					degrees of each.
				</p>
			</div>
		</div>
	</section>

	<!-- Docs teaser -->
	<section class="space-y-4">
		<h2 class="smallcaps text-[var(--color-text-secondary)]">Under the hood</h2>
		<div class="grid gap-4 sm:grid-cols-2">
			{#each docTeasers as doc (doc.slug)}
				<a
					href="/docs/{doc.slug}"
					class="panel block rounded-xl bg-[var(--color-bg-secondary)] p-5 transition-colors hover:bg-[var(--color-bg-tertiary)]"
				>
					<div class="font-display font-semibold text-[var(--color-text)]">{doc.title}</div>
					<p class="mt-1 text-sm text-[var(--color-text-secondary)]">{doc.blurb}</p>
				</a>
			{/each}
		</div>
	</section>

	<!-- Heritage -->
	<section class="max-w-2xl space-y-2 border-t border-[var(--color-bg-tertiary)] pt-6 pb-4">
		<h2 class="smallcaps text-[var(--color-text-secondary)]">The name</h2>
		<p class="text-sm text-[var(--color-text-secondary)]">
			Mankunku is named for Winston "Mankunku" Ngozi (1943&ndash;2009), the South African tenor
			saxophonist whose 1968 album <em>Yakhal' Inkomo</em> — "the cry of the bull" — became a
			landmark of Cape jazz. The name is a reminder of what the practice is for: not the metronome,
			not the score, but the cry.
		</p>
	</section>
</div>
